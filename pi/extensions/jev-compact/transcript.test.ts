import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Verdict } from '../../../jev/shared/compact-policy.ts'
import { buildState, candidatesOf, serialize, toTurns } from './transcript.ts'

// `node --test pi/extensions/jev-compact/transcript.test.ts`
// Covers the part where Pi differs from Claude Code: the history becomes text, and that text must
// stay verbatim except where Jev decided to truncate or drop.

const call = (id: string, tool: string, input: Record<string, unknown>) => ({ type: 'toolCall', id, name: tool, arguments: input })
const text = (value: string) => ({ type: 'text', text: value })
const result = (id: string, tool: string, body: string) => ({ role: 'toolResult', toolCallId: id, toolName: tool, isError: false, content: [text(body)] })
// Six tail messages: PRESERVE_RECENT protects them, so the candidates stay those of the first ones.
const tail = () => Array.from({ length: 6 }, () => ({ role: 'assistant', content: [text('tail')] }))

const conversation = () => [
  { role: 'user', content: 'fix the parser' },
  { role: 'assistant', content: [text('reading'), call('c1', 'read', { path: 'src/a.ts' })] },
  result('c1', 'read', 'A'.repeat(1200)),
  { role: 'assistant', content: [text('now searching'), call('c2', 'grep', { pattern: 'foo' })] },
  result('c2', 'grep', 'zero matches'),
  ...tail(),
]

test('only a call with its result outside the protected messages is a candidate', () => {
  const turns = toTurns(conversation())
  assert.deepEqual(candidatesOf(turns).map((c) => [c.id, c.resultChars]), [['c1', 1200], ['c2', 12]])
})

test('the state never carries result contents, only outcome and length', () => {
  const state = buildState(toTurns(conversation()), undefined)
  const dumped = JSON.stringify(state)
  assert.ok(!dumped.includes('A'.repeat(50)), 'result contents ended up in the state')
  assert.match(dumped, /"result":"ok, 1200 chars"/)
  assert.deepEqual(state.goal, ['fix the parser'])
})

test('kept is verbatim, truncated keeps the head, dropped takes the call away too', () => {
  const turns = toTurns(conversation())
  const verdicts = new Map<string, Verdict>([['c1', 'truncate'], ['c2', 'drop']])
  const body = serialize(turns, verdicts)
  assert.ok(body.includes('[User]: fix the parser'), 'user text is never touched')
  assert.ok(body.includes(`[Tool result read]: ${'A'.repeat(300)}\n[… 900 chars removed]`))
  assert.ok(!body.includes('zero matches'), 'the dropped result is still there')
  assert.ok(!body.includes('grep('), 'the dropped call is still there')
  assert.ok(body.includes('[Assistant tool calls]: read({"path":"src/a.ts"})'))
})

test('without verdicts the serialization is the whole history: the baseline', () => {
  const turns = toTurns(conversation())
  const full = serialize(turns, new Map())
  assert.ok(full.includes('A'.repeat(1200)))
  assert.ok(full.length > serialize(turns, new Map<string, Verdict>([['c1', 'truncate']])).length)
})
