import type { EngineInterface, Hook, SessionCompactInput, SessionCompactResult, SessionMessage, ToolResultSummary, ToolUseSummary } from 'claude-code'
import type { CallInfo, JevState as State, Question, StateCall as Call, StateEntry as Entry, Verdict } from '../shared/compact-policy.ts'
import {
  bar,
  describeCall,
  fitState,
  isOpen,
  JEV_MODEL,
  JEV_TIMEOUT_MS,
  JEV_URL,
  kilo,
  MAX_STATE_TOKENS,
  MIN_REDUCTION,
  parseAnswers,
  percent,
  toBatches,
  truncated,
  verdictOf,
} from '../shared/compact-policy.ts'

// Claude Code side only: thresholds and questions live in shared/compact-policy.ts, shared with Pi.
const RESULT_VISIBLE_MS = 30_000 // how long the outcome stays in the status line

type Next = Parameters<Hook<'session.compact'>>[2]
type Candidate = { use: ToolUseSummary; result: ToolResultSummary }
type Plan = { messages: SessionMessage[]; candidates: Candidate[]; verdicts: Map<string, Verdict>; before: number; after: number; count: number }

export async function compact($: EngineInterface, e: SessionCompactInput, next: Next): Promise<SessionCompactResult> {
  const startedAt = await $.clock.now()
  const plan = await planCompaction($, e, next.signal).catch((error: unknown) => `internal error: ${String(error)}`)
  if (typeof plan === 'string') return delegate($, e, next, plan)
  report($, plan, (await $.clock.now()) - startedAt)
  return { messages: plan.messages }
}

// Every reason not to compact becomes a string: the caller defers to the native summary.
async function planCompaction($: EngineInterface, e: SessionCompactInput, signal: AbortSignal): Promise<Plan | string> {
  const key = await $.env.get('TYPESAFE_API_KEY')
  if (!key) return 'TYPESAFE_API_KEY missing'
  progress($, 10, 'finding candidates')
  const candidates = findCandidates(e.messages)
  if (!candidates.length) return 'no candidate tool call'
  const state = fitState(buildState(e), e.messages.length)
  if (!state) return `state over ${MAX_STATE_TOKENS} tokens`
  const answers = await askJev($, { key, state, calls: candidates.map(infoOf) }, signal)
  if (typeof answers === 'string') return answers
  progress($, 90, 'rebuilding')
  const verdicts = new Map(candidates.map((candidate) => [candidate.use.tool_use_id, verdictOf(answers, infoOf(candidate))]))
  const messages = rebuild(e.messages, verdicts)
  const before = charsOf(e.messages)
  const after = charsOf(messages)
  if (1 - after / before < MIN_REDUCTION) return `reduction ${percent(1 - after / before)} below ${percent(MIN_REDUCTION)}`
  return { messages, candidates, verdicts, before, after, count: e.messages.length }
}

const infoOf = ({ use, result }: Candidate): CallInfo => ({ id: use.tool_use_id, tool: use.tool, resultChars: result.text.length })

// Candidate: a call with its result, both outside the immune messages.
const findCandidates = (messages: readonly SessionMessage[]): Candidate[] => {
  const open = messages.filter((_, i) => isOpen(i, messages.length))
  const results = new Map(open.flatMap((m) => m.toolResults ?? []).map((r) => [r.tool_use_id, r]))
  return open.flatMap((m) => (m.role === 'assistant' ? m.toolUses : [])).flatMap((use) => {
    const result = results.get(use.tool_use_id)
    return result ? [{ use, result }] : []
  })
}

// Structure and history without result contents: only a note with outcome and length.
const buildState = ({ messages, instructions }: SessionCompactInput): State => {
  const results = new Map(messages.flatMap((m) => m.toolResults ?? []).map((r) => [r.tool_use_id, r]))
  const note = (id: string) => {
    const r = results.get(id)
    return r ? `${r.isError ? 'error' : 'ok'}, ${r.text.length} chars` : 'no result'
  }
  const conversation = messages.flatMap((m, i): Entry[] => {
    const calls = m.toolUses.map((u) => ({ id: u.tool_use_id, tool: u.tool, input: u.input, result: note(u.tool_use_id) }))
    if (!m.text && !calls.length) return []
    return [{ i, role: m.role, text: m.text, ...(calls.length ? { tool_calls: calls } : {}) }]
  })
  const goal = messages.filter((m) => m.role === 'user' && m.text).slice(-3).map((m) => m.text)
  return { goal, ...(instructions ? { instructions } : {}), conversation }
}

// Batches run in parallel under one timeout: an in-flight fetch does not consume the hook budget,
// waiting on the clock does, so the timeout stays under 10 s.
async function askJev($: EngineInterface, ask: { key: string; state: State; calls: CallInfo[] }, signal: AbortSignal): Promise<Record<string, number> | string> {
  const batches = toBatches(ask.state, ask.calls)
  const timer = new AbortController()
  signal.addEventListener('abort', () => timer.abort())
  const timeout = $.clock.sleep(JEV_TIMEOUT_MS, { signal: timer.signal }).then(() => 'timeout', () => 'timeout')
  const status = { done: 0, total: batches.length, calls: ask.calls.length }
  showBatches($, status)
  const requests = Promise.all(batches.map((questions) => askBatch($, { ...ask, questions }, status)))
  const outcome = await Promise.race([requests, timeout])
  timer.abort()
  if (typeof outcome === 'string') return outcome
  return outcome.find((answer): answer is string => typeof answer === 'string') ?? Object.assign({}, ...outcome)
}

async function askBatch($: EngineInterface, ask: { key: string; state: State; questions: Record<string, Question> }, status: { done: number; total: number; calls: number }): Promise<Record<string, number> | string> {
  const response = await $.http
    .fetch(JEV_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${ask.key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: JEV_MODEL, state: ask.state, questions: ask.questions }),
    })
    .catch((error: unknown) => `network error: ${String(error)}`)
  status.done++
  showBatches($, status)
  if (typeof response === 'string') return response
  return response.ok ? parseAnswers(response.text, Object.keys(ask.questions)) : `HTTP ${response.status}`
}

// Call and result share one verdict: never a tool_use without its tool_result.
const reshape = <T extends { tool_use_id: string; text?: string; result?: unknown }>(blocks: readonly T[], verdicts: Map<string, Verdict>): T[] =>
  blocks.flatMap((block) => {
    const verdict = verdicts.get(block.tool_use_id)
    if (verdict === 'drop') return []
    if (verdict !== 'truncate' || block.text === undefined) return [block]
    const { result: _stored, ...rest } = block
    return [{ ...rest, text: truncated(block.text) } as T]
  })

// Without a handle the engine rebuilds each message from role, text and blocks; with the handle it
// would ignore the edits and reload the old chain on --resume.
const rebuild = (messages: readonly SessionMessage[], verdicts: Map<string, Verdict>): SessionMessage[] =>
  joinParallelCalls(
    messages.flatMap(({ handle: _handle, ...message }) => {
      const toolUses = reshape(message.toolUses, verdicts)
      const toolResults = message.toolResults && reshape(message.toolResults, verdicts)
      const rebuilt: SessionMessage = { ...message, toolUses, ...(toolResults ? { toolResults } : {}) }
      return rebuilt.text || toolUses.length || toolResults?.length ? [rebuilt] : []
    }),
  )

// Parallel calls of one response arrive as consecutive assistant messages, one per block. Rebuilt,
// they would get new ids and on --resume the loader would no longer rejoin them
// (ensureToolResultPairing): they go back to one message, like the original response.
const joinParallelCalls = (messages: SessionMessage[]): SessionMessage[] => {
  const joined: SessionMessage[] = []
  for (const message of messages) {
    const previous = joined[joined.length - 1]
    if (message.role !== 'assistant' || previous?.role !== 'assistant' || !previous.toolUses.length) joined.push(message)
    else joined[joined.length - 1] = { ...previous, text: [previous.text, message.text].filter(Boolean).join('\n\n'), toolUses: [...previous.toolUses, ...message.toolUses] }
  }
  return joined
}

const charsOf = (messages: readonly SessionMessage[]) =>
  messages.reduce((sum, m) => sum + m.text.length + m.toolUses.reduce((s, u) => s + JSON.stringify(u.input).length, 0) + (m.toolResults ?? []).reduce((s, r) => s + r.text.length, 0), 0)

function progress($: EngineInterface, pct: number, phase: string): void {
  $.ui.status(`jev-compact ${bar(pct)} ${pct}% · ${phase}`)
}

function showBatches($: EngineInterface, { done, total, calls }: { done: number; total: number; calls: number }): void {
  progress($, 20 + Math.round((60 * done) / total), `asking Jev (${done}/${total} batches, ${calls} calls)`)
}

// The outcome stays readable for RESULT_VISIBLE_MS: Jev answers in a second, the bar alone would vanish.
function settle($: EngineInterface, outcome: string): void {
  $.ui.status(`jev-compact ${outcome}`)
  $.ui.toast(`jev-compact ${outcome}`, { timeoutMs: 8_000 })
  $.clock.after(RESULT_VISIBLE_MS, () => $.ui.status(undefined))
}

function report($: EngineInterface, plan: Plan, ms: number): void {
  const counts = { keep: 0, truncate: 0, drop: 0 }
  for (const verdict of plan.verdicts.values()) counts[verdict]++
  const saved = plan.before - plan.after
  const reduction = percent(saved / plan.before)
  settle($, `${bar(100)} 100% · -${reduction} (${kilo(saved)} chars) · ${counts.truncate} truncated, ${counts.drop} dropped, ${counts.keep} kept`)
  $.ui.log(`Jev compacted the context: -${reduction} (${kilo(saved)} of ${kilo(plan.before)} chars) in ${ms}ms`)
  $.ui.log(`${plan.verdicts.size} tool calls judged → ${counts.keep} kept, ${counts.truncate} truncated, ${counts.drop} dropped · messages ${plan.count} → ${plan.messages.length}`)
  for (const candidate of plan.candidates) {
    const verdict = plan.verdicts.get(candidate.use.tool_use_id) ?? 'keep'
    if (verdict !== 'keep') $.ui.log(describeCall(infoOf(candidate), verdict, candidate.use.input))
  }
}

async function delegate($: EngineInterface, e: SessionCompactInput, next: Next, reason: string): Promise<SessionCompactResult> {
  $.ui.log(`Jev did not compact (${reason}): native Claude Code summary`)
  progress($, 90, 'native summary')
  try {
    return await next(e)
  } finally {
    settle($, `Jev not used (${reason}) → native summary`)
  }
}
