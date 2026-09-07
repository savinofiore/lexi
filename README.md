# lexi

Test-first workflow for coding agents: analyze task, propose unit tests, confirm, execute RED→GREEN cycle. No spec documents, no cleanup after. Tests are the spec and stay in the repository.

## What it does

Three paths from `/lexi:lexi`:

**Bug fix:**
```
bug report → identify failing tests → rewrite tests to RED (prove bug)
          → fix production code to GREEN → report
```

**Feature with clear scope:**
```
feature → propose 3-5 unit tests → confirm + additions
       → test RED → code GREEN (repeat per test) → report
```

**Feature with open scope:**
```
feature → interrogate with /lexi:grill → settle decisions
       → propose tests based on decisions → confirm
       → test RED → code GREEN (repeat) → report
```

## How it enforces test-first

Two rules, enforced by a git hook:

| Rule | Effect |
|---|---|
| Source file under `testable` cannot be written before its mirror test exists | Write test first, mechanically |
| Committed test cannot have assertions rewritten | No cheating: rewrite test assertions to reach green |

Appending new tests to an existing file is allowed. Rewriting existing assertions is a breaking change: it gets flagged as such in step 2, recorded in `.lexi/allow`, and cleared when the gate passes.

Everything outside `testable` (UI, design tokens, generated code, platform bindings) stays free to edit with no test.

## Requires

**Python 3** on `PATH` as `python3`. The guard runs it, so without it every guarded edit fails instead of being checked. macOS and most Linux distributions already have it. On Windows: install Python and verify `python3 --version` answers.

```bash
python3 --version
```

**One external plugin: ponytail**

```
/plugin marketplace add DietrichGebert/ponytail
/plugin install ponytail@ponytail
```

[ponytail](https://github.com/DietrichGebert/ponytail) governs every GREEN step: does it need to exist, is it already in the codebase, does stdlib/platform do it, can it be one line. It is ambient once installed — lexi does not restate it.

**Skills shipped with lexi:**

| Skill | Owns |
|---|---|
| `lexi:init` | Project setup: detect stack, find gate command, choose testable paths, write `.lexi.json` |
| `lexi:lexi` | Router: directs bug/feature/grill/manual flows |
| `lexi:bug` | Bug fix: rewrite existing tests to prove bug, fix code |
| `lexi:feature` | Feature: propose unit tests, confirm, RED→GREEN cycle |
| `lexi:grill` | Scope interrogation: settle open decisions in rounds before writing anything |
| `lexi:tdd` | Reference: seams, assertions, mocking, anti-patterns, when to test |

## Install

Dependencies first, lexi last:

```
/plugin marketplace add DietrichGebert/ponytail
/plugin install ponytail@ponytail

/plugin marketplace add savinofiore/lexi
/plugin install lexi@lexi
```

Verify:

```
/plugin
```

Should show `lexi` with **6 skills** (`init`, `lexi`, `bug`, `feature`, `tdd`, `grill`) and **1 PreToolUse hook**.

From shell (outside Claude):

```bash
claude plugin marketplace add savinofiore/lexi
claude plugin install lexi@lexi
claude plugin details lexi@lexi
```

Restart the session, then opt a project in:

```
/lexi:init
```

### Local development

Only for working *on* lexi. The marketplace takes its name from the manifest, so the clone and GitHub version cannot coexist.

Local (edits to hooks/ and skills/ live immediately):

```
/plugin marketplace add /absolute/path/to/lexi
/plugin install lexi@lexi
```

Back to GitHub:

```
/plugin uninstall lexi@lexi
/plugin marketplace remove lexi
/plugin marketplace add savinofiore/lexi
/plugin install lexi@lexi
```

## Configuration

`.lexi.json`, written by `/lexi:init`:

```json
{
  "gate": "flutter test",
  "source": "lib/",
  "tests": "test/",
  "test_suffix": "_test.dart",
  "testable": ["lib/models/", "lib/repositories/", "lib/utils/"]
}
```

Mirror rule: `<source><rel>.<ext>` → `<tests><rel><test_suffix>`. Co-located tests work by setting `tests` equal to `source`.

## Commands

| Command | Use when |
|---|---|
| `/lexi:init` | Once per project to setup |
| `/lexi:lexi <description>` | Task, feature, or bug — routes to bug/feature/grill/manual |
| `/lexi:bug <description>` | Bug report with broken behavior |
| `/lexi:feature <description>` | Feature with clear scope |
| `/lexi:grill <description>` | Feature with open scope (optional, feature can call it) |
| `/lexi:tdd` | Reference material for test quality |

The guard runs on every `Edit`/`Write` once `.lexi.json` exists. No invocation needed.

## Flows: detailed

### Bug fix

```
/lexi:lexi <bug description>
  → routes to /lexi:bug
    → analyze, find root cause
    → identify existing tests that should fail if bug exists
    → propose rewrites (how to make them RED)
    → wait for confirmation + additions
    → rewrite tests in .lexi/allow
    → RED: run gate (bug confirmed)
      ✅ gate fails for bug reason → proceed
      ❌ gate fails for setup reason → fix test
      ❌ gate passes → test is not proving bug → go back
    → fix production code (minimal, ponytail governs)
    → GREEN: run gate
      ✅ gate passes → next
      ❌ gate fails after 3 attempts → report, stop
      ❌ test green without fix → fix was unnecessary → go back
    → empty .lexi/allow
    → report: files touched, root cause fixed, tests stay as regression
```

### Feature with clear scope

```
/lexi:lexi <clear feature description>
  → routes to /lexi:feature
    → analyze feature
    → propose 3-5 unit tests (no widget tests)
      "applies 10% discount", "caps at 50%", "rejects negative", …
    → wait for confirmation
      ✅ approve these
      ➕ add any I missed?
    → confirm seams (public boundaries under test)
    → per test, in order:
      1. RED: write ONE test, run gate
        ✅ gate fails for test reason → proceed
        ❌ gate fails for setup reason → fix test
        ❌ gate passes → test asserts nothing → verify
      2. GREEN: write production code (minimal, ponytail governs)
      3. run gate → passes → next test
    → report: tests written (files, names), production files touched, untested code and why
```

### Feature with open scope

```
/lexi:lexi <vague feature description>
  → routes to /lexi:lexi (analyzes scope)
  → scope is open (multiple defensible designs)
    → call /lexi:grill
      → Q1 with recommendation → your answer
      → Q2 with recommendation → your answer
      → … (blocked questions held for next round)
      → frontier empty → done
  → back to /lexi:lexi
    → routes to /lexi:feature
    → same as "feature with clear scope" above
```

### Manual flow (legacy)

```
/lexi:lexi <task>
  → analyze code
  → propose seams manually (skips feature)
    seam: function → mirror test file
    seam: function → mirror test file
    tests: list in order
    breaking: which existing tests change
    outside testable: what has no test
  → confirm seams
  → proceed with RED→GREEN cycle
```

## Examples

### Example 1 — bug

```
/lexi:lexi discount calculation is negative for high percentages
```

Gate fails on existing test `applies 10% discount`. That test expects `90`, passes `negative_number`. Analysis: discount formula is `(pct * total) - total` instead of `total - (pct * total)`.

Rewrite test assertion to prove bug:
- Old: `expect(applyDiscount(100, 10)).toBe(90)`
- New: `expect(applyDiscount(100, 10)).toBe(-10)` (proves the bug exists)

Red: gate fails (bug confirmed).

Fix: `export const applyDiscount = (total, pct) => total - (pct / 100) * total;`

Green: gate passes.

Empty `.lexi/allow`. Tests stay; they now pass because the bug is fixed.

### Example 2 — feature, clear scope

```
/lexi:lexi in src/domain/discount.js add applyDiscount(total, pct) capped at 50%
```

Propose tests:
- applies a 10% discount to total
- caps discount at 50% of total
- rejects a negative percentage

Confirm. Write test 1 → RED. Write minimal code → GREEN. Write test 2 → RED. Write cap logic → GREEN. Write test 3 → RED. Write validation → GREEN.

Gate green. Report three tests, one file touched, no untested code.

### Example 3 — feature, open scope

```
/lexi:lexi support promo codes at checkout
```

Scope is open. Call `/lexi:grill`.

Rounds:
1. Q1 — source of truth: hardcoded table, API, or payment provider? → API (table can't expire, provider locks you in)
2. Q2 — stacking: one code or many? → One (stacking is a pricing engine nobody asked for)
3. Q3 — what a code discounts: total, line items, or shipping? → Total (line-item scope needs category model that doesn't exist)
4. Q4 — rejected code: throw or result? → Result (UI needs to show "expired" vs "not found" differently)
5. Held for round 2: behavior when API is down (needs Q1), second code entered (needs Q2, Q3)

Back to `/lexi:lexi`. Routes to `/lexi:feature`.

Feature proposes:
- rejects unknown code → `{ ok: false, reason: 'not_found' }`
- rejects expired code → `{ ok: false, reason: 'expired' }`
- applies valid code to total
- second code replaces first
- API unreachable → no discount, checkout still works

Breaking: existing test `total is the sum of line items` will change when we add promo logic.

Confirm. Execute five RED→GREEN loops. Gate green. Report five tests, three files touched.

## What the guard blocks

Write to testable source before test exists:

```
lexi — write to `src/domain/discount.js` BLOCKED.
`src/domain/discount.js` is under `testable` and mirror test does not exist:
  tests/domain/discount.test.js
```

Rewrite committed test assertion:

```
lexi — edit to `tests/domain/total.test.js` BLOCKED.
Test file is tracked by git and edit replaces existing content.
Rewriting an assertion to reach green is what this guard stops.
```

Free (no test required):

```
src/components/card.js           ← outside testable
tests/domain/new.test.js         ← untracked, about to be written
tests/domain/total.test.js       ← appending new case, existing ones intact
```

## Breaking changes

Feature or bug discovers an existing test is now obsolete or wrong. Name it in step 2 of the flow (`breaking: tests/domain/cart.test.js, 'total is the sum of line items'`). That agreement lets you rewrite it:

```bash
echo tests/domain/cart.test.js >> .lexi/allow
```

Rewrite the test to new expected behavior, run gate, clear the file:

```bash
: > .lexi/allow
```

The release covers one breaking test per slice, never bulk. An assertion discovered "obsolete" mid-implementation is not pre-approved — stop and ask again.

`.lexi/allow` is per-task scratch, gitignored by `/lexi:init`.

## Stack examples

```json
{ "gate": "flutter test", "source": "lib/", "tests": "test/",
  "test_suffix": "_test.dart", "testable": ["lib/models/", "lib/repositories/"] }

{ "gate": "npx vitest run", "source": "src/", "tests": "src/",
  "test_suffix": ".test.ts", "testable": ["src/domain/", "src/lib/"] }

{ "gate": "pytest -q tests/unit", "source": "app/", "tests": "tests/unit/",
  "test_suffix": "_test.py", "testable": ["app/services/", "app/parsers/"] }
```

Vitest line is co-located: `tests` equal to `source` maps `src/cart/total.ts` → `src/cart/total.test.ts`.

## Escape hatches

- `.lexi/allow` — one test path per line, releases rewrite on those files only. Cleared when gate passes.
- `LEXI_OFF=1` — disables guard for the session. Outside the process, for emergencies.

## Development

```bash
python3 hooks/tdd_guard_test.py
```

## Known limits

- Guard matches `Edit`/`Write`/`MultiEdit`/`NotebookEdit`. Writes through `Bash` (`sed -i`, heredocs) walk past it.
- "Rewrite vs append" is substring containment, not a real diff. Hand-crafted edits could fool it.
- Guard is friction + audit trail, not a wall. An agent can write `.lexi/allow` on its own — the skill says to ask first, and the file records what was released.

## License

MIT
