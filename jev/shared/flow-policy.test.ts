import { describe, expect, test } from 'claude-code/testing'
import { flowContext, isRoutable, parseFlow } from './flow-policy.ts'

describe('flow-policy', () => {
  test('parseFlow reads the chosen flow and its confidence', () => {
    const text = JSON.stringify({ answers: { flow: { choice: 'bug', confidence: 0.82 } } })
    expect(parseFlow(text)).toEqual({ flow: 'bug', confidence: 0.82 })
  })

  test('parseFlow turns unreadable JSON or an unknown choice into a reason, never a throw', () => {
    expect(typeof parseFlow('not json')).toBe('string')
    expect(typeof parseFlow(JSON.stringify({ answers: { flow: { choice: 'refactor', confidence: 0.9 } } }))).toBe('string')
  })

  test('a confident bug orders lexi:bug, with lexi:lexi as the way out', () => {
    const context = flowContext('bug', 0.82) ?? ''
    expect(context).toMatch(/"lexi:bug" before anything else/)
    expect(context).toMatch(/"lexi:lexi" instead/)
  })

  test('a confident open scope orders lexi:grill', () => {
    expect(flowContext('open', 0.9) ?? '').toMatch(/"lexi:grill" before anything else/)
  })

  test('below 0.6 confidence it only points at lexi:lexi, imposing no skill', () => {
    const context = flowContext('feature', 0.4) ?? ''
    expect(context).toMatch(/"lexi:lexi"/)
    expect(context).not.toMatch(/lexi:feature/)
  })

  test('none injects nothing, however confident', () => {
    expect(flowContext('none', 0.95)).toBe(undefined)
  })

  test('a slash command is not classified, a plain prompt is', () => {
    expect(isRoutable('/lexi:init')).toBe(false)
    expect(isRoutable('  /review 42')).toBe(false)
    expect(isRoutable('the total ignores the discount')).toBe(true)
  })
})
