import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// A bare `/skill:lexi-init` reaches the model as the skill block alone, with no request after it,
// and the model answers "Ready. What task?". The command sends the skill with the request attached.
// The skill text is inlined: sendUserMessage does not expand `/skill:` commands.
const SKILL_PATH = resolve(__dirname, '../skills/lexi-init/SKILL.md')
const REQUEST = 'Run lexi-init now on this project, starting with the required packages.'

export default function (pi: ExtensionAPI) {
  pi.registerCommand('lexi-init', {
    description: 'Set up lexi in this project, or update it after a new lexi version',
    handler: async (args) => pi.sendUserMessage(`${readFileSync(SKILL_PATH, 'utf8')}\n\n${REQUEST} ${args}`.trim()),
  })
}
