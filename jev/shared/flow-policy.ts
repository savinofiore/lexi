// Flow policy: which lexi skill a prompt goes to. No runtime dependency, so the Claude Code hook
// (`jev/hooks/flow.ts`) and the Pi extension (`pi/extensions/jev-flow.ts`) share it.

export const FLOWS = ['bug', 'feature', 'open', 'none'] as const
export type Flow = (typeof FLOWS)[number]
export type FlowAnswer = { flow: Flow; confidence: number }

export const FLOW_QUESTIONS = {
  flow: {
    type: 'choice',
    instructions: 'In a project that writes a failing test before any code change, which flow fits this prompt?',
    criteria: {
      bug: 'Existing behaviour is broken: an error, a crash, a wrong result, a failing test, a regression the user reports.',
      feature: 'A new or changed behaviour whose design the prompt already settles: what to build is stated, only how remains.',
      open: 'A new or changed behaviour with several defensible designs or unstated product intent: decisions come before tests can be named.',
      none: 'No change to production behaviour: a question, an explanation, docs, config, a review, a pure refactor, or a reply that continues the current task ("ok", "go on").',
    },
  },
}
type JevResponse = { answers?: { flow?: { choice?: string; confidence?: number } } }

export const parseFlow = (text: string): FlowAnswer | string => {
  let body: JevResponse
  try {
    body = JSON.parse(text) as JevResponse
  } catch {
    return 'unreadable JSON'
  }
  const answer = body.answers?.flow
  const flow = FLOWS.find((name) => name === answer?.choice)
  if (!flow) return 'answer without a valid flow'
  return { flow, confidence: answer?.confidence ?? 0 }
}

export const MIN_CONFIDENCE = 0.6
const SKILL_OF: Record<Exclude<Flow, 'none'>, string> = { bug: 'bug', feature: 'feature', open: 'grill' }

// `skillOf` names a skill for the runtime: `lexi:bug` on Claude Code, `lexi-bug` on Pi.
export const flowContext = (flow: Flow, confidence: number, skillOf = (name: string) => `lexi:${name}`): string | undefined => {
  if (flow === 'none') return undefined
  if (confidence < MIN_CONFIDENCE) return `lexi flow (Jev): unsure (${flow}, ${confidence.toFixed(2)}). If this prompt asks for a code change, load the skill "${skillOf('lexi')}" first: it routes.`
  const skill = skillOf(SKILL_OF[flow])
  return `lexi flow (Jev): ${flow}, confidence ${confidence.toFixed(2)}. Load the skill "${skill}" before anything else. If that is clearly wrong for this prompt, say why in one line and load "${skillOf('lexi')}" instead.`
}

// A slash command already names what runs: classifying it would only second-guess the user.
export const isRoutable = (prompt: string): boolean => !prompt.trimStart().startsWith('/')
