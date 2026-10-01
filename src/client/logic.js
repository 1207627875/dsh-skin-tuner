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

/** Marks the tuner writes so its own CSS can gate itself. */
const ACTIVE_ATTR = 'data-skin-tuner'
const BUBBLE_BLUR_ATTR = 'data-skin-tuner-bubble-blur'
const BUBBLE_BLUR_TARGET_ATTR = 'data-skin-tuner-bubble'
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
    `html > [${BACKDROP_ELEM_ATTR}] {`,
    '  position: fixed;',
    '  inset: 0;',
    '  z-index: 0;',
    '  pointer-events: none;',
    '  background: var(--dsw-alias-bg-base, rgb(0 0 0 / 45%));',
    '}',
    // `isolation: isolate` gives each blurred element its own backdrop root.
    // Without it a backdrop-filter element blurs everything painted below it -
    // including the other one of ours - which used to smear the composer frost
    // into the conversation.
    `html > [${BACKDROP_ELEM_ATTR}][data-blur] {`,
    '  isolation: isolate;',
    '  backdrop-filter: blur(var(--dsh-skin-tuner-bg-blur, 0px));',
    '  -webkit-backdrop-filter: blur(var(--dsh-skin-tuner-bg-blur, 0px));',
    '}',
    `html > [${COMPOSER_FROST_ATTR}][data-blur] {`,
    '  isolation: isolate;',
    '  backdrop-filter: blur(var(--dsh-input-card-blur, 10px));',
    '  -webkit-backdrop-filter: blur(var(--dsh-input-card-blur, 10px));',
    '}',
    `html > [${COMPOSER_FROST_ATTR}] {`,
    '  position: fixed;',
    '  z-index: 1;',
    '  pointer-events: none;',
    '  border-radius: var(--dsw-radius-panel, 16px);',
    '}',
    // Bubble blur is the only rule that a skin may already implement; it stays
    // off unless the slider actually asks for it, so the default paint is
    // byte-identical to no tuner at all.
    `html[${BUBBLE_BLUR_ATTR}] [${BUBBLE_BLUR_TARGET_ATTR}] {`,
    '  isolation: isolate;',
    '  backdrop-filter: blur(var(--dsh-skin-bubble-blur, 0px));',
    '  -webkit-backdrop-filter: blur(var(--dsh-skin-bubble-blur, 0px));',
    '}',
  ].join('\n')
  doc.head.append(style)

  const startingBodyVars = new Map()
  const previousAttrs = new Map()
  const setVar = (property, value) => {
    // The value seen before this plugin ever wrote the property is the only one
    // worth restoring; a value it wrote itself and then moved (the empty vs
    // with-content blur step) must be cleared, not reinstated.
    if (!startingBodyVars.has(property)) startingBodyVars.set(property, body.style.getPropertyValue(property))
    body.style.setProperty(property, value)
  }
  const setAttr = (element, attribute, value) => {
    const scope = element === html ? 'html' : 'body'
    const key = `attr:${attribute}|${scope}`
    if (!previousAttrs.has(key)) previousAttrs.set(key, element.getAttribute(attribute))
    if (value === null) element.removeAttribute(attribute)
    else element.setAttribute(attribute, value)
  }

  const backdrop = doc.createElement('div')
  backdrop.setAttribute(BACKDROP_ELEM_ATTR, '')
  backdrop.setAttribute('aria-hidden', 'true')

  const frost = doc.createElement('div')
  frost.setAttribute(COMPOSER_FROST_ATTR, '')
  frost.setAttribute('aria-hidden', 'true')

  /**
   * Mirror the active background blur onto the backdrop. A zero strength drops
   * the attribute as well, so `backdrop-filter` is absent rather than `blur(0)`
   * - the latter still creates a backdrop root and a compositing layer.
   * @param {number} value - the blur strength in px.
   */
  const setBlurStrength = (value) => {
    if (value > 0) {
      backdrop.setAttribute('data-blur', '')
      setVar('--dsh-skin-tuner-bg-blur', `${value}px`)
    } else {
      backdrop.removeAttribute('data-blur')
      body.style.removeProperty('--dsh-skin-tuner-bg-blur')
    }
  }

  const enabled = settings.enabled !== false
  if (enabled) {
    // Both surfaces live on the document element, outside the app root: `body`
    // is the app's own subtree, where an ancestor's filter/transform turns a
    // `position: fixed` child into a positioned descendant and the surface
    // lands in the wrong place.
    html.append(backdrop)
    if (settings.inputCardBlur > 0) {
      frost.setAttribute('data-blur', '')
      html.append(frost)
    }
    setAttr(body, ACTIVE_ATTR, '')
    setAttr(html, BUBBLE_BLUR_ATTR, settings.bubbleBlur > 0 ? '' : null)
    setVar(SCRIM_VAR, String(settings.backgroundOpacity / 100))
    setVar(BUBBLE_ALPHA_VAR, String(settings.bubbleOpacity / 100))
    setVar(BUBBLE_BLUR_VAR, `${settings.bubbleBlur}px`)
    setVar(INPUT_CARD_BLUR_VAR, `${settings.inputCardBlur}px`)
    setBlurStrength(settings.backgroundBlurEmpty)
  }

  const timers = new Set()
  const every = (fn, ms) => {
    const id = setInterval(fn, ms)
    timers.add(id)
    return id
  }

  /** Follow the conversation state into the empty vs with-content blur step. */
  const syncContentState = () => {
    if (!enabled) return
    const hasContent = doc.querySelector(MESSAGE_ROW_SELECTOR) !== null
    setBlurStrength(hasContent ? settings.backgroundBlurContent : settings.backgroundBlurEmpty)
  }

  /**
   * Mark the message rows the bubble-blur rule targets, and only while the
   * slider asks for it: with the value at 0 no rule matches any row.
   */
  const syncBubbleBlurTargets = () => {
    if (!enabled) return
    const wanted = settings.bubbleBlur > 0
    if (!wanted) setAttr(html, BUBBLE_BLUR_ATTR, null)
    for (const row of doc.querySelectorAll(MESSAGE_ROW_SELECTOR)) {
      if (wanted) row.setAttribute(BUBBLE_BLUR_TARGET_ATTR, '')
      else row.removeAttribute(BUBBLE_BLUR_TARGET_ATTR)
    }
  }

  /** Follow the composer card's box so the frost sits exactly behind it. */
  const syncComposerFrost = () => {
    if (!enabled || settings.inputCardBlur <= 0) return
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
    syncBubbleBlurTargets()
    syncComposerFrost()
    every(syncContentState, 500)
    every(syncBubbleBlurTargets, 1000)
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
    for (const row of doc.querySelectorAll(`[${BUBBLE_BLUR_TARGET_ATTR}]`)) {
      row.removeAttribute(BUBBLE_BLUR_TARGET_ATTR)
    }
    for (const [property, starting] of startingBodyVars) {
      if (starting === '') body.style.removeProperty(property)
      else body.style.setProperty(property, starting)
    }
    startingBodyVars.clear()
    for (const [key, value] of previousAttrs) {
      const [attribute, scope] = key.slice(5).split('|')
      const element = scope === 'html' ? html : body
      if (value === null) element.removeAttribute(attribute)
      else element.setAttribute(attribute, value)
    }
    previousAttrs.clear()
  }
}

/** Conversation-pane selectors the panel documents for skinners. */
export const SELECTORS = Object.freeze({
  composer: COMPOSER_SELECTOR,
  conversation: CONVERSATION_SELECTOR,
  messageRow: MESSAGE_ROW_SELECTOR,
})
