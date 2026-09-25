import { describe, expect, mock, test } from 'claude-code/testing'
import type { HttpResponse, On, SessionCompactResult, SessionMessage, ToolResultSummary, ToolUseSummary } from 'claude-code'

type JevRequest = { model: string; state: unknown; questions: Record<string, unknown> }
type Reply = (body: JevRequest) => Promise<HttpResponse> | HttpResponse

const use = (id: string, tool: string, input: Record<string, unknown>): ToolUseSummary => ({ tool_use_id: id, tool, input })
const result = (id: string, text: string): ToolResultSummary => ({ tool_use_id: id, text, isError: false })
const assistant = (text: string, toolUses: ToolUseSummary[] = []): SessionMessage => ({ role: 'assistant', text, toolUses })
const user = (text: string, toolResults: ToolResultSummary[] = []): SessionMessage => ({ role: 'user', text, toolUses: [], toolResults })

// 14 messages: the last 6 (8..13) and the first are immune. Candidates: read, bash, grep, big.
// "pending" has no result, "ghost" has no call, "recent" is in the protected tail.
const conversation = (): SessionMessage[] =>
  [
    user('refactor the parser'),
    assistant('reading the file', [use('read', 'Read', { file_path: 'src/parser.ts' })]),
    user('', [result('read', 'r'.repeat(4_000)), result('ghost', 'g'.repeat(50))]),
    assistant('', [use('bash', 'Bash', { command: 'ls -la' }), use('grep', 'Grep', { pattern: 'TODO' })]),
    user('', [result('bash', 'b'.repeat(2_000)), result('grep', 'z'.repeat(100))]),
    assistant('fetching the log', [use('big', 'Bash', { command: 'cat build.log' })]),
    user('', [result('big', 'w'.repeat(20_000))]),
    assistant('', [use('pending', 'Read', { file_path: 'a.ts' })]),
    user('now add the tests'),
    assistant('', [use('recent', 'Read', { file_path: 'test/parser_test.ts' })]),
    user('', [result('recent', 'x'.repeat(5_000))]),
    assistant('done'),
    user('thanks'),
    assistant('welcome'),
  ].map((message, i) => ({ ...message, handle: `h${i}` }))

// [keep_result, keep_call] per call: read kept, bash truncated, grep kept (short), big dropped.
const DEFAULT_PLAN: Record<string, [number, number]> = { read: [0.9, 0.9], bash: [0.1, 0.8], grep: [0.1, 0.9], big: [0.1, 0.1] }

const jevAnswers = (answers: Record<string, unknown>): HttpResponse => ({ status: 200, ok: true, headers: {}, text: JSON.stringify({ model: 'jev-1.13.0', answers }) })

const answerByPlan = (plan: Record<string, [number, number]>) => (body: JevRequest) =>
  jevAnswers(Object.fromEntries(Object.keys(body.questions).map((id) => {
    const [, kind = '', call = ''] = /^keep_(call|result)_(.+)$/.exec(id) ?? []
    const [keepResult, keepCall] = plan[call] ?? [1, 1]
    return [id, { type: 'noul', noul: kind === 'result' ? keepResult : keepCall }]
  })))

// The world beneath the plugin: mocked clock and env, a Jev that answers `reply`, and the native
// summary at the bottom of the chain, which records whether the hook deferred.
const setupWorld = (on: On, reply: Reply, hasKey = true) => {
  const clock = mock.clock(on)
  mock.env(on, hasKey ? { TYPESAFE_API_KEY: 'test-key' } : {})
  const seen = { delegated: false, logs: [] as string[], statuses: [] as (string | undefined)[], toasts: [] as string[], requests: [] as JevRequest[], headers: [] as Record<string, string>[] }
  on('ui.log', async (_$, e) => (seen.logs.push(e.text), { value: undefined }))
  on('ui.status', async (_$, e) => (seen.statuses.push(e.text), { value: undefined }))
  on('ui.toast', async (_$, e) => (seen.toasts.push(e.text), { value: undefined }))
  on('http.fetch', async (_$, e) => {
    const body = JSON.parse(e.init?.body ?? '{}') as JevRequest
    seen.requests.push(body)
    seen.headers.push(e.init?.headers ?? {})
    return { value: await reply(body) }
  })
  on('session.compact', async (_$, e) => ((seen.delegated = true), { messages: e.messages }))
  return { clock, seen }
}

const compactInput = () => ({ trigger: 'manual' as const, messages: conversation() })
const messagesOf = (outcome: SessionCompactResult) => outcome.messages ?? []
const usesOf = (messages: readonly SessionMessage[]) => messages.flatMap((m) => m.toolUses)
const resultsOf = (messages: readonly SessionMessage[]) => messages.flatMap((m) => m.toolResults ?? [])

describe('jev-compact', () => {
  test('asks Jev two questions for each paired call outside the protected messages', async ($, on) => {
    const { seen } = setupWorld(on, answerByPlan(DEFAULT_PLAN))
    await $.session.compact(compactInput())
    const ids = seen.requests.flatMap((body) => Object.keys(body.questions)).sort()
    expect(ids).toEqual(['big', 'bash', 'grep', 'read'].flatMap((id) => [`keep_call_${id}`, `keep_result_${id}`]).sort())
    expect(seen.requests[0]?.model).toBe('jev-latest')
    expect(seen.headers[0]?.authorization).toBe('Bearer test-key')
  })

  test('keeps, truncates or drops as the table says and leaves every text untouched', async ($, on) => {
    const { seen } = setupWorld(on, answerByPlan(DEFAULT_PLAN))
    const messages = messagesOf(await $.session.compact(compactInput()))
    const textOf = (id: string) => resultsOf(messages).find((r) => r.tool_use_id === id)?.text
    expect(seen.delegated).toBe(false)
    expect(textOf('read')).toBe('r'.repeat(4_000))
    expect(textOf('bash')).toBe(`${'b'.repeat(300)}\n[… 1700 chars removed]`)
    expect(textOf('grep')).toBe('z'.repeat(100))
    expect(textOf('big')).toBeUndefined()
    expect(usesOf(messages).map((u) => u.tool_use_id)).toEqual(['read', 'bash', 'grep', 'pending', 'recent'])
    expect(textOf('recent')).toBe('x'.repeat(5_000))
    expect(messages.map((m) => m.text).filter(Boolean)).toEqual(conversation().map((m) => m.text).filter(Boolean))
    expect(messages).toHaveLength(13)
    expect(seen.logs).toContain('✗ dropped    Bash · cat build.log  (-20.0k chars)')
    expect(seen.logs).toContain('✂ truncated  Bash · ls -la  (2.0k → 300 chars)')
    expect(seen.logs).toContain('4 tool calls judged → 2 kept, 1 truncated, 1 dropped · messages 14 → 13')
  })

  test('returns no handle and never splits a call from its result', async ($, on) => {
    setupWorld(on, answerByPlan(DEFAULT_PLAN))
    const messages = messagesOf(await $.session.compact(compactInput()))
    expect(messages.every((m) => !('handle' in m))).toBe(true)
    const useIds = new Set(usesOf(messages).map((u) => u.tool_use_id))
    const resultIds = new Set(resultsOf(messages).map((r) => r.tool_use_id))
    for (const id of ['read', 'bash', 'grep', 'big', 'recent']) expect(useIds.has(id)).toBe(resultIds.has(id))
  })

  // Parallel calls arrive as consecutive assistant messages: they must be rejoined into one,
  // otherwise on --resume the loader splits them from their results.
  test('joins parallel calls back into one assistant message', async ($, on) => {
    setupWorld(on, answerByPlan({ p1: [0.9, 0.9], p2: [0.9, 0.9], big: [0.1, 0.1] }))
    const filler = ['a', 'b', 'c', 'd', 'e', 'f'].map((text, i) => (i % 2 ? assistant(text) : user(text)))
    const messages = [
      user('count the lines'),
      assistant('', [use('p1', 'Bash', { command: 'wc -l a' })]),
      assistant('', [use('p2', 'Bash', { command: 'wc -l b' })]),
      user('', [result('p1', '10 a')]),
      user('', [result('p2', '20 b')]),
      assistant('', [use('big', 'Read', { file_path: 'c' })]),
      user('', [result('big', 'w'.repeat(20_000))]),
      ...filler,
    ].map((message, i) => ({ ...message, handle: `h${i}` }))
    const compacted = messagesOf(await $.session.compact({ trigger: 'manual', messages }))
    const parallel = compacted.filter((m) => m.toolUses.some((u) => u.tool_use_id === 'p1' || u.tool_use_id === 'p2'))
    expect(parallel.map((m) => m.toolUses.map((u) => u.tool_use_id))).toEqual([['p1', 'p2']])
  })

  test('shows the outcome for a while, then clears the status line', async ($, on) => {
    const { clock, seen } = setupWorld(on, answerByPlan(DEFAULT_PLAN))
    await $.session.compact(compactInput())
    expect(seen.statuses.at(-1)).toMatch(/^jev-compact ██████████ 100% · -\d+% .* · 1 truncated, 1 dropped, 2 kept$/)
    expect(seen.toasts).toHaveLength(1)
    await clock.advance(30_000)
    expect(seen.statuses.at(-1)).toBeUndefined()
  })
})

describe('jev-compact falls back to the native summary', () => {
  const expectFallback = (seen: { delegated: boolean; logs: string[] }, reason: string) => {
    expect(seen.delegated).toBe(true)
    expect(seen.logs).toContain(`Jev did not compact (${reason}): native Claude Code summary`)
  }

  test('without a key, never calling Jev', async ($, on) => {
    const { clock, seen } = setupWorld(on, answerByPlan(DEFAULT_PLAN), false)
    await $.session.compact(compactInput())
    expectFallback(seen, 'TYPESAFE_API_KEY missing')
    expect(seen.requests).toHaveLength(0)
    await clock.advance(30_000)
    expect(seen.statuses.at(-1)).toBeUndefined()
  })

  test('on a body that is not JSON', async ($, on) => {
    const { seen } = setupWorld(on, () => ({ status: 200, ok: true, headers: {}, text: '<html>' }))
    await $.session.compact(compactInput())
    expectFallback(seen, 'answer is not JSON')
  })

  test('on an answer whose noul is missing or not a finite number', async ($, on) => {
    const { seen } = setupWorld(on, (body) => jevAnswers(Object.fromEntries(Object.keys(body.questions).map((id) => [id, { noul: 'NaN' }]))))
    await $.session.compact(compactInput())
    expectFallback(seen, 'answer without valid noul')
  })

  test('on a non-2xx status', async ($, on) => {
    const { seen } = setupWorld(on, () => ({ status: 529, ok: false, headers: {}, text: '{}' }))
    await $.session.compact(compactInput())
    expectFallback(seen, 'HTTP 529')
  })

  test('when Jev does not answer in time', async ($, on) => {
    const { clock, seen } = setupWorld(on, () => clock.sleep(60_000).then(() => jevAnswers({})))
    const pending = $.session.compact(compactInput())
    await clock.settle()
    await clock.advance(9_000)
    await pending
    expectFallback(seen, 'timeout')
  })

  test('when the reduction is below MIN_REDUCTION', async ($, on) => {
    const { seen } = setupWorld(on, answerByPlan({ ...DEFAULT_PLAN, big: [0.9, 0.9] }))
    await $.session.compact(compactInput())
    expect(seen.logs.some((line) => /^Jev did not compact \(reduction \d+% below 30%\)/.test(line))).toBe(true)
    expect(seen.delegated).toBe(true)
  })
})
