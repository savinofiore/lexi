import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

const GATE = 'python3 a_test.py'
const BAND = { component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 3, bodyColumns: 80, scroll: { offset: 0, bodyRows: 3 }, view: {} } } as const

// A lexi project whose gate takes 3.4s and passes; status and toasts go nowhere.
const setupWorld = (on: On) => {
  const clock = mock.clock(on)
  on('ui.status', async () => ({ value: undefined }))
  on('ui.render', async () => ({ type: 'Box', props: {}, children: [] }))
  on('fs.read', async () => ({ value: JSON.stringify({ gate: GATE }) }))
  on('tool.call', async () => (await clock.advance(3400), { result: '34 pass', text: '34 pass' }))
  return clock
}

const bandText = async ($: Engine) => {
  const ui = await $.ui.mount({ plugin: 'lexi-mods', surface: 'terminal', ...BAND })
  const found = await ui.findAll({ type: 'Text' })
  await ui.unmount()
  return found.map((text) => text.text).join('')
}

describe('band', () => {
  test('after a gate run the band shows its result, duration and age', async ($, on) => {
    const clock = setupWorld(on)
    await $.tool.call({ tool: 'Bash', command: GATE })
    await clock.advance(12000)
    expect(await bandText($)).toContain('gate GREEN · 3.4s · 12s ago')
  })

  test('before any gate run the band draws nothing of its own', async ($, on) => {
    setupWorld(on)
    expect(await bandText($)).toBe('')
  })
})
