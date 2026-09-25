---
name: init
description: Set up lexi in a project — detect the stack, find the real gate command, choose the testable whitelist, and write .lexi.json plus .lexi/. Run once per project after installing the plugin, and again after updating lexi — on an existing .lexi.json it only asks what the new version added. Use when the user says "lexi init", "set up lexi", or the guard reports it is dormant.
---

# init — opt this project into lexi

The plugin ships the flow and the guard. This writes the project side:
`.lexi.json`, the only file the guard reads. Without it the guard is dormant and
the flow has no gate to run.

Invocation: `/lexi:init`

## 0. Already set up? Update, do not redo

`.lexi.json` exists → this is an update run, not a fresh setup. Show the current
`gate`, `source`, `tests`, `test_suffix` and `testable`, and keep them: do not
re-detect or rewrite them unless the user asks to. Skip steps 1–4 and ask only
the questions this version added whose answer is missing:

- no `jev` key → step 5 (Jev). `"jev": false` means the user already said no —
  do not ask again unless they bring it up;
- `jev` is an object but `.claude/skills/code-review/` or
  `.claude/skills/review/` is missing → write the missing shim (step 5).

Then step 6. Nothing missing → say the project is up to date and run step 6
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

## 5. Jev — mandatory question, optional feature

STOP. Ask the user this exact question and wait for a reply — do not infer an
answer, do not skip it:

> Enable Jev in this project (model router, verbatim compaction, code review
> after the last GREEN)? It calls TypeSafe's API with `TYPESAFE_API_KEY`.

No → write `"jev": false` in `.lexi.json` (so an update run does not ask again), move to step 6. Yes → check the prerequisites and name any
that is missing; the user fixes them, you never ask for the key in chat:

- the jev plugin: installed with lexi since 0.4.0; if `/jev:code-review` is not
  in the skill list, `/plugin update lexi@lexi` or `/plugin install jev@lexi`;
- Claude Code ≥ 2.1.276 (`claude --version`);
- `TYPESAFE_API_KEY` under `env` in `~/.claude/settings.json` or exported in
  the shell — never in a project settings file that is committed.

Then write, merging into existing files and never overwriting other keys:

- `.lexi.json` → `"jev": {}` — turns on the review step of the bug and
  feature flows;
- `.claude/settings.json` → under `env`: `"CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1"`
  (the plugin's hooks module stays off without it) and
  `"CLAUDE_AUTOCOMPACT_PCT_OVERRIDE": "50"` (compaction runs earlier, so Jev
  prunes while the context is still cheap to rewrite).

- `.claude/skills/code-review/SKILL.md` and `.claude/skills/review/SKILL.md` —
  two project shims. A project skill replaces the built-in skill of the same
  name, and `/review` needs its own file, so in this project both commands run
  Jev's review. They are meant to be committed: the whole team gets the same
  review. If either file already exists, show it and ask before replacing it.

  ```markdown
  ---
  name: code-review
  description: Code review in this project goes through Jev (jev plugin), replacing Claude Code's built-in review. Use for "/code-review", "review the diff", "can I merge?", "is this code ok?", a PR number, a git ref or a .diff/.patch file.
  ---

  This project routes code review to Jev. Invoke the `jev:code-review` skill
  with these arguments and follow it: $ARGUMENTS

  If that skill is not available, the jev plugin is not installed: say so and
  stop — do not review on your own. The fix is `/plugin install jev@lexi`, or
  deleting `.claude/skills/code-review/` and `.claude/skills/review/` to get the
  built-in review back.
  ```

  `review/SKILL.md` is the same file with `name: review` and `"/review"` in
  place of `"/code-review"` in the description.

Say that the project's own conventions can be added to the review later in
`.lexi/review.json` (see the jev README) — do not write that file now.

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
that count, and whether Jev is on (with any missing prerequisite). With Jev on,
the router confirms itself on the first prompt of the next session:
`[jev-router] session: …`.
