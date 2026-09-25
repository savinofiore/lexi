import type { ExtensionAPI, ExtensionContext, SessionBeforeCompactEvent, SessionBeforeCompactResult } from '@earendil-works/pi-coding-agent'
import { convertToLlm } from '@earendil-works/pi-coding-agent'
import type { CallInfo, JevState, Question, Verdict } from '../../../jev/shared/compact-policy.ts'
import {
  bar,
  describeCall,
  fitState,
  JEV_MODEL,
  JEV_TIMEOUT_MS,
  JEV_URL,
  kilo,
  MAX_STATE_TOKENS,
  MIN_REDUCTION,
  parseAnswers,
  percent,
  toBatches,
  verdictOf,
} from '../../../jev/shared/compact-policy.ts'
import { jevApiKey, jevConfig } from '../../../jev/shared/pi-config.ts'
import type { Call, Turn } from './transcript.ts'
import { buildState, candidatesOf, serialize, toTurns } from './transcript.ts'

// Thresholds and questions live in jev/shared/compact-policy.ts, shared with the Claude Code hook.
// Here lives Pi's difference: compaction can only return a text, not a new message list, so verbatim
// means rewriting the history as text and removing what Jev declares superseded.
const STATUS_KEY = 'jev-compact'
// ponytail: cap on the already-compacted block, keeping its tail. Without it every compaction carries
// it whole and the context grows instead of shrinking. To keep it all, move to two levels.
const MAX_PREVIOUS_CHARS = 20_000
const RESULT_VISIBLE_MS = 30_000 // how long the outcome stays in the status line
const HEADER = [
  '=== History compacted by Jev: verbatim, not a summary ===',
  'The text below is the original conversation word for word. Tool calls declared superseded',
  'were removed and some outputs truncated; nothing was rewritten or summarised.',
  '',
].join('\n')

type Plan = { summary: string; counts: Record<Verdict, number>; before: number; after: number; changed: string[] }

export default function (pi: ExtensionAPI) {
  pi.on('session_before_compact', async (event, ctx): Promise<SessionBeforeCompactResult> => {
    if (!jevConfig(ctx.cwd)) return {}
    const startedAt = Date.now()
    const plan = await planCompaction(event, ctx).catch((error: unknown) => `internal error: ${String(error)}`)
    if (typeof plan === 'string') {
      ctx.ui.notify(`[jev-compact] Jev did not compact (${plan}): native Pi summary`, 'info')
      return {}
    }
    report(ctx, plan, Date.now() - startedAt)
    const { firstKeptEntryId, tokensBefore } = event.preparation
    return { compaction: { summary: plan.summary, firstKeptEntryId, tokensBefore, details: plan.counts } }
  })
}

// Every reason not to compact becomes a string: the caller defers to the native summary.
async function planCompaction(event: SessionBeforeCompactEvent, ctx: ExtensionContext): Promise<Plan | string> {
  const key = jevApiKey()
  if (!key) return 'TYPESAFE_API_KEY missing'
  const { preparation } = event
  const turns = toTurns(convertToLlm([...preparation.messagesToSummarize, ...preparation.turnPrefixMessages]))
  const calls = candidatesOf(turns)
  if (!calls.length) return 'no candidate tool call'
  progress(ctx, 10, 'preparing the state')
  const state = fitState(buildState(turns, event.customInstructions), turns.length)
  if (!state) return `state over ${MAX_STATE_TOKENS} tokens`
  const answers = await askJev({ ctx, key, state, calls }, event.signal)
  if (typeof answers === 'string') return answers
  progress(ctx, 90, 'rebuilding')
  const verdicts = new Map(calls.map((call) => [call.id, verdictOf(answers, call)]))
  return measure(turns, calls, verdicts, previousOf(preparation.previousSummary))
}

const measure = (turns: Turn[], calls: (CallInfo & Call)[], verdicts: Map<string, Verdict>, previous: string): Plan | string => {
  const before = serialize(turns, new Map()).length
  const body = serialize(turns, verdicts)
  const reduction = 1 - body.length / before
  if (reduction < MIN_REDUCTION) return `reduction ${percent(reduction)} below ${percent(MIN_REDUCTION)}`
  const counts = { keep: 0, truncate: 0, drop: 0 }
  for (const verdict of verdicts.values()) counts[verdict]++
  const changed = calls.flatMap((call) => {
    const verdict = verdicts.get(call.id) ?? 'keep'
    return verdict === 'keep' ? [] : [describeCall(call, verdict, call.input)]
  })
  return { summary: `${HEADER}${previous}${body}`, counts, before, after: body.length, changed }
}

// The already-compacted block does not go through Jev: keep its tail, the part closest to what the
// assistant is doing now.
const previousOf = (previous: string | undefined): string => {
  if (!previous) return ''
  const kept = previous.length > MAX_PREVIOUS_CHARS ? `[… ${previous.length - MAX_PREVIOUS_CHARS} earlier chars omitted]\n${previous.slice(-MAX_PREVIOUS_CHARS)}` : previous
  return `${kept}\n\n`
}

// --- Jev ---------------------------------------------------------------------------------------

type Ask = { ctx: ExtensionContext; key: string; state: JevState; calls: CallInfo[] }

// Batches run in parallel under one timeout, as on Claude Code.
async function askJev(ask: Ask, signal: AbortSignal): Promise<Record<string, number> | string> {
  const batches = toBatches(ask.state, ask.calls)
  const status = { done: 0, total: batches.length, calls: ask.calls.length }
  showBatches(ask.ctx, status)
  const timeout = new Promise<string>((resolve) => setTimeout(() => resolve('timeout'), JEV_TIMEOUT_MS))
  const aborted = new Promise<string>((resolve) => signal.addEventListener('abort', () => resolve('aborted')))
  const requests = Promise.all(batches.map((questions) => askBatch(ask, questions, status)))
  const outcome = await Promise.race([requests, timeout, aborted])
  if (typeof outcome === 'string') return outcome
  return outcome.find((answer): answer is string => typeof answer === 'string') ?? Object.assign({}, ...outcome)
}

async function askBatch(ask: Ask, questions: Record<string, Question>, status: { done: number; total: number; calls: number }): Promise<Record<string, number> | string> {
  const outcome = await fetch(JEV_URL, {
    method: 'POST',
    headers: { authorization: `Bearer ${ask.key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: JEV_MODEL, state: ask.state, questions }),
    signal: AbortSignal.timeout(JEV_TIMEOUT_MS),
  }).then(
    async (response) => (response.ok ? parseAnswers(await response.text(), Object.keys(questions)) : `HTTP ${response.status}`),
    (error: unknown) => `network error: ${String(error)}`,
  )
  status.done++
  showBatches(ask.ctx, status)
  return outcome
}

// --- report ---------------------------------------------------------------------------------------

const progress = (ctx: ExtensionContext, pct: number, phase: string) => ctx.ui.setStatus(STATUS_KEY, `jev-compact ${bar(pct)} ${pct}% · ${phase}`)

const showBatches = (ctx: ExtensionContext, { done, total, calls }: { done: number; total: number; calls: number }) =>
  progress(ctx, 20 + Math.round((60 * done) / total), `asking Jev (${done}/${total} batches, ${calls} calls)`)

function report(ctx: ExtensionContext, plan: Plan, ms: number): void {
  const saved = plan.before - plan.after
  const reduction = percent(saved / plan.before)
  const outcome = `-${reduction} (${kilo(saved)} chars) · ${plan.counts.truncate} truncated, ${plan.counts.drop} dropped, ${plan.counts.keep} kept`
  ctx.ui.setStatus(STATUS_KEY, `jev-compact ${bar(100)} 100% · ${outcome}`)
  // The outcome stays readable for RESULT_VISIBLE_MS: Jev answers in a second, the bar would vanish.
  setTimeout(() => ctx.ui.setStatus(STATUS_KEY, undefined), RESULT_VISIBLE_MS).unref?.()
  ctx.ui.notify(`[jev-compact] Jev compacted the context: ${outcome}, of ${kilo(plan.before)} chars in ${ms}ms`, 'info')
  for (const line of plan.changed) ctx.ui.notify(`[jev-compact] ${line}`, 'info')
}
