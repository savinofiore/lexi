// The last run of the project's gate, as the status line and the band show it.
export type GateRun = { isGreen: boolean; durationMs: number; at: number }

// One tool call a subagent made: the tool, a short form of its input, whether it errored.
export type AgentStep = { tool: string; input: string; isError: boolean }

export type AgentRun = {
  id: string
  type: string
  label: string
  color: string
  description: string
  model?: string
  isDone: boolean
  steps: AgentStep[]
  durationMs?: number
  tokens?: number
  answer?: string
}

// The engine's status-line figures at its last measurement, as the band's usage row draws them.
export type Usage = {
  model: string
  context: { tokens?: number; percent?: number }
  rateLimits: { kind: string; percentUsed: number; resetsAt?: string }[]
  usd?: number
}

// The model and effort the Jev router settled on for the session, as the usage row shows them.
export type Routing = { model: string; effort: string }

declare module 'claude-code' {
  interface PluginState {
    'lexi': { lastGate: GateRun | null; agents: AgentRun[]; selected: string | null; usage: Usage | null; routing: Routing | null }
  }
}
