# lexi

Test-first workflow for coding agents, without the spec ceremony.

The tests are the spec. There is no directive to write, no document to re-read,
no `STATE: APPROVED` to edit by hand, and nothing to clean up when the task is
done — the tests stay in the repository, which is where they were going anyway.

## What it does

```
task → [grill, only if the scope is open] → seams confirmed in one message
     → per slice: RED → minimal implementation → GREEN → next slice
```

Two things are enforced by a hook rather than by prose:

| rule | effect |
|---|---|
| a source file under `testable` cannot be written before its mirror test exists | test-first, mechanically |
| a git-tracked test file cannot have its assertions rewritten | no adapting the test to the code |

Appending a test to a tracked file is allowed. Rewriting one is a breaking
change: it gets agreed with the user first and recorded in `.lexi/allow`.

Everything outside `testable` — UI layers, design tokens, generated code,
platform bindings — is free to edit with no test. The whitelist is deliberately
narrow, so the guard bites on logic and never taxes a one-line style fix.

## Requires

One external plugin:

```
/plugin marketplace add DietrichGebert/ponytail
/plugin install ponytail@ponytail
```

[ponytail](https://github.com/DietrichGebert/ponytail) governs every GREEN step
— does this need to exist, is it already in the codebase, does the stdlib or the
platform do it, can it be one line. It is ambient once installed, and lexi does
not restate it: writing less code is a whole discipline and someone already
maintains it.

The other two halves ship with lexi, as skills rather than dependencies:

| skill | what it holds |
|---|---|
| `lexi:tdd` | what makes a test worth keeping — seams, assertions, mocking, the anti-patterns, why coverage is a diagnostic and not a target |
| `lexi:grill` | rounds of questions that settle a genuinely open scope before anything is written |

Neither is novel ground — seams, the assertion-independence rule and the
anti-patterns are decades old, and [mattpocock/skills](https://github.com/mattpocock/skills)
covers the same territory in a larger collection worth reading. They live here
because lexi needs exactly these two and installing twenty-five skills to reach
them is a bad trade.

## Install

Dependencies first, lexi last:

```
/plugin marketplace add DietrichGebert/ponytail
/plugin install ponytail@ponytail

/plugin marketplace add savinofiore/lexi
/plugin install lexi@lexi

/lexi:init
```

From a local clone, point the marketplace at the directory instead —
the path must be absolute:

```
/plugin marketplace add /absolute/path/to/lexi
```

Outside a session the same three steps work from the shell:

```
claude plugin marketplace add savinofiore/lexi
claude plugin install lexi@lexi
claude plugin details lexi@lexi   # 4 skills, 1 PreToolUse hook
```

Without `.lexi.json` the guard is dormant and nothing changes — a project opts
in explicitly.

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

Mirror rule: `<source><rel>.<ext>` → `<tests><rel><test_suffix>`. Co-located
tests work by setting `tests` equal to `source`.

## Usage

Three entry points, and only the first is run by hand:

| command | when |
|---|---|
| `/lexi:init` | once per project, to write `.lexi.json` |
| `/lexi:lexi` | a task, feature or bug — drives the whole flow |
| `/lexi:grill` | on its own, to settle a scope before committing to any code |

`/lexi:tdd` is reference material the flow pulls in by itself. The guard needs no
invocation: it runs on every `Edit`/`Write` once `.lexi.json` exists.

Two tasks below, on the same Node project — one clear enough to start
immediately, one that gets interrogated first. The difference is the only
judgement call the flow asks you to make.

### Case 1 — clear scope, one file

`.lexi.json`, written by `/lexi:init`:

```json
{
  "gate": "npm test",
  "source": "src/",
  "tests": "tests/",
  "test_suffix": ".test.js",
  "testable": ["src/domain/"]
}
```

The task names the behaviour and the file. One defensible design, nothing to
settle — no grill:

```
/lexi:lexi in src/domain/discount.js add applyDiscount(total, pct),
capped at 50%
```

**Step 2 — the seams, in one message.** This is the only checkpoint, and the
flow stops here until you answer:

```
seam: applyDiscount(total, pct) in src/domain/discount.js
      mirror: tests/domain/discount.test.js

slices:
  1. applies a percentage      applyDiscount(100, 10) -> 90
  2. caps at 50%               applyDiscount(100, 90) -> 50
  3. rejects a negative pct    applyDiscount(100, -1) -> throws RangeError

retro-compatible: only new tests, no existing assertion changes
outside testable: the cart summary component, no test
```

**Step 3 — one slice at a time.** Slice 1 RED first:

```js
// tests/domain/discount.test.js
test('applies a percentage', () => {
  assert.equal(applyDiscount(100, 10), 90);
});
```

`npm test` → red, `Cannot find module './discount.js'`. That is a setup error,
not a valid red — the flow writes the module stub, gets the real red
(`undefined !== 90`), and only then the green:

```js
// src/domain/discount.js
export const applyDiscount = (total, pct) => total - total * (pct / 100);
```

`npm test` → green. Slice 2 next, and the cap lands as the one change that makes
its test pass. Never all three tests up front.

### Case 2 — open scope, grill first

Same project, a task with no single right shape: where codes live, whether they
stack, what they apply to, and how a rejection surfaces are all product
decisions, and guessing any of them writes a test against imagined behaviour.

```
/lexi:lexi support promo codes at checkout
```

**What it does not ask you.** Anything the repo can answer, it answers itself,
and says so before the questions start:

```
facts, not questions:
  src/domain/cart.js exports total(lines) only — no promo anything
  testable is src/domain/ — PromoField.jsx gets no test
  zero deps, gate `npm test` currently green, 1 test
```

**Round 1 — the whole frontier at once, each with a recommendation:**

```
❓ Q1 — source of truth: hardcoded table, our API, or the payment provider?
➡️  Our API. The table cannot expire a code, the provider ties you to it.

❓ Q2 — stacking: one code per order, or several?
➡️  One. Stacking is a pricing rule engine, and nobody asked for one.

❓ Q3 — what a code discounts: order total, line items, or shipping?
➡️  Order total. Line-item scoping needs a category model that does not exist.

❓ Q4 — a rejected code: throw, or a result the UI can render?
➡️  Result object. "expired" and "not found" read differently to a buyer.

held for round 2, each blocked on an answer above:
  behaviour when the source is unreachable (needs Q1)
  a second code entered (needs Q2), rounding and floor at zero (needs Q3)
```

Then it stops. Those held questions come back only once their prerequisite is
settled — asked now, they would collect a guess:

```
❓ Q5 — the API is the source: what happens when it is down at checkout?
➡️  Fail open, no discount, order still completes. Losing the sale is worse.

❓ Q6 — one code per order: a second code entered replaces, or is rejected?
➡️  Replaces. Rejecting makes the buyer hunt for a clear button.
```

Frontier empty → the interview ends and step 2 posts the seams, now across
three files:

```
seams:
  validatePromo(code) in src/domain/promo.js
      mirror: tests/domain/promo.test.js
  PromoClient.fetch(code) in src/domain/promo_client.js  (mocked transport)
      mirror: tests/domain/promo_client.test.js
  applyPromo(cart, promo) in src/domain/cart.js
      mirror: tests/domain/cart.test.js

slices:
  1. rejects an unknown code          -> { ok: false, reason: 'not_found' }
  2. rejects an expired code          -> { ok: false, reason: 'expired' }
  3. applies a valid code to the total
  4. a second code replaces the first
  5. API unreachable -> no discount, cart still checks out

breaking: tests/domain/cart.test.js, 'total is the sum of line items'
          asserts a total that ignores promo — slice 3 changes it
outside testable: src/components/PromoField.jsx, no test
```

Five slices, five red→green loops, in that order. The interview cost two
messages and bought a test list that matches what was actually wanted.

### What the guard blocks

Touch the source before the test exists and the write does not happen:

```
lexi — write to `src/domain/discount.js` BLOCKED.

`src/domain/discount.js` is under a `testable` path and its mirror test does
not exist yet:
  tests/domain/discount.test.js
```

Edit a committed test so an assertion reads differently and it does not happen
either:

```
lexi — edit to `tests/domain/total.test.js` BLOCKED.

This test file is tracked by git and the edit replaces existing content rather
than adding to it. Rewriting an assertion to reach green is the one move this
guard exists to stop.
```

What stays free, with no test and no prompt:

```
src/components/card.js     outside `testable`
tests/domain/new.test.js   untracked, the test you are about to write
tests/domain/total.test.js appending a new case, existing ones intact
```

### A breaking change

Case 2, slice 3. `'total is the sum of line items'` asserts a total that ignores
promo, and it was named as breaking back in step 2 — that agreement is what makes
the next line legal:

```
echo tests/domain/cart.test.js >> .lexi/allow
```

Rewrite that one test to the new expected total, run the gate, then empty the
file — the release covers one slice, not the rest of the task:

```
: > .lexi/allow
```

The flow asks before writing that line, and an assertion discovered "obsolete"
mid-implementation is not covered by step 2's agreement: it stops and asks again.
`.lexi/allow` is per-task scratch, gitignored by `/lexi:init` — what it holds is
what was released, and when.

### Other stacks

```json
{ "gate": "flutter test", "source": "lib/", "tests": "test/",
  "test_suffix": "_test.dart", "testable": ["lib/models/", "lib/repositories/"] }

{ "gate": "npx vitest run", "source": "src/", "tests": "src/",
  "test_suffix": ".test.ts", "testable": ["src/domain/", "src/lib/"] }

{ "gate": "pytest -q tests/unit", "source": "app/", "tests": "tests/unit/",
  "test_suffix": "_test.py", "testable": ["app/services/", "app/parsers/"] }
```

The Vitest line is the co-located case: `tests` equal to `source` maps
`src/domain/cart.ts` → `src/domain/cart.test.ts`.

## Escape hatches

- `.lexi/allow` — one test path per line, releases a rewrite on those files only.
- `LEXI_OFF=1` — disables the guard for the session. Outside the process, for
  emergencies.

## Development

```
python3 hooks/tdd_guard_test.py
```

## Known limits

- The guard matches `Edit`/`Write`/`MultiEdit`/`NotebookEdit`. Writes through
  `Bash` (`sed -i`, heredocs) walk past it.
- "Rewrite vs append" is substring containment, not a real diff. It reads an
  append as an append and a rewritten assertion as a rewrite; a hand-crafted
  edit could still fool it.
- The guard is friction plus an audit trail, not a wall. An agent can write to
  `.lexi/allow` on its own — the skill says to ask first, and the file records
  what was released.

## License

MIT
