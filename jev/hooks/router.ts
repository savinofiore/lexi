import type { EngineInterface, EventName, Hook } from 'claude-code'
import { flowContext, FLOW_QUESTIONS, isRoutable, parseFlow } from '../shared/flow-policy.ts'
import type { Answer, Effort } from '../shared/router-policy.ts'
import {
  aliasOfRank,
  causeOf,
  EFFORTS,
  effortRankOf,
  isMoveAllowed,
  isRisky,
  JEV_MODEL,
  JEV_URL,
  parseAnswer,
  QUESTIONS,
  sessionTierRank,
  shortModel,
  targetEffortRank,
  targetTierRank,
  TIER_ALIAS,
  tierRankOfModel,
  TIMEOUT_MS,
} from '../shared/router-policy.ts'

// Claude Code side only: thresholds and questions live in shared/router-policy.ts, shared with Pi.
const SHOW_STATUS = true
const MODEL_ID: Record<string, string> = { sonnet: 'claude-sonnet-5-5', opus: 'claude-opus-5-5' }
const DEBUG = { to: 'debug' } as const

type HookArgs<N extends EventName> = Parameters<Hook<N>>
type Plan = { fromModel: string; fromEffort: unknown; model?: string; effort?: Effort }

let apiKey: string | undefined | null = null // null: not read yet
let sessionAnswer: Answer | undefined
let sessionPlan: Plan | undefined
let hasWarnedUnavailable = false

// session.start does not fire on /clear (session.end with reason 'clear' does): reset on both.
export async function onSessionStart($: EngineInterface, e: HookArgs<'session.start'>[1], next: HookArgs<'session.start'>[2]) {
  resetSession($)
  return next(e)
}

export async function onSessionEnd($: EngineInterface, e: HookArgs<'session.end'>[1], next: HookArgs<'session.end'>[2]) {
  resetSession($)
  return next(e)
}

function resetSession($: EngineInterface) {
  sessionAnswer = undefined
  sessionPlan = undefined
  if (SHOW_STATUS) $.ui.status(undefined)
}

// One hook per event: the model is chosen once per session, the lexi flow on every prompt.
export async function onPromptSubmit($: EngineInterface, e: HookArgs<'prompt.submit'>[1], next: HookArgs<'prompt.submit'>[2]) {
  if (sessionAnswer) $.ui.log('[jev-router] reusing the first prompt\'s choice', DEBUG)
  // ponytail: sequential, so the first prompt can wait up to two Jev timeouts; run both at once if it shows.
  else sessionAnswer = await classify($, 'prompt', { prompt: e.text })
  const context = await routeFlow($, e.text)
  return next(context ? { ...e, context: [...(e.context ?? []), context] } : e)
}

// In a lexi project (`.lexi.json` is the opt-in), Jev names the flow and its order rides along as context.
async function routeFlow($: EngineInterface, prompt: string): Promise<string | undefined> {
  if (!isRoutable(prompt) || !(await $.fs.read('.lexi.json').then(() => true, () => false))) return undefined
  const key = await readApiKey($)
  if (!key) return undefined
  const outcome = await postJev($, { model: JEV_MODEL, state: { prompt }, questions: FLOW_QUESTIONS }, key)
  const answer = typeof outcome === 'string' ? outcome : parseFlow(outcome.text)
  if (typeof answer === 'string') {
    $.ui.log(`[jev-flow] jev unavailable: ${answer}, no routing for this prompt`, DEBUG)
    return undefined
  }
  $.ui.log(`[jev-flow] ${answer.flow} (${answer.confidence.toFixed(2)})`, DEBUG)
  return flowContext(answer.flow, answer.confidence)
}

export async function* onTurnStep($: EngineInterface, e: HookArgs<'turn.step'>[1], next: HookArgs<'turn.step'>[2]) {
  if (e.agentId !== undefined || !sessionAnswer) return yield* next(e)
  sessionPlan ??= startSessionPlan($, sessionAnswer, e.model, e.effort)
  const isModelOurs = sessionPlan.model && e.model === sessionPlan.fromModel
  const isEffortOurs = sessionPlan.effort && e.effort === sessionPlan.fromEffort
  return yield* next({
    ...e,
    ...(isModelOurs ? { model: sessionPlan.model } : {}),
    ...(isEffortOurs ? { effort: sessionPlan.effort } : {}),
  })
}

export async function onAgentSpawn($: EngineInterface, e: HookArgs<'agent.spawn'>[1], next: HookArgs<'agent.spawn'>[2]) {
  if (e.fork) return next(e)
  const label = `subagent ${e.subagentType}`
  const answer = await classify($, label, { prompt: e.prompt, description: e.description, agentType: e.subagentType })
  if (!answer) return next(e)
  const current = e.model ?? e.parentModel
  const rank = targetTierRank(answer)
  const alias = isMoveAllowed(tierRankOfModel(current), rank, answer.tierConfidence, isRisky(answer)) ? aliasOfRank(rank) : undefined
  $.ui.log(`[jev-router] ${label}: ${alias ? `model ${shortModel(current)} → ${alias}` : 'unchanged'} (${causeOf(answer)})`, DEBUG)
  const started = await next(alias ? { ...e, model: alias } : e)
  if (started.model) $.ui.log(`[jev-router] ${label}: ${shortModel(started.model)}`)
  return started
}

function startSessionPlan($: EngineInterface, answer: Answer, model: string, effort: unknown): Plan {
  const tierRank = sessionTierRank(answer)
  const effortRank = targetEffortRank(answer)
  const moveModel = isMoveAllowed(tierRankOfModel(model), tierRank, answer.tierConfidence, isRisky(answer))
  const moveEffort = isMoveAllowed(effortRankOf(effort), effortRank, answer.effortConfidence, isRisky(answer))
  const plan: Plan = { fromModel: model, fromEffort: effort }
  if (moveModel) plan.model = MODEL_ID[aliasOfRank(tierRank)] ?? aliasOfRank(tierRank)
  if (moveEffort) plan.effort = EFFORTS[effortRank]
  const changes = [
    plan.model && `model ${shortModel(model)} → ${shortModel(plan.model)}`,
    plan.effort && `effort ${String(effort ?? 'default')} → ${plan.effort}`,
  ].filter(Boolean)
  const summary = `${shortModel(plan.model ?? model)} · effort ${String(plan.effort ?? effort ?? 'default')}`
  $.ui.log(`[jev-router] ${changes.length ? changes.join(', ') : `unchanged — staying on ${summary}`} (${causeOf(answer)})`, DEBUG)
  $.ui.log(`[jev-router] session: ${summary}`)
  if (SHOW_STATUS) $.ui.status(`jev · ${summary}`)
  return plan
}

async function classify($: EngineInterface, label: string, state: Record<string, string>): Promise<Answer | undefined> {
  const key = await readApiKey($)
  if (!key) return undefined
  const result = await askJev($, state, key)
  if (typeof result === 'string') {
    // First failure goes to the transcript (bad key, blocked network), later ones to debug only.
    $.ui.log(`[jev-router] jev unavailable (${label}): ${result}, retrying next time`, hasWarnedUnavailable ? DEBUG : {})
    hasWarnedUnavailable = true
    return undefined
  }
  const effortName = EFFORTS[result.effort] ?? result.effort
  $.ui.log(`[jev-router] classification (${label}): ${result.tier} → ${TIER_ALIAS[result.tier]} (${result.tierConfidence.toFixed(2)}) · effort ${effortName} (${result.effortConfidence.toFixed(2)}) · risk ${result.risk.toFixed(2)} · ${result.ms}ms`, DEBUG)
  return result
}

async function readApiKey($: EngineInterface): Promise<string | undefined> {
  if (apiKey !== null) return apiKey
  apiKey = await $.env.get('TYPESAFE_API_KEY')
  if (apiKey) $.ui.log(`[jev-router] ready — ${JEV_URL}, timeout ${TIMEOUT_MS}ms`, DEBUG)
  else $.ui.log('[jev-router] TYPESAFE_API_KEY missing: add it under "env" in .claude/settings.local.json or export it in the shell. Router off.')
  return apiKey
}

async function askJev($: EngineInterface, state: Record<string, string>, key: string): Promise<Answer | string> {
  const outcome = await postJev($, { model: JEV_MODEL, state, questions: QUESTIONS }, key)
  return typeof outcome === 'string' ? outcome : parseAnswer(outcome.text, outcome.ms)
}

// Any failure (timeout, non-2xx, exception) becomes a reason string, never a throw.
async function postJev($: EngineInterface, body: object, key: string): Promise<{ text: string; ms: number } | string> {
  const startedAt = await $.clock.now()
  const timer = new AbortController()
  const timeout = $.clock.sleep(TIMEOUT_MS, { signal: timer.signal }).then(() => 'timeout', () => 'timeout')
  const request = $.http
    .fetch(JEV_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    .then((response) => (response.ok ? response : `HTTP ${response.status}`), (error: unknown) => `error ${String(error)}`)
  const outcome = await Promise.race([request, timeout])
  timer.abort()
  if (typeof outcome === 'string') return outcome
  return { text: outcome.text, ms: (await $.clock.now()) - startedAt }
}
