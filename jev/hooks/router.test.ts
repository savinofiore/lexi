import { describe, expect, mock, test } from 'claude-code/testing'
import type { HttpResponse, On } from 'claude-code'

type Reply = (call: number) => Promise<HttpResponse> | HttpResponse

const jevReply = (tier: string, effort: number, risk = 0.04): HttpResponse => ({
  status: 200,
  ok: true,
  headers: {},
  text: JSON.stringify({
    answers: { tier: { choice: tier, confidence: 0.98 }, effort: { score: effort, confidence: 0.94 }, risky: { noul: risk } },
  }),
})

// The world beneath the plugin: mocked clock and env, a Jev that answers `reply`, and bottoms
// for every event the router passes on, recording what reached them.
const setupWorld = (on: On, hasKey: boolean, reply: Reply) => {
  const clock = mock.clock(on)
  mock.env(on, hasKey ? { TYPESAFE_API_KEY: 'test-key' } : {})
  const seen = { jevCalls: 0, logs: [] as string[], steps: [] as { model: string; effort: unknown }[], spawns: [] as (string | undefined)[] }
  on('ui.log', async (_$, e) => (seen.logs.push(e.text), { value: undefined }))
  on('ui.status', async () => ({ value: undefined }))
  on('http.fetch', async () => ({ value: await reply(++seen.jevCalls) }))
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('prompt.submit', async (_$, e) => ({ text: e.text }))
  on('agent.spawn', async (_$, e) => (seen.spawns.push(e.model), { model: e.model ?? e.parentModel, agentId: 'agent-1' }))
  on('turn.step', async function* (_$, e) {
    seen.steps.push({ model: e.model, effort: e.effort })
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: null, usage: null }
  })
  return { clock, seen }
}

const prompt = (text: string) => ({ text, wait: false, origin: { kind: 'composer' as const } })
const step = (index: number, agentId?: string) => ({ turnId: 't1', index, model: 'claude-opus-5-5', effort: 'medium' as const, messageCount: 1, ...(agentId ? { agentId } : {}) })
const spawn = (subagentType: string) => ({
  tool_use_id: 'tu1', prompt: 'find usages of X', description: 'search', subagentType,
  provider: { plugin: 'engine', tier: 'core' as const }, parentModel: 'claude-opus-5-5', background: false, fork: false,
})

const drain = async (stream: AsyncIterable<unknown>) => {
  for await (const _chunk of stream) void _chunk
}

describe('jev-router', () => {
  test('calls Jev once over two prompts and applies the same decision to every step', async ($, on) => {
    const { seen } = setupWorld(on, true, () => jevReply('fast', 0.2))
    await $.session.start({ cwd: '/p', surface: null, isInteractive: false })
    await $.prompt.submit(prompt('rename foo to bar'))
    await drain($.turn.step(step(0)))
    await $.prompt.submit(prompt('and run the tests'))
    await drain($.turn.step(step(1)))
    await drain($.turn.step(step(2)))
    expect(seen.jevCalls).toBe(1)
    expect(seen.steps).toEqual([0, 1, 2].map(() => ({ model: 'claude-sonnet-5', effort: 'low' })))
    expect(seen.logs).toContain('[jev-router] session: sonnet · effort low')
    expect(seen.logs).toContain("[jev-router] reusing the first prompt's choice")
  })

  test('leaves subagent steps alone', async ($, on) => {
    const { seen } = setupWorld(on, true, () => jevReply('fast', 0.2))
    await $.prompt.submit(prompt('rename foo'))
    await drain($.turn.step(step(0, 'agent-9')))
    expect(seen.steps).toEqual([{ model: 'claude-opus-5-5', effort: 'medium' }])
  })

  test('a timeout is no decision: the next prompt asks again', async ($, on) => {
    const { clock, seen } = setupWorld(on, true, (call) => (call === 1 ? clock.sleep(5000).then(() => jevReply('fast', 0.2)) : jevReply('deep', 2.8)))
    const first = $.prompt.submit(prompt('first'))
    await clock.advance(1500)
    await first
    await drain($.turn.step(step(0)))
    expect(seen.steps[0]).toEqual({ model: 'claude-opus-5-5', effort: 'medium' })
    await $.prompt.submit(prompt('second'))
    await drain($.turn.step(step(1)))
    expect(seen.jevCalls).toBe(2)
    expect(seen.steps[1]).toEqual({ model: 'claude-fable-5-1', effort: 'xhigh' })
  })

  test('without a key never calls Jev and changes nothing', async ($, on) => {
    const { seen } = setupWorld(on, false, () => jevReply('fast', 0.2))
    await $.prompt.submit(prompt('one'))
    await $.prompt.submit(prompt('two'))
    await drain($.turn.step(step(0)))
    expect(seen.jevCalls).toBe(0)
    expect(seen.steps).toEqual([{ model: 'claude-opus-5-5', effort: 'medium' }])
    expect(seen.logs.filter((line) => line.includes('TYPESAFE_API_KEY'))).toHaveLength(1)
  })

  test('classifies every subagent spawn on its own', async ($, on) => {
    const { seen } = setupWorld(on, true, (call) => jevReply(call === 1 ? 'fast' : 'deep', 0.78))
    await $.agent.spawn(spawn('Explore'))
    await $.agent.spawn(spawn('general-purpose'))
    await $.agent.spawn({ ...spawn('fork'), fork: true })
    expect(seen.jevCalls).toBe(2)
    expect(seen.spawns).toEqual(['sonnet', 'fable', undefined])
    expect(seen.logs).toContain('[jev-router] subagent Explore: sonnet')
  })

  test('risk forces deep and at least high effort', async ($, on) => {
    const { seen } = setupWorld(on, true, () => jevReply('fast', 0.1, 0.9))
    await $.prompt.submit(prompt('run the migration on prod'))
    await drain($.turn.step(step(0)))
    expect(seen.steps[0]).toEqual({ model: 'claude-fable-5-1', effort: 'high' })
  })
})
