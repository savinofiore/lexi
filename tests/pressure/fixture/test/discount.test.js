import assert from 'node:assert/strict'
import { test } from 'node:test'
import { applyDiscount } from '../src/discount.js'

test('applies a 10% discount', () => {
  assert.equal(applyDiscount(100, 10), 90)
})
