import type { Register } from 'claude-code'
import { compact } from './compact.ts'
import { onAgentSpawn, onPromptSubmit, onSessionEnd, onSessionStart, onTurnStep } from './router.ts'

// A plugin gets exactly one hooks module: this one wires both levels.
export const register: Register = (on) => {
  on('session.start', onSessionStart)
  on('session.end', onSessionEnd)
  on('prompt.submit', onPromptSubmit)
  on('turn.step', onTurnStep)
  on('agent.spawn', onAgentSpawn)
  on('session.compact', compact)
}
