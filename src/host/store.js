/**
 * Durable appearance document at `$DSH_HOME/dsh-skin-tuner.json`.
 *
 * The document is plain JSON next to the harness home so the tuner keeps its
 * own state: it survives a restart, needs no profile patch, and never writes
 * into a skin's or another plugin's storage.
 *
 * @module dsh-skin-tuner/store
 */

import { readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_SETTINGS, SETTINGS_FILENAME, resolvePatch, resolveSettings } from './schema.js'

/** Environment variable that overrides the default harness home. */
const DSH_HOME_ENV = 'DSH_HOME'

/** The default harness home directory name under the OS home. */
const DSH_HOME_DIR_NAME = '.dsh'

/**
 * The harness home: `DSH_HOME` when it is set to a non-empty value, otherwise
 * `~/.dsh`. Mirrors `@deepseek-ai/dsh-home-paths` so this plugin also resolves
 * correctly when it is loaded outside the app (tests, a bare checkout).
 * @returns {string} the absolute harness home.
 */
function harnessHome() {
  const configured = process.env[DSH_HOME_ENV]
  if (typeof configured === 'string' && configured.trim().length > 0) return configured.trim()
  return join(homedir(), DSH_HOME_DIR_NAME)
}

/** Resolve the document path against the live harness home. */
function documentPath() {
  return join(harnessHome(), SETTINGS_FILENAME)
}

/**
 * Read the document. A missing, unreadable, or unparsable file resolves to the
 * defaults instead of failing: a bad appearance document must never be able to
 * take the GUI down.
 * @param {{ warn?: (message: string) => void }} [options] - diagnostic sink.
 * @returns {{ enabled: boolean, schemaVersion: number } & Record<string, number>} the resolved document.
 */
export function readSettings(options = {}) {
  const warn = options.warn
  const filename = documentPath()
  let text
  try {
    text = readFileSync(filename, 'utf8')
  } catch (error) {
    if (error?.code !== 'ENOENT' && typeof warn === 'function') warn(`cannot read ${filename} (${String(error)})`)
    return { ...DEFAULT_SETTINGS }
  }
  try {
    // A byte-order mark is what every Windows editor writes when the file is
    // saved by hand; `JSON.parse` rejects it, and a hand-edited file must not
    // silently revert the panel to its defaults.
    return resolveSettings(JSON.parse(stripByteOrderMark(text)))
  } catch (error) {
    if (typeof warn === 'function') warn(`${filename} is not valid JSON (${String(error)}); using defaults`)
    return { ...DEFAULT_SETTINGS }
  }
}

/**
 * Drop a leading UTF-8 byte-order mark.
 * @param {string} text - file contents.
 * @returns {string} the contents without a leading BOM.
 */
export function stripByteOrderMark(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

/**
 * Merge a patch onto the stored document and write it back atomically.
 * @param {unknown} body - the client's write body.
 * @param {{ warn?: (message: string) => void }} [options] - diagnostic sink.
 * @returns {{ settings: Record<string, unknown>, persisted: boolean }} the document after the write.
 */
export function writeSettings(body, options = {}) {
  const warn = options.warn
  const current = readSettings(options)
  const settings = resolveSettings({ ...current, ...resolvePatch(body) })
  const filename = documentPath()
  const temporary = `${filename}.${process.pid}.tmp`
  try {
    writeFileSync(temporary, `${JSON.stringify(settings, undefined, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    renameSync(temporary, filename)
    return { settings, persisted: true }
  } catch (error) {
    try {
      unlinkSync(temporary)
    } catch {
      /* the temporary file may never have been created */
    }
    if (typeof warn === 'function') warn(`cannot write ${filename} (${String(error)})`)
    return { settings, persisted: false }
  }
}

/** The absolute document path, for diagnostics and tests. */
export function settingsPath() {
  return documentPath()
}
