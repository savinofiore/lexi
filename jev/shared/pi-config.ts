import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Pi only. Both runtimes ship Jev inside the lexi package and it is required: `.lexi.json` turns it on,
// its `jev` object only holds settings (written by lexi-init).
export type JevConfig = { tiers?: Partial<Record<'fast' | 'balanced' | 'deep', string>> }

const readJson = <T>(path: string): T | undefined => {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T
  } catch {
    return undefined
  }
}

// No `.lexi.json` → not a lexi project, Jev stays out. Otherwise Jev is on: a missing `jev`, `true`, or a
// `false` left from when Jev was optional (before 0.14.0) all mean `{}`.
export const jevConfig = (cwd: string): JevConfig | undefined => {
  const lexi = readJson<{ jev?: unknown }>(join(cwd, '.lexi.json'))
  if (!lexi) return undefined
  return typeof lexi.jev === 'object' && lexi.jev !== null ? (lexi.jev as JevConfig) : {}
}

// Pi has no `env` block in its settings: the key is exported in the shell or, like on Claude Code,
// kept under `env` in the project's gitignored .claude/settings.local.json. The value is never printed.
let cached: string | undefined | null = null

export const jevApiKey = (cwd: string): string | undefined => {
  if (cached !== null) return cached
  const local = readJson<{ env?: Record<string, string> }>(join(cwd, '.claude', 'settings.local.json'))?.env?.TYPESAFE_API_KEY
  cached = process.env.TYPESAFE_API_KEY?.trim() || local?.trim() || undefined
  return cached
}
