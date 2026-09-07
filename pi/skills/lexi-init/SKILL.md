---
name: lexi-init
description: Set up lexi in a project — detect the stack, find the real gate command, choose the testable whitelist, and write .lexi.json plus .lexi/. Run once per project after installing the plugin. Use when the user says "lexi init", "set up lexi", or the guard reports it is dormant.
---

> **Pi:** invoke this skill with `/skill:lexi-init`.


# init — opt this project into lexi

The plugin ships the flow and the guard. This writes the project side:
`.lexi.json`, the only file the guard reads. Without it the guard is dormant and
the flow has no gate to run.

## 1. Detect the stack

`pubspec.yaml` → Dart/Flutter · `package.json` → Node/TS · `pyproject.toml` or
`setup.py` → Python · `go.mod` → Go · `Cargo.toml` → Rust. Several, or none you
recognise → ask. Confirm what you found, do not assume.

## 2. Find the real gate command — do not invent one

Look for what the project already runs: `scripts` in `package.json`, a Makefile
target, CI config (`.github/workflows/`, `codemagic.yaml`, `.gitlab-ci.yml`), an
existing test script under `scripts/` or `tool/`. Propose that, and say where you
found it.

The gate must be **deterministic and offline**: unit tests only. Anything that
needs a device, a browser, a network or a real clock is not a gate — it is a
suite you run elsewhere. If the project's test command pulls those in, propose
the narrowest command that does not, and say what you excluded.

## 3. Choose `testable` — a narrow whitelist

Only paths where a deterministic unit test is both possible and worth writing:
domain models and parsing, repositories and clients over a mocked transport,
pure logic, state containers and reducers.

Everything not listed is free to edit with no test, by design: UI, widget and
component layers, design tokens, generated code, platform and plugin bindings,
declaration-only files. That is the point of a whitelist — the guard bites on
logic and stays out of the layers where a unit test would be theatre. A guard
that taxes every edit gets bypassed, and then it protects nothing.

Propose the list from what the repo actually contains, and state what you left
out and why. Err narrow: a path can be added later, and each addition should be
a decision, not a default.

## 4. Write the files

`.lexi.json` at the project root:

```json
{
  "gate": "flutter test",
  "source": "lib/",
  "tests": "test/",
  "test_suffix": "_test.dart",
  "testable": ["lib/models/", "lib/repositories/", "lib/utils/"]
}
```

The mirror rule is fixed: `<source><rel>.<ext>` → `<tests><rel><test_suffix>`,
so `lib/models/user.dart` → `test/models/user_test.dart`. Co-located tests work
too — set `tests` equal to `source` and `test_suffix` to `.test.ts`, giving
`src/cart/total.ts` → `src/cart/total.test.ts`.

Then create `.lexi/` containing an empty `allow` file, and add `.lexi/allow` to
`.gitignore` — it is per-task scratch, not shared state.

## 5. Gate subagent — mandatory question, optional feature

STOP. Before writing any file, ask the user this exact question and wait for
a reply — do not infer an answer, do not skip it because a gate command was
found, do not proceed to step 6 without it:

> Want the gate offloaded to a subagent (`lexi-gate`), or run it inline?

If inline — no `gate_agent` key, move to step 6. If subagent:

1. Run `pi --list-models`, show the table, ask which model runs the gate. A
   fast/cheap one is enough — the job is "run one command, report pass/fail",
   not reasoning.
2. Write `.pi/agents/lexi-gate.md`:

```markdown
---
name: lexi-gate
description: Runs the project's lexi gate command and reports pass/fail.
tools: bash
model: <chosen model id, e.g. anthropic/claude-haiku-4-5>
---

Run exactly the command given in the task, once. Do not edit files. Report:
- PASS, or
- FAIL, with only the failing assertion/stack trace — not the full log.
```

3. Add `"gate_agent": true` to `.lexi.json`.

## 6. Verify before declaring done

1. Run the gate command once. It has to pass, or the starting state is already
   broken and the user needs to know that first.
2. Take a test file that already exists in the repo and check the mirror rule
   resolves to it from its source file. If it does not, the config is wrong —
   fix the config, never move the project's files to satisfy it.
3. Count the source files under `testable` with no mirror test. Report the
   number. Do not fix it: that is the standing debt, and the guard will surface
   it one file at a time as the code gets touched.

Report the gate command, the `testable` list, what you deliberately left out,
that count, and — if set — the model running the gate subagent.
