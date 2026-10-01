/**
 * Bundle smoke test: load the built `client.js` the way the app's module loader
 * does and run the whole browser half against stubs.
 *
 * This catches what unit tests on the sources cannot: a missing banner, a
 * tree-shaken stylesheet, an accidental top-level dependency on something only
 * the app provides, or an `apply()` that throws before it registers anything.
 * Run `npm run build` first; the test fails with a clear message when the
 * artifact is missing.
 *
 * Teardown runs from a `finally` block: the paint installs real timers, and a
 * failing assertion must still clear them or the test process never exits.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'

const bundlePath = new URL('../client.js', import.meta.url)

/** Minimal element stub (same surface the logic tests exercise). */
function createElementStub(tag = 'div') {
  const attributes = new Map()
  const styles = new Map()
  const element = {
    tagName: tag.toUpperCase(),
    parent: null,
    children: [],
    textContent: '',
    style: {
      setProperty: (key, value) => styles.set(key, value),
      getPropertyValue: (key) => styles.get(key) ?? '',
      removeProperty: (key) => styles.delete(key),
    },
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
  // A real `dataset` writes the matching data-* attribute; mirror that so a
  // `dataset.foo = ''` marker is observable exactly like `setAttribute`.
  element.dataset = new Proxy(
    {},
    {
      set: (_target, property, value) => {
        element.setAttribute(`data-${String(property).replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`, value)
        return true
      },
      get: (_target, property) => {
        const attribute = `data-${String(property).replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`
        return attributes.has(attribute) ? attributes.get(attribute) : undefined
      },
      has: (_target, property) => {
        const attribute = `data-${String(property).replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`
        return attributes.has(attribute)
      },
    },
  )
  return element
}

/** A React stand-in: hooks resolve to plain values, and element factories record the tree. */
function createReactStub() {
  let captured = null
  const record = (type, props, children) => {
    captured = { type, props, children }
    return captured
  }
  return {
    module: {
      useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
      useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
      useEffect: () => {},
      createElement: (type, props, ...children) => record(type, props, children),
      // The bundle is built with the automatic JSX runtime, so the panel's element
      // factories are jsx/jsxs rather than createElement.
      jsx: (type, props) => record(type, props, props?.children),
      jsxs: (type, props) => record(type, props, props?.children),
      Fragment: Symbol('Fragment'),
    },
    captured: () => captured,
  }
}

test('the built client bundle loads, registers, and tears down cleanly', async () => {
  if (!existsSync(bundlePath)) {
    assert.fail('client.js is missing - run `npm run build` before this test')
  }
  const source = readFileSync(bundlePath, 'utf8')
  assert.match(source, /^window\.__ModuleLoader__\.load\(\{id:"dsh-skin-tuner",factory:/, 'bundle wrapper is missing')

  const react = createReactStub()
  const loaders = []
  const body = createElementStub('body')
  const head = createElementStub('head')
  const html = createElementStub('html')
  const seat = createElementStub('div')
  const row = createElementStub('div')
  const documentStub = {
    body,
    head,
    documentElement: html,
    createElement: (tag) => createElementStub(tag),
    querySelector: (selector) => {
      if (selector === '[data-composer-seat]') return seat
      if (selector === '[data-pane="conversation"] [data-chat-anchor-key]') return row
      return null
    },
    addEventListener: () => {},
    removeEventListener: () => {},
  }

  globalThis.window = { __ModuleLoader__: { load: (descriptor) => { loaders.push(descriptor) } } }
  globalThis.document = documentStub

  const fetched = []
  globalThis.fetch = async (url, init = {}) => {
    fetched.push({ url, method: init.method ?? 'GET' })
    return {
      ok: true,
      json: async () => ({
        ok: true,
        settings: { enabled: true, backgroundOpacity: 20, bubbleOpacity: 90, inputCardBlur: 8 },
        path: 'D:\\DSH\\dsh-skin-tuner.json',
      }),
    }
  }

  const disposers = []
  let teardownDone = false
  const teardown = () => {
    if (teardownDone) return
    teardownDone = true
    for (const dispose of disposers.reverse()) {
      if (typeof dispose === 'function') dispose()
    }
  }

  try {
    const require = (id) => {
      if (id === 'react' || id === 'react/jsx-runtime') return react.module
      throw new Error(`unexpected external require(${JSON.stringify(id)})`)
    }

    // eslint-disable-next-line no-new-func -- the bundle is a script, exactly as the browser evaluates it
    new Function('window', 'document', 'require', source)(globalThis.window, documentStub, require)
    assert.equal(loaders.length, 1)
    assert.equal(loaders[0].id, 'dsh-skin-tuner')
    const factory = loaders[0].factory
    assert.equal(typeof factory, 'function')

    const exports = factory(require)
    assert.equal(typeof exports.apply, 'function', 'the bundle must export apply')
    assert.deepEqual(exports.inject, ['slots', 'locale'])
    assert.equal(typeof exports.mountStyles, 'function')

    const registered = []
    let rendered = null
    const ctx = {
      effect(callback) {
        disposers.push(callback())
      },
      locale: {
        bind: () => (key) => key,
        register: () => {},
      },
      slots: {
        inject: (_name, callback) => {
          registered.push(callback())
        },
        register: (descriptor, Component) => {
          rendered = { descriptor, Component }
          return () => {}
        },
      },
    }

    exports.apply(ctx)

    assert.equal(registered.length, 1, 'one settings.section injection is registered')
    assert.ok(rendered !== null, 'the section component is registered')
    assert.equal(rendered.descriptor.id, 'skin-tuner')
    assert.equal(rendered.descriptor.name, 'settings.section')
    assert.equal(typeof rendered.descriptor.label(), 'string')
    assert.equal(typeof rendered.descriptor.inject().t, 'function')

    const panelStyles = head.children.filter((node) => node.getAttribute('data-skin-tuner-panel') !== null)
    const paintStyles = head.children.filter((node) => node.getAttribute('data-skin-tuner-style') !== null)
    assert.equal(panelStyles.length, 1, 'the panel stylesheet is mounted')
    assert.match(panelStyles[0].textContent, /dsh-skin-tuner-range/)
    assert.equal(paintStyles.length, 1, 'the paint stylesheet is mounted')
    assert.match(paintStyles[0].textContent, /--dsh-skin-bubble-blur/)
    assert.equal(body.hasAttribute('data-skin-tuner'), true, 'the tuner is active')
    // The first paint uses the defaults; the Host document arrives right after.
    assert.equal(body.style.getPropertyValue('--dsh-skin-bubble-alpha'), '1')

    // Render the panel: the React stub records the outermost element.
    rendered.Component({
      controller: {
        fields: { subscribe: () => () => {}, getSnapshot: () => [] },
        settings: { subscribe: () => () => {}, getSnapshot: () => ({ enabled: true }) },
        detail: { subscribe: () => () => {}, getSnapshot: () => '' },
        warning: { subscribe: () => () => {}, getSnapshot: () => '' },
        set: () => {},
        setEnabled: () => {},
        reset: () => {},
      },
      t: (key) => key,
    })
    const tree = react.captured()
    assert.ok(tree !== null, 'the panel renders an element')
    assert.equal(tree.props.className, 'dsh-skin-tuner')

    await new Promise((resolve) => setTimeout(resolve, 20))
    assert.equal(fetched[0].url, '/dsh-skin-tuner/settings', 'the panel reads the Host document')
    assert.equal(body.style.getPropertyValue('--dsh-skin-bubble-alpha'), '0.9', 'the stored document repaints')
  } finally {
    teardown()
    delete globalThis.window
    delete globalThis.document
    delete globalThis.fetch
  }

  assert.equal(body.hasAttribute('data-skin-tuner'), false, 'teardown removes every marker')
  assert.equal(head.children.length, 0, 'teardown removes both stylesheets')
  assert.equal(body.children.length, 0, 'teardown removes the paint elements')
  // The paint installs real timers; a leak here would hang the whole test run
  // instead of failing a test, so assert the loop is empty.
  assert.deepEqual(process.getActiveResourcesInfo().filter((kind) => kind === 'Timeout'), [])
})
