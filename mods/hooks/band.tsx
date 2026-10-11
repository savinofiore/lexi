import { atom, read } from 'claude-code'
import type { MatchedHook } from 'claude-code'

// The engine's state scan wants each atom spelled in the file that reads it: gate.ts writes this one.
const lastGate = atom({ plugin: 'lexi-mods', key: 'lastGate' } as const, null)

const secondsOf = (ms: number): string => `${(ms / 1000).toFixed(1)}s`

// One row above the prompt: the last gate run, once there is one.
export const onAbovePrompt: MatchedHook<'ui.render', { component: 'AbovePrompt' }> = async ($, e, next) => {
  const run = await read($, lastGate)
  if (run === null || e.props.hasSurvey) return next(e)
  const { Box, Text } = $.ui.resolve(e)
  const age = Math.round(((await $.clock.now()) - run.at) / 1000)
  return (
    <Box>
      <Text color={run.isGreen ? 'success' : 'error'}>gate {run.isGreen ? 'GREEN' : 'RED'}</Text>
      <Text dimColor> · {secondsOf(run.durationMs)} · {age}s ago</Text>
    </Box>
  )
}
