/**
 * Browser-half tests: the controller's optimistic paint plus the exact DOM
 * writes `applySettings` performs. The DOM is a hand-rolled stub so the test
 * stays dependency-free.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

const { DEFAULT_FIELDS, TunerController, applySettings, normalize, clampField } = await import(
  new URL('../src/client/logic.js', import.meta.url)
)

/** Minimal element stub covering the surface applySettings touches. */
function createElementStub(tag = 'div') {
  const attributes = new Map()
  const styles = new Map()
  const element = {
    tagName: tag.toUpperCase(),
    dataset: {},
    parent: null,
    children: [],
    textContent: '',
    style: {
      setProperty: (key, value) => styles.set(key, value),
      getPropertyValue: (key) => styles.get(key) ?? '',
      removeProperty: (key) => styles.delete(key),
    },
    attributes,
    getAttribute: (key) => (attributes.has(key) ? attributes.get(key) : null),
    setAttribute: (key, value) => attributes.set(key, String(value)),
    removeAttribute: (key) => attributes.delete(key),
    hasAttribute: (key) => attributes.has(key),
    append: (...nodes) => {
      for (const node of nodes) {
        node.parent = element
        element.children.push(node)
      }
    },
    remove: () => {
      const owner = element.parent
      if (owner === null) return
      const index = owner.children.indexOf(element)
      if (index >= 0) owner.children.splice(index, 1)
      element.parent = null
    },
    getBoundingClientRect: () => ({ left: 10, top: 20, width: 300, height: 40 }),
  }
  return element
}

/** Minimal document stub with one composer seat and one message row. */
function createDocumentStub({ withMessage = true } = {}) {
  const body = createElementStub('body')
  const html = createElementStub('html')
  const head = createElementStub('head')
  const seat = createElementStub('div')
  const row = createElementStub('div')
  const doc = {
    body,
    head,
    documentElement: html,
    createElement: (tag) => createElementStub(tag),
    querySelector: (selector) => {
      if (selector === '[data-composer-seat]') return seat
      if (selector === '[data-pane="conversation"] [data-chat-anchor-key]') return withMessage ? row : null
      return null
    },
    querySelectorAll: (selector) => {
      const rows = selector === '[data-pane="conversation"] [data-chat-anchor-key]' && withMessage ? [row] : []
      // Teardown asks for the rows it marked; a real document would answer that
      // query with exactly the marked rows.
      if (selector === '[data-skin-tuner-bubble]') return row.hasAttribute('data-skin-tuner-bubble') ? [row] : []
      return rows
    },
    addEventListener: () => {},
    removeEventListener: () => {},
  }
  return { doc, body, html, head, seat, row }
}

test('normalize fills defaults and clamps the outliers', () => {
  const resolved = normalize(DEFAULT_FIELDS, { bubbleOpacity: 500, inputCardBlur: -3 })
  assert.equal(resolved.bubbleOpacity, 100)
  assert.equal(resolved.inputCardBlur, 0)
  assert.equal(resolved.backgroundBlurContent, 0)
  assert.equal(resolved.enabled, true)
})

test('clampField refuses non-finite input', () => {
  const field = DEFAULT_FIELDS.find((entry) => entry.key === 'bubbleBlur')
  assert.equal(clampField(field, Number.NaN), field.default)
  assert.equal(clampField(field, 99), 20)
})

test('the controller loads, clamps writes, and coalesces the POST', async () => {
  const calls = []
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init })
    if (init.method === 'POST') {
      return { ok: true, json: async () => ({ ok: true, persisted: true }) }
    }
    return {
      ok: true,
      json: async () => ({
        ok: true,
        fields: DEFAULT_FIELDS,
        settings: { enabled: true, bubbleOpacity: 30, inputCardBlur: 4 },
        path: 'D:\\DSH\\dsh-skin-tuner.json',
      }),
    }
  }
  const controller = new TunerController({ fetchImpl })
  await controller.load()
  assert.equal(controller.settings.getSnapshot().bubbleOpacity, 30)
  assert.equal(controller.status.getSnapshot(), 'ready')

  controller.set('bubbleOpacity', 88)
  controller.set('bubbleOpacity', 91)
  controller.set('inputCardBlur', 999)
  assert.equal(controller.settings.getSnapshot().bubbleOpacity, 91)
  assert.equal(controller.settings.getSnapshot().inputCardBlur, 20)
  assert.equal(calls.filter((call) => call.init.method === 'POST').length, 0, 'writes are coalesced')

  await controller.flush()
  const posts = calls.filter((call) => call.init.method === 'POST')
  assert.equal(posts.length, 1)
  assert.deepEqual(JSON.parse(posts[0].init.body), controller.settings.getSnapshot())
  controller.dispose()
})

test('a failed load keeps the defaults and reports the reason', async () => {
  const controller = new TunerController({ fetchImpl: async () => ({ ok: false, status: 401 }) })
  await controller.load()
  assert.equal(controller.status.getSnapshot(), 'error')
  assert.equal(controller.warning.getSnapshot(), 'HTTP 401')
  assert.equal(controller.settings.getSnapshot().bubbleOpacity, 100)
  controller.dispose()
})

test('applySettings writes the shared contract and undoes it exactly', () => {
  const { doc, body, html, head, row } = createDocumentStub()
  const undo = applySettings(
    { enabled: true, backgroundOpacity: 40, backgroundBlurEmpty: 3, backgroundBlurContent: 8, inputCardBlur: 12, bubbleOpacity: 85, bubbleBlur: 6 },
    doc,
  )
  assert.equal(body.style.getPropertyValue('--dsw-skin-scrim'), '0.4')
  assert.equal(body.style.getPropertyValue('--dsh-skin-bubble-alpha'), '0.85')
  assert.equal(body.style.getPropertyValue('--dsh-skin-bubble-blur'), '6px')
  assert.equal(body.style.getPropertyValue('--dsh-input-card-blur'), '12px')
  assert.equal(body.hasAttribute('data-skin-tuner'), true)
  assert.equal(html.hasAttribute('data-skin-tuner-bubble-blur'), true)
  assert.equal(head.children.length, 1, 'one style element is injected')
  // Both painted surfaces live on the document element, outside the app root.
  assert.equal(html.children.length, 2, 'backdrop and composer frost are appended to <html>')
  assert.equal(body.children.length, 0, 'nothing is injected into the app subtree')
  // With content present the "with content" blur step is the active one.
  assert.equal(body.style.getPropertyValue('--dsh-skin-tuner-bg-blur'), '8px')
  assert.equal(html.children[0].getAttribute('data-blur'), '')
  // The bubble rule targets rows explicitly, and only while the slider asks.
  assert.equal(row.hasAttribute('data-skin-tuner-bubble'), true)
  assert.equal(html.hasAttribute('data-skin-tuner-bubble-blur'), true, 'the marker that gates the bubble rule is on the document element')

  undo()
  assert.equal(body.style.getPropertyValue('--dsw-skin-scrim'), '')
  assert.equal(body.style.getPropertyValue('--dsh-input-card-blur'), '')
  assert.equal(body.style.getPropertyValue('--dsh-skin-tuner-bg-blur'), '')
  assert.equal(body.hasAttribute('data-skin-tuner'), false)
  assert.equal(html.hasAttribute('data-skin-tuner-bubble-blur'), false, 'the bubble marker leaves the document element')
  assert.equal(row.hasAttribute('data-skin-tuner-bubble'), false, 'the bubble marker leaves every row')
  assert.equal(head.children.length, 0)
  assert.equal(html.children.length, 0)
})

test('a zero blur keeps backdrop-filter off entirely', () => {
  const { doc, html } = createDocumentStub({ withMessage: false })
  const undo = applySettings(
    { enabled: true, backgroundOpacity: 0, backgroundBlurEmpty: 0, backgroundBlurContent: 0, inputCardBlur: 0, bubbleOpacity: 100, bubbleBlur: 0 },
    doc,
  )
  // `blur(0px)` still creates a backdrop root, so the attribute must be absent.
  assert.equal(html.children[0].hasAttribute('data-blur'), false, 'no backdrop blur at 0')
  assert.equal(html.children.length, 1, 'no composer frost element is created at 0')
  assert.equal(html.hasAttribute('data-skin-tuner-bubble-blur'), false, 'no bubble blur marker at 0')
  undo()
})

test('a disabled tuner writes nothing at all', () => {
  const { doc, body, html, head } = createDocumentStub()
  const undo = applySettings({ enabled: false, backgroundOpacity: 40, bubbleOpacity: 0, bubbleBlur: 6, inputCardBlur: 12, backgroundBlurContent: 8, backgroundBlurEmpty: 0 }, doc)
  assert.equal(body.hasAttribute('data-skin-tuner'), false)
  assert.equal(body.style.getPropertyValue('--dsw-skin-scrim'), '')
  assert.equal(html.children.length, 0)
  assert.equal(head.children.length, 1, 'the stylesheet is still present but gated off')
  undo()
  assert.equal(head.children.length, 0)
})
