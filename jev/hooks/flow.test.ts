import { describe, expect, mock, test } from 'claude-code/testing'
import type { HttpResponse, On } from 'claude-code'

const flowReply = (choice: string, confidence: number): HttpResponse => ({
  status: 200,
  ok: true,
  headers: {},
  text: JSON.stringify({ answers: { flow: { choice, confidence } } }),
})

// The world beneath the plugin, for the flow hook: `.lexi.json` present or not, a Jev that answers
// flow questions with `reply` (router questions get a neutral answer), and the context that entered.
const setupWorld = (on: On, hasLexi: boolean, reply: () => HttpResponse | Promise<HttpResponse>) => {
  mock.clock(on)
  mock.env(on, { TYPESAFE_API_KEY: 'test-key' })
  const seen = { flowCalls: 0, contexts: [] as (readonly string[] | undefined)[], shown: [] as string[] }
  on('ui.log', async (_$, e) => (e.to !== 'debug' && seen.shown.push(e.text), { value: undefined }))
  on('ui.status', async () => ({ value: undefined }))
  on('fs.read', async (_$, e) => {
    if (hasLexi && e.path.endsWith('.lexi.json')) return { value: '{"jev":{}}' }
    throw new Error('ENOENT')
  })
  on('http.fetch', async (_$, e) => {
    if (!String(e.init?.body).includes('"flow"')) return { value: flowReply('none', 0) }
    seen.flowCalls++
    return { value: await reply() }
  })
  on('prompt.submit', async (_$, e) => (seen.contexts.push(e.context), { text: e.text }))
  return seen
}

const prompt = (text: string) => ({ text, wait: false, origin: { kind: 'composer' as const } })

describe('jev-router: lexi flow', () => {
  test('attaches the lexi:bug order to a bug prompt, asking Jev on every prompt', async ($, on) => {
    const seen = setupWorld(on, true, () => flowReply('bug', 0.82))
    await $.prompt.submit(prompt('the total ignores the discount'))
    await $.prompt.submit(prompt('and the tax is wrong too'))
    expect(seen.flowCalls).toBe(2)
    expect(seen.contexts[0]?.join('\n') ?? '').toMatch(/"lexi:bug" before anything else/)
  })

  test('a Jev failure leaves the prompt as typed, without throwing', async ($, on) => {
    const seen = setupWorld(on, true, () => ({ status: 500, ok: false, headers: {}, text: '' }))
    await $.prompt.submit(prompt('the total ignores the discount'))
    expect(seen.flowCalls).toBe(1)
    expect(seen.contexts).toEqual([undefined])
  })

  test('outside a lexi project Jev is never asked for a flow', async ($, on) => {
    const seen = setupWorld(on, false, () => flowReply('bug', 0.82))
    await $.prompt.submit(prompt('the total ignores the discount'))
    expect(seen.flowCalls).toBe(0)
    expect(seen.contexts).toEqual([undefined])
  })

  test('shows the flow and the skill it ordered in the transcript', async ($, on) => {
    const seen = setupWorld(on, true, () => flowReply('bug', 0.82))
    await $.prompt.submit(prompt('the total ignores the discount'))
    expect(seen.shown.filter((line) => line.startsWith('[jev-flow]'))).toEqual(['[jev-flow] bug (0.82) → lexi:bug'])
  })

  test('below the threshold it shows the fallback to lexi:lexi', async ($, on) => {
    const seen = setupWorld(on, true, () => flowReply('feature', 0.45))
    await $.prompt.submit(prompt('make the title red'))
    expect(seen.shown.filter((line) => line.startsWith('[jev-flow]'))).toEqual(['[jev-flow] feature (0.45) → lexi:lexi'])
  })

  test('none shows nothing', async ($, on) => {
    const seen = setupWorld(on, true, () => flowReply('none', 0.95))
    await $.prompt.submit(prompt('ciao'))
    expect(seen.shown.filter((line) => line.startsWith('[jev-flow]'))).toEqual([])
  })
})
