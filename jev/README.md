# jev

A three-level decision layer on [TypeSafe](https://typesafe.ai)'s **Jev**, a model that answers closed
questions with calibrated probabilities. Jev never decides on its own: it answers yes/no, scores and choices,
and the code turns those numbers into a decision through fixed thresholds.

| Level | What it decides | Claude Code | Pi |
|---|---|---|---|
| **Router** | model and effort, once per session (and per subagent on Claude Code) | `hooks/router.ts` | `pi/extensions/jev-router/` |
| **Compact** | which tool calls to keep, truncate or drop when compacting, without rewriting anything | `hooks/compact.ts` | `pi/extensions/jev-compact/` |
| **Review** | the verdict on a diff, computed in code from Jev's answers; the agent takes the handoff | `skills/code-review/` | `pi/skills/jev-code-review/` |

Thresholds and questions live once, in `shared/` (router and compact) and `review/` (review), and both runtimes
import them: they cannot drift apart. With lexi, the review runs after the last GREEN of the bug and feature
flows.

## Requirements

- `TYPESAFE_API_KEY`: Claude Code reads it under `env` in `~/.claude/settings.json` (or the shell). Pi needs it
  exported in the shell it starts from (`~/.zshrc`): the router and compaction fall back to
  `~/.claude/settings.json`, the review does not and exits 4. Both runtimes on one machine: set it in both
  places. Never put it in a project settings file that is committed.
  Without it every level stays off and says so once.
- Python 3 for the review (standard library only; lexi already needs it).
- Claude Code ≥ 2.1.276 for the router and compaction hooks.

## Install and opt in

**Claude Code** — jev is a dependency of lexi (since 0.4.0): installing `lexi@lexi` installs it. Older installs: `/plugin install jev@lexi`. Then run `/lexi:init` in the project.

`init` asks whether to enable Jev and, on yes, writes `"jev": {}` in `.lexi.json` (the review step) and, in the
project's `.claude/settings.json`, `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` (the hooks module stays off without it)
and `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=50`. It also writes two project shims, `.claude/skills/code-review/SKILL.md`
and `.claude/skills/review/SKILL.md`, that hand off to `jev:code-review`: a project skill replaces the built-in
skill of the same name, and `/review` needs its own file. Commit them so the team shares the review; delete them
to get the built-in review back. The project folder must be trusted, or Claude Code reads neither the project
`env` nor its skills.

Pi has no built-in code review, so there is nothing to replace: the skill is `/skill:jev-code-review`.

**Pi** — jev ships inside the lexi package. `/skill:lexi-init` asks whether to enable it, which model to use
per tier, and writes a `jev` object in `.lexi.json`; without that object the extensions do nothing, even when
the package is installed.

```json
{ "jev": { "tiers": { "fast": "claude-sonnet-5", "balanced": "claude-opus-5-5", "deep": "claude-fable-5-1" } } }
```

`tiers` is optional (those are the defaults). A bare id resolves on the provider the session already
runs on, to the newest model of that family there (`claude-opus-5-5` → `claude-bridge/claude-opus-5` on a
bridge session); `provider/id` pins a tier to that provider exactly. It also sets `compaction.modelOverrides[<model>].reserveTokens` in
`.pi/settings.json` to half each model's context window, so compaction runs at ~50%.

## Router

On the first prompt, Jev classifies the task: tier (`fast`, `balanced`, `deep`), effort (`low` … `max`) and
risk. The choice is applied once and then held for the whole session, so the prompt cache is never thrown
away; a manual `/model` is never overridden. Going up needs confidence ≥ 0.3, going down ≥ 0.6; risk > 0.7
forces `deep` with effort at least `high`. If Jev does not answer (1.5 s timeout, error), the next prompt asks
again.

On Claude Code every subagent spawn (forks excepted) is classified on its own: `fast → sonnet`,
`balanced → opus`, `deep → fable`. On Pi subagent models are pinned by the subagent extension and left alone.

You see `[jev-router] session: sonnet · effort low` in the transcript and `jev · …` in the status line.

## Compact

Native compaction replaces the conversation with a summary, and paths, line numbers and exact errors can drift.
Here Jev sees the structure of the conversation (without tool result contents) and, per tool call, decides
whether to keep it, truncate its result to 300 characters, or drop it with its result. What stays is verbatim;
user and assistant text is never touched. It falls back to the native summary when the key is missing, Jev does
not answer within 8 s, the answer is invalid, there is no candidate call, or the reduction is under 30%: below
that, rewriting the prompt cache does not pay off.

On Pi compaction can only return text, so the kept history is written back verbatim as text
(`[User]: …`, `[Assistant tool calls]: …`, `[Tool result <tool>]: …`) under a header saying it is not a summary.

## Review

```sh
python3 jev/review/review.py --working                        # uncommitted changes, new files included
python3 jev/review/review.py --git $(git merge-base HEAD main)  # the branch's commits
python3 jev/review/review.py --diff pr.diff --title "..." --description "..."
python3 jev/review/review.py ... --json                       # for CI and the skills
python3 jev/review/review.py ... --escalate                   # the handoff as a ready prompt
python3 jev/review/review.py ... --compare before.json        # after a fix: per-check deltas
```

Exit codes: 0 MERGE, 1 NITS/CONVENTIONS/QUALITY ("fix before merge, no risk outside the codebase"), 2 SECURITY
REVIEW, 3 BLOCK, 4 error. From an agent: `/jev:code-review` (Claude Code; `/code-review` and `/review` too in a project `init` set up) or
`/skill:jev-code-review` (Pi).

| File | Holds |
|---|---|
| `review/checks.json` | the core questions: generic risk (secrets, injection, auth, weakened tests, API breaks, migrations…) and code quality (nesting, length, parameters, naming, duplication, over-engineering…) |
| `review/policy.json` | the lanes BLOCK → SECURITY REVIEW → CONVENTIONS → QUALITY → NITS → MERGE, one threshold per check, the uncertainty band, state limits |
| `review/review.py` | the CLI: builds the state, calls Jev, applies the policy. No question, threshold or check name lives here |

Jev says *that* there is a problem and how likely, not *where*. The JSON carries a `handoff`: every fired rule
to `locate` (`path:line` and the minimal fix), every critical check in the 0.35–0.65 band to `verify`, every
check with `escalate_to` to `delegate`. After the fix, `--compare` reruns Jev: the fix is judged by the
numbers, not by opinion.

The state also carries `.lexi.json` → `testable` as `testable_paths`, so `outside_test_perimeter` knows where
a unit test is expected.

### Project conventions: `.lexi/review.json`

The CONVENTIONS lane ships empty. A project fills it:

```json
{
  "checks": {
    "layer_bypass": {
      "label": "Layer bypass",
      "critical": false,
      "higher_is_better": false,
      "escalation_patterns": ["components/", "pages/"],
      "type": "noul",
      "instructions": { "question": "Does a UI file in `diff` call the HTTP client directly instead of going through a repository?" },
      "criteria": { "true": "…boundary cases that count…", "false": "…boundary cases that do not…" }
    }
  },
  "rules": { "CONVENTIONS": [{ "check": "layer_bypass", "op": "gte", "value": 0.7 }] },
  "drop_first_patterns": ["^fixtures/"]
}
```

`checks` uses the `checks.json` format; a project check with a core id overrides it for that project. `rules`
maps a lane name to rules appended to it. An unknown lane, or a rule on a check that does not exist, is an
error (exit 4), never a silent no-op. `escalate_to: "agent:<name>"` on a critical check hands it to that agent.

### Correcting a judgement

A verdict is wrong when a probability is wrong. Fix it in the `criteria` of the question that answered badly:
add the boundary case, with an example, to the `true` or `false` side that should absorb it. **Never** move a
threshold in `policy.json` to let one case through, and never touch `review.py`: the threshold is the cost you
accept for that error, not a knob to tune on the last diff.

## Development

```sh
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude plugin test jev   # router + compact, Claude Code
claude plugin validate jev
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude -p "/plugin-types jev/types" && npx -y -p typescript@5 tsc -p jev/tsconfig.json
node --test pi/extensions/jev-compact/transcript.test.ts
npx -y -p typescript@5 tsc -p pi/tsconfig.json               # Pi extensions (paths assume a brew install of pi)
python3 jev/review/test_review.py
```

A Claude Code plugin gets exactly one hooks module, and `register` must call `on("<event>", hook)` directly:
`hooks/index.ts` wires both levels, `router.ts` and `compact.ts` export only handlers.

## Turning it off

Claude Code: `/plugin uninstall jev@lexi`, or drop `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS` from the project settings.
Pi: remove the `jev` object from `.lexi.json`. Either runtime, one machine only: unset `TYPESAFE_API_KEY`.
