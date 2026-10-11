import type { Register } from 'claude-code'
import { compact } from './jev/compact.ts'
import { onAgentSpawn as routeAgent, onPromptSubmit, onSessionEnd, onSessionStart as resetRouter, onTurnStep } from './jev/router.ts'
import { PANE, onAgentToolCall, onAgentsCommand, onAgentSpawn as listAgent, onPane, onSessionStart as resetAgents, onTurnComplete } from './ui/agents.tsx'
import { onAbovePrompt } from './ui/band.tsx'
import { GUARDED, onToolCall } from './ui/gate.ts'
import { onMeasure } from './ui/usage.tsx'

// An event takes one hook without a matcher, so the router and the interface split session.start and agent.spawn by matcher.
// A plugin gets exactly one hooks module: this one wires the Jev layer (router, compaction) and the interface (usage row, gate, subagents).
export const register: Register = (on) => {
  on('session.start', resetRouter)
  on('session.start', { isInteractive: true }, resetAgents)
  on('session.end', onSessionEnd)
  on('prompt.submit', onPromptSubmit)
  on('turn.step', onTurnStep)
  on('agent.spawn', { fork: false }, routeAgent)
  on('agent.spawn', listAgent)
  on('session.compact', compact)
  on('command.run', { command: 'agents' }, onAgentsCommand)
  on('tool.call', GUARDED, onToolCall)
  on('tool.call', onAgentToolCall)
  on('turn.complete', onTurnComplete)
  on('session.measure', onMeasure)
  on('ui.render', { component: 'AbovePrompt' }, onAbovePrompt)
  on('ui.render', { component: 'Pane', requestId: PANE }, onPane)
}
