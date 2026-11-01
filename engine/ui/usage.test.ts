import { describe, expect, mock, test } from 'claude-code/testing'
import type { On, SessionMeasureInput, SessionRateLimit } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { GREEN, ORANGE, RED, YELLOW } from './usage.tsx'

const BAND = { component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 3, bodyColumns: 120, scroll: { offset: 0, bodyRows: 3 }, view: {} } } as const
const HOUR = 3_600_000

// A Jev that calls the prompt trivial: the router moves the session to Sonnet at medium effort.
const JEV_FAST = {
  status: 200, ok: true, headers: {},
  text: JSON.stringify({ answers: { tier: { choice: 'fast', confidence: 0.98 }, effort: { score: 0.2, confidence: 0.94 }, risky: { noul: 0.04 } } }),
}
const STEP = { turnId: 't1', index: 0, model: 'claude-opus-5-5', effort: 'medium' as const, messageCount: 1 }

const finish = (cacheReadTokens: number) => ({
  answer: 'done', durationMs: 100, isAborted: false, turnId: 't1', reason: 'answer' as const,
  usage: { model: 'claude-opus-5-5', input_tokens: 500, output_tokens: 100, cache_read_input_tokens: cacheReadTokens, cache_creation_input_tokens: 0 },
})

const drain = async (stream: AsyncIterable<unknown>) => {
  for await (const chunk of stream) void chunk
}

// A session on Opus 5.5 whose clock starts at 0; panes and the status line go nowhere.
const setupWorld = (on: On) => {
  mock.clock(on)
  on('session.model', async () => ({ value: 'Opus 5.5' }))
  on('session.measure', async (_$, e) => ({ changed: e.changed }))
  on('ui.status', async () => ({ value: undefined }))
  on('ui.log', async () => ({ value: undefined }))
  on('turn.step', async function* (_$, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: null, usage: null }
  })
  on('ui.render', async () => ({ type: 'Box', props: {}, children: [] }))
}

const measure = (percent: number, rateLimits: SessionRateLimit[] = [], usd?: number): SessionMeasureInput => ({
  context: { tokens: percent * 2000, window: 200_000, percent },
  rateLimits,
  ...(usd === undefined ? {} : { cost: { usd } }),
  changed: ['context'],
})

const mountBand = ($: Engine) => $.ui.mount({ plugin: 'lexi', surface: 'terminal', ...BAND })

const bandText = async ($: Engine) => {
  const ui = await mountBand($)
  const found = await ui.findAll({ type: 'Text' })
  await ui.unmount()
  return found.map((text) => text.text).join('')
}

// The color of the filled bar right after `label`.
const barColor = async ($: Engine, label: string) => {
  const ui = await mountBand($)
  const texts = await ui.findAll({ type: 'Text' })
  await ui.unmount()
  const at = texts.findIndex((text) => text.text.trim() === label)
  return texts.slice(at).find((text) => text.text.includes('█'))?.props.color
}

describe('usage row', () => {
  test('after a measure the band shows the model, the context bar, its tokens and the cost', async ($, on) => {
    setupWorld(on)
    await $.session.measure(measure(42, [], 1.234))
    const text = await bandText($)
    expect(text).toContain('Opus 5.5')
    expect(text).toContain('ctx')
    expect(text).toContain('42%')
    expect(text).toContain('84.0k tok')
    expect(text).toContain('$1.23')
  })

  test('the rate-limit windows show with their percent and the time left to reset', async ($, on) => {
    setupWorld(on)
    const limits = [
      { kind: 'five_hour', percentUsed: 21, resetsAt: new Date(3 * HOUR + 29 * 60_000).toISOString() },
      { kind: 'seven_day', percentUsed: 9, resetsAt: new Date(36 * HOUR).toISOString() },
    ]
    await $.session.measure(measure(10, limits))
    const text = await bandText($)
    expect(text).toContain('5h')
    expect(text).toContain('21%')
    expect(text).toContain('3h29m')
    expect(text).toContain('wk')
    expect(text).toContain('9%')
    expect(text).toContain('1d12h')
  })

  test('the model and its effort move after the rate-limit gauges, so ctx and the limits lead the row', async ($, on) => {
    setupWorld(on)
    const limits = [{ kind: 'five_hour', percentUsed: 21, resetsAt: new Date(3 * HOUR).toISOString() }]
    await $.session.measure(measure(10, limits))
    const ui = await mountBand($)
    const texts = (await ui.findAll({ type: 'Text' })).map((t) => t.text)
    await ui.unmount()
    const ctxAt = texts.findIndex((t) => t.trim() === 'ctx')
    const fiveHourAt = texts.findIndex((t) => t.trim() === '5h')
    const modelAt = texts.findIndex((t) => t.includes('Opus 5.5'))
    expect(ctxAt).toBeGreaterThanOrEqual(0)
    expect(modelAt).toBeGreaterThan(fiveHourAt)
  })

  test('off a subscription there is no rate-limit segment, and no cost without a ledger', async ($, on) => {
    setupWorld(on)
    await $.session.measure(measure(10))
    const text = await bandText($)
    expect(text).not.toContain('5h')
    expect(text).not.toContain('wk')
    expect(text).not.toContain('$')
  })

  test('the bar warms as the window fills: green, yellow at 50, orange at 75, red at 90', async ($, on) => {
    setupWorld(on)
    for (const [percent, color] of [[49, GREEN], [50, YELLOW], [75, ORANGE], [90, RED]] as const) {
      await $.session.measure(measure(percent))
      expect(await barColor($, 'ctx')).toBe(color)
    }
  })

  test('before any measure the band draws nothing of its own', async ($, on) => {
    setupWorld(on)
    expect(await bandText($)).toBe('')
  })

  test('the row shows the model and effort the router chose, from the main loop only, and a later measure keeps them', async ($, on) => {
    setupWorld(on)
    mock.env(on, { TYPESAFE_API_KEY: 'test-key' })
    on('http.fetch', async () => ({ value: JEV_FAST }))
    on('prompt.submit', async (_$, e) => ({ text: e.text }))
    await $.prompt.submit({ text: 'rename foo to bar', wait: false, origin: { kind: 'composer' } })
    await $.session.measure(measure(10))
    await drain($.turn.step(STEP))
    await $.session.measure(measure(20))
    const text = await bandText($)
    expect(text).toContain('sonnet · medium')
    expect(text).not.toContain('Opus 5.5')
  })

  test('a subagent step leaves the model shown as it was', async ($, on) => {
    setupWorld(on)
    mock.env(on, { TYPESAFE_API_KEY: 'test-key' })
    on('http.fetch', async () => ({ value: JEV_FAST }))
    on('prompt.submit', async (_$, e) => ({ text: e.text }))
    await $.prompt.submit({ text: 'rename foo to bar', wait: false, origin: { kind: 'composer' } })
    await drain($.turn.step({ ...STEP, agentId: 'agent-1' }))
    await $.session.measure(measure(10))
    expect(await bandText($)).toContain('Opus 5.5')
  })

  test('off Jev the model still shows its effort, taken from the turn\'s own setting', async ($, on) => {
    setupWorld(on)
    await drain($.turn.step({ ...STEP, effort: 'high' }))
    await $.session.measure(measure(10))
    expect(await bandText($)).toContain('Opus 5.5 · high')
  })

  test('the row shows cache tokens read this session', async ($, on) => {
    setupWorld(on)
    on('turn.complete', async (_$, e) => ({ text: e.answer }))
    await $.turn.complete(finish(50_000))
    await $.session.measure(measure(10))
    expect(await bandText($)).toContain('50.0k cache')
  })

  test('cache accumulates across turns in the session', async ($, on) => {
    setupWorld(on)
    on('turn.complete', async (_$, e) => ({ text: e.answer }))
    await $.turn.complete(finish(10_000))
    await $.turn.complete(finish(20_000))
    await $.session.measure(measure(10))
    expect(await bandText($)).toContain('30.0k cache')
  })

  test('cache resets when the session restarts', async ($, on) => {
    setupWorld(on)
    on('turn.complete', async (_$, e) => ({ text: e.answer }))
    on('session.end', async (_$, e) => ({ sessionId: e.sessionId }))
    await $.turn.complete(finish(50_000))
    await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
    await $.session.measure(measure(10))
    expect(await bandText($)).not.toContain('cache')
  })
})
