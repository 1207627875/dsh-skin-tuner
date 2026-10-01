/**
 * dsh-skin-tuner, Host half.
 *
 * Serves the durable appearance document on `/dsh-skin-tuner/settings` so the
 * browser half can read it on start and write it back on every slider move.
 * The Host owns validation and the atomic file write; it applies nothing
 * itself and depends on no skin, theme, or another plugin's storage.
 *
 * @module dsh-skin-tuner
 */

import { FIELDS, SCHEMA_VERSION } from './src/host/schema.js'
import { readSettings, settingsPath, writeSettings } from './src/host/store.js'

/** The route table needs the web carrier; without it this plugin has nothing to serve. */
export const inject = ['webServer']

/** Every route this plugin owns lives under one prefix. */
const ROUTE_PREFIX = '/dsh-skin-tuner'

/** Refuse write bodies larger than any legitimate document. */
const MAX_BODY_BYTES = 16_384

/** Hostnames that only ever mean "this machine". */
const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '[::1]', '::1'])

/**
 * Split a `host:port` authority, tolerating the bracketed IPv6 form.
 * @param {string} authority - a Host header value or an Origin's host.
 * @returns {{ hostname: string, port: string } | null} the parts, or null when unparsable.
 */
function splitAuthority(authority) {
  const match = /^(\[[^\]]+\]|[^:]+)(?::(\d+))?$/u.exec(authority.trim())
  if (match === null) return null
  return { hostname: match[1].toLowerCase(), port: match[2] ?? '' }
}

/**
 * Reply with JSON.
 * @param {import('node:http').ServerResponse} response - the pending response.
 * @param {number} status - HTTP status code.
 * @param {unknown} value - JSON-serializable body.
 */
function sendJson(response, status, value) {
  const body = JSON.stringify(value)
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': String(Buffer.byteLength(body)),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  })
  response.end(body)
}

/**
 * Accept only the methods this route serves.
 * @param {import('node:http').IncomingMessage} request - the request.
 * @param {import('node:http').ServerResponse} response - the response.
 * @param {string[]} allowed - accepted methods.
 * @returns {boolean} true when the caller may continue.
 */
function methodGuard(request, response, allowed) {
  if (allowed.includes(request.method ?? '')) return true
  response.writeHead(405, { Allow: allowed.join(', ') })
  response.end()
  return false
}

/**
 * Require a same-origin write: a cross-site page must not be able to change the
 * GUI's appearance through the loopback listener.
 * @param {import('node:http').IncomingMessage} request - the request.
 * @returns {boolean} true when the write may proceed.
 */
function sameOrigin(request) {
  const origin = request.headers.origin
  const host = request.headers.host
  if (typeof origin !== 'string' || typeof host !== 'string') return false
  let parsed
  try {
    parsed = new URL(origin)
  } catch {
    return false
  }
  if (parsed.host === host) return true
  // Two spellings of the same loopback listener are one origin: the page may be
  // open as `127.0.0.1` while a request carries `localhost`, or the reverse.
  // The desktop app serves the page and the API from the same listener, so the
  // ports always agree; a differing explicit port is a different origin.
  const source = splitAuthority(parsed.host)
  const target = splitAuthority(host)
  if (source === null || target === null) return false
  const portsAgree = source.port === '' || target.port === '' || source.port === target.port
  return portsAgree && LOOPBACK_HOSTNAMES.has(source.hostname) && LOOPBACK_HOSTNAMES.has(target.hostname)
}

/**
 * Read and parse a JSON request body within a size cap.
 * @param {import('node:http').IncomingMessage} request - the request.
 * @returns {Promise<unknown>} the parsed body.
 * @throws when the stream is unreadable, too large, or not JSON.
 */
async function readJsonBody(request) {
  if (typeof request[Symbol.asyncIterator] !== 'function') throw new Error('unreadable request stream')
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) throw new Error(`body exceeds ${MAX_BODY_BYTES} bytes`)
    chunks.push(chunk)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (text.trim().length === 0) return {}
  return JSON.parse(text)
}

/**
 * Mount the routes.
 * @param {import('@deepseek-ai/cordis').Context} ctx - the plugin context.
 */
export function apply(ctx) {
  const logger = ctx.logger
  const warn = (message) => logger?.warn?.(`dsh-skin-tuner: ${message}`)

  ctx.effect(() => {
    const dispose = ctx.webServer.register({
      kind: 'exact',
      path: `${ROUTE_PREFIX}/settings`,
      handler: async (request, response) => {
        const method = request.method ?? 'GET'
        if (method === 'GET') {
          sendJson(response, 200, {
            ok: true,
            schemaVersion: SCHEMA_VERSION,
            fields: FIELDS,
            settings: readSettings({ warn }),
            path: settingsPath(),
          })
          return
        }
        if (!methodGuard(request, response, ['POST'])) return
        if (!sameOrigin(request)) {
          // The panel shows this text, so it names exactly what was refused.
          warn(`refused a write with Origin ${JSON.stringify(request.headers.origin ?? null)} for Host ${JSON.stringify(request.headers.host ?? null)}`)
          sendJson(response, 403, {
            ok: false,
            error: `cross-origin writes are refused (Origin ${JSON.stringify(request.headers.origin ?? null)}, Host ${JSON.stringify(request.headers.host ?? null)})`,
          })
          return
        }
        try {
          const body = await readJsonBody(request)
          const { settings, persisted } = writeSettings(body, { warn })
          sendJson(response, 200, { ok: true, persisted, settings })
        } catch (error) {
          sendJson(response, 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
        }
      },
    })
    return () => {
      try {
        dispose()
      } catch {
        /* a route already gone is not an error */
      }
    }
  }, 'dsh-skin-tuner: settings route')

  logger?.info?.(`dsh-skin-tuner ready - appearance document at ${settingsPath()}`)
}
