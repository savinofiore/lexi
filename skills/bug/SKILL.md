---
name: bug
description: Fix a bug by rewriting existing tests to RED (prove the bug exists), then fix production code to GREEN. Unit tests only. Use when a bug report names the broken behavior and existing tests need to be rewritten to confirm it.
---

# bug — rewrite tests to RED, fix to GREEN

Bug fix: existing tests become RED to prove the bug, then production code becomes GREEN.

Read `.lexi.json` first. No `.lexi.json` → run `/lexi:init`.

## 1. Understand and diagnose

Read the code the bug report names. Run the gate on the affected area to verify
starting state.

**Root cause first:** Does the symptom come from multiple layers? List the 3 most
likely causes with one log line that separates them. Ask the user to reproduce
with logs before proposing test rewrites.

**Scope genuinely uncertain?** Use `lexi:grill` first to settle what's actually
broken. Then return here.

## 2. Find the tests to rewrite

Identify the existing tests that should fail if the bug is present. These are:
- Tests for the feature that is broken
- Tests that assert the correct behavior (which the bug violates)

Do NOT create new tests yet. You are rewriting existing ones.

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

1. **Rewrite tests** — update assertions in `.lexi/allow` tracked files to fail
   if the bug exists
2. **Run gate** — must fail for the bug reason, not setup error
3. If red for wrong reason → fix the test, not code. If setup error → stop.

All tests rewritten now, one gate run, one RED.

## 5. GREEN cycle — fix the bug

1. **Write fix** — production code only. Minimal change that makes RED tests pass.
   Ponytail governs: does it need to exist, is it already here, does stdlib do it.
2. **Run gate** — all tests green
3. If still red after 3 attempts → report what you've ruled out, stop.
4. If a test is green without the fix → test was not rewriting the bug, go back
   to step 4.

## 6. Close

Empty `.lexi/allow`. Run gate one final time. Report:
- Test files rewritten (paths)
- Production files touched (paths)
- Root cause fixed and how
- Tests stay as regression; nothing to delete
