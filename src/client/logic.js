/**
 * Browser half's logic: the durable document, its observable mirror, and the
 * live application of every value onto the shell.
 *
 * The applied surface is intentionally the same contract the skin ecosystem
 * already reads - `--dsw-skin-scrim`, `--dsh-skin-bubble-alpha`,
 * `--dsh-skin-bubble-blur`, `--dsh-input-card-blur` - plus two elements this
 * plugin owns for the background and composer blurs. A skin that reads the
 * contract reacts to the tuner with no code change; a deployment with no skin
 * at all still gets working occlusion, bubble opacity, and card frost.
 *
 * @module dsh-skin-tuner/client-logic
 */

/** Route the Host half serves. */
export const SETTINGS_ROUTE = '/dsh-skin-tuner/settings'

/**
 * The canonical document, duplicated from the Host schema so the panel can
 * paint before the first response and still agree with the Host field for
 * field. The response's own `fields` win when they arrive.
 */
export const DEFAULT_FIELDS = Object.freeze([
  Object.freeze({ key: 'backgroundOpacity', min: 0, max: 100, step: 1, unit: '%', default: 0 }),
  Object.freeze({ key: 'backgroundBlurEmpty', min: 0, max: 20, step: 1, unit: 'px', default: 0 }),
  Object.freeze({ key: 'backgroundBlurContent', min: 0, max: 20, step: 1, unit: 'px', default: 0 }),
  Object.freeze({ key: 'inputCardBlur', min: 0, max: 20, step: 1, unit: 'px', default: 10 }),
  Object.freeze({ key: 'bubbleOpacity', min: 0, max: 100, step: 1, unit: '%', default: 100 }),
  Object.freeze({ key: 'bubbleBlur', min: 0, max: 20, step: 1, unit: 'px', default: 0 }),
])

/** Custom properties the shell and skins read. */
const SCRIM_VAR = '--dsw-skin-scrim'
const BUBBLE_ALPHA_VAR = '--dsh-skin-bubble-alpha'
const BUBBLE_BLUR_VAR = '--dsh-skin-bubble-blur'
const INPUT_CARD_BLUR_VAR = '--dsh-input-card-blur'

/** Marks written to `<body>` so the tuner's own CSS can gate itself. */
const ACTIVE_ATTR = 'data-skin-tuner'
const CONTENT_ATTR = 'data-skin-tuner-content'
const BUBBLE_BLUR_ATTR = 'data-skin-tuner-bubble-blur'
const COMPOSER_FROST_ATTR = 'data-skin-tuner-composer-frost'
const BACKDROP_ELEM_ATTR = 'data-skin-tuner-backdrop'

/** Empty conversation, and a conversation with at least one message. */
const COMPOSER_SELECTOR = '[data-composer-seat]'
const CONVERSATION_SELECTOR = '[data-pane="conversation"]'
const MESSAGE_ROW_SELECTOR = '[data-pane="conversation"] [data-chat-anchor-key]'

/**
 * Clamp and quantize one value against its field.
 * @param {{ min: number, max: number, step: number }} field - the field definition.
 * @param {unknown} value - raw value.
 * @returns {number} the accepted value.
 */
export function clampField(field, value) {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return field.default
  const clamped = Math.min(field.max, Math.max(field.min, numeric))
  return Math.min(field.max, Math.max(field.min, Math.round(clamped / field.step) * field.step))
}

/**
 * Resolve a partial document onto the defaults using the given field list.
 * @param {ReadonlyArray<{ key: string, default: number }>} fields - field definitions.
 * @param {unknown} stored - candidate document.
 * @returns {{ enabled: boolean } & Record<string, number>} the resolved document.
 */
export function normalize(fields, stored) {
  const source = typeof stored === 'object' && stored !== null ? stored : {}
  const resolved = { enabled: source.enabled !== false }
  for (const field of fields) resolved[field.key] = clampField(field, source[field.key])
  return resolved
}

/**
 * Minimal observable so React can subscribe with `useSyncExternalStore`.
 * @template T
 */
export class Observable {
  /** @param {T} value - the initial snapshot. */
  constructor(value) {
    this.value = value
    this.listeners = new Set()
  }

  /** @returns {T} the current snapshot. */
  getSnapshot = () => this.value

  /** @param {() => void} listener - called after every change. @returns {() => void} unsubscribe. */
  subscribe = (listener) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /**
   * Replace the snapshot when it changed by identity.
   * @param {T} next - the new snapshot.
   */
  set(next) {
    this.value = next
    for (const listener of [...this.listeners]) listener()
  }

  /**
   * Replace the snapshot through a projection of the current value.
   * @param {(current: T) => T} project - the projection.
   */
  update(project) {
    this.set(project(this.value))
  }
}

/**
 * The tuner's document controller: read once on start, write on every change,
 * keep painting optimistically while a write is in flight.
 */
export class TunerController {
  /**
   * @param {{ fetchImpl?: typeof fetch }} [options] - injectable transport for tests.
   */
  constructor(options = {}) {
    this.fetchImpl = options.fetchImpl ?? ((...args) => globalThis.fetch(...args))
    this.fields = new Observable(DEFAULT_FIELDS)
    this.settings = new Observable(normalize(DEFAULT_FIELDS, undefined))
    this.status = new Observable('idle')
    this.detail = new Observable('')
    this.warning = new Observable('')
    this.disposed = false
    this.pending = null
    this.flushTimer = null
  }

  /** Read the Host document once. Failure keeps the defaults and reports why. */
  async load() {
    this.status.set('loading')
    try {
      const response = await this.fetchImpl(SETTINGS_ROUTE, { headers: { accept: 'application/json' } })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const payload = await response.json()
      if (this.disposed) return
      if (Array.isArray(payload?.fields) && payload.fields.length > 0) this.fields.set(payload.fields)
      this.settings.set(normalize(this.fields.getSnapshot(), payload?.settings))
      this.detail.set(typeof payload?.path === 'string' ? payload.path : '')
      this.warning.set('')
      this.status.set('ready')
    } catch (error) {
      if (this.disposed) return
      this.status.set('error')
      this.warning.set(error instanceof Error ? error.message : String(error))
    }
  }

  /**
   * Change one field and queue a write.
   * @param {string} key - field key.
   * @param {unknown} value - requested value.
   */
  set(key, value) {
    const fields = this.fields.getSnapshot()
    const field = fields.find((entry) => entry.key === key)
    if (field === undefined) return
    this.settings.update((current) => ({ ...current, [key]: clampField(field, value) }))
    this.queue()
  }

  /**
   * Flip the master switch and queue a write.
   * @param {boolean} enabled - requested state.
   */
  setEnabled(enabled) {
    this.settings.update((current) => ({ ...current, enabled: enabled !== false }))
    this.queue()
  }

  /** Restore every field to its schema default and queue a write. */
  reset() {
    const defaults = { enabled: true }
    for (const field of this.fields.getSnapshot()) defaults[field.key] = field.default
    this.settings.set(defaults)
    this.queue()
  }

  /** Coalesce bursts of slider input into one write. */
  queue() {
    if (this.flushTimer !== null) return
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null
      void this.flush()
    }, 120)
  }

  /** Send the current document to the Host. */
  async flush() {
    if (this.disposed) return
    const body = JSON.stringify(this.settings.getSnapshot())
    try {
      const response = await this.fetchImpl(SETTINGS_ROUTE, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const payload = await response.json()
      if (this.disposed) return
      this.warning.set(payload?.persisted === false ? 'write refused by the Host' : '')
    } catch (error) {
      if (this.disposed) return
      this.warning.set(error instanceof Error ? error.message : String(error))
    }
  }

  /** Stop timers and drop listeners. */
  dispose() {
    this.disposed = true
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
  }
}

/**
 * Apply a document to the live shell and return the undo.
 *
 * Every value is written where the ecosystem already reads it, and the two
 * blur surfaces this plugin owns are injected as one `<style>` plus two
 * elements. Nothing here commits a change to the DOM the shell itself renders,
 * so the undo restores the previous paint exactly.
 *
 * @param {{ enabled: boolean } & Record<string, number>} settings - resolved document.
 * @param {Document} [doc] - target document, injectable for tests.
 * @returns {() => void} teardown restoring the previous paint.
 */
export function applySettings(settings, doc = document) {
  const body = doc.body
  const html = doc.documentElement
  const style = doc.createElement('style')
  style.dataset.skinTunerStyle = ''
  style.textContent = [
    `body[${ACTIVE_ATTR}] [${BACKDROP_ELEM_ATTR}] {`,
    '  position: fixed;',
    '  inset: 0;',
    '  z-index: 0;',
    '  pointer-events: none;',
    '  background: var(--dsw-alias-bg-base, rgb(0 0 0 / 45%));',
    '}',
    `body[${ACTIVE_ATTR}][${CONTENT_ATTR}] [${BACKDROP_ELEM_ATTR}] {`,
    '  backdrop-filter: blur(var(--dsh-skin-tuner-bg-blur, 0px));',
    '  -webkit-backdrop-filter: blur(var(--dsh-skin-tuner-bg-blur, 0px));',
    '}',
    `body[${ACTIVE_ATTR}][${BUBBLE_BLUR_ATTR}] ${MESSAGE_ROW_SELECTOR} > * {`,
    '  backdrop-filter: blur(var(--dsh-skin-bubble-blur, 0px));',
    '  -webkit-backdrop-filter: blur(var(--dsh-skin-bubble-blur, 0px));',
    '}',
    `body[${ACTIVE_ATTR}] [${COMPOSER_FROST_ATTR}] {`,
    '  position: fixed;',
    '  z-index: 1;',
    '  pointer-events: none;',
    '  border-radius: var(--dsw-radius-panel, 16px);',
    '  backdrop-filter: blur(var(--dsh-input-card-blur, 10px));',
    '  -webkit-backdrop-filter: blur(var(--dsh-input-card-blur, 10px));',
    '}',
    '@media (prefers-reduced-motion: reduce) {',
    `  body[${ACTIVE_ATTR}] [${BACKDROP_ELEM_ATTR}],`,
    `  body[${ACTIVE_ATTR}] [${COMPOSER_FROST_ATTR}] { transition: none; }`,
    '}',
  ].join('\n')
  doc.head.append(style)

  const previous = new Map()
  const remember = (element, property) => {
    previous.set(`${property}`, element.style.getPropertyValue(property))
  }
  const setVar = (property, value) => {
    remember(body, property)
    body.style.setProperty(property, value)
  }
  const setAttr = (element, attribute, value) => {
    const key = `attr:${attribute}`
    if (!previous.has(key)) previous.set(key, element.getAttribute(attribute))
    if (value === null) element.removeAttribute(attribute)
    else element.setAttribute(attribute, value)
  }

  const backdrop = doc.createElement('div')
  backdrop.setAttribute(BACKDROP_ELEM_ATTR, '')
  backdrop.setAttribute('aria-hidden', 'true')

  const frost = doc.createElement('div')
  frost.setAttribute(COMPOSER_FROST_ATTR, '')
  frost.setAttribute('aria-hidden', 'true')

  const enabled = settings.enabled !== false
  if (enabled) {
    body.append(backdrop, frost)
    setAttr(body, ACTIVE_ATTR, '')
    setVar(SCRIM_VAR, String(settings.backgroundOpacity / 100))
    setVar(BUBBLE_ALPHA_VAR, String(settings.bubbleOpacity / 100))
    setVar(BUBBLE_BLUR_VAR, `${settings.bubbleBlur}px`)
    setVar(INPUT_CARD_BLUR_VAR, `${settings.inputCardBlur}px`)
    if (settings.bubbleBlur > 0) setAttr(body, BUBBLE_BLUR_ATTR, '')
  }

  const timers = new Set()
  const every = (fn, ms) => {
    const id = setInterval(fn, ms)
    timers.add(id)
    return id
  }

  /** Track whether the conversation has message content, and mirror the active background blur. */
  const syncContentState = () => {
    if (!enabled) return
    const hasContent = doc.querySelector(MESSAGE_ROW_SELECTOR) !== null
    if (hasContent) setAttr(body, CONTENT_ATTR, '')
    else setAttr(body, CONTENT_ATTR, null)
    html.style.setProperty(
      '--dsh-skin-tuner-bg-blur',
      `${hasContent ? settings.backgroundBlurContent : settings.backgroundBlurEmpty}px`,
    )
  }

  /** Follow the composer card's box so the frost sits exactly behind it. */
  const syncComposerFrost = () => {
    if (!enabled) return
    const seat = doc.querySelector(COMPOSER_SELECTOR)
    if (seat === null) {
      frost.style.display = 'none'
      return
    }
    const box = seat.getBoundingClientRect()
    if (box.width === 0 || box.height === 0) {
      frost.style.display = 'none'
      return
    }
    frost.style.display = 'block'
    frost.style.left = `${box.left}px`
    frost.style.top = `${box.top}px`
    frost.style.width = `${box.width}px`
    frost.style.height = `${box.height}px`
  }

  if (enabled) {
    syncContentState()
    syncComposerFrost()
    every(syncContentState, 500)
    every(syncComposerFrost, 250)
    doc.addEventListener('scroll', syncComposerFrost, { capture: true, passive: true })
    globalThis.addEventListener?.('resize', syncComposerFrost, { passive: true })
  }

  return () => {
    for (const id of timers) clearInterval(id)
    timers.clear()
    doc.removeEventListener('scroll', syncComposerFrost, { capture: true })
    globalThis.removeEventListener?.('resize', syncComposerFrost)
    style.remove()
    backdrop.remove()
    frost.remove()
    for (const [key, value] of previous) {
      if (key.startsWith('attr:')) {
        const attribute = key.slice(5)
        if (value === null) body.removeAttribute(attribute)
        else body.setAttribute(attribute, value)
      } else if (value === '') body.style.removeProperty(key)
      else body.style.setProperty(key, value)
    }
    html.style.removeProperty('--dsh-skin-tuner-bg-blur')
  }
}

/** Conversation-pane selectors the panel documents for skinners. */
export const SELECTORS = Object.freeze({
  composer: COMPOSER_SELECTOR,
  conversation: CONVERSATION_SELECTOR,
  messageRow: MESSAGE_ROW_SELECTOR,
})
