import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import type { Answer, Tier } from '../../../jev/shared/router-policy.ts'
import {
  causeOf,
  EFFORTS,
  effortRankOf,
  isMoveAllowed,
  isRisky,
  JEV_MODEL,
  JEV_URL,
  parseAnswer,
  QUESTIONS,
  shortModel,
  targetEffortRank,
  targetTierRank,
  TIERS,
  tierRankOfModel,
  TIMEOUT_MS,
} from '../../../jev/shared/router-policy.ts'
import { jevApiKey, jevConfig } from '../../../jev/shared/pi-config.ts'
import { resolveTarget } from './models.ts'

// Thresholds, questions and decision live in jev/shared/router-policy.ts, shared with the Claude
// Code hook: here lives only what is Pi's, which models exist and how to switch them mid-session.
// `.lexi.json` → `jev.tiers` overrides any tier with a `provider/model-id` (exact) or a bare model id,
// which stays on the session's provider: the defaults must never move a claude-bridge session onto
// the metered `anthropic` provider.
const DEFAULT_TIERS: Record<Tier, string> = {
  fast: 'claude-sonnet-5',
  balanced: 'claude-opus-5-5',
  deep: 'claude-fable-5-1',
}
const STATUS_KEY = 'jev-router'

let sessionAnswer: Answer | undefined
let hasApplied = false
let hasWarned = false

export default function (pi: ExtensionAPI) {
  pi.on('session_start', async (_event, ctx) => {
    sessionAnswer = undefined
    hasApplied = false
    ctx.ui.setStatus(STATUS_KEY, undefined)
  })
  // One classification per session: switching model midway throws away the prompt cache.
  pi.on('before_agent_start', async (event, ctx) => {
    if (hasApplied) return
    const config = jevConfig(ctx.cwd)
    if (!config) return
    sessionAnswer ??= await classify(ctx, event.prompt)
    if (!sessionAnswer) return
    hasApplied = true
    await apply(pi, ctx, sessionAnswer, { ...DEFAULT_TIERS, ...config.tiers })
  })
}

async function apply(pi: ExtensionAPI, ctx: ExtensionContext, answer: Answer, tiers: Record<Tier, string>): Promise<void> {
  const fromModel = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : ''
  const fromEffort = pi.getThinkingLevel()
  const forced = isRisky(answer)
  const tierRank = targetTierRank(answer)
  const effortRank = targetEffortRank(answer)
  const configuredRank = TIERS.findIndex((tier) => tiers[tier] === fromModel || tiers[tier] === ctx.model?.id)
  const fromRank = configuredRank >= 0 ? configuredRank : tierRankOfModel(fromModel)
  const target = isMoveAllowed(fromRank, tierRank, answer.tierConfidence, forced) ? tiers[TIERS[tierRank] ?? 'deep'] : undefined
  const effort = isMoveAllowed(effortRankOf(fromEffort), effortRank, answer.effortConfidence, forced) ? EFFORTS[effortRank] : undefined
  const model = target ? await switchModel(pi, ctx, target) : undefined
  if (effort) pi.setThinkingLevel(effort)
  report(ctx, answer, { fromModel, fromEffort, model, effort })
}

async function switchModel(pi: ExtensionAPI, ctx: ExtensionContext, target: string): Promise<string | undefined> {
  const found = resolveTarget(ctx.modelRegistry.getAll(), ctx.model?.provider, target)
  if (!found) return warn(ctx, `model ${target} not in the registry: staying on the current one`)
  const ok = await pi.setModel(found)
  return ok ? shortModel(found.id) : warn(ctx, `${target} has no authentication configured: staying on the current one`)
}
type Applied = { fromModel: string; fromEffort: string; model?: string; effort?: string }

function report(ctx: ExtensionContext, answer: Answer, { fromModel, fromEffort, model, effort }: Applied): void {
  const summary = `${model ?? shortModel(fromModel)} · effort ${effort ?? fromEffort}`
  const changes = [
    model && `model ${shortModel(fromModel)} → ${model}`,
    effort && `effort ${fromEffort} → ${effort}`,
  ].filter(Boolean)
  ctx.ui.notify(`[jev-router] ${changes.length ? changes.join(', ') : `unchanged — staying on ${summary}`} (${causeOf(answer)})`, 'info')
  ctx.ui.setStatus(STATUS_KEY, `jev · ${summary}`)
}

async function classify(ctx: ExtensionContext, prompt: string): Promise<Answer | undefined> {
  const key = jevApiKey()
  if (!key) return warnOnce(ctx, 'TYPESAFE_API_KEY missing: export it in the shell or put it under "env" in ~/.claude/settings.json. Router off.')
  const startedAt = Date.now()
  const outcome = await askJev(prompt, key)
  if (typeof outcome === 'string') return warnOnce(ctx, `jev unavailable: ${outcome}, retrying on the next prompt`)
  const answer = parseAnswer(outcome.body, Date.now() - startedAt)
  if (typeof answer === 'string') return warnOnce(ctx, `jev unavailable: ${answer}, retrying on the next prompt`)
  return answer
}

// Any failure (timeout, non-2xx, exception) becomes a string, never a throw.
async function askJev(prompt: string, key: string): Promise<{ body: string } | string> {
  try {
    const response = await fetch(JEV_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: JEV_MODEL, state: { prompt }, questions: QUESTIONS }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    return response.ok ? { body: await response.text() } : `HTTP ${response.status}`
  } catch (error: unknown) {
    return `error ${String(error)}`
  }
}

const warn = (ctx: ExtensionContext, message: string): undefined => {
  ctx.ui.notify(`[jev-router] ${message}`, 'warning')
  return undefined
}

// The first failure shows, later ones do not: a session without a key must not shout on every prompt.
const warnOnce = (ctx: ExtensionContext, message: string): undefined => {
  if (!hasWarned) warn(ctx, message)
  hasWarned = true
  return undefined
}
