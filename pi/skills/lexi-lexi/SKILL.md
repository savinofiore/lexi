---
name: lexi-lexi
description: Test-first flow for a task, bug or feature, with no spec document. Routes to lexi-feature for clear scope or lexi-grill for open scope, then confirms seams and drives vertical slices red to green. Use whenever a code change is requested in a project with a .lexi.json, or when the lexi guard blocks a write.
---

> **Pi:** invoke this skill with `/skill:lexi-lexi`.


# lexi — one task, vertical slices, red → green

No spec file, no approval file, nothing to clean up afterwards. The tests are the
spec, and they stay in the repository when the task is done.

Read `.lexi.json` at the project root first: it names the `gate` command, the
`testable` paths and the mirror rule. No `.lexi.json` → invoke `/skill:lexi-init`
first.

Running the gate: `.lexi.json` has `"gate_agent": true` → dispatch to the
`lexi-gate` subagent (`{agent: "lexi-gate", task: "<gate command>", agentScope:
"project"}`) instead of running it in bash. Otherwise run the gate command
directly, as before.

This skill owns routing. Test quality lives in `lexi-tdd`, scope interrogation in
`lexi-grill`, test proposal in `lexi-feature` (new tests), bug fixing in `lexi-bug`
(rewrite existing tests), and how much code to write in **ponytail** — the one
external pi package lexi requires. If ponytail is missing, say so instead of
improvising.

## 1. Understand and route

Read the code the task actually touches — the file, and the callers of anything
you are about to change. Run the gate on the affected area to fix the starting
state before proposing anything.

**Bug:** name the root cause before writing any test. If more than one layer
could plausibly produce the symptom, give the three most likely causes and the
one log line that separates them, and ask the user to reproduce. A test written
against a guessed cause goes green while the bug is still there.

**Now choose the path:**

- **Bug report** (existing code is broken, existing tests should fail)? Invoke
  `/skill:lexi-bug` — rewrite existing tests to prove the bug, then fix production
  code. That skill owns test rewrites and fix execution.

- **Scope genuinely open** (several designs defensible, product intent unclear)?
  Invoke `/skill:lexi-grill` first — settle decisions in rounds. Then return here.

- **Scope clear, feature ready?** Invoke `/skill:lexi-feature` — it proposes unit
  tests, waits for confirmation, then runs full RED→GREEN cycle. That skill owns
  proposal and execution.

- **Scope clear, manual flow?** Continue to step 2 below (legacy path).

## 2. Confirm the seams — the only checkpoint

A **seam** is the public boundary you test at: the interface where behaviour is
observable without reaching inside. Post, in one message:

- the seams under test, each with its mirror test file
- one test name per slice, in the order you will write them
- **feature type**: retro-compatible (only new tests) or breaking (which existing
  tests change behaviour)
- what the task touches that falls outside `testable`, and gets no test

Then wait. No test is written at an unconfirmed seam. This is the whole of the
human gate: a list of test names in chat, not a document to re-read.

## 3. Slice loop — one seam at a time

Per slice, in order:

1. **RED** — write ONE test. Run the gate. It must fail *for the reason under
   test*, not for a setup or compile error.
2. **GREEN** — change production code only, the least that makes it pass. The
   ponytail ladder governs this step: does it need to exist, is it already in
   the codebase, does the stdlib or the platform do it, can it be one line.
   Ponytail is ambient once installed — no call needed, but the ladder is not
   optional here.
3. **Gate** — rerun. Green → next slice.

Never write all the tests up front. Bulk tests verify *imagined* behaviour: they
commit to a test shape before the implementation has taught you anything, and
they go insensitive to real changes. Each slice is a tracer bullet that answers
to what the last one revealed.

Invoke `/skill:lexi-tdd` for what makes a test worth keeping — seams, assertions,
mocking, the anti-patterns. Consult it before and during the loop, not after:
this skill does not restate any of it.

## 4. Stop conditions

Stop and report. Do not push through:

- **A test would have to change to reach green.** The guard blocks it. Either
  the production code is wrong — fix the code — or the expected behaviour is
  not what was agreed — ask. Never rewrite an assertion to chase green.
- **Three attempts, same red, no progress.** Report the actual error and what
  you have ruled out. Widening the diff until the assertion goes quiet is the
  failure this rule exists to prevent.
- **Red for the wrong reason.** A setup or compile error is not a valid red.
  Fix the test before touching production code.
- **A new test that is green on its first run.** The feature is a no-op or the
  test asserts nothing. Verify before continuing.

## 5. Breaking change protocol

Only for tests confirmed in step 2:

1. Write those test paths into `.lexi/allow`, one per line.
2. Rewrite them to the new expected behaviour — one per slice, never in bulk.
3. Empty `.lexi/allow` once the gate is green.

An assertion found "obsolete" mid-implementation is not covered by that
agreement: stop and go back to step 2.

## 6. Done

Full gate green. Report the slices, the files touched, and what you left
untested and why. The tests stay as permanent regression; there is nothing to
delete.
