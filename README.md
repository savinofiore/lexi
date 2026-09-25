# lexi

Test-first workflow for coding agents: analyze task, propose unit tests, confirm, execute RED→GREEN cycle. No spec documents, no cleanup after. Tests are the spec and stay in the repository.

Ships for two agent runtimes: **Claude Code** (plugin) and **Pi** (`@earendil-works/pi-coding-agent`, pi package). Same skills, same guard, same flow — different install path and invocation syntax per runtime.

Companion: **[jev](jev/README.md)**, a decision layer on TypeSafe's Jev that picks model and effort per session, compacts context without rewriting it, and reviews the diff after the last GREEN with a verdict computed in code. Installed with lexi on Claude Code (`jev@lexi`, a dependency since 0.4.0) and shipped inside the Pi package; off in a project until `init` turns it on.

## What it does

Three paths from the router skill:

**Bug fix:**
```
bug report → identify failing tests → rewrite tests to RED (prove bug)
          → fix production code to GREEN → [Jev review] → report
```

**Feature with clear scope:**
```
feature → propose 3-5 unit tests → confirm + additions
       → test RED → code GREEN (repeat per test) → [Jev review] → report
```

**Feature with open scope:**
```
feature → interrogate with the grill skill → settle decisions
       → propose tests based on decisions → confirm
       → test RED → code GREEN (repeat) → [Jev review] → report
```

`[Jev review]` runs only when the project enabled Jev in `init`: the verdict comes from the policy, fixes
are proposed and confirmed, and a fix under `testable` goes back through RED→GREEN. See [jev](jev/README.md).

## How it enforces test-first

Two rules, enforced by a hook (Claude Code) / extension (Pi):

| Rule | Effect |
|---|---|
| Source file under `testable` cannot be written before its mirror test exists | Write test first, mechanically |
| Committed test cannot have assertions rewritten | No cheating: rewrite test assertions to reach green |

Appending new tests to an existing file is allowed. Rewriting existing assertions is a breaking change: it gets flagged as such in step 2, recorded in `.lexi/allow`, and cleared when the gate passes.

Everything outside `testable` (UI, design tokens, generated code, platform bindings) stays free to edit with no test.

## Requires

| What | Needed for | Check |
|---|---|---|
| **Python 3** as `python3` | the guard on both runtimes (`hooks/tdd_guard.py`), and jev's review | `python3 --version` |
| **[ponytail](https://github.com/DietrichGebert/ponytail)** | Claude Code only: governs every GREEN step (does it need to exist, is it already here, does stdlib do it, can it be one line). Declared in lexi's `plugin.json` `dependencies`, installed with lexi. Pi has no port: lexi's Pi skills carry the same ladder inline | `/plugin` lists it |
| **[caveman](https://github.com/JuliusBrussee/caveman)** | Terse output in every session. Claude Code: declared in lexi's `plugin.json` `dependencies`, so installing lexi installs it once its marketplace is added. Pi: install the package (`/lexi-init` does it if missing); lexi's `caveman` extension keeps its rules on every turn and warns at session start when it is missing | `/plugin` / `pi list` |
| **[pi-subagents](https://www.npmjs.com/package/pi-subagents)** | Pi only, optional: runs the gate in an isolated subagent | `pi list` |
| **`TYPESAFE_API_KEY`** | jev only, optional | see [jev](jev/README.md#requirements) |
| **Claude Code ≥ 2.1.276** | jev's router and compaction hooks | `claude --version` |

Without Python every guarded edit fails instead of being checked. macOS and most Linux distributions already
have it; on Windows install it and verify `python3 --version` answers.

**What ships**

| Skill | Owns |
|---|---|
| `init` | Project setup: detect stack, find gate command, choose testable paths, ask about Jev, write `.lexi.json` |
| `lexi` | Router: directs bug/feature/grill/manual flows |
| `bug` | Bug fix: rewrite existing tests to prove bug, fix code |
| `feature` | Feature: propose unit tests, confirm, RED→GREEN cycle |
| `grill` | Scope interrogation: settle open decisions in rounds before writing anything |
| `tdd` | Reference: seams, assertions, mocking, anti-patterns, when to test |
| `code-review` (jev) | Jev review of a diff; the bug and feature flows call it after the last GREEN when Jev is on |

On Claude Code the first six are the `lexi` plugin and `code-review` is the separate `jev` plugin. On Pi all
seven come in the one lexi package, named `lexi-*` and `jev-code-review`.

## Install — Claude Code

**1. Plugins** — add the dependencies' marketplaces, then lexi (it installs ponytail and caveman), jev only if you want it:

```
/plugin marketplace add DietrichGebert/ponytail   # lexi installs ponytail from here
/plugin marketplace add JuliusBrussee/caveman     # and caveman from here

/plugin marketplace add savinofiore/lexi
/plugin install lexi@lexi       # installs ponytail, caveman and jev too
```

From a shell, outside Claude:

```bash
claude plugin marketplace add savinofiore/lexi
claude plugin install lexi@lexi
```

**2. Jev key** (only with jev) — in `~/.claude/settings.json`, never in a committed project file:

```json
{ "env": { "TYPESAFE_API_KEY": "..." } }
```

**3. Verify** — restart the session and run `/plugin`:

- `lexi`: **6 skills** (`init`, `lexi`, `bug`, `feature`, `tdd`, `grill`) and **1 PreToolUse hook**;
- `jev`: **1 skill** (`code-review`) and **1 hooks module**.

**4. Opt the project in** — open `claude` in the project folder, accept the trust prompt (Claude Code reads
the project's settings only in a trusted folder), then:

```
/lexi:init
```

`init` writes `.lexi.json` and asks whether to enable Jev. On yes it adds `"jev": {}` to `.lexi.json`, puts
`CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` and `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=50` in `.claude/settings.json`, and
writes two project shims, `.claude/skills/code-review/` and `.claude/skills/review/`: a project skill replaces
the built-in one of the same name, so in that project `/code-review` and `/review` run Jev's review. Delete
the two folders to get the built-in review back. The next session confirms the router on its first prompt:
`[jev-router] session: …`.

### Local development (Claude Code)

Only for working *on* lexi. The marketplace takes its name from the manifest, so the clone and GitHub version
cannot coexist.

Local (edits to `hooks/`, `skills/` and `jev/` live immediately):

```
/plugin marketplace add /absolute/path/to/lexi
/plugin install lexi@lexi
```

For one session only, without touching your installed plugins:

```bash
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude --plugin-dir /absolute/path/to/lexi/jev
```

Back to GitHub:

```
/plugin uninstall jev@lexi
/plugin uninstall lexi@lexi
/plugin marketplace remove lexi
/plugin marketplace add savinofiore/lexi
/plugin install lexi@lexi
```

## Install — Pi

Lexi ships as one **pi package**, declared in `package.json`'s `pi` field:

- `pi/extensions/lexi-guard.ts`: the guard, wrapping the same `hooks/tdd_guard.py`;
- `pi/extensions/lexi-init.ts`: the `/lexi-init` command;
- `pi/extensions/caveman.ts`: caveman's rules on every turn, off with "stop caveman" or "normal mode";
- `pi/extensions/jev-router/`, `pi/extensions/jev-compact/`: jev, inert until a project opts in;
- `pi/skills/`: `lexi-init`, `lexi-lexi`, `lexi-bug`, `lexi-feature`, `lexi-grill`, `lexi-tdd`, `jev-code-review`.

**1. Packages** — the optional subagent extension first, lexi last:

```
pi install npm:pi-subagents                  # optional: gate in a subagent
pi install git:github.com/JuliusBrussee/caveman
pi install git:github.com/savinofiore/lexi
```

From a local clone, for development (edits to `pi/` and `jev/` live immediately):

```
pi install /absolute/path/to/lexi
```

**2. Jev key** (only if you will enable Jev) — export it in the shell Pi starts from; Pi has no `env` block,
so as a fallback it reads `env.TYPESAFE_API_KEY` from `~/.claude/settings.json`:

```bash
export TYPESAFE_API_KEY=...
```

**3. Opt the project in** — Pi loads project files only in an approved folder (accept the prompt once, or
`pi -a` for one run), then:

```
/lexi-init
```

Use `/lexi-init`, not `/skill:lexi-init`: the bare skill command sends no request, and the model only answers
that it is waiting for a task.

`init` asks two mandatory questions besides the gate and the testable paths:

- **gate subagent** — with pi-subagents installed, which model runs the gate; it writes
  `.pi/agents/lexi-gate.md` and `"gate_agent": true`. Say inline to keep the gate in the driving model;
- **Jev** — on yes, which model per tier (`pi --list-models`); it writes `"jev": { "tiers": … }` in
  `.lexi.json` and `compaction.modelOverrides` in `.pi/settings.json`, so compaction runs at ~50%.

Without the `jev` key the jev extensions do nothing, even though the package is installed.

### Invocation on Pi

Pi has no `/lexi:` namespace or Skill-tool convention — each skill is its own top-level command, `/skill:lexi-<name>`:

| Claude Code | Pi |
|---|---|
| `/lexi:init` | `/lexi-init` |
| `/lexi:lexi <description>` | `/skill:lexi-lexi <description>` |
| `/lexi:bug <description>` | `/skill:lexi-bug <description>` |
| `/lexi:feature <description>` | `/skill:lexi-feature <description>` |
| `/lexi:grill <description>` | `/skill:lexi-grill <description>` |
| `/lexi:tdd` | `/skill:lexi-tdd` |
| `/jev:code-review` | `/skill:jev-code-review` |

The guard itself needs no invocation on either runtime — it runs on every edit/write once `.lexi.json` exists.

## Updating

An update never breaks a project that is already set up: the guard reads only its own keys in `.lexi.json`,
and every new step stays off until the project opts in (the Jev review runs only when `jev` is an object).

**Claude Code**

```
/plugin marketplace update lexi
/plugin update lexi@lexi          # since 0.4.0 this also installs jev
```

**Pi**

```
pi update git:github.com/savinofiore/lexi
```

The jev extensions arrive with the package but stay inert without a `jev` object in `.lexi.json`.

**Then, per project, rerun init** (`/lexi:init` or `/lexi-init`). On an existing `.lexi.json` it runs
as an update: it shows and keeps `gate`, `testable` and the rest, and asks only what the new version added —
today the Jev question. On Pi it also installs ponytail or caveman if missing. A "no" is saved as `"jev": false`, so the next update run does not ask again. Skipping
this step is fine: the project keeps working exactly as before, without Jev.

## Configuration

`.lexi.json`, written by the init skill (same file, same format, both runtimes):

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

**Pi only — `gate_agent`**: set by `init` when the user opts in and a model is
picked. Its presence means "run the gate through the `lexi-gate` subagent",
named in `.pi/agents/lexi-gate.md` next to it:

```json
{ "gate": "npx vitest run", "gate_agent": true, "...": "..." }
```

Absent (default) — the gate runs inline, in the driving model's own context,
exactly as before. Claude Code has no subagent equivalent and ignores this key.

**`jev`**: set by `init` when the user enables Jev. Its presence turns on the
review step after the last GREEN (both runtimes) and, on Pi, the router and
compaction extensions. See [jev/README.md](jev/README.md) for `tiers` and the
project conventions file `.lexi/review.json`.

```json
{ "gate": "npx vitest run", "jev": {}, "...": "..." }
```

## Commands

Claude Code syntax shown; see [Invocation on Pi](#invocation-on-pi) for the Pi equivalent of each.

| Command | Use when |
|---|---|
| `/lexi:init` | Once per project to setup |
| `/lexi:lexi <description>` | Task, feature, or bug — routes to bug/feature/grill/manual |
| `/lexi:bug <description>` | Bug report with broken behavior |
| `/lexi:feature <description>` | Feature with clear scope |
| `/lexi:grill <description>` | Feature with open scope (optional, feature can call it) |
| `/lexi:tdd` | Reference material for test quality |
| `/jev:code-review` | Jev review of the working tree, a ref, a PR or a diff (jev plugin; the flows call it on their own). With Jev on, `/code-review` and `/review` route here too |

The guard runs on every `Edit`/`Write` (Claude Code) or `edit`/`write` tool call (Pi) once `.lexi.json` exists. No invocation needed.

## Flows: detailed

### Bug fix

```
lexi router <bug description>
  → routes to bug skill
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
    → Jev review (if enabled): verdict, located findings, confirmed fixes via RED→GREEN
    → report: files touched, root cause fixed, tests stay as regression
```

### Feature with clear scope

```
lexi router <clear feature description>
  → routes to feature skill
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
    → Jev review (if enabled): verdict, located findings, confirmed fixes via RED→GREEN
    → report: tests written (files, names), production files touched, untested code and why
```

### Feature with open scope

```
lexi router <vague feature description>
  → analyzes scope
  → scope is open (multiple defensible designs)
    → call the grill skill
      → Q1 with recommendation → your answer
      → Q2 with recommendation → your answer
      → … (blocked questions held for next round)
      → frontier empty → done
  → back to lexi router
    → routes to feature skill
    → same as "feature with clear scope" above
```

### Manual flow (legacy)

```
lexi router <task>
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

Scope is open. Call the grill skill.

Rounds:
1. Q1 — source of truth: hardcoded table, API, or payment provider? → API (table can't expire, provider locks you in)
2. Q2 — stacking: one code or many? → One (stacking is a pricing engine nobody asked for)
3. Q3 — what a code discounts: total, line items, or shipping? → Total (line-item scope needs category model that doesn't exist)
4. Q4 — rejected code: throw or result? → Result (UI needs to show "expired" vs "not found" differently)
5. Held for round 2: behavior when API is down (needs Q1), second code entered (needs Q2, Q3)

Back to the lexi router. Routes to the feature skill.

Feature proposes:
- rejects unknown code → `{ ok: false, reason: 'not_found' }`
- rejects expired code → `{ ok: false, reason: 'expired' }`
- applies valid code to total
- second code replaces first
- API unreachable → no discount, checkout still works

Breaking: existing test `total is the sum of line items` will change when we add promo logic.

Confirm. Execute five RED→GREEN loops. Gate green. Report five tests, three files touched.

(Examples use Claude Code's `/lexi:` syntax; swap for `/skill:lexi-*` on Pi.)

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

`.lexi/allow` is per-task scratch, gitignored by the init skill.

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
python3 skills_frontmatter_test.py   # every SKILL.md: valid frontmatter, name = folder
python3 versions_test.py             # every copy of a plugin version matches
```

jev's own checks are listed in [jev/README.md](jev/README.md#development).

**Releasing**: Claude Code caches a plugin by its version, so a change that does not bump it never reaches
users who already have that version (Pi follows git commits and is not affected). Every merged change to lexi
bumps `version` in `.claude-plugin/plugin.json`, the `lexi` entry and `metadata` of
`.claude-plugin/marketplace.json`, and `package.json`; a change to jev bumps `jev/.claude-plugin/plugin.json`
and the `jev` entry of the marketplace.

Repo layout:

```
hooks/            guard script + its own tests (source of truth for both runtimes)
skills/           Claude Code skills (init, lexi, bug, feature, grill, tdd)
.claude-plugin/   Claude Code plugin + marketplace manifests
pi/extensions/    Pi extensions: the guard (wraps hooks/tdd_guard.py), jev-router, jev-compact
pi/skills/        Pi skills (lexi-init, lexi-lexi, lexi-bug, lexi-feature, lexi-grill, lexi-tdd, jev-code-review)
jev/              jev Claude Code plugin; shared/ and review/ are imported by the Pi side too
package.json      Pi package manifest (`pi.extensions`, `pi.skills`)
```

Both skill sets carry the same flow; changing one (routing logic, stop conditions, test guidance) means changing its counterpart too — there is no shared source for the prose, only for the guard.

## Known limits

- Guard matches `Edit`/`Write`/`MultiEdit`/`NotebookEdit` (Claude Code) or `edit`/`write` (Pi). Writes through `Bash` (`sed -i`, heredocs) walk past it on either runtime.
- "Rewrite vs append" is substring containment, not a real diff. Hand-crafted edits could fool it.
- Guard is friction + audit trail, not a wall. An agent can write `.lexi/allow` on its own — the skill says to ask first, and the file records what was released.
- Ponytail (the GREEN-step ladder) has no Pi port yet; Pi's skills carry the same rules inline instead of delegating to an installed package.

## License

MIT
