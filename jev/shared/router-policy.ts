// Router policy: questions to Jev, thresholds and decision. No runtime dependency, so the Claude
// Code hook (`jev/hooks/router.ts`) and the Pi extension (`pi/extensions/jev-router/`) share it.

export const JEV_URL = 'https://api.typesafe.ai/v1/systemone'
export const JEV_MODEL = 'jev-latest'
export const TIMEOUT_MS = 1500
export const UP_CONFIDENCE = 0.3
export const DOWN_CONFIDENCE = 0.6
export const RISK_THRESHOLD = 0.7
export const TIERS = ['trivial', 'fast', 'balanced', 'deep'] as const
// Opus 5.5 beats Fable 5.1 at every cost point, so `deep` is Opus at a higher effort.
export const TIER_ALIAS: Record<Tier, string> = { trivial: 'haiku', fast: 'sonnet', balanced: 'opus', deep: 'opus' }
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
export const DEEP_EFFORT = 2 // high
export const RISKY_EFFORT = 3 // xhigh: max scores lower and costs more on Opus 5.5

export const QUESTIONS = {
  tier: {
    type: 'choice',
    instructions: 'Which is the cheapest tier that can complete this coding task well?',
    criteria: {
      trivial: 'Read-only or single shell command: read/search/summarise files, run one command and report its output, answer from context. No edits.',
      fast: 'Small mechanical edit: rename a symbol, fix a typo, apply an exact change already described, one-file tweak.',
      balanced: 'Ordinary engineering: implement a well-specified change across a few files, write tests, fix a clearly described bug, review a small diff.',
      deep: 'Hard or high-stakes: architecture and design, debugging a failure whose cause is unknown, security, data migrations, concurrency, anything touching production or money.',
    },
  },
  effort: {
    type: 'score',
    instructions: 'How much step-by-step reasoning does this task need?',
    criteria: ['almost none', 'some', 'a lot', 'as much as possible'],
  },
  risky: { type: 'noul', instructions: 'Carrying out this task would itself change production, move real money, or alter data that cannot be restored. Writing or testing code that deals with such things, without running it against the real system, does not count.' },
}

export type Tier = (typeof TIERS)[number]
export type SessionTier = Exclude<Tier, 'trivial'>
export type Effort = (typeof EFFORTS)[number]
export type Answer = { tier: Tier; tierConfidence: number; effort: number; effortConfidence: number; risk: number; ms: number }
type JevAnswers = { tier?: { choice?: string; confidence?: number }; effort?: { score?: number; confidence?: number }; risky?: { noul?: number } }
type JevResponse = { answers?: JevAnswers }

export const parseAnswer = (text: string, ms: number): Answer | string => {
  let body: JevResponse
  try {
    body = JSON.parse(text) as JevResponse
  } catch {
    return 'unreadable JSON'
  }
  const answers = body.answers
  const tier = TIERS.find((name) => name === answers?.tier?.choice)
  const score = answers?.effort?.score
  // Jev's score is continuous (0.78 = between "almost none" and "some"): take the nearest level.
  if (!tier || typeof score !== 'number' || !(score >= 0 && score <= 3)) return 'answer without a valid tier/effort'
  const effort = Math.round(score)
  const confidenceOf = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : 0)
  return { tier, tierConfidence: confidenceOf(answers?.tier?.confidence), effort, effortConfidence: confidenceOf(answers?.effort?.confidence), risk: confidenceOf(answers?.risky?.noul), ms }
}

// An unknown current value (-1: haiku, a numeric effort, an unrecognised id) counts as below
// every level, so any move from it is a raise: it can only go up.
export const isMoveAllowed = (from: number, to: number, confidence: number, isForced: boolean): boolean => {
  if (to === from) return false
  if (isForced) return to > from
  return confidence >= (to > from ? UP_CONFIDENCE : DOWN_CONFIDENCE)
}

export const isRisky = (answer: Answer) => answer.risk > RISK_THRESHOLD
// An off-scale level ('off', 'minimal', a number) ranks -1: below all, so it can only go up.
export const effortRankOf = (level: unknown) => (EFFORTS as readonly unknown[]).indexOf(level)
export const targetTierRank = (answer: Answer) => (isRisky(answer) ? TIERS.length - 1 : TIERS.indexOf(answer.tier))
export const targetEffortRank = (answer: Answer) => {
  if (isRisky(answer)) return Math.max(answer.effort, RISKY_EFFORT)
  return answer.tier === 'deep' ? Math.max(answer.effort, DEEP_EFFORT) : answer.effort
}
// The session holds its model to the end: haiku is for one-shot subagents only.
export const sessionTierRank = (answer: Answer) => Math.max(targetTierRank(answer), TIERS.indexOf('fast'))
export const aliasOfRank = (rank: number) => TIER_ALIAS[TIERS[rank] ?? 'deep']
export const tierRankOfModel = (model: string) => TIERS.findIndex((tier) => model.includes(TIER_ALIAS[tier]))
export const shortModel = (model: string) => Object.values(TIER_ALIAS).find((alias) => model.includes(alias)) ?? model
export const causeOf = (answer: Answer) =>
  isRisky(answer) ? `risk ${answer.risk.toFixed(2)}` : `${answer.tier}, confidence ${answer.tierConfidence.toFixed(2)}`
