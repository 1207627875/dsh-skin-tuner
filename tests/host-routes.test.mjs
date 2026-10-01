/**
 * Host-half tests: the routes the plugin mounts, the guards on its writes, and
 * the durable document behind them.
 *
 * `apply` is driven with a stub context, so the test proves the exact route
 * shape and the same-origin refusal without booting a harness.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

const { apply, inject } = await import(new URL('../index.js', import.meta.url))

/** A stub response that records what the handler wrote. */
function createResponse() {
  return {
    status: 0,
    headers: {},
    body: '',
    writeHead(status, headers = {}) {
      this.status = status
      Object.assign(this.headers, headers)
    },
    end(body = '') {
      this.body = body
    },
  }
}

/** A stub request over a JSON body. */
function createRequest({ method = 'GET', origin, host = '127.0.0.1:19387', body } = {}) {
  const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body))]
  return {
    method,
    headers: { host, ...(origin === undefined ? {} : { origin }) },
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk
    },
  }
}

/** Mount the plugin against a stub context and return the registered route. */
function mount() {
  let route = null
  let disposed = false
  const ctx = {
    logger: { info: () => {}, warn: () => {} },
    effect(callback) {
      callback()
    },
    webServer: {
      register(candidate) {
        route = candidate
        return () => {
          disposed = true
        }
      },
    },
  }
  apply(ctx)
  return { route, wasDisposed: () => disposed }
}

test('the plugin injects the web carrier and mounts exactly one route', () => {
  assert.deepEqual(inject, ['webServer'])
  const { route } = mount()
  assert.ok(route !== null, 'a route is registered')
  assert.equal(route.kind, 'exact')
  assert.equal(route.path, '/dsh-skin-tuner/settings')
  assert.equal(typeof route.handler, 'function')
})

test('a GET returns the document, the field schema, and the path', async () => {
  const { route } = mount()
  const response = createResponse()
  await route.handler(createRequest(), response)
  assert.equal(response.status, 200)
  const payload = JSON.parse(response.body)
  assert.equal(payload.ok, true)
  assert.ok(Array.isArray(payload.fields) && payload.fields.length === 6)
  assert.equal(typeof payload.settings.bubbleOpacity, 'number')
  assert.match(payload.path, /dsh-skin-tuner\.json$/)
  assert.equal(response.headers['Cache-Control'], 'no-store')
})

test('a cross-origin write is refused', async () => {
  const { route } = mount()
  const response = createResponse()
  await route.handler(
    createRequest({ method: 'POST', origin: 'https://evil.example', body: { bubbleOpacity: 1 } }),
    response,
  )
  assert.equal(response.status, 403)
  assert.match(JSON.parse(response.body).error, /cross-origin/)
})

test('a same-origin write is accepted and clamped', async () => {
  const { route } = mount()
  const response = createResponse()
  await route.handler(
    createRequest({
      method: 'POST',
      origin: 'http://127.0.0.1:19387',
      host: '127.0.0.1:19387',
      body: { bubbleOpacity: 900, inputCardBlur: 5 },
    }),
    response,
  )
  assert.equal(response.status, 200)
  const payload = JSON.parse(response.body)
  assert.equal(payload.settings.bubbleOpacity, 100, 'the value is clamped, not stored raw')
  assert.equal(payload.settings.inputCardBlur, 5)
})

test('an unsupported method is rejected with Allow', async () => {
  const { route } = mount()
  const response = createResponse()
  await route.handler(createRequest({ method: 'DELETE' }), response)
  assert.equal(response.status, 405)
  assert.equal(response.headers.Allow, 'POST')
})

test('a malformed write body is reported, not thrown', async () => {
  const { route } = mount()
  const response = createResponse()
  const request = createRequest({ method: 'POST', origin: 'http://127.0.0.1:19387', body: {} })
  request[Symbol.asyncIterator] = async function* broken() {
    yield Buffer.from('{not json')
  }
  await route.handler(request, response)
  assert.equal(response.status, 400)
  assert.equal(JSON.parse(response.body).ok, false)
})
