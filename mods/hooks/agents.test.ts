import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { colorOf } from './palette.ts'

const PANE = {
  component: 'Pane', requestId: 'lexi-mods-agents',
  props: { title: 'Subagents', isFocused: true, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const

// The world beneath the plugin: spawns get agent-1, agent-2, ...; tools answer ok unless the
// command says `fail`; what the plugin opened is recorded.
const setupWorld = (on: On) => {
  const clock = mock.clock(on)
  const seen = { opened: [] as string[], spawned: 0 }
  on('ui.open', async (_$, e) => (seen.opened.push(e.id), { value: { isPlaced: true } }))
  on('ui.render', async () => ({ type: 'Box', props: {}, children: [] }))
  on('agent.spawn', async (_$, e) => ({ model: e.parentModel, agentId: `agent-${++seen.spawned}` }))
  on('tool.call', async (_$, e) =>
    e.tool === 'Bash' && e.command.includes('fail') ? { isError: true, result: 'boom', text: 'boom' } : { result: 'ok', text: 'ok' })
  on('turn.complete', async (_$, e) => ({ text: e.answer }))
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('command.run', async () => ({ text: 'Unknown command' }))
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  return { clock, seen }
}

const spawn = (subagentType: string) => ({
  tool_use_id: 'tu1', prompt: 'find usages of X', description: 'find X', subagentType,
  provider: { plugin: 'engine', tier: 'core' as const }, parentModel: 'claude-opus-5-5', background: false, fork: false,
})

const finish = (agentId: string, answer: string) => ({
  answer, durationMs: 4200, isAborted: false, turnId: 't1', agentId, reason: 'answer' as const,
  usage: { model: 'claude-haiku-5-5', input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
})

// A call made inside a subagent's loop: the engine stamps agentId there, a plugin's own call cannot.
const inAgent = (agentId: string, command: string) => ({ tool: 'Bash', command, agentId }) as unknown as Parameters<Engine['tool']['call']>[0]

const mountPane = ($: Engine) => $.ui.mount({ plugin: 'lexi-mods', surface: 'terminal', ...PANE })

describe('agents', () => {
  test('a spawned subagent is listed as running, colored by its type', async ($, on) => {
    setupWorld(on)
    await $.agent.spawn(spawn('Explore'))
    const ui = await mountPane($)
    const row = await ui.find({ type: 'Text', text: /Explore #1/ })
    expect(row?.text).toContain('running')
    expect(row?.props.color).toBe(colorOf('Explore'))
  })

  test('a finished subagent shows its duration and tokens', async ($, on) => {
    setupWorld(on)
    await $.agent.spawn(spawn('Explore'))
    await $.turn.complete(finish('agent-1', 'X is used in a.ts'))
    const ui = await mountPane($)
    expect((await ui.find({ type: 'Text', text: /Explore #1/ }))?.text).toContain('done · 4.2s · 1500 tok')
  })

  test('two subagents of the same type are told apart by an index', async ($, on) => {
    setupWorld(on)
    await $.agent.spawn(spawn('Explore'))
    await $.agent.spawn(spawn('Explore'))
    const ui = await mountPane($)
    expect(await ui.find({ type: 'Text', text: /Explore #1/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Explore #2/ })).toBeDefined()
  })

  test('the pane opens by itself on the first spawn only', async ($, on) => {
    const { seen } = setupWorld(on)
    await $.agent.spawn(spawn('Explore'))
    await $.agent.spawn(spawn('Plan'))
    expect(seen.opened).toEqual(['lexi-mods-agents'])
  })

  test('the agents command opens the pane', async ($, on) => {
    const { seen } = setupWorld(on)
    await $.session.start({ cwd: '/p', surface: null, isInteractive: true })
    await $.command.run({ command: 'agents', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } })
    expect(seen.opened).toEqual(['lexi-mods-agents'])
  })

  test('pressing a subagent opens its answer, back returns to the list', async ($, on) => {
    setupWorld(on)
    await $.agent.spawn(spawn('Explore'))
    await $.turn.complete(finish('agent-1', 'X is used in a.ts'))
    const ui = await mountPane($)
    await ui.press({ key: 'agent-1' })
    expect(await ui.find({ type: 'Text', text: /X is used in a\.ts/ })).toBeDefined()
    await ui.press({ key: 'back' })
    expect(await ui.find({ type: 'Text', text: /X is used in a\.ts/ })).toBeUndefined()
  })

  test('the tool calls of a subagent form its timeline, errors marked', async ($, on) => {
    setupWorld(on)
    await $.agent.spawn(spawn('Explore'))
    await $.tool.call(inAgent('agent-1', 'grep -rn X src'))
    await $.tool.call(inAgent('agent-1', 'fail now'))
    await $.tool.call(inAgent('agent-9', 'ls'))
    const ui = await mountPane($)
    await ui.press({ key: 'agent-1' })
    const steps = (await ui.findAll({ type: 'Text', text: /^[✓✗] / })).map((step) => step.text)
    expect(steps).toEqual(['✓ Bash grep -rn X src', '✗ Bash fail now'])
  })
})
