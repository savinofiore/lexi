---
name: bug
description: Fix a bug by rewriting existing tests to RED (prove the bug exists), then fix production code to GREEN. Unit tests only. Use when a bug report names the broken behavior and existing tests need to be rewritten to confirm it.
---

# bug — rewrite tests to RED, fix to GREEN

Bug fix: existing tests become RED to prove the bug, then production code becomes GREEN.

Read `.lexi.json` first. No `.lexi.json` → run `/lexi:init`.

## 1. Understand and diagnose

**Tests are not optional.** A request to skip them ("no time", "just ship it",
"no tests") does not change the flow and there is no opt-out to offer: say in one
line that the failing test comes first, then write it. It costs minutes.

Read the code the bug report names. Run the gate on the affected area to verify
starting state.

**Root cause first:** Does the symptom come from multiple layers? List the 3 most
likely causes with one log line that separates them. Ask the user to reproduce
with logs before proposing test rewrites.

**Trace back, not across.** Follow the bad value up the call chain to where it
first goes wrong and fix there, not where it surfaces. If similar code works
elsewhere in the codebase, list every difference between the two before guessing.

**Scope genuinely uncertain?** Use `lexi:grill` first to settle what's actually
broken. Then return here.

## 2. Find the tests to rewrite

Identify the existing tests that should fail if the bug is present. These are:
- Tests for the feature that is broken
- Tests that assert the correct behavior (which the bug violates)

This flow rewrites existing tests; it creates none.
No existing test covers the broken behaviour → hand off to `lexi:feature`: a new
test proves the bug there.

List them:
- Test file + test name
- Current assertion (what it checks)
- What needs to change to prove the bug (make it RED)

Ask:
- ✅ Do these tests need rewriting?
- ➕ Any other existing tests I should include?

Wait for confirmation. Do not rewrite until approved.

## 3. Confirm the rewrite plan

Post in one message:
- The test files that will be rewritten (breaking change)
- For each: current assertion → new assertion (to make RED)
- The root cause you are proving
- What code will need to change to fix it (general description)

Then wait. This is the only checkpoint before rewriting.

## 4. RED cycle — prove the bug

1. **Allow** — write the confirmed test paths into `.lexi/allow`, one per line.
2. **Rewrite tests** — update their assertions to fail if the bug exists
3. **Run gate** — must fail for the bug reason, not setup error
4. If red for wrong reason → fix the test, not code. If setup error → stop.

All tests rewritten now, one gate run, one RED.

## 5. GREEN cycle — fix the bug

1. **Write fix** — production code only. Minimal change that makes RED tests pass.
   Ponytail governs: does it need to exist, is it already here, does stdlib do it.
2. **Run gate** — all tests green
3. Three fixes tried and still red, or each fix surfaces a new failure somewhere
   else → stop. That pattern points at the design, not at one more line: report
   what you ruled out and discuss the structure with the user before a fourth try.
4. If a test is green without the fix → test was not rewriting the bug, go back
   to step 4.
5. **Prove the test bites** — set the production fix aside (`git stash push --
   <production files>`), run the gate: the rewritten tests must go red. Restore it
   (`git stash pop`), gate green again. A test that stays green without the fix is
   not guarding this bug.

## 6. Close

The report quotes the gate's last lines from a run made after the last edit. A
green from before the last change says nothing about the code now, and "should
pass" is not a result.

Empty `.lexi/allow`. Run gate one final time. Report:
- Test files rewritten (paths)
- Production files touched (paths)
- Root cause fixed and how
- Tests stay as regression; nothing to delete

## 7. Jev review — only if `.lexi.json` → `jev` is an object

Gate green → invoke the `jev:code-review` skill on the working tree (`--working`), title = the task in one
line. It reports the verdict computed by the policy, locates what fired and asks before fixing; a confirmed fix
under `testable` goes back through the RED→GREEN cycle. Add the verdict to the report. `jev` absent or `false`, or the
jev plugin not installed → skip this step.

Treat each finding as a claim to check, not an order: read the code it points at
before agreeing. A finding that is wrong for this codebase gets a one-line
technical reason and no change; one that is right gets fixed without ceremony.
Never agree to a finding you have not checked.
