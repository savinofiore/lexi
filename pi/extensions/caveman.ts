import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

// lexi requires caveman. On Claude Code the plugin dependency installs it and its SessionStart hook
// turns it on; on Pi caveman ships only skills, so this keeps it on every turn, like ponytail does.
// The rules are read from the installed caveman package: its SKILL.md stays the single source.
const SKILL = 'git/github.com/JuliusBrussee/caveman/skills/caveman/SKILL.md'
const INSTALL = 'pi install -l git:github.com/JuliusBrussee/caveman'
const OFF = /\b(stop caveman|normal mode)\b/i

const readRules = (cwd: string): string | undefined => {
  const path = [join(cwd, '.pi'), join(homedir(), '.pi/agent')].map((root) => join(root, SKILL)).find(existsSync)
  return path ? readFileSync(path, 'utf8').replace(/^---[\s\S]*?\n---\s*/, '') : undefined
}

export default function (pi: ExtensionAPI) {
  let rules: string | undefined

  pi.on('session_start', async (_event, ctx) => {
    rules = readRules(ctx.cwd)
    if (!rules) ctx.ui.notify(`lexi requires caveman, not installed: ${INSTALL}`, 'warning')
  })
  pi.on('input', async (event) => {
    if (OFF.test(event.text)) rules = undefined
  })
  pi.on('before_agent_start', async (event) => (rules ? { systemPrompt: `${event.systemPrompt}\n\n${rules}` } : undefined))
}
