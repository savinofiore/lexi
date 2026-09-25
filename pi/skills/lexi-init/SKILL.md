---
name: lexi-init
description: Set up lexi in a project — detect the stack, find the real gate command, choose the testable whitelist, and write .lexi.json plus .lexi/. Run once per project after installing the plugin, and again after updating lexi — on an existing .lexi.json it only asks what the new version added. Use when the user says "lexi init", "set up lexi", or the guard reports it is dormant.
---

> **Pi:** invoke this skill with `/lexi-init` — a bare `/skill:lexi-init` carries
> no request and the model only waits for a task.

**Loading this skill is the request.** Do not wait for a task — start with the required packages
now, in the project the session is running in.

# init — opt this project into lexi

The plugin ships the flow and the guard. This writes the project side:
`.lexi.json`, the only file the guard reads. Without it the guard is dormant and
the flow has no gate to run.

## Required packages — every run, fresh or update

lexi needs ponytail and caveman. Pi cannot install one package from another, so
check `pi list` (or `packages` in `.pi/settings.json`) for
`git:github.com/DietrichGebert/ponytail` and `git:github.com/JuliusBrussee/caveman`.
Install whichever is missing with `pi install -l <source>`, then tell the user to
run `/reload`.

## 0. Already set up? Update, do not redo

`.lexi.json` exists → this is an update run, not a fresh setup. Show the current
`gate`, `source`, `tests`, `test_suffix`, `testable` and `gate_agent`, and keep
them: do not re-detect or rewrite them, and do not re-ask the gate subagent
question, unless the user asks to. Skip steps 1–5 and ask only the questions
this version added whose answer is missing:

- no `jev` key → step 6 (Jev). `"jev": false` means the user already said no —
  do not ask again unless they bring it up.

Then step 7. Nothing missing → say the project is up to date and run step 7
only.

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

If inline — no `gate_agent` key, move to step 6. If subagent, ask these in
order:

1. **Which model?** Run `pi --list-models`, show the table, let the user pick.
   A fast/cheap one is enough — the job is "run one command, report
   pass/fail", not reasoning.
2. **What do you want it to do, beyond running the gate and reporting
   pass/fail?** Default is nothing extra. Fold any answer into the prompt
   below as-is — do not invent scope it didn't ask for.

Write `.pi/agents/lexi-gate.md` with the answers:

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

<user's extra instructions from question 2, if any>
```

Add `"gate_agent": true` to `.lexi.json`.

## 6. Jev — mandatory question, optional feature

STOP. Ask the user this exact question and wait for a reply — do not infer an
answer, do not skip it:

> Enable Jev in this project (model router, verbatim compaction, code review
> after the last GREEN)? It calls TypeSafe's API with `TYPESAFE_API_KEY`.

No → write `"jev": false` in `.lexi.json` (so an update run does not ask again), move to step 7. Yes → the key must be exported in the shell
Pi starts from (`export TYPESAFE_API_KEY=...`), or sit under `env` in
`~/.claude/settings.json` as a fallback. Name it if missing; never ask for the
key in chat. Then ask:

1. **Which model per tier?** The router moves between three tiers: `fast`
   (mechanical work), `balanced` (ordinary engineering), `deep` (hard or
   high-stakes). Run `pi --list-models`, show the table, propose one model per
   tier, let the user confirm or change. Defaults if the user keeps them:
   `claude-sonnet-5`, `claude-opus-5-5`, `claude-fable-5-1`, resolved on the
   provider the session already runs on (a `claude-bridge` session stays on
   the bridge). Propose the same: bare ids unless the user wants a tier on
   another provider.

Write, merging into existing files and never overwriting other keys:

- `.lexi.json` → `"jev": { "tiers": { "fast": "<id>", "balanced": "<id>", "deep": "<id>" } }`
  (omit `tiers` if the user kept the defaults; `provider/id` pins a tier to
  that provider, a bare id follows the session's provider). The `jev` key is what turns on
  the router and compaction extensions and the review step of the flows.
- `.pi/settings.json` → `compaction.modelOverrides`: for each tier model, set
  `reserveTokens` to half its context window from the `pi --list-models` table,
  so compaction runs at ~50% and Jev prunes while the context is still cheap
  to rewrite:

  ```json
  { "compaction": { "modelOverrides": { "anthropic/claude-opus-5-5": { "reserveTokens": 500000 } } } }
  ```

Say that the project's own conventions can be added to the review later in
`.lexi/review.json` (see the jev README) — do not write that file now.

## 7. Verify before declaring done

1. Run the gate command once. It has to pass, or the starting state is already
   broken and the user needs to know that first.
2. Take a test file that already exists in the repo and check the mirror rule
   resolves to it from its source file. If it does not, the config is wrong —
   fix the config, never move the project's files to satisfy it.
3. Count the source files under `testable` with no mirror test. Report the
   number. Do not fix it: that is the standing debt, and the guard will surface
   it one file at a time as the code gets touched.

Report the gate command, the `testable` list, what you deliberately left out,
that count, and — if set — the model running the gate subagent and the Jev
tiers.
