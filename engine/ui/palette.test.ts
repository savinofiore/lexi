import { describe, expect, test } from 'claude-code/testing'

import { PALETTE, colorOf } from './palette.ts'

describe('palette', () => {
  test('a type gets the same palette color on every call', async () => {
    expect(PALETTE).toContain(colorOf('Explore'))
    expect(colorOf('Explore')).toBe(colorOf('Explore'))
  })

  test('the common subagent types get different colors', async () => {
    const colors = ['Explore', 'Plan', 'general-purpose'].map(colorOf)
    expect(new Set(colors).size).toBe(3)
  })
})
