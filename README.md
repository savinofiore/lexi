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

## Install

```
/plugin marketplace add savinofiore/lexi
/plugin install lexi@lexi
/lexi:init
```

From a local clone, point the marketplace at the directory instead:
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

## Pairs with

- [ponytail](https://github.com/DietrichGebert/ponytail) — the ladder that keeps
  the implementation step minimal.
- `tdd` from [mattpocock/skills](https://github.com/mattpocock/skills) — what
  makes a test worth keeping: seams, mocking, anti-patterns.
- `grilling` from the same collection — for the tasks whose scope is actually open.

lexi holds only what those cannot know: the project's gate, its testable
perimeter, and the red-green protocol with its stop conditions.

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
