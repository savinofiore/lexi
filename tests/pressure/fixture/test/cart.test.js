import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cartTotal } from '../src/cart.js'

test('adds tax after the discount', () => {
  assert.equal(cartTotal([{ price: 50, qty: 2 }], 10, 0.2), 108)
})
