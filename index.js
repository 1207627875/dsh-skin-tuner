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
 * @returns {boolean} true when Origin matches Host.
 */
function sameOrigin(request) {
  const origin = request.headers.origin
  const host = request.headers.host
  if (typeof origin !== 'string' || typeof host !== 'string') return false
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
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
          sendJson(response, 403, { ok: false, error: 'cross-origin writes are refused' })
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
