import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { colorOf } from './palette.ts'

const GATE = 'python3 a_test.py'
const BAND = { component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 3, bodyColumns: 80, scroll: { offset: 0, bodyRows: 3 }, view: {} } } as const

// A lexi project whose gate takes 3.4s and passes; spawns get agent-1, agent-2, ...; status and panes go nowhere.
const setupWorld = (on: On) => {
  mock.env(on, {}) // the router shares the agent.spawn event and asks for its key
  const clock = mock.clock(on)
  let spawned = 0
  on('agent.spawn', async (_$, e) => ({ model: e.parentModel, agentId: `agent-${++spawned}` }))
  on('turn.complete', async (_$, e) => ({ text: e.answer }))
  on('ui.open', async () => ({ value: { isPlaced: false, reason: 'narrow terminal' } }))
  on('ui.status', async () => ({ value: undefined }))
  on('ui.render', async () => ({ type: 'Box', props: {}, children: [] }))
  on('fs.read', async () => ({ value: JSON.stringify({ gate: GATE }) }))
  on('tool.call', async (_$, e) =>
    e.tool === 'Bash' && e.command.includes('fail') ? { isError: true, result: 'boom', text: 'boom' } : (await clock.advance(3400), { result: '34 pass', text: '34 pass' }))
  return clock
}

const spawn = (subagentType: string) => ({
  tool_use_id: 'tu1', prompt: 'find usages of X', description: 'find X', subagentType,
  provider: { plugin: 'engine', tier: 'core' as const }, parentModel: 'claude-opus-5-5', background: false, fork: false,
})

const mountBand = ($: Engine) => $.ui.mount({ plugin: 'lexi', surface: 'terminal', ...BAND })

const bandText = async ($: Engine) => {
  const ui = await $.ui.mount({ plugin: 'lexi', surface: 'terminal', ...BAND })
  const found = await ui.findAll({ type: 'Text' })
  await ui.unmount()
  return found.map((text) => text.text).join('')
}

describe('band', () => {
  test('after a gate run the band shows its result, duration and age', async ($, on) => {
    const clock = setupWorld(on)
    await $.tool.call({ tool: 'Bash', command: GATE })
    await clock.advance(12000)
    expect(await bandText($)).toContain('gate GREEN · 3.4s · 12s ago')
  })

  test('before any gate run the band draws nothing of its own', async ($, on) => {
    setupWorld(on)
    expect(await bandText($)).toBe('')
  })

  test('a running subagent shows in its color, with no gate run and the pane held back', async ($, on) => {
    setupWorld(on)
    await $.agent.spawn(spawn('Explore'))
    const ui = await mountBand($)
    const row = await ui.find({ type: 'Text', text: /● Explore #1/ })
    await ui.unmount()
    expect(row?.props.color).toBe(colorOf('Explore'))
  })

  test('a running subagent shows its step count, and ✗ in place of ● once a step failed', async ($, on) => {
    setupWorld(on)
    await $.agent.spawn(spawn('Explore'))
    const inAgent = (command: string) => ({ tool: 'Bash', command, agentId: 'agent-1' }) as unknown as Parameters<Engine['tool']['call']>[0]
    await $.tool.call(inAgent('ls'))
    expect(await bandText($)).toContain('● Explore #1 · 1 step')
    await $.tool.call(inAgent('fail now'))
    expect(await bandText($)).toContain('✗ Explore #1 · 2 steps')
  })

  test('a finished subagent leaves the band, which then draws nothing of its own', async ($, on) => {
    setupWorld(on)
    await $.agent.spawn(spawn('Explore'))
    await $.turn.complete({ answer: 'done', durationMs: 4200, isAborted: false, turnId: 't1', agentId: 'agent-1', reason: 'answer' })
    expect(await bandText($)).toBe('')
  })

  test('the gate row and the subagents row show together', async ($, on) => {
    setupWorld(on)
    await $.tool.call({ tool: 'Bash', command: GATE })
    await $.agent.spawn(spawn('Plan'))
    const text = await bandText($)
    expect(text).toContain('gate GREEN')
    expect(text).toContain('● Plan #1')
  })

  test('past four running subagents the row shows four and counts the rest', async ($, on) => {
    setupWorld(on)
    for (const type of ['Explore', 'Plan', 'Explore', 'general-purpose', 'Plan', 'Explore']) await $.agent.spawn(spawn(type))
    const text = await bandText($)
    expect(text.match(/●/g)?.length).toBe(4)
    expect(text).toContain('+2 more')
  })
})
