---
name: lexi-feature
description: Analyze a feature, propose multiple unit tests, confirm them with the user, then execute RED→GREEN cycle. Unit tests only, no widget tests. Use for features with clear scope where you want explicit test proposals before implementation.
---

> **Pi:** invoke this skill with `/skill:lexi-feature`.


# feature — propose unit tests, confirm, then RED→GREEN

One flow: analyze → propose tests → confirm → write tests (RED) → write code (GREEN) → report.

Read `.lexi.json` first. No `.lexi.json` → invoke `/skill:lexi-init`.

## 1. Understand the feature

Read the code the feature touches. Run the gate to verify starting state. If scope is genuinely open (multiple defensible designs), invoke `/skill:lexi-grill` first, get decisions, then return here.

**Bug**: name the root cause. If symptom could come from multiple layers, list the 3 most likely with one log line that separates them. Ask user to reproduce with logs before proposing tests.

## 2. Propose unit tests

Analyze the feature and propose **3-5 concrete unit tests**, not widget/UI tests. Each test:
- Names what the unit does (e.g., "applies a 10% discount to total")
- States expected input → output
- No internal implementation details

Post them as a list with one-liner descriptions. Then ask:
- ✅ Which of these do you want?
- ➕ Any tests I missed?

Wait for confirmation. Do not write tests at unconfirmed seams.

## 3. Confirm the seams

Once approved, post in one message:
- The seams under test (public functions/boundaries), each with its mirror test file
- The test list in execution order (depends on implementation order)
- Feature type: retro-compatible (new tests only) or breaking (which existing tests change)
- What the feature touches outside `testable` (gets no test)

Then wait again. No code written until checkpoint confirmed.

## 4. RED → GREEN cycle

Per test, in order:

1. **RED** — write ONE test. Run gate. Must fail for the reason under test (not setup error).
2. **GREEN** — write production code only. Minimal change. Ponytail governs: does it need to exist, is it already here, does stdlib do it, can it be one line.
3. **Gate** — rerun. If green → next test.

Stop conditions (do not push through):
- Red for the wrong reason (setup, compile) → fix test, not production code
- Test would have to change to reach green → ask, never rewrite assertion
- Same red after 3 attempts → report what you've ruled out, stop
- Green on first run → verify test actually asserts something

## 5. Breaking changes

If an existing test was named "breaking" in step 3:

1. Write path into `.lexi/allow`
2. Rewrite to new expected behaviour — one test per cycle, never bulk
3. Empty `.lexi/allow` when gate is green

Any test found obsolete mid-implementation is not pre-approved → stop, ask again.

## 6. Done

Gate fully green. Report:
- Tests written (files, names)
- Production files touched
- What was left untested and why

Tests stay as permanent regression — nothing to delete.
