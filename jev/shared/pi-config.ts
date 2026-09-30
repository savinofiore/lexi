import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Pi only. On Claude Code the jev plugin is installed on its own; on Pi it ships inside the lexi
// package, so a project opts in through a `jev` object in `.lexi.json` (written by lexi-init).
export type JevConfig = { tiers?: Partial<Record<'fast' | 'balanced' | 'deep', string>> }

const readJson = <T>(path: string): T | undefined => {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T
  } catch {
    return undefined
  }
}

// `"jev": false` records that the user said no. `"jev": true` is a hand-written `{}`: accept it,
// a silent "off" for a typo cost a whole session once.
export const jevConfig = (cwd: string): JevConfig | undefined => {
  const jev = readJson<{ jev?: unknown }>(join(cwd, '.lexi.json'))?.jev
  if (jev === true) return {}
  return typeof jev === 'object' && jev !== null ? (jev as JevConfig) : undefined
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
