import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { colorOf } from './palette.ts'

const PANE = {
  component: 'Pane', requestId: 'lexi-agents',
  props: { title: 'Subagents', isFocused: true, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const

// The world beneath the plugin: spawns get agent-1, agent-2, ...; tools answer ok unless the
// command says `fail`; what the plugin opened is recorded.
const setupWorld = (on: On) => {
  const clock = mock.clock(on)
  mock.env(on, {}) // the router shares the agent.spawn event and asks for its key
  const seen = { opened: [] as string[], spawned: 0 }
  on('ui.open', async (_$, e) => (seen.opened.push(e.id), { value: { isPlaced: true } }))
  on('ui.render', async () => ({ type: 'Box', props: {}, children: [] }))
  on('agent.spawn', async (_$, e) => ({ model: e.model ?? e.parentModel, agentId: `agent-${++seen.spawned}` }))
  on('tool.call', async (_$, e) =>
    e.tool === 'Bash' && e.command.includes('fail') ? { isError: true, result: 'boom', text: 'boom' } : { result: 'ok', text: 'ok' })
  on('turn.complete', async (_$, e) => ({ text: e.answer }))
  // The engine refuses a name that is one of its own (/agents is built in), and the whole session.start hook with it.
  on('command.register', async (_$, e) => {
    if (e.name === 'agents') throw new Error('"/agents" refused: it is the built-in /agents')
    return { value: { command: e.name } }
  })
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

const mountPane = ($: Engine) => $.ui.mount({ plugin: 'lexi', surface: 'terminal', ...PANE })

describe('agents', () => {
  test('a spawned subagent is listed as running, colored by its type', async ($, on) => {
    setupWorld(on)
    await $.agent.spawn(spawn('Explore'))
    const ui = await mountPane($)
    const row = await ui.find({ type: 'Text', text: /Explore #1/ })
    expect(row?.text).toContain('running')
    expect(row?.props.color).toBe(colorOf('Explore'))
  })

  test('a row shows the model the subagent runs on, shortened to its family', async ($, on) => {
    setupWorld(on)
    await $.agent.spawn({ ...spawn('Explore'), model: 'claude-haiku-5-5' })
    const ui = await mountPane($)
    expect((await ui.find({ type: 'Text', text: /Explore #1/ }))?.text).toContain('· haiku ·')
  })

  test('a row counts the steps the subagent took', async ($, on) => {
    setupWorld(on)
    await $.agent.spawn(spawn('Explore'))
    for (const [command, steps] of [['ls', '1 step'], ['ls -a', '2 steps']] as const) {
      await $.tool.call(inAgent('agent-1', command))
      const ui = await mountPane($)
      expect((await ui.find({ type: 'Text', text: /Explore #1/ }))?.text).toContain(`· ${steps} ·`)
      await ui.unmount()
    }
  })

  test('a row is marked ▶ while running, ✓ when done and ✗ once a step failed', async ($, on) => {
    setupWorld(on)
    for (const type of ['Explore', 'Plan', 'Review']) await $.agent.spawn(spawn(type))
    await $.turn.complete(finish('agent-2', 'planned'))
    await $.tool.call(inAgent('agent-3', 'fail now'))
    const ui = await mountPane($)
    const glyphOf = async (label: string) => (await ui.find({ type: 'Text', text: new RegExp(`${label} ·`) }))?.text.slice(0, 1)
    expect([await glyphOf('Explore #1'), await glyphOf('Plan #1'), await glyphOf('Review #1')]).toEqual(['▶', '✓', '✗'])
  })

  test('running subagents list above the finished ones, each group in start order', async ($, on) => {
    setupWorld(on)
    for (const type of ['Explore', 'Plan', 'Review']) await $.agent.spawn(spawn(type))
    await $.turn.complete(finish('agent-1', 'found'))
    const ui = await mountPane($)
    const labels = (await ui.findAll({ type: 'Text', text: /#1 ·/ })).map((row) => row.text.match(/\w+ #1/)?.[0])
    expect(labels).toEqual(['Plan #1', 'Review #1', 'Explore #1'])
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
    expect(seen.opened).toEqual(['lexi-agents'])
  })

  test('the subagents command opens the pane, under a name the engine does not own', async ($, on) => {
    const { seen } = setupWorld(on)
    await $.session.start({ cwd: '/p', surface: null, isInteractive: true })
    await $.command.run({ command: 'subagents', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } })
    expect(seen.opened).toEqual(['lexi-agents'])
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
