// Compaction policy: questions to Jev, thresholds, verdict and formatting. No runtime dependency, so
// the Claude Code hook (`jev/hooks/compact.ts`) and the Pi extension (`pi/extensions/jev-compact/`)
// share the same numbers.

export const KEEP_THRESHOLD = 0.5 // minimum probability to keep
export const PRESERVE_RECENT = 6 // last messages never touched (the first is immune too)
export const TRUNCATE_HEAD = 300 // what is left of a truncated result
export const MAX_STATE_TOKENS = 25_000 // cap on the state sent to Jev
export const MAX_REQUEST_TOKENS = 30_000 // cap on one request (state + questions)
export const MIN_REDUCTION = 0.3 // below this, defer to native (rewriting the cache does not pay off)
export const JEV_TIMEOUT_MS = 8_000
export const JEV_MODEL = 'jev-latest'
export const JEV_URL = 'https://api.typesafe.ai/v1/systemone'
export const ARG_KEYS = ['file_path', 'command', 'pattern', 'url', 'query', 'path']

export type Verdict = 'keep' | 'truncate' | 'drop'
export type Question = { type: 'noul'; instructions: string; criteria: { true: string; false: string } }
// The minimum needed to ask the questions and read the verdict: each runtime maps its own tool
// call representation onto it.
export type CallInfo = { id: string; tool: string; resultChars: number }

export const isOpen = (i: number, total: number) => i > 0 && i < total - PRESERVE_RECENT

// The state Jev reads: structure and history without tool result contents. Each runtime builds it
// from its own messages; the JSON shape is the same.
export type StateCall = { id: string; tool: string; input?: unknown; result: string }
export type StateEntry = { i: number; role: string; text: string; tool_calls?: StateCall[] }
export type JevState = { goal: string[]; instructions?: string; conversation: StateEntry[] }

// Shrinks in steps until it fits: call inputs, then long texts, then whole messages, always from
// the oldest unprotected ones. undefined if that is not enough.
export const fitState = (state: JevState, total: number): JevState | undefined => {
  const open = state.conversation.filter((entry) => isOpen(entry.i, total))
  const lengths = new Map(open.map((entry) => [entry, entry.text.length]))
  const clipInputs = () => state.conversation.forEach((entry) => entry.tool_calls?.forEach((c) => (c.input = clip(JSON.stringify(c.input), 200))))
  const shorten = (entry: StateEntry) => () => (entry.text = headTail(entry.text))
  const collapse = (entry: StateEntry) => () => {
    entry.text = `[… ${lengths.get(entry)} chars]`
    entry.tool_calls?.forEach((c) => (c.input = undefined))
  }
  for (const step of [() => {}, clipInputs, ...open.map(shorten), ...open.map(collapse)]) {
    step()
    if (tokensOf(state) <= MAX_STATE_TOKENS) return state
  }
  return undefined
}

export const questionsFor = ({ id, tool, resultChars }: CallInfo): Record<string, Question> => ({
  [`keep_call_${id}`]: {
    type: 'noul',
    instructions: `Tool call \`${id}\` (\`${tool}\`) must stay in the history: knowing it was made, with its input, still matters for what the assistant does next.`,
    criteria: { true: 'The assistant will still refer to this call or its input.', false: 'Step superseded: exploration finished, empty search, file later rewritten, nothing that steers the work.' },
  },
  [`keep_result_${id}`]: {
    type: 'noul',
    instructions: `The full output of tool call \`${id}\` (\`${tool}\`, ${resultChars} characters) must stay verbatim: the assistant still needs its content and re-running the tool would not do.`,
    criteria: { true: 'Needed word for word and not recoverable by re-running the tool (exact error, non-repeatable output, changed state).', false: 'Superseded or recoverable by re-running the tool: file later edited or re-readable, listing, search, output already summarised.' },
  },
})

// Batches under MAX_REQUEST_TOKENS: each one resends the full state.
export const toBatches = (state: unknown, calls: readonly CallInfo[]): Record<string, Question>[] => {
  const room = MAX_REQUEST_TOKENS - tokensOf(state)
  const batches: Record<string, Question>[] = [{}]
  let used = 0
  for (const call of calls) {
    const questions = questionsFor(call)
    if (used > 0 && used + tokensOf(questions) > room) (batches.push({}), (used = 0))
    Object.assign(batches[batches.length - 1] ?? {}, questions)
    used += tokensOf(questions)
  }
  return batches
}

export const parseAnswers = (text: string, ids: string[]): Record<string, number> | string => {
  let answers: Record<string, { noul?: unknown } | undefined> | undefined
  try {
    answers = (JSON.parse(text) as { answers?: typeof answers } | null)?.answers
  } catch {
    return 'answer is not JSON'
  }
  const entries = ids.flatMap((id) => {
    const noul = answers?.[id]?.noul
    return typeof noul === 'number' && Number.isFinite(noul) ? [[id, noul] as const] : []
  })
  return entries.length === ids.length ? Object.fromEntries(entries) : 'answer without valid noul'
}

export const verdictOf = (answers: Record<string, number>, { id, resultChars }: CallInfo): Verdict => {
  if ((answers[`keep_result_${id}`] ?? 1) >= KEEP_THRESHOLD) return 'keep'
  if ((answers[`keep_call_${id}`] ?? 1) < KEEP_THRESHOLD) return 'drop'
  return resultChars > TRUNCATE_HEAD ? 'truncate' : 'keep'
}

export const truncated = (text: string) => `${text.slice(0, TRUNCATE_HEAD)}\n[… ${text.length - TRUNCATE_HEAD} chars removed]`

export const tokensOf = (value: unknown) => JSON.stringify(value).length / 4
export const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text)
export const headTail = (text: string) => (text.length > 800 ? `${text.slice(0, 400)} […] ${text.slice(-400)}` : text)
export const percent = (ratio: number) => `${Math.round(ratio * 100)}%`
export const kilo = (chars: number) => (chars >= 1000 ? `${(chars / 1000).toFixed(1)}k` : `${chars}`)
export const bar = (pct: number) => '█'.repeat(Math.round(pct / 10)) + '░'.repeat(10 - Math.round(pct / 10))
export const argumentOf = (input: Record<string, unknown>) =>
  clip((ARG_KEYS.map((key) => input[key]).find((v): v is string => typeof v === 'string') ?? JSON.stringify(input)).replace(/\s+/g, ' ').trim(), 70)

export const describeCall = ({ tool, resultChars }: CallInfo, verdict: Verdict, input: Record<string, unknown>) =>
  verdict === 'drop'
    ? `✗ dropped    ${tool} · ${argumentOf(input)}  (-${kilo(resultChars + JSON.stringify(input).length)} chars)`
    : `✂ truncated  ${tool} · ${argumentOf(input)}  (${kilo(resultChars)} → ${TRUNCATE_HEAD} chars)`
