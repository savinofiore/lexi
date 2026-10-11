import { atom, update } from 'claude-code'
import type { EngineInterface, MatchedHook } from 'claude-code'

const lastGate = atom({ plugin: 'lexi-mods', key: 'lastGate' } as const, null)

// The first line of lexi's guard refusal (hooks/tdd_guard.py): `lexi — edit to `x` BLOCKED.`
const GUARD_LINE = /^lexi — .* BLOCKED\.$/m

// The project's gate from `.lexi.json`; undefined outside a lexi project, so the mod stays quiet.
const gateOf = async ($: EngineInterface): Promise<string | undefined> => {
  const text = await $.fs.read('.lexi.json').then(String, () => undefined)
  try {
    const gate: unknown = text === undefined ? undefined : JSON.parse(text).gate
    return typeof gate === 'string' && gate !== '' ? gate : undefined
  } catch {
    return undefined
  }
}

// The tools lexi's guard covers (hooks/hooks.json): the gate runs in Bash, a block lands on any of them.
export const GUARDED = { tool: /^(Bash|Edit|Write|NotebookEdit)$/ }

export const onToolCall: MatchedHook<'tool.call', typeof GUARDED> = async ($, e, next) => {
  const gate = e.tool === 'Bash' ? await gateOf($) : undefined
  const startedAt = await $.clock.now()
  const ran = await next(e)
  if (ran.deny !== undefined) return ran
  const blocked = ran.isError ? ran.text?.match(GUARD_LINE)?.[0] : undefined
  if (blocked) $.ui.toast(blocked)
  if (e.tool !== 'Bash' || gate === undefined || !e.command.includes(gate)) return ran
  const at = await $.clock.now()
  const isGreen = !ran.isError
  await update($, lastGate, () => ({ isGreen, durationMs: at - startedAt, at }))
  $.ui.status(isGreen ? 'lexi:GREEN' : 'lexi:RED')
  return ran
}
