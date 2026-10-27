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
`gate`, `source`, `tests`, `test_suffix` (or `mirrors`), `testable` and `gate_agent`, and keep
them: do not re-detect or rewrite them, and do not re-ask the gate subagent
question, unless the user asks to. Skip steps 1–5 and ask only the questions
this version added whose answer is missing:

- no `jev` key, or `"jev": false` (written before lexi 0.14.0, when Jev was
  optional) → step 6 (Jev). Jev is required now: `false` no longer turns it off.

Then step 7. Nothing missing → say the project is up to date and run step 7
only.

## 1. Detect the stack

`package.json` → Node/TS · `pyproject.toml` or `setup.py` → Python ·
`pom.xml` or `build.gradle(.kts)` → Java/Kotlin · `*.csproj` → C# · `go.mod` → Go ·
`Cargo.toml` → Rust · `Gemfile` → Ruby · `composer.json` → PHP ·
`pubspec.yaml` → Dart/Flutter. Several (a monorepo), or none you recognise → ask.
Confirm what you found, do not assume.

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
  "gate": "npm test",
  "source": "src/",
  "tests": "test/",
  "test_suffix": ".test.ts",
  "testable": ["src/domain/", "src/repositories/", "src/parsers/"]
}
```

The default mirror rule: `<source><rel>.<ext>` → `<tests><rel><test_suffix>`,
so `src/domain/user.ts` → `test/domain/user.test.ts`. Co-located tests work
too — set `tests` equal to `source`, giving `src/cart/total.ts` →
`src/cart/total.test.ts`. Java and Kotlin fit it as well: `src/main/java/` →
`src/test/java/` with `Test.java`.

When the project's tests do not end in a suffix, or live under more than one
root, write `mirrors` instead of `source`/`tests`/`test_suffix`: a list of
`{ "source", "test" }`, first match wins. In `test`, `{dir}` is the folder under
`source` and `{name}` the file name without its extension:

```json
"mirrors": [
  { "source": "app/", "test": "tests/{dir}test_{name}.py" },
  { "source": "packages/api/src/", "test": "packages/api/src/{dir}__tests__/{name}.test.ts" }
]
```

Read the mirror off the tests the repo already has; never pick a convention
the project does not use. Code whose tests sit inside the source file (Rust's
`#[cfg(test)]`) has no mirror the guard can check: leave it out of `testable`.

Then create `.lexi/` containing an empty `allow` file, and add `.lexi/allow` to
`.gitignore` — it is per-task scratch, not shared state.

## 5. Gate subagent — mandatory question, optional feature

Before writing any file, ask the user this question and wait for the answer,
even when a gate command was found — where the gate runs is their call:

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
model: <chosen model id, e.g. anthropic/claude-haiku-5-5>
---

Run exactly the command given in the task, once. Do not edit files. Report:
- PASS, or
- FAIL, with only the failing assertion/stack trace — not the full log.

<user's extra instructions from question 2, if any>
```

Add `"gate_agent": true` to `.lexi.json`.

## 6. Jev — required

Jev is part of lexi, like ponytail and caveman are: there is no opt-out. Tell the
user in one line, then go on without asking:

> Jev (model router, verbatim compaction, code review after the last GREEN)
> sends prompts, transcripts and diffs to TypeSafe's API with `TYPESAFE_API_KEY`.

The key goes under `env` in `.claude/settings.local.json` (a shell export also
works). Run `git check-ignore -q .claude/settings.local.json`: if it fails, the
file is tracked or not ignored — stop and say so. A missing key stops `init`
here: name it, the user adds it, then run init again; never ask for it in chat.
Then ask:

1. **Which model per tier?** The router moves between three tiers: `fast`
   (mechanical work), `balanced` (ordinary engineering), `deep` (hard or
   high-stakes). Run `pi --list-models`, show the table, propose one model per
   tier, let the user confirm or change. Defaults if the user keeps them:
   `claude-sonnet-5-5`, `claude-opus-5-5`, `claude-opus-5-5` (`deep` is Opus at
   a higher effort), resolved on the
   provider the session already runs on (a `claude-bridge` session stays on
   the bridge). Propose the same: bare ids unless the user wants a tier on
   another provider.

Write, merging into existing files and never overwriting other keys:

- `.lexi.json` → `"jev": { "tiers": { "fast": "<id>", "balanced": "<id>", "deep": "<id>" } }`
  (omit `tiers` if the user kept the defaults; `provider/id` pins a tier to
  that provider, a bare id follows the session's provider). The `jev` key only holds
  settings: with `.lexi.json` present the router, compaction and review run either way.
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
