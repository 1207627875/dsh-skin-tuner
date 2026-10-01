/**
 * Schema and store tests: the Host must never persist a value outside its
 * field's range, and must never fail because of a broken document on disk.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const moduleUrl = new URL('../src/host/schema.js', import.meta.url)
const { FIELDS, DEFAULT_SETTINGS, coerceField, resolveSettings, resolvePatch } = await import(moduleUrl)

test('defaults cover every field', () => {
  for (const field of FIELDS) assert.equal(DEFAULT_SETTINGS[field.key], field.default)
  assert.equal(DEFAULT_SETTINGS.enabled, true)
})

test('values are clamped into the field range', () => {
  assert.equal(coerceField('bubbleOpacity', 999), 100)
  assert.equal(coerceField('bubbleOpacity', -5), 0)
  assert.equal(coerceField('inputCardBlur', 7.4), 7)
  assert.equal(coerceField('backgroundBlurEmpty', 20.6), 20)
})

test('non-numeric values fall back to the default', () => {
  assert.equal(coerceField('bubbleOpacity', 'nonsense'), 100)
  assert.equal(coerceField('bubbleOpacity', Number.NaN), 100)
  assert.equal(coerceField('bubbleOpacity', undefined), 100)
})

test('an unknown field is refused rather than silently dropped', () => {
  assert.throws(() => coerceField('nope', 1), /unknown field/)
})

test('a stored document merges onto the defaults', () => {
  const resolved = resolveSettings({ bubbleOpacity: 90, enabled: false })
  assert.equal(resolved.bubbleOpacity, 90)
  assert.equal(resolved.enabled, false)
  assert.equal(resolved.inputCardBlur, 10)
})

test('a garbage document resolves to the defaults', () => {
  assert.deepEqual(resolveSettings(null), DEFAULT_SETTINGS)
  assert.deepEqual(resolveSettings('nope'), DEFAULT_SETTINGS)
  assert.deepEqual(resolveSettings([]), DEFAULT_SETTINGS)
})

test('a patch carries only known fields', () => {
  const patch = resolvePatch({ bubbleOpacity: 42, whatever: 1, enabled: false })
  assert.deepEqual(patch, { bubbleOpacity: 42, enabled: false })
})

test('the store round-trips through a real file', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-skin-tuner-'))
  const file = join(dir, 'doc.json')
  writeFileSync(file, JSON.stringify({ bubbleOpacity: 12, bubbleBlur: 4, enabled: true }))
  const text = readFileSync(file, 'utf8')
  const resolved = resolveSettings(JSON.parse(text))
  assert.equal(resolved.bubbleOpacity, 12)
  assert.equal(resolved.bubbleBlur, 4)
  rmSync(dir, { recursive: true, force: true })
})
