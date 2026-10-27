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
`gate`, `source`, `tests`, `test_suffix` (or `mirrors`) and `testable`, and keep them: do not
re-detect or rewrite them unless the user asks to. Skip steps 1–4 and ask only
the questions this version added whose answer is missing:

- no `jev` key, or `"jev": false` (written before lexi 0.14.0, when Jev was
  optional) → step 5 (Jev). Jev is required now: `false` no longer turns it off;
- `jev` is an object but `.claude/skills/code-review/` or
  `.claude/skills/review/` is missing → write the missing shim (step 5);
- a shim that still names `jev:code-review` (written before lexi 0.12.0) → rewrite it to the
  step 5 text without asking: it is lexi's own file, and the `jev` plugin it calls is gone;
- `.claude/settings.json` `enabledPlugins` lists `jev@lexi` or `lexi-mods@lexi` → remove them
  and make sure `lexi@lexi` is `true`: both are empty stubs since 0.12.0;
- `.claude/settings.json` lacks any of the step 4 marketplaces, or one has
  `autoUpdate` other than `true` → merge it in (step 4, team install).

Then step 6. Nothing missing → say the project is up to date and run step 6
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

**Team install.** Merge into `.claude/settings.json`, keeping every other key:

```json
{
  "extraKnownMarketplaces": {
    "lexi": { "source": { "source": "github", "repo": "savinofiore/lexi" }, "autoUpdate": true },
    "ponytail": { "source": { "source": "github", "repo": "DietrichGebert/ponytail" }, "autoUpdate": true },
    "caveman": { "source": { "source": "github", "repo": "JuliusBrussee/caveman" }, "autoUpdate": true }
  },
  "enabledPlugins": { "lexi@lexi": true }
}
```

Committed, this is what reaches the rest of the team: a teammate who trusts the
folder is offered the marketplaces and lexi, and `autoUpdate` keeps lexi and
every dependency it adds current. Third-party marketplaces do not auto-update
by default, so without it each teammate stays on the version they first
installed. An existing entry for one of these marketplaces keeps its `source`;
only set `autoUpdate` to `true`.

## 5. Jev — required

Jev is part of lexi, like ponytail and caveman are: there is no opt-out. Tell the
user in one line, then go on without asking:

> Jev (model router, verbatim compaction, code review after the last GREEN)
> sends prompts, transcripts and diffs to TypeSafe's API with `TYPESAFE_API_KEY`.

Check the prerequisites. Any missing one stops `init` here: name it, the user
fixes it, then run `/lexi:init` again. You never ask for the key in chat.

- the Jev layer: part of lexi since 0.12.0; if `/lexi:code-review` is not
  in the skill list, run `/plugin update lexi@lexi` (an older install may still carry `jev@lexi`: uninstall it);
- Claude Code ≥ 2.1.276 (`claude --version`);
- `TYPESAFE_API_KEY` under `env` in `.claude/settings.local.json` — per project,
  never in a settings file that is committed. Run
  `git check-ignore -q .claude/settings.local.json`: if it fails, the file is
  tracked or not ignored. Stop and say so; the fix is `git rm --cached` plus a
  `.gitignore` line, and the user decides.

Then write, merging into existing files and never overwriting other keys:

- `.lexi.json` → `"jev": {}` (replacing a `false`) — the place for Jev's
  settings; the review step of the bug and feature flows runs either way;
- `.claude/settings.json` → under `env`: `"CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1"`
  (the plugin's hooks module stays off without it) and
  `"CLAUDE_AUTOCOMPACT_PCT_OVERRIDE": "50"` (compaction runs earlier, so Jev
  prunes while the context is still cheap to rewrite).

  The settings `env` is applied too late for the hooks-module gate: while
  Claude Code's plugin-hooks rollout is off server-side, the flag counts only
  in the environment of the `claude` process. Run
  `echo $CLAUDE_CODE_ENABLE_FUNCTION_HOOKS`; if it is not `1`, tell the user
  to add `export CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` to their shell profile
  (`~/.zshrc`, `~/.bashrc`) and restart. Each teammate needs it too. Without
  it the router stays off silently; `review.py` does not use hooks and works
  either way.

- `.claude/skills/code-review/SKILL.md` and `.claude/skills/review/SKILL.md` —
  two project shims. A project skill replaces the built-in skill of the same
  name, and `/review` needs its own file, so in this project both commands run
  Jev's review. They are meant to be committed: the whole team gets the same
  review. If either file already exists, show it and ask before replacing it.

  ```markdown
  ---
  name: code-review
  description: Code review in this project goes through Jev (lexi plugin), replacing Claude Code's built-in review. Use for "/code-review", "review the diff", "can I merge?", "is this code ok?", a PR number, a git ref or a .diff/.patch file.
  ---

  This project routes code review to Jev. Invoke the `lexi:code-review` skill
  with these arguments and follow it: ARGS_TOKEN

  If that skill is not available, the lexi plugin is missing or older than 0.12.0:
  say so and stop — do not review on your own. The fix is `/plugin update lexi@lexi`, or
  deleting `.claude/skills/code-review/` and `.claude/skills/review/` to get the
  built-in review back.
  ```

  Write `ARGS_TOKEN` as a dollar sign followed by `ARGUMENTS`, no space: Claude
  Code fills that token with the caller's arguments when the shim runs. It is
  spelled out here because in this file it would already hold init's own.

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
that count, and that Jev's prerequisites are in place. The router confirms
itself on the first prompt of the next session:
`[jev-router] session: …`.
