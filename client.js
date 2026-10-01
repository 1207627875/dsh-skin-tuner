window.__ModuleLoader__.load({id:"dsh-skin-tuner",factory:(require)=>{var module={exports:{}};var exports=module.exports;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client/index.jsx
var index_exports = {};
__export(index_exports, {
  DEFAULT_FIELDS: () => DEFAULT_FIELDS,
  apply: () => apply,
  dictionaries: () => dictionaries,
  fieldKeys: () => fieldKeys,
  inject: () => inject,
  mountStyles: () => mountStyles,
  skinCenterActive: () => skinCenterActive
});
module.exports = __toCommonJS(index_exports);
var import_react = require("react");

// src/client/logic.js
var SETTINGS_ROUTE = "/dsh-skin-tuner/settings";
var DEFAULT_FIELDS = Object.freeze([
  Object.freeze({ key: "backgroundOpacity", min: 0, max: 100, step: 1, unit: "%", default: 0 }),
  Object.freeze({ key: "backgroundBlurEmpty", min: 0, max: 20, step: 1, unit: "px", default: 0 }),
  Object.freeze({ key: "backgroundBlurContent", min: 0, max: 20, step: 1, unit: "px", default: 0 }),
  Object.freeze({ key: "inputCardBlur", min: 0, max: 20, step: 1, unit: "px", default: 10 }),
  Object.freeze({ key: "bubbleOpacity", min: 0, max: 100, step: 1, unit: "%", default: 100 }),
  Object.freeze({ key: "bubbleBlur", min: 0, max: 20, step: 1, unit: "px", default: 0 })
]);
var SCRIM_VAR = "--dsw-skin-scrim";
var BUBBLE_ALPHA_VAR = "--dsh-skin-bubble-alpha";
var BUBBLE_BLUR_VAR = "--dsh-skin-bubble-blur";
var INPUT_CARD_BLUR_VAR = "--dsh-input-card-blur";
var ACTIVE_ATTR = "data-skin-tuner";
var BUBBLE_BLUR_ATTR = "data-skin-tuner-bubble-blur";
var BUBBLE_BLUR_TARGET_ATTR = "data-skin-tuner-bubble";
var COMPOSER_FROST_ATTR = "data-skin-tuner-composer-frost";
var BACKDROP_ELEM_ATTR = "data-skin-tuner-backdrop";
var COMPOSER_SELECTOR = "[data-composer-seat]";
var CONVERSATION_SELECTOR = '[data-pane="conversation"]';
var MESSAGE_ROW_SELECTOR = '[data-pane="conversation"] [data-chat-anchor-key]';
function clampField(field, value) {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return field.default;
  const clamped = Math.min(field.max, Math.max(field.min, numeric));
  return Math.min(field.max, Math.max(field.min, Math.round(clamped / field.step) * field.step));
}
function normalize(fields, stored) {
  const source = typeof stored === "object" && stored !== null ? stored : {};
  const resolved = { enabled: source.enabled !== false };
  for (const field of fields) resolved[field.key] = clampField(field, source[field.key]);
  return resolved;
}
var Observable = class {
  /** @param {T} value - the initial snapshot. */
  constructor(value) {
    this.value = value;
    this.listeners = /* @__PURE__ */ new Set();
  }
  /** @returns {T} the current snapshot. */
  getSnapshot = () => this.value;
  /** @param {() => void} listener - called after every change. @returns {() => void} unsubscribe. */
  subscribe = (listener) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  /**
   * Replace the snapshot when it changed by identity.
   * @param {T} next - the new snapshot.
   */
  set(next) {
    this.value = next;
    for (const listener of [...this.listeners]) listener();
  }
  /**
   * Replace the snapshot through a projection of the current value.
   * @param {(current: T) => T} project - the projection.
   */
  update(project) {
    this.set(project(this.value));
  }
};
var TunerController = class {
  /**
   * @param {{ fetchImpl?: typeof fetch }} [options] - injectable transport for tests.
   */
  constructor(options = {}) {
    this.fetchImpl = options.fetchImpl ?? ((...args) => globalThis.fetch(...args));
    this.fields = new Observable(DEFAULT_FIELDS);
    this.settings = new Observable(normalize(DEFAULT_FIELDS, void 0));
    this.status = new Observable("idle");
    this.detail = new Observable("");
    this.warning = new Observable("");
    this.disposed = false;
    this.pending = null;
    this.flushTimer = null;
  }
  /** Read the Host document once. Failure keeps the defaults and reports why. */
  async load() {
    this.status.set("loading");
    try {
      const response = await this.fetchImpl(SETTINGS_ROUTE, { headers: { accept: "application/json" } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      if (this.disposed) return;
      if (Array.isArray(payload?.fields) && payload.fields.length > 0) this.fields.set(payload.fields);
      this.settings.set(normalize(this.fields.getSnapshot(), payload?.settings));
      this.detail.set(typeof payload?.path === "string" ? payload.path : "");
      this.warning.set("");
      this.status.set("ready");
    } catch (error) {
      if (this.disposed) return;
      this.status.set("error");
      this.warning.set(error instanceof Error ? error.message : String(error));
    }
  }
  /**
   * Change one field and queue a write.
   * @param {string} key - field key.
   * @param {unknown} value - requested value.
   */
  set(key, value) {
    const fields = this.fields.getSnapshot();
    const field = fields.find((entry) => entry.key === key);
    if (field === void 0) return;
    this.settings.update((current) => ({ ...current, [key]: clampField(field, value) }));
    this.queue();
  }
  /**
   * Flip the master switch and queue a write.
   * @param {boolean} enabled - requested state.
   */
  setEnabled(enabled) {
    this.settings.update((current) => ({ ...current, enabled: enabled !== false }));
    this.queue();
  }
  /** Restore every field to its schema default and queue a write. */
  reset() {
    const defaults = { enabled: true };
    for (const field of this.fields.getSnapshot()) defaults[field.key] = field.default;
    this.settings.set(defaults);
    this.queue();
  }
  /** Coalesce bursts of slider input into one write. */
  queue() {
    if (this.flushTimer !== null) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, 120);
  }
  /** Send the current document to the Host. */
  async flush() {
    if (this.disposed) return;
    const body = JSON.stringify(this.settings.getSnapshot());
    try {
      const response = await this.fetchImpl(SETTINGS_ROUTE, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      if (this.disposed) return;
      this.warning.set(payload?.persisted === false ? "write refused by the Host" : "");
    } catch (error) {
      if (this.disposed) return;
      this.warning.set(error instanceof Error ? error.message : String(error));
    }
  }
  /** Stop timers and drop listeners. */
  dispose() {
    this.disposed = true;
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }
};
function applySettings(settings, doc = document) {
  const body = doc.body;
  const html = doc.documentElement;
  const style = doc.createElement("style");
  style.dataset.skinTunerStyle = "";
  style.textContent = [
    `html > [${BACKDROP_ELEM_ATTR}] {`,
    "  position: fixed;",
    "  inset: 0;",
    "  z-index: 0;",
    "  pointer-events: none;",
    "  background: var(--dsw-alias-bg-base, rgb(0 0 0 / 45%));",
    "}",
    // `isolation: isolate` gives each blurred element its own backdrop root.
    // Without it a backdrop-filter element blurs everything painted below it -
    // including the other one of ours - which used to smear the composer frost
    // into the conversation.
    `html > [${BACKDROP_ELEM_ATTR}][data-blur] {`,
    "  isolation: isolate;",
    "  backdrop-filter: blur(var(--dsh-skin-tuner-bg-blur, 0px));",
    "  -webkit-backdrop-filter: blur(var(--dsh-skin-tuner-bg-blur, 0px));",
    "}",
    `html > [${COMPOSER_FROST_ATTR}][data-blur] {`,
    "  isolation: isolate;",
    "  backdrop-filter: blur(var(--dsh-input-card-blur, 10px));",
    "  -webkit-backdrop-filter: blur(var(--dsh-input-card-blur, 10px));",
    "}",
    `html > [${COMPOSER_FROST_ATTR}] {`,
    "  position: fixed;",
    "  z-index: 1;",
    "  pointer-events: none;",
    "  border-radius: var(--dsw-radius-panel, 16px);",
    "}",
    // Bubble blur is the only rule that a skin may already implement; it stays
    // off unless the slider actually asks for it, so the default paint is
    // byte-identical to no tuner at all.
    `html[${BUBBLE_BLUR_ATTR}] [${BUBBLE_BLUR_TARGET_ATTR}] {`,
    "  isolation: isolate;",
    "  backdrop-filter: blur(var(--dsh-skin-bubble-blur, 0px));",
    "  -webkit-backdrop-filter: blur(var(--dsh-skin-bubble-blur, 0px));",
    "}"
  ].join("\n");
  doc.head.append(style);
  const startingBodyVars = /* @__PURE__ */ new Map();
  const previousAttrs = /* @__PURE__ */ new Map();
  const setVar = (property, value) => {
    if (!startingBodyVars.has(property)) startingBodyVars.set(property, body.style.getPropertyValue(property));
    body.style.setProperty(property, value);
  };
  const setAttr = (element, attribute, value) => {
    const scope = element === html ? "html" : "body";
    const key = `attr:${attribute}|${scope}`;
    if (!previousAttrs.has(key)) previousAttrs.set(key, element.getAttribute(attribute));
    if (value === null) element.removeAttribute(attribute);
    else element.setAttribute(attribute, value);
  };
  const backdrop = doc.createElement("div");
  backdrop.setAttribute(BACKDROP_ELEM_ATTR, "");
  backdrop.setAttribute("aria-hidden", "true");
  const frost = doc.createElement("div");
  frost.setAttribute(COMPOSER_FROST_ATTR, "");
  frost.setAttribute("aria-hidden", "true");
  const setBlurStrength = (value) => {
    if (value > 0) {
      backdrop.setAttribute("data-blur", "");
      setVar("--dsh-skin-tuner-bg-blur", `${value}px`);
    } else {
      backdrop.removeAttribute("data-blur");
      body.style.removeProperty("--dsh-skin-tuner-bg-blur");
    }
  };
  const enabled = settings.enabled !== false;
  if (enabled) {
    html.append(backdrop);
    if (settings.inputCardBlur > 0) {
      frost.setAttribute("data-blur", "");
      html.append(frost);
    }
    setAttr(body, ACTIVE_ATTR, "");
    setAttr(html, BUBBLE_BLUR_ATTR, settings.bubbleBlur > 0 ? "" : null);
    setVar(SCRIM_VAR, String(settings.backgroundOpacity / 100));
    setVar(BUBBLE_ALPHA_VAR, String(settings.bubbleOpacity / 100));
    setVar(BUBBLE_BLUR_VAR, `${settings.bubbleBlur}px`);
    setVar(INPUT_CARD_BLUR_VAR, `${settings.inputCardBlur}px`);
    setBlurStrength(settings.backgroundBlurEmpty);
  }
  const timers = /* @__PURE__ */ new Set();
  const every = (fn, ms) => {
    const id = setInterval(fn, ms);
    timers.add(id);
    return id;
  };
  const syncContentState = () => {
    if (!enabled) return;
    const hasContent = doc.querySelector(MESSAGE_ROW_SELECTOR) !== null;
    setBlurStrength(hasContent ? settings.backgroundBlurContent : settings.backgroundBlurEmpty);
  };
  const syncBubbleBlurTargets = () => {
    if (!enabled) return;
    const wanted = settings.bubbleBlur > 0;
    if (!wanted) setAttr(html, BUBBLE_BLUR_ATTR, null);
    for (const row of doc.querySelectorAll(MESSAGE_ROW_SELECTOR)) {
      if (wanted) row.setAttribute(BUBBLE_BLUR_TARGET_ATTR, "");
      else row.removeAttribute(BUBBLE_BLUR_TARGET_ATTR);
    }
  };
  const syncComposerFrost = () => {
    if (!enabled || settings.inputCardBlur <= 0) return;
    const seat = doc.querySelector(COMPOSER_SELECTOR);
    if (seat === null) {
      frost.style.display = "none";
      return;
    }
    const box = seat.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) {
      frost.style.display = "none";
      return;
    }
    frost.style.display = "block";
    frost.style.left = `${box.left}px`;
    frost.style.top = `${box.top}px`;
    frost.style.width = `${box.width}px`;
    frost.style.height = `${box.height}px`;
  };
  if (enabled) {
    syncContentState();
    syncBubbleBlurTargets();
    syncComposerFrost();
    every(syncContentState, 500);
    every(syncBubbleBlurTargets, 1e3);
    every(syncComposerFrost, 250);
    doc.addEventListener("scroll", syncComposerFrost, { capture: true, passive: true });
    globalThis.addEventListener?.("resize", syncComposerFrost, { passive: true });
  }
  return () => {
    for (const id of timers) clearInterval(id);
    timers.clear();
    doc.removeEventListener("scroll", syncComposerFrost, { capture: true });
    globalThis.removeEventListener?.("resize", syncComposerFrost);
    style.remove();
    backdrop.remove();
    frost.remove();
    for (const row of doc.querySelectorAll(`[${BUBBLE_BLUR_TARGET_ATTR}]`)) {
      row.removeAttribute(BUBBLE_BLUR_TARGET_ATTR);
    }
    for (const [property, starting] of startingBodyVars) {
      if (starting === "") body.style.removeProperty(property);
      else body.style.setProperty(property, starting);
    }
    startingBodyVars.clear();
    for (const [key, value] of previousAttrs) {
      const [attribute, scope] = key.slice(5).split("|");
      const element = scope === "html" ? html : body;
      if (value === null) element.removeAttribute(attribute);
      else element.setAttribute(attribute, value);
    }
    previousAttrs.clear();
  };
}
var SELECTORS = Object.freeze({
  composer: COMPOSER_SELECTOR,
  conversation: CONVERSATION_SELECTOR,
  messageRow: MESSAGE_ROW_SELECTOR
});

// src/client/styles.css
var styles_default = "/*\n * dsh-skin-tuner panel styles.\n *\n * All colours come from the official `--dsw-*` tokens, so the panel follows the\n * active theme - and the active skin - instead of pinning its own palette.\n */\n\n.dsh-skin-tuner {\n  display: flex;\n  flex-direction: column;\n  gap: 14px;\n  padding: 4px 2px 24px;\n  color: var(--dsw-alias-label-primary);\n  font-size: 13px;\n  line-height: 1.55;\n}\n\n.dsh-skin-tuner-title {\n  margin: 0;\n  font-size: 15px;\n  font-weight: 600;\n}\n\n.dsh-skin-tuner-intro {\n  margin: 0;\n  color: var(--dsw-alias-label-secondary);\n}\n\n.dsh-skin-tuner-notice {\n  margin: 0;\n  padding: 10px 12px;\n  border: 1px solid var(--dsw-alias-border-l2);\n  border-radius: var(--dsw-radius-md, 8px);\n  background: var(--dsw-alias-bg-layer-2);\n  color: var(--dsw-alias-label-primary);\n}\n\n.dsh-skin-tuner-error {\n  margin: 0;\n  color: var(--dsw-alias-state-error-primary);\n}\n\n.dsh-skin-tuner-switch {\n  display: inline-flex;\n  align-items: center;\n  gap: 8px;\n  cursor: pointer;\n}\n\n.dsh-skin-tuner-row {\n  display: flex;\n  flex-direction: column;\n  gap: 6px;\n  padding: 10px 12px;\n  border: 1px solid var(--dsw-alias-border-l2);\n  border-radius: var(--dsw-radius-md, 8px);\n  background: var(--dsw-alias-bg-layer-2);\n}\n\n.dsh-skin-tuner-row-head {\n  display: flex;\n  align-items: baseline;\n  justify-content: space-between;\n  gap: 12px;\n}\n\n.dsh-skin-tuner-row-label {\n  font-weight: 500;\n}\n\n.dsh-skin-tuner-row-value {\n  color: var(--dsw-alias-label-secondary);\n  font-variant-numeric: tabular-nums;\n}\n\n.dsh-skin-tuner-hint {\n  margin: 0;\n  color: var(--dsw-alias-label-secondary);\n  font-size: 12px;\n}\n\n.dsh-skin-tuner-range {\n  width: 100%;\n  height: 18px;\n  margin: 0;\n  appearance: none;\n  background: transparent;\n  cursor: pointer;\n}\n\n.dsh-skin-tuner-range:disabled {\n  cursor: not-allowed;\n  opacity: 0.5;\n}\n\n.dsh-skin-tuner-range::-webkit-slider-runnable-track {\n  height: 4px;\n  border-radius: 999px;\n  background: var(--dsw-alias-bg-mask-1, var(--dsw-alias-border-l2));\n}\n\n.dsh-skin-tuner-range::-webkit-slider-thumb {\n  appearance: none;\n  width: 14px;\n  height: 14px;\n  margin-top: -5px;\n  border: none;\n  border-radius: 50%;\n  background: var(--dsw-alias-brand-primary-new-color, var(--dsw-alias-label-primary));\n}\n\n.dsh-skin-tuner-range::-moz-range-track {\n  height: 4px;\n  border-radius: 999px;\n  background: var(--dsw-alias-bg-mask-1, var(--dsw-alias-border-l2));\n}\n\n.dsh-skin-tuner-range::-moz-range-thumb {\n  width: 14px;\n  height: 14px;\n  border: none;\n  border-radius: 50%;\n  background: var(--dsw-alias-brand-primary-new-color, var(--dsw-alias-label-primary));\n}\n\n.dsh-skin-tuner-actions {\n  display: flex;\n  flex-wrap: wrap;\n  gap: 8px;\n}\n\n.dsh-skin-tuner-button {\n  padding: 6px 12px;\n  border: 1px solid var(--dsw-alias-border-l2);\n  border-radius: var(--dsw-radius-sm, 6px);\n  background: var(--dsw-alias-bg-layer-2);\n  color: var(--dsw-alias-label-primary);\n  font: inherit;\n  cursor: pointer;\n}\n\n.dsh-skin-tuner-button:hover {\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.dsh-skin-tuner-button-quiet {\n  background: transparent;\n}\n\n.dsh-skin-tuner-advanced {\n  display: flex;\n  flex-direction: column;\n  gap: 6px;\n  padding: 10px 12px;\n  border: 1px dashed var(--dsw-alias-border-l2);\n  border-radius: var(--dsw-radius-md, 8px);\n}\n";

// src/client/index.jsx
var import_jsx_runtime = require("react/jsx-runtime");
var inject = ["slots", "locale"];
var SECTION_ID = "skin-tuner";
var NS = "dsh-skin-tuner";
var zh = {
  nav: "\u5916\u89C2\u5FAE\u8C03",
  title: "\u5916\u89C2\u5FAE\u8C03",
  intro: "\u72EC\u7ACB\u4E8E\u4EFB\u4F55\u76AE\u80A4\u7684\u80CC\u666F\u4E0E\u6C14\u6CE1\u53C2\u6570\u3002\u6240\u6709\u503C\u7ACB\u5373\u751F\u6548\u5E76\u6301\u4E45\u5316\u5230 DSH_HOME/dsh-skin-tuner.json\u3002",
  enable: "\u542F\u7528\u5FAE\u8C03",
  enableHint: "\u5173\u95ED\u540E\u7ACB\u5373\u79FB\u9664\u672C\u63D2\u4EF6\u5199\u5165\u7684\u5168\u90E8\u53D8\u91CF\u4E0E\u5143\u7D20\uFF0C\u56DE\u5230\u672A\u5B89\u88C5\u72B6\u6001\u3002",
  reset: "\u6062\u590D\u9ED8\u8BA4",
  advanced: "\u6539\u5199\u76AE\u80A4\u5951\u7EA6",
  advancedHint: "\u672C\u9875\u5199\u5165\u7684\u662F\u76AE\u80A4\u751F\u6001\u5171\u7528\u7684\u81EA\u5B9A\u4E49\u5C5E\u6027\uFF1A--dsw-skin-scrim / --dsh-skin-bubble-alpha / --dsh-skin-bubble-blur / --dsh-input-card-blur\u3002\u82E5\u53E6\u4E00\u4E2A\u63D2\u4EF6\uFF08\u5982\u76AE\u80A4\u4E2D\u5FC3\uFF09\u4E5F\u5728\u5199\u540C\u4E00\u6279\u5C5E\u6027\uFF0C\u540E\u5199\u8005\u751F\u6548\u2014\u2014\u4E24\u8005\u540C\u65F6\u542F\u7528\u65F6\u8BF7\u53EA\u4FDD\u7559\u4E00\u8FB9\u3002",
  detectOn: "\u68C0\u6D4B\u5230\u76AE\u80A4\u4E2D\u5FC3\u6B63\u5728\u672C\u9875\u8FD0\u884C\uFF1A\u5B83\u7684\u80CC\u666F\u63A7\u5236\u4F1A\u8986\u76D6\u672C\u9875\u540C\u540D\u53C2\u6570\u3002",
  detectHint: "\u5EFA\u8BAE\u505C\u7528\u76AE\u80A4\u4E2D\u5FC3\uFF0C\u6216\u5728\u90A3\u8FB9\u8C03\u5B8C\u80CC\u666F\u540E\u4E0D\u8981\u5728\u672C\u9875\u91CD\u590D\u8BBE\u7F6E\u3002",
  file: "\u5B58\u50A8\u6587\u4EF6",
  none: "\uFF08\u5C1A\u672A\u843D\u76D8\uFF09",
  "fields.backgroundOpacity.label": "\u80CC\u666F\u906E\u6321",
  "fields.backgroundOpacity.hint": "\u7ED9\u9762\u677F\u80CC\u540E\u7684\u80CC\u666F\u56FE\u52A0\u7EB1\uFF1B0 \u5B8C\u5168\u4E0D\u906E\uFF0C100 \u51E0\u4E4E\u5168\u906E\u3002\u4EC5\u5BF9\u5E26\u80CC\u666F\u56FE\u7684\u76AE\u80A4\u53EF\u89C1\u3002",
  "fields.backgroundBlurEmpty.label": "\u7A7A\u5BF9\u8BDD\u80CC\u666F\u6A21\u7CCA",
  "fields.backgroundBlurEmpty.hint": "\u5BF9\u8BDD\u4E3A\u7A7A\u65F6\uFF0C\u80CC\u666F\u56FE\u7684\u9AD8\u65AF\u6A21\u7CCA\u5F3A\u5EA6\uFF1B0 \u4E3A\u5173\u95ED\u3002",
  "fields.backgroundBlurContent.label": "\u6709\u5BF9\u8BDD\u80CC\u666F\u6A21\u7CCA",
  "fields.backgroundBlurContent.hint": "\u5BF9\u8BDD\u6709\u5185\u5BB9\u65F6\uFF0C\u80CC\u666F\u56FE\u7684\u9AD8\u65AF\u6A21\u7CCA\u5F3A\u5EA6\uFF1B0 \u4E3A\u5173\u95ED\u3002",
  "fields.inputCardBlur.label": "\u8F93\u5165\u5361\u78E8\u7802",
  "fields.inputCardBlur.hint": "\u53EA\u6A21\u7CCA\u8F93\u5165\u5361\u80CC\u540E\u7684\u533A\u57DF\uFF0C\u6574\u5F20\u80CC\u666F\u56FE\u4E0D\u53D8\u7CCA\u3002",
  "fields.bubbleOpacity.label": "\u6C14\u6CE1\u4E0D\u900F\u660E\u5EA6",
  "fields.bubbleOpacity.hint": "\u6D88\u606F\u6C14\u6CE1\u7684\u4E0D\u900F\u660E\u5EA6\uFF1B\u8D8A\u9AD8\u5B57\u8D8A\u6E05\u695A\u3002100 \u4E3A\u5B8C\u5168\u4E0D\u900F\u660E\u3002",
  "fields.bubbleBlur.label": "\u6C14\u6CE1\u6A21\u7CCA\u7A0B\u5EA6",
  "fields.bubbleBlur.hint": "\u6A21\u7CCA\u534A\u900F\u660E\u6C14\u6CE1\u80CC\u540E\u7684\u533A\u57DF\uFF0C\u4E0E\u300C\u6C14\u6CE1\u4E0D\u900F\u660E\u5EA6\u300D\u76F8\u4E92\u72EC\u7ACB\uFF1B0 \u4E3A\u5173\u95ED\u3002"
};
var en = {
  nav: "Appearance tuner",
  title: "Appearance tuner",
  intro: "Background and bubble parameters that stand alone, independent of any skin. Every value applies immediately and persists to DSH_HOME/dsh-skin-tuner.json.",
  enable: "Enable tuning",
  enableHint: "Turning this off removes every variable and element this plugin writes, back to an uninstalled state.",
  reset: "Restore defaults",
  advanced: "Skin contracts written",
  advancedHint: "This page writes the custom properties the skin ecosystem shares: --dsw-skin-scrim / --dsh-skin-bubble-alpha / --dsh-skin-bubble-blur / --dsh-input-card-blur. When another plugin (the skin center, for example) writes the same properties, the last writer wins - keep only one side enabled at a time.",
  detectOn: "The skin center is running on this page: its background controls override the matching fields here.",
  detectHint: "Disable the skin center, or do not set the same background values on both sides.",
  file: "Document",
  none: "(not written yet)",
  "fields.backgroundOpacity.label": "Background occlusion",
  "fields.backgroundOpacity.hint": "Fogs the artwork behind panels; 0 leaves it clear, 100 nearly hides it. Visible only on skins with backdrop art.",
  "fields.backgroundBlurEmpty.label": "Backdrop blur (empty)",
  "fields.backgroundBlurEmpty.hint": "Gaussian blur of the backdrop while the conversation is empty; 0 disables it.",
  "fields.backgroundBlurContent.label": "Backdrop blur (with content)",
  "fields.backgroundBlurContent.hint": "Gaussian blur of the backdrop while the conversation has messages; 0 disables it.",
  "fields.inputCardBlur.label": "Composer frost",
  "fields.inputCardBlur.hint": "Blurs only the region behind the composer card, never the whole backdrop.",
  "fields.bubbleOpacity.label": "Bubble opacity",
  "fields.bubbleOpacity.hint": "Opacity of message bubbles; higher is easier to read. 100 is fully opaque.",
  "fields.bubbleBlur.label": "Bubble blur",
  "fields.bubbleBlur.hint": "Blurs the region behind translucent bubbles, independent of bubble opacity; 0 disables it."
};
var dictionaries = { zh, en };
var fieldKeys = DEFAULT_FIELDS.map((field) => field.key);
function skinCenterActive(doc = document) {
  return doc.querySelector("[data-dsh-composer-frost]") !== null || doc.documentElement.hasAttribute("data-dsh-skin") || doc.querySelector("[data-dsh-backdrop-active]") !== null;
}
function mountStyles(css, doc = document) {
  const style = doc.createElement("style");
  style.setAttribute("data-skin-tuner-panel", "");
  style.textContent = css;
  doc.head.append(style);
  return () => style.remove();
}
function apply(ctx) {
  const t = ctx.locale.bind(NS);
  const controller = new TunerController();
  let disposePaint = null;
  let lastPaintKey = "";
  ctx.effect(() => mountStyles(styles_default), "dsh-skin-tuner: panel styles");
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), "dsh-skin-tuner: dictionaries");
  ctx.effect(() => () => controller.dispose(), "dsh-skin-tuner: controller");
  const repaint = () => {
    const settings = controller.settings.getSnapshot();
    const key = JSON.stringify(settings);
    if (key === lastPaintKey) return;
    lastPaintKey = key;
    if (disposePaint !== null) disposePaint();
    disposePaint = applySettings(settings);
  };
  ctx.effect(() => {
    const stop = controller.settings.subscribe(repaint);
    repaint();
    return () => {
      stop();
      if (disposePaint !== null) {
        disposePaint();
        disposePaint = null;
        lastPaintKey = "";
      }
    };
  }, "dsh-skin-tuner: paint");
  void controller.load();
  ctx.slots.inject(
    "settings.section",
    () => ctx.slots.register(
      {
        name: "settings.section",
        id: SECTION_ID,
        order: 60,
        label: () => t("nav"),
        locale: NS,
        inject: () => ({ controller, t })
      },
      Panel
    )
  );
}
function Panel({ controller, t }) {
  const fields = (0, import_react.useSyncExternalStore)(controller.fields.subscribe, controller.fields.getSnapshot);
  const settings = (0, import_react.useSyncExternalStore)(controller.settings.subscribe, controller.settings.getSnapshot);
  const path = (0, import_react.useSyncExternalStore)(controller.detail.subscribe, controller.detail.getSnapshot);
  const warning = (0, import_react.useSyncExternalStore)(controller.warning.subscribe, controller.warning.getSnapshot);
  const [centerActive, setCenterActive] = (0, import_react.useState)(() => skinCenterActive());
  const [open, setOpen] = (0, import_react.useState)(false);
  (0, import_react.useEffect)(() => {
    const id = setInterval(() => setCenterActive(skinCenterActive()), 2e3);
    return () => clearInterval(id);
  }, []);
  const rows = fields.map((field) => {
    const copy = t(`fields.${field.key}.label`);
    return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { className: "dsh-skin-tuner-row", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "dsh-skin-tuner-row-head", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-skin-tuner-row-label", children: copy }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "dsh-skin-tuner-row-value", children: [
          settings[field.key],
          field.unit
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "input",
        {
          type: "range",
          className: "dsh-skin-tuner-range",
          min: field.min,
          max: field.max,
          step: field.step,
          value: settings[field.key],
          disabled: settings.enabled === false,
          "aria-label": copy,
          onChange: (event) => controller.set(field.key, Number(event.target.value))
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-skin-tuner-hint", children: t(`fields.${field.key}.hint`) })
    ] }, field.key);
  });
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { className: "dsh-skin-tuner", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { className: "dsh-skin-tuner-title", children: t("title") }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dsh-skin-tuner-intro", children: t("intro") }),
    centerActive ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { className: "dsh-skin-tuner-notice", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: t("detectOn") }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("br", {}),
      t("detectHint")
    ] }) : null,
    warning ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dsh-skin-tuner-error", children: warning }) : null,
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { className: "dsh-skin-tuner-switch", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "input",
        {
          type: "checkbox",
          checked: settings.enabled !== false,
          onChange: (event) => controller.setEnabled(event.target.checked)
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: t("enable") })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dsh-skin-tuner-hint", children: t("enableHint") }),
    rows,
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-skin-tuner-actions", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "dsh-skin-tuner-button", onClick: () => controller.reset(), children: t("reset") }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "button",
        {
          type: "button",
          className: "dsh-skin-tuner-button dsh-skin-tuner-button-quiet",
          onClick: () => setOpen((value) => !value),
          children: t("advanced")
        }
      )
    ] }),
    open ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-skin-tuner-advanced", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dsh-skin-tuner-hint", children: t("advancedHint") }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { className: "dsh-skin-tuner-hint", children: [
        t("file"),
        ": ",
        path.length > 0 ? path : t("none")
      ] })
    ] }) : null
  ] });
}
return module.exports;}});
//# sourceMappingURL=client.js.map
