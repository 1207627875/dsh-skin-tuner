/**
 * dsh-skin-tuner, browser half.
 *
 * Registers one Settings section that edits the appearance document and paints
 * its values on the live shell. The section is mounted through the official
 * `settings.section` slot, and its dictionaries through the client locale, so
 * the plugin needs the official runtime and nothing else.
 *
 * @module dsh-skin-tuner/client
 */

import { useEffect, useState, useSyncExternalStore } from 'react'
import {
  TunerController,
  applySettings,
  DEFAULT_FIELDS,
} from './logic.js'
// The text loader hands back the stylesheet source; an explicit binding keeps
// esbuild from tree-shaking a bare `import './styles.css'` away.
import styles from './styles.css'

/** Client services this half needs. */
export const inject = ['slots', 'locale']

/** Slot id of the panel. */
const SECTION_ID = 'skin-tuner'

/** Locale namespace for the panel's dictionaries. */
const NS = 'dsh-skin-tuner'

/** Chinese dictionary. */
const zh = {
  nav: '外观微调',
  title: '外观微调',
  intro: '独立于任何皮肤的背景与气泡参数。所有值立即生效并持久化到 DSH_HOME/dsh-skin-tuner.json。',
  enable: '启用微调',
  enableHint: '关闭后立即移除本插件写入的全部变量与元素，回到未安装状态。',
  reset: '恢复默认',
  advanced: '改写皮肤契约',
  advancedHint:
    '本页写入的是皮肤生态共用的自定义属性：--dsw-skin-scrim / --dsh-skin-bubble-alpha / --dsh-skin-bubble-blur / --dsh-input-card-blur。若另一个插件（如皮肤中心）也在写同一批属性，后写者生效——两者同时启用时请只保留一边。',
  detectOn: '检测到皮肤中心正在本页运行：它的背景控制会覆盖本页同名参数。',
  detectHint: '建议停用皮肤中心，或在那边调完背景后不要在本页重复设置。',
  file: '存储文件',
  none: '（尚未落盘）',
  fields: {
    backgroundOpacity: { label: '背景遮挡', hint: '给面板背后的背景图加纱；0 完全不遮，100 几乎全遮。仅对带背景图的皮肤可见。' },
    backgroundBlurEmpty: { label: '空对话背景模糊', hint: '对话为空时，背景图的高斯模糊强度；0 为关闭。' },
    backgroundBlurContent: { label: '有对话背景模糊', hint: '对话有内容时，背景图的高斯模糊强度；0 为关闭。' },
    inputCardBlur: { label: '输入卡磨砂', hint: '只模糊输入卡背后的区域，整张背景图不变糊。' },
    bubbleOpacity: { label: '气泡不透明度', hint: '消息气泡的不透明度；越高字越清楚。100 为完全不透明。' },
    bubbleBlur: { label: '气泡模糊程度', hint: '模糊半透明气泡背后的区域，与「气泡不透明度」相互独立；0 为关闭。' },
  },
}

/** English dictionary. */
const en = {
  nav: 'Appearance tuner',
  title: 'Appearance tuner',
  intro:
    'Background and bubble parameters that stand alone, independent of any skin. Every value applies immediately and persists to DSH_HOME/dsh-skin-tuner.json.',
  enable: 'Enable tuning',
  enableHint: 'Turning this off removes every variable and element this plugin writes, back to an uninstalled state.',
  reset: 'Restore defaults',
  advanced: 'Skin contracts written',
  advancedHint:
    'This page writes the custom properties the skin ecosystem shares: --dsw-skin-scrim / --dsh-skin-bubble-alpha / --dsh-skin-bubble-blur / --dsh-input-card-blur. When another plugin (the skin center, for example) writes the same properties, the last writer wins - keep only one side enabled at a time.',
  detectOn: 'The skin center is running on this page: its background controls override the matching fields here.',
  detectHint: 'Disable the skin center, or do not set the same background values on both sides.',
  file: 'Document',
  none: '(not written yet)',
  fields: {
    backgroundOpacity: { label: 'Background occlusion', hint: 'Fogs the artwork behind panels; 0 leaves it clear, 100 nearly hides it. Visible only on skins with backdrop art.' },
    backgroundBlurEmpty: { label: 'Backdrop blur (empty)', hint: 'Gaussian blur of the backdrop while the conversation is empty; 0 disables it.' },
    backgroundBlurContent: { label: 'Backdrop blur (with content)', hint: 'Gaussian blur of the backdrop while the conversation has messages; 0 disables it.' },
    inputCardBlur: { label: 'Composer frost', hint: 'Blurs only the region behind the composer card, never the whole backdrop.' },
    bubbleOpacity: { label: 'Bubble opacity', hint: 'Opacity of message bubbles; higher is easier to read. 100 is fully opaque.' },
    bubbleBlur: { label: 'Bubble blur', hint: 'Blurs the region behind translucent bubbles, independent of bubble opacity; 0 disables it.' },
  },
}

/**
 * Whether the skin center is painting this page right now. The center is the
 * other writer of the shared variables, so the panel says so instead of
 * silently losing a fight over them.
 * @param {Document} [doc] - target document.
 * @returns {boolean} true when the center's own markers are present.
 */
export function skinCenterActive(doc = document) {
  return (
    doc.querySelector('[data-dsh-composer-frost]') !== null ||
    doc.documentElement.hasAttribute('data-dsh-skin') ||
    doc.querySelector('[data-dsh-backdrop-active]') !== null
  )
}

/**
 * Mount the panel's stylesheet once and return its undo.
 * @param {string} css - the bundled stylesheet source.
 * @param {Document} [doc] - target document.
 * @returns {() => void} teardown.
 */
export function mountStyles(css, doc = document) {
  const style = doc.createElement('style')
  style.setAttribute('data-skin-tuner-panel', '')
  style.textContent = css
  doc.head.append(style)
  return () => style.remove()
}

/**
 * Mount the section.
 * @param {import('@deepseek-ai/cordis').Context} ctx - the browser plugin context.
 */
export function apply(ctx) {
  const t = ctx.locale.bind(NS)
  const controller = new TunerController()
  let disposePaint = null
  let lastPaintKey = ''

  ctx.effect(() => mountStyles(styles), 'dsh-skin-tuner: panel styles')
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-skin-tuner: dictionaries')
  ctx.effect(() => () => controller.dispose(), 'dsh-skin-tuner: controller')

  const repaint = () => {
    const settings = controller.settings.getSnapshot()
    const key = JSON.stringify(settings)
    if (key === lastPaintKey) return
    lastPaintKey = key
    if (disposePaint !== null) disposePaint()
    disposePaint = applySettings(settings)
  }

  ctx.effect(() => {
    const stop = controller.settings.subscribe(repaint)
    repaint()
    return () => {
      stop()
      if (disposePaint !== null) {
        disposePaint()
        disposePaint = null
        lastPaintKey = ''
      }
    }
  }, 'dsh-skin-tuner: paint')

  void controller.load()

  ctx.slots.inject('settings.section', () =>
    ctx.slots.register(
      {
        name: 'settings.section',
        id: SECTION_ID,
        order: 60,
        label: () => t('nav'),
        locale: NS,
        inject: () => ({ controller, t }),
      },
      Panel,
    ),
  )
}

/**
 * The Settings page body.
 * @param {{ controller: TunerController, t: (key: string) => string }} props - slot-injected props.
 * @returns {import('react').ReactElement} the panel.
 */
function Panel({ controller, t }) {
  const fields = useSyncExternalStore(controller.fields.subscribe, controller.fields.getSnapshot)
  const settings = useSyncExternalStore(controller.settings.subscribe, controller.settings.getSnapshot)
  const path = useSyncExternalStore(controller.detail.subscribe, controller.detail.getSnapshot)
  const warning = useSyncExternalStore(controller.warning.subscribe, controller.warning.getSnapshot)
  const [centerActive, setCenterActive] = useState(() => skinCenterActive())
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const id = setInterval(() => setCenterActive(skinCenterActive()), 2000)
    return () => clearInterval(id)
  }, [])

  const rows = fields.map((field) => {
    const copy = t(`fields.${field.key}.label`)
    return (
      <label key={field.key} className="dsh-skin-tuner-row">
        <span className="dsh-skin-tuner-row-head">
          <span className="dsh-skin-tuner-row-label">{copy}</span>
          <span className="dsh-skin-tuner-row-value">
            {settings[field.key]}
            {field.unit}
          </span>
        </span>
        <input
          type="range"
          className="dsh-skin-tuner-range"
          min={field.min}
          max={field.max}
          step={field.step}
          value={settings[field.key]}
          disabled={settings.enabled === false}
          aria-label={copy}
          onChange={(event) => controller.set(field.key, Number(event.target.value))}
        />
        <span className="dsh-skin-tuner-hint">{t(`fields.${field.key}.hint`)}</span>
      </label>
    )
  })

  return (
    <section className="dsh-skin-tuner">
      <h2 className="dsh-skin-tuner-title">{t('title')}</h2>
      <p className="dsh-skin-tuner-intro">{t('intro')}</p>

      {centerActive ? (
        <p className="dsh-skin-tuner-notice">
          <strong>{t('detectOn')}</strong>
          <br />
          {t('detectHint')}
        </p>
      ) : null}
      {warning ? <p className="dsh-skin-tuner-error">{warning}</p> : null}

      <label className="dsh-skin-tuner-switch">
        <input
          type="checkbox"
          checked={settings.enabled !== false}
          onChange={(event) => controller.setEnabled(event.target.checked)}
        />
        <span>{t('enable')}</span>
      </label>
      <p className="dsh-skin-tuner-hint">{t('enableHint')}</p>

      {rows}

      <div className="dsh-skin-tuner-actions">
        <button type="button" className="dsh-skin-tuner-button" onClick={() => controller.reset()}>
          {t('reset')}
        </button>
        <button
          type="button"
          className="dsh-skin-tuner-button dsh-skin-tuner-button-quiet"
          onClick={() => setOpen((value) => !value)}
        >
          {t('advanced')}
        </button>
      </div>

      {open ? (
        <div className="dsh-skin-tuner-advanced">
          <p className="dsh-skin-tuner-hint">{t('advancedHint')}</p>
          <p className="dsh-skin-tuner-hint">
            {t('file')}: {path.length > 0 ? path : t('none')}
          </p>
        </div>
      ) : null}
    </section>
  )
}

export { DEFAULT_FIELDS }
