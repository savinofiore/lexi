import type { Register } from 'claude-code'
import { PANE, onAgentToolCall, onAgentsCommand, onAgentSpawn, onPane, onSessionStart, onTurnComplete } from './agents.tsx'
import { onAbovePrompt } from './band.tsx'
import { GUARDED, onToolCall } from './gate.ts'
import { onMeasure, onTurnStep } from './usage.tsx'

export const register: Register = (on) => {
  on('session.start', onSessionStart)
  on('command.run', { command: 'agents' }, onAgentsCommand)
  on('tool.call', GUARDED, onToolCall)
  on('tool.call', onAgentToolCall)
  on('agent.spawn', onAgentSpawn)
  on('turn.complete', onTurnComplete)
  on('session.measure', onMeasure)
  on('turn.step', onTurnStep)
  on('ui.render', { component: 'AbovePrompt' }, onAbovePrompt)
  on('ui.render', { component: 'Pane', requestId: PANE }, onPane)
}
