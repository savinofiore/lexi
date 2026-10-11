import { atom, read } from 'claude-code'
import type { MatchedHook } from 'claude-code'
import type { AgentRun, GateRun } from '../types'
import { hasFailedStep, stepsOf } from './agents.tsx'
import { usageRow } from './usage.tsx'
import type { Elements } from './usage.tsx'

// The engine's state scan wants each atom spelled in the file that reads it: gate.ts, agents.tsx and usage.tsx write these.
const lastGate = atom({ plugin: 'lexi', key: 'lastGate' } as const, null)
const agents = atom({ plugin: 'lexi', key: 'agents' } as const, [])
const usage = atom({ plugin: 'lexi', key: 'usage' } as const, null)

// One short row: the rest are counted, the pane lists them all.
const SHOWN = 4

const secondsOf = (ms: number): string => `${(ms / 1000).toFixed(1)}s`

const gateRow = (ui: Elements, run: GateRun, age: number) => (
  <ui.Box>
    <ui.Text color={run.isGreen ? 'success' : 'error'}>gate {run.isGreen ? 'GREEN' : 'RED'}</ui.Text>
    <ui.Text dimColor> · {secondsOf(run.durationMs)} · {age}s ago</ui.Text>
  </ui.Box>
)

const agentsRow = (ui: Elements, running: readonly AgentRun[]) => (
  <ui.Box>
    {running.slice(0, SHOWN).map((run) => <ui.Text color={run.color}>{hasFailedStep(run) ? '✗' : '●'} {run.label} · {stepsOf(run)} </ui.Text>)}
    {running.length > SHOWN && <ui.Text dimColor>+{running.length - SHOWN} more</ui.Text>}
  </ui.Box>
)

// Above the prompt, whatever the terminal's width: the session's usage, the last gate run and the subagents running now.
export const onAbovePrompt: MatchedHook<'ui.render', { component: 'AbovePrompt' }> = async ($, e, next) => {
  const run = await read($, lastGate)
  const running = (await read($, agents)).filter((one) => !one.isDone)
  const now = await read($, usage)
  if ((now === null && run === null && running.length === 0) || e.props.hasSurvey) return next(e)
  const ui = $.ui.resolve(e)
  const at = await $.clock.now()
  const age = run === null ? 0 : Math.round((at - run.at) / 1000)
  return (
    <ui.Box flexDirection="column">
      {now !== null && usageRow(ui, now, at)}
      {run !== null && gateRow(ui, run, age)}
      {running.length > 0 && agentsRow(ui, running)}
    </ui.Box>
  )
}
