import type { CallInfo, JevState, StateCall, Verdict } from '../../../jev/shared/compact-policy.ts'
import { isOpen, truncated } from '../../../jev/shared/compact-policy.ts'

// Reads messages already converted by `convertToLlm` and rewrites the history verbatim. No runtime
// import from the Pi package, so `transcript.test.ts` runs under `node --test`.

export type Call = { id: string; tool: string; input: Record<string, unknown>; at: number }
export type Result = { id: string; tool: string; text: string; isError: boolean; at: number }
export type Turn = { i: number; role: string; text: string; calls: Call[]; result?: Result }
type Block = { type?: string; text?: string; id?: string; name?: string; arguments?: Record<string, unknown> }
type LlmMessage = { role: string; content?: unknown; toolCallId?: string; toolName?: string; isError?: boolean }

const textOf = (content: unknown): string => {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return (content as Block[]).filter((part) => part.type === 'text').map((part) => part.text ?? '').join('\n')
}

export const toTurns = (messages: readonly LlmMessage[]): Turn[] =>
  messages.map((message, i): Turn => {
    const blocks: Block[] = Array.isArray(message.content) ? message.content : []
    const calls = blocks
      .filter((block) => block.type === 'toolCall')
      .map((block): Call => ({ id: block.id ?? '', tool: block.name ?? '?', input: block.arguments ?? {}, at: i }))
    const result = message.role === 'toolResult'
      ? { id: message.toolCallId ?? '', tool: message.toolName ?? '?', text: textOf(message.content), isError: message.isError === true, at: i }
      : undefined
    // A toolResult's text lives only in `result`: leaving it in `text` too would send it to Jev, which
    // must never see result contents in the state.
    return { i, role: message.role, text: result ? '' : textOf(message.content), calls, ...(result ? { result } : {}) }
  })

// Candidate: a call with its result, both outside the immune messages.
export const candidatesOf = (turns: readonly Turn[]): (CallInfo & Call)[] => {
  const open = turns.filter((turn) => isOpen(turn.i, turns.length))
  const results = new Map(open.flatMap((turn) => (turn.result ? [[turn.result.id, turn.result] as const] : [])))
  return open.flatMap((turn) => turn.calls).flatMap((call) => {
    const result = results.get(call.id)
    return result ? [{ ...call, resultChars: result.text.length }] : []
  })
}

// Structure and history without result contents: only a note with outcome and length.
export const buildState = (turns: readonly Turn[], instructions: string | undefined): JevState => {
  const results = new Map(turns.flatMap((turn) => (turn.result ? [[turn.result.id, turn.result] as const] : [])))
  const note = (id: string) => {
    const result = results.get(id)
    return result ? `${result.isError ? 'error' : 'ok'}, ${result.text.length} chars` : 'no result'
  }
  const conversation = turns.flatMap((turn) => {
    const calls: StateCall[] = turn.calls.map((call) => ({ id: call.id, tool: call.tool, input: call.input, result: note(call.id) }))
    if (!turn.text && !calls.length) return []
    return [{ i: turn.i, role: turn.role, text: turn.text, ...(calls.length ? { tool_calls: calls } : {}) }]
  })
  const goal = turns.filter((turn) => turn.role === 'user' && turn.text).slice(-3).map((turn) => turn.text)
  return { goal, ...(instructions ? { instructions } : {}), conversation }
}

const LABEL: Record<string, string> = { user: '[User]', assistant: '[Assistant]', system: '[System]' }

// The text that ends up in the compaction: word for word, minus what Jev declares superseded.
export const serialize = (turns: readonly Turn[], verdicts: Map<string, Verdict>): string =>
  turns.flatMap((turn) => linesOf(turn, verdicts)).join('\n')

const linesOf = (turn: Turn, verdicts: Map<string, Verdict>): string[] => {
  const result = turn.result
  if (result) {
    const verdict = verdicts.get(result.id) ?? 'keep'
    if (verdict === 'drop') return []
    return [`[Tool result ${result.tool}${result.isError ? ' · error' : ''}]: ${verdict === 'truncate' ? truncated(result.text) : result.text}`]
  }
  const calls = turn.calls.filter((call) => verdicts.get(call.id) !== 'drop')
  const lines = turn.text ? [`${LABEL[turn.role] ?? `[${turn.role}]`}: ${turn.text}`] : []
  if (calls.length) lines.push(`[Assistant tool calls]: ${calls.map((call) => `${call.tool}(${JSON.stringify(call.input)})`).join('; ')}`)
  return lines
}
