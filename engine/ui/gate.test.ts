import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const GATE = 'python3 a_test.py && claude plugin test mods'

// The world beneath the plugin: a project with or without `.lexi.json`, a Bash that answers
// `ran` for every command, and what reached the status line and the toasts.
const setupWorld = (on: On, hasLexi: boolean, ran: { isError?: true; text: string }) => {
  mock.clock(on)
  const seen = { status: [] as (string | undefined)[], toasts: [] as string[] }
  on('ui.status', async (_$, e) => (seen.status.push(e.text), { value: undefined }))
  on('ui.toast', async (_$, e) => (seen.toasts.push(e.text), { value: undefined }))
  on('fs.read', async (_$, e) => {
    if (hasLexi && e.path.endsWith('.lexi.json')) return { value: JSON.stringify({ gate: GATE }) }
    throw new Error(`ENOENT: ${e.path}`)
  })
  on('tool.call', async () => ({ result: ran.text, ...ran }))
  return seen
}

describe('gate', () => {
  test('a gate run that passes shows lexi:GREEN', async ($, on) => {
    const seen = setupWorld(on, true, { text: '34 pass' })
    await $.tool.call({ tool: 'Bash', command: GATE })
    expect(seen.status).toEqual(['lexi:GREEN'])
  })

  test('a gate run that fails shows lexi:RED', async ($, on) => {
    const seen = setupWorld(on, true, { isError: true, text: '1 fail' })
    await $.tool.call({ tool: 'Bash', command: GATE })
    expect(seen.status).toEqual(['lexi:RED'])
  })

  test('any other Bash command leaves the status line alone', async ($, on) => {
    const seen = setupWorld(on, true, { text: 'a_test.py' })
    await $.tool.call({ tool: 'Bash', command: 'ls' })
    expect(seen.status).toEqual([])
  })

  test('outside a lexi project nothing is shown', async ($, on) => {
    const seen = setupWorld(on, false, { text: '34 pass' })
    await $.tool.call({ tool: 'Bash', command: GATE })
    expect(seen.status).toEqual([])
  })

  test('an edit the lexi guard blocked shows its first line as a toast', async ($, on) => {
    const seen = setupWorld(on, true, { isError: true, text: 'lexi — edit to `src/a.py` BLOCKED.\n\nIt asserts behaviour.' })
    await $.tool.call({ tool: 'Edit', file_path: 'src/a.py', old_string: 'a', new_string: 'b' })
    expect(seen.toasts).toEqual(['lexi — edit to `src/a.py` BLOCKED.'])
  })
})
