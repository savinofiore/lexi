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

lexi is deliberately small because it delegates. It owns the protocol — the
gate, the testable perimeter, the red-green loop and its stop conditions — and
nothing else. How to write code, what makes a test worth keeping and how to
interrogate an open scope are all answered by plugins that already do it well,
so lexi calls them instead of restating them.

**All three are required.** Without them lexi still runs, but each missing
plugin removes a step it hands off rather than a step it performs itself:

| plugin | what lexi hands to it | when |
|---|---|---|
| [ponytail](https://github.com/DietrichGebert/ponytail) | the ladder that keeps the implementation minimal — reuse before writing, stdlib before custom, one line before fifty | every GREEN step |
| [`tdd`](https://github.com/mattpocock/skills) (mattpocock-skills) | what a good test is: seams, mocking, the anti-patterns, why vertical slices beat bulk tests | before and during the loop |
| [`grilling`](https://github.com/mattpocock/skills) (same plugin) | rounds of questions that settle a genuinely open scope | step 1, opt-in |

Restating their content inside lexi would mean paying for the same context
twice and maintaining a stale copy of someone else's work. That duplication is
the exact failure this plugin was built to remove.

## Install

Dependencies first, lexi last:

```
/plugin marketplace add DietrichGebert/ponytail
/plugin install ponytail@ponytail

/plugin install mattpocock-skills@claude-plugins-official

/plugin marketplace add savinofiore/lexi
/plugin install lexi@lexi

/lexi:init
```

`mattpocock-skills` ships both `tdd` and `grilling`, and lives in the official
marketplace, which is already registered in a stock Claude Code install. From a
local clone of lexi, point the marketplace at the directory instead:
`/plugin marketplace add /path/to/lexi`.

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
