import { atom, read, update } from 'claude-code'
import type { EngineInterface, Hook, MatchedHook } from 'claude-code'
import type { AgentRun } from '../types'
import { shortModel } from '../../jev/shared/router-policy.ts'
import { colorOf } from './palette.ts'

export const PANE = 'lexi-agents' as const
const TITLE = 'Subagents'

const agents = atom({ plugin: 'lexi', key: 'agents' } as const, [])
const selected = atom({ plugin: 'lexi', key: 'selected' } as const, null)

// shortcut: keeps the last 50 subagents of the session; raise it if a long session needs more.
const KEEP = 50

const startRun = (list: readonly AgentRun[], id: string, type: string, description: string, model?: string): AgentRun => ({
  id, type, description,
  ...(model === undefined ? {} : { model: shortModel(model) }),
  label: `${type} #${list.filter((run) => run.type === type).length + 1}`,
  color: colorOf(type),
  isDone: false,
  steps: [],
})

export const onAgentSpawn: Hook<'agent.spawn'> = async ($, e, next) => {
  const started = await next(e)
  const id = started.agentId
  if (id === undefined) return started
  const isFirst = (await read($, agents)).length === 0
  // Not awaited: on a narrow terminal the engine holds an unasked pane until there is room.
  if (isFirst) void $.ui.open({ id: PANE, title: TITLE })
  await update($, agents, (list) => [...list, startRun(list, id, e.subagentType, e.description, started.model)].slice(-KEEP))
  return started
}

// The argument that says what a call did, cut to one short line.
const INPUT_KEYS = ['command', 'file_path', 'pattern', 'path', 'url', 'query', 'description'] as const
const inputOf = (e: Readonly<Record<string, unknown>>): string => {
  const value = INPUT_KEYS.map((key) => e[key]).find((one) => typeof one === 'string')
  return typeof value === 'string' ? value.split('\n')[0]!.slice(0, 60) : ''
}

// One step of a subagent's timeline; calls of the main loop carry no agentId and are skipped.
export const onAgentToolCall: Hook<'tool.call'> = async ($, e, next) => {
  const ran = await next(e)
  if (e.agentId === undefined) return ran
  const step = { tool: e.tool, input: inputOf(e), isError: ran.deny !== undefined || ran.isError === true }
  await update($, agents, (list) => list.map((run) => (run.id === e.agentId ? { ...run, steps: [...run.steps, step] } : run)))
  return ran
}

export const onSessionStart: Hook<'session.start'> = async ($, e, next) => {
  await $.command.register({ name: 'subagents', description: 'Show the subagents of this session, colored by type' })
  return next(e)
}

export const onAgentsCommand: MatchedHook<'command.run', { command: 'subagents' }> = async ($) => {
  await $.ui.open({ id: PANE, title: TITLE })
  return { text: 'Subagents pane opened.' }
}

export const onTurnComplete: Hook<'turn.complete'> = async ($, e, next) => {
  const done = await next(e)
  if (e.agentId === undefined) return done
  const tokens = e.usage === undefined ? undefined : e.usage.input_tokens + e.usage.output_tokens
  const finished = { isDone: true, durationMs: e.durationMs, tokens, answer: e.answer }
  await update($, agents, (list) => list.map((run) => (run.id === e.agentId ? { ...run, ...finished } : run)))
  return done
}

export const stepsOf = (run: AgentRun): string => `${run.steps.length} step${run.steps.length === 1 ? '' : 's'}`

// A failed step outranks the run's own state: that is what a glance at the list should catch.
export const hasFailedStep = (run: AgentRun): boolean => run.steps.some((step) => step.isError)
const glyphOf = (run: AgentRun): string => (hasFailedStep(run) ? '✗' : run.isDone ? '✓' : '▶')

const statusOf = (run: AgentRun): string =>
  run.isDone ? `done · ${((run.durationMs ?? 0) / 1000).toFixed(1)}s · ${run.tokens ?? 0} tok` : 'running'

type Elements = ReturnType<EngineInterface['ui']['resolve']>
type Select = (id: string | null) => Promise<unknown>

const listView = (ui: Elements, list: readonly AgentRun[], select: Select) => (
  <ui.Box flexDirection="column">
    {list.length === 0 && <ui.Text dimColor>No subagents yet.</ui.Text>}
    {[...list.filter((run) => !run.isDone), ...list.filter((run) => run.isDone)].map((run) => (
      <ui.Box>
        <ui.Text color={run.color}>{glyphOf(run)} {run.label} · {run.model === undefined ? '' : `${run.model} · `}{statusOf(run)} · {stepsOf(run)} · {run.description} </ui.Text>
        <ui.Button key={run.id} label="open" onPress={() => select(run.id)} />
      </ui.Box>
    ))}
  </ui.Box>
)

const detailView = (ui: Elements, run: AgentRun, select: Select) => (
  <ui.Box flexDirection="column">
    <ui.Text color={run.color}>{run.label} · {statusOf(run)}</ui.Text>
    <ui.Text dimColor>{run.description}</ui.Text>
    {run.steps.map((step) => (
      <ui.Text color={step.isError ? 'error' : undefined}>{step.isError ? '✗' : '✓'} {step.tool} {step.input}</ui.Text>
    ))}
    <ui.Text>{run.answer ?? '…'}</ui.Text>
    <ui.Button key="back" label="back" onPress={() => select(null)} />
  </ui.Box>
)

export const onPane: MatchedHook<'ui.render', { component: 'Pane'; requestId: typeof PANE }> = async ($, e) => {
  const ui = $.ui.resolve(e)
  const list = await read($, agents)
  const id = await read($, selected)
  const run = list.find((one) => one.id === id)
  const select: Select = (next) => update($, selected, () => next)
  return run === undefined ? listView(ui, list, select) : detailView(ui, run, select)
}
