---
name: lexi
description: Test-first flow for a task, bug or feature, with no spec document. Confirms the seams under test in one message, then drives one vertical slice at a time red to green through the project gate. Use whenever a code change is requested in a project with a .lexi.json, or when the lexi guard blocks a write.
---

# lexi — one task, vertical slices, red → green

No spec file, no approval file, nothing to clean up afterwards. The tests are the
spec, and they stay in the repository when the task is done.

Read `.lexi.json` at the project root first: it names the `gate` command, the
`testable` paths and the mirror rule. No `.lexi.json` → run `/lexi:init` first.

## 1. Understand

Read the code the task actually touches — the file, and the callers of anything
you are about to change. Run the gate on the affected area to fix the starting
state before proposing anything.

**Bug:** name the root cause before writing any test. If more than one layer
could plausibly produce the symptom, give the three most likely causes and the
one log line that separates them, and ask the user to reproduce. A test written
against a guessed cause goes green while the bug is still there.

**Scope genuinely open** (several designs are defensible, product intent
unclear)? Call the Skill tool with "grilling" and settle it in rounds. Skip it
when the task is clear — the interview is the expensive part of the old
process, so here it is opt-in, not a toll on every change.

## 2. Confirm the seams — the only checkpoint

A **seam** is the public boundary you test at: the interface where behaviour is
observable without reaching inside. Post, in one message:

- the seams under test, each with its mirror test file
- one test name per slice, in the order you will write them
- **feature**: retro-compatible (only new tests) or breaking (which existing
  tests change behaviour, and which change in expected behaviour forces each)
- what the task touches that falls outside `testable`, and gets no test

Then wait. No test is written at an unconfirmed seam. This is the whole of the
human gate: a list of test names in chat, not a document to re-read.

## 3. Slice loop — one seam at a time

Per slice, in order:

1. **RED** — write ONE test. Run the gate. It must fail *for the reason under
   test*, not for a setup or compile error.
2. **GREEN** — change production code only, the least that makes it pass. The
   ponytail ladder applies here: reuse what the repo already has, stdlib before
   custom, one line before fifty.
3. **Gate** — rerun. Green → next slice.

Never write all the tests up front. Bulk tests verify *imagined* behaviour: they
commit to a test shape before the implementation has taught you anything, and
they go insensitive to real changes. Each slice is a tracer bullet that answers
to what the last one revealed.

If the `tdd` skill is installed, call the Skill tool with "tdd" for what makes a
test worth keeping (seams, mocking, anti-patterns).

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

Only for tests the user confirmed in step 2:

1. Write those test paths into `.lexi/allow`, one per line.
2. Rewrite them to the new expected behaviour — one per slice, never in bulk.
3. Empty `.lexi/allow` once the gate is green.

An assertion found "obsolete" mid-implementation is not covered by that
agreement: stop and go back to step 2.

## 6. Done

Full gate green. Report the slices, the files touched, and what you left
untested and why. The tests stay as permanent regression; there is nothing to
delete.
