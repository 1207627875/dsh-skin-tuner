/**
 * The appearance document's shape: defaults, ranges, and validation.
 *
 * This module is the single source of truth for both halves and for
 * `$DSH_HOME/dsh-skin-tuner.json`, so it stays dependency-free plain ESM that
 * the browser bundle can inline the same way the Host imports it.
 *
 * @module dsh-skin-tuner/schema
 */

/** Document format revision; a stored document with another value is re-defaulted field by field. */
export const SCHEMA_VERSION = 1

/** Name of the home-level appearance document (next to the harness home, not inside the profile). */
export const SETTINGS_FILENAME = 'dsh-skin-tuner.json'

/**
 * The tunable fields, in panel order. `revision` is the integer a skin's
 * stylesheet keys its presentation off; a field with no codec persists an
 * opaque JSON value instead (not used by the shipped fields).
 * @type {ReadonlyArray<{ key: string, min: number, max: number, step: number, unit: string, default: number }>}
 */
export const FIELDS = Object.freeze([
  Object.freeze({ key: 'backgroundOpacity', min: 0, max: 100, step: 1, unit: '%', default: 0 }),
  Object.freeze({ key: 'backgroundBlurEmpty', min: 0, max: 20, step: 1, unit: 'px', default: 0 }),
  Object.freeze({ key: 'backgroundBlurContent', min: 0, max: 20, step: 1, unit: 'px', default: 0 }),
  Object.freeze({ key: 'inputCardBlur', min: 0, max: 20, step: 1, unit: 'px', default: 10 }),
  Object.freeze({ key: 'bubbleOpacity', min: 0, max: 100, step: 1, unit: '%', default: 100 }),
  Object.freeze({ key: 'bubbleBlur', min: 0, max: 20, step: 1, unit: 'px', default: 0 }),
])

/** @type {Readonly<Record<string, { min: number, max: number, step: number, unit: string, default: number }>>} */
const FIELD_BY_KEY = Object.freeze(Object.fromEntries(FIELDS.map((field) => [field.key, field])))

/**
 * Whether a key is one of the persisted appearance fields.
 * @param {string} key - candidate key.
 * @returns {boolean} true for a known field.
 */
export function isField(key) {
  return Object.hasOwn(FIELD_BY_KEY, key)
}

/**
 * Clamp and quantize one field value, falling back to the schema default for
 * values that are not finite numbers.
 * @param {string} key - a key from {@link FIELDS}.
 * @param {unknown} value - raw stored or submitted value.
 * @returns {number} the accepted value.
 */
export function coerceField(key, value) {
  const field = FIELD_BY_KEY[key]
  if (field === undefined) throw new Error(`dsh-skin-tuner: unknown field ${JSON.stringify(key)}`)
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return field.default
  const clamped = Math.min(field.max, Math.max(field.min, numeric))
  const stepped = Math.round(clamped / field.step) * field.step
  return Math.min(field.max, Math.max(field.min, stepped))
}

/**
 * Merge a stored document onto the defaults and validate `enabled`.
 * @param {unknown} stored - parsed document, or anything else.
 * @returns {{ enabled: boolean, schemaVersion: number } & Record<string, number>} the resolved document.
 */
export function resolveSettings(stored) {
  const source = typeof stored === 'object' && stored !== null ? stored : {}
  const resolved = {
    enabled: source.enabled !== false,
    schemaVersion: SCHEMA_VERSION,
  }
  for (const field of FIELDS) resolved[field.key] = coerceField(field.key, source[field.key])
  return resolved
}

/**
 * Reduce a client write body to the fields it may change. Unknown keys are
 * dropped instead of throwing, so a newer panel against an older Host degrades
 * to the fields both sides know.
 * @param {unknown} body - parsed request body.
 * @returns {{ enabled?: boolean } & Record<string, number>} the patch to persist.
 */
export function resolvePatch(body) {
  const source = typeof body === 'object' && body !== null ? body : {}
  const patch = {}
  if (Object.hasOwn(source, 'enabled')) patch.enabled = source.enabled !== false
  for (const field of FIELDS) {
    if (Object.hasOwn(source, field.key)) patch[field.key] = coerceField(field.key, source[field.key])
  }
  return patch
}

/** The default document, i.e. every field untouched. */
export const DEFAULT_SETTINGS = resolveSettings(undefined)
