import assert from 'node:assert/strict'
import { test } from 'node:test'
import { familyOf, resolveTarget } from './models.ts'

// `node --test pi/extensions/jev-router/models.test.ts`
// A bridge session must never be routed onto the metered `anthropic` provider by the defaults.

const registry = [
  { provider: 'anthropic', id: 'claude-sonnet-5' },
  { provider: 'anthropic', id: 'claude-opus-5-5' },
  { provider: 'claude-bridge', id: 'claude-sonnet-4-5' },
  { provider: 'claude-bridge', id: 'claude-sonnet-5' },
  { provider: 'claude-bridge', id: 'claude-opus-5' },
  { provider: 'claude-bridge', id: 'claude-haiku-4-5' },
]

test('familyOf strips the version', () => {
  assert.equal(familyOf('claude-opus-5-5'), 'claude-opus')
  assert.equal(familyOf('claude-sonnet-4-5-20250929'), 'claude-sonnet')
})

test('bare id stays on the current provider, newest of the family', () => {
  assert.deepEqual(resolveTarget(registry, 'claude-bridge', 'claude-opus-5-5'), { provider: 'claude-bridge', id: 'claude-opus-5' })
  assert.deepEqual(resolveTarget(registry, 'claude-bridge', 'claude-sonnet-5'), { provider: 'claude-bridge', id: 'claude-sonnet-5' })
  assert.equal(resolveTarget(registry, 'claude-bridge', 'claude-fable-5-1'), undefined)
})

test('bare id without a session provider falls back to anthropic', () => {
  assert.deepEqual(resolveTarget(registry, undefined, 'claude-opus-5-5'), { provider: 'anthropic', id: 'claude-opus-5-5' })
})

test('provider/id is exact and may leave the current provider', () => {
  assert.deepEqual(resolveTarget(registry, 'claude-bridge', 'anthropic/claude-sonnet-5'), { provider: 'anthropic', id: 'claude-sonnet-5' })
  assert.equal(resolveTarget(registry, 'claude-bridge', 'anthropic/claude-haiku-4-5'), undefined)
})
