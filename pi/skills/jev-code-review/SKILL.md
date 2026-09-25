---
name: jev-code-review
description: Hybrid Jev + Pi code review. review.py has TypeSafe's Jev judge the diff on closed questions (generic risk and code quality, plus the project's own conventions from .lexi/review.json) and computes the verdict in code (BLOCK, SECURITY REVIEW, CONVENTIONS, QUALITY, NITS, MERGE); you take the handoff, locate fired rules, verify uncertain checks, delegate triggers and, after a fix, rerun Jev to measure the deltas. lexi's bug and feature flows call it after the last GREEN. Use for "/skill:jev-code-review", "review the diff", "can I merge?", "is this code ok?", "does it follow our conventions?", a PR number, a git ref or a .diff/.patch file.
---

# jev-code-review — hybrid Jev + Pi protocol

Twin of the Claude Code skill (`jev/skills/code-review/SKILL.md` in the lexi package): same `review.py`,
same `policy.json`, same `handoff`. Only tool names and the way to launch an agent differ.

Division of labour, fixed:

| Who | Does | Does not |
|---|---|---|
| **Jev** | answers every closed question with calibrated probabilities, one call, ~1–2 s | write prose, know *where*, see the codebase |
| **`review.py`** | applies `policy.json`: verdict, exit code, `handoff` | hold questions or thresholds |
| **You** | locate (`path:line`), verify uncertain checks, delegate, propose the minimal fix, rerun Jev to measure | **read the diff to decide the verdict**, rewrite it, edit without confirmation |

`REVIEW` below is `python3 <this skill's directory>/../../../jev/review/review.py` (resolve it to an absolute
path once). Run it from the project root. Use a temporary directory of your own (`mktemp -d`) as `$SCRATCH`.

## 1. Run Jev (always `--json`, save the output)

```sh
$REVIEW <source> --json > "$SCRATCH/jev-1.json"
```

| Skill argument | `<source>` |
|---|---|
| none, dirty tree (`git status --porcelain` not empty) | `--working --title "..." --description "..."` taken from the request or the task just finished; missing → ask in one line |
| none, clean tree, not on the default branch | `--git $(git merge-base HEAD <default>)`, `<default>` from `git symbolic-ref --short refs/remotes/origin/HEAD` (fallback `main`) |
| none, clean tree, on the default branch | `--git HEAD~1` |
| git ref | `--git <ref>` |
| `.diff`/`.patch` file | `--diff <file>` |
| PR number (`326`) | `gh pr diff 326 > "$SCRATCH/pr.diff"` and `gh pr view 326 --json title,body`, then `--diff "$SCRATCH/pr.diff" --title "<title>" --description "<body>"` |

Exit 4 with `TYPESAFE_API_KEY not set` → the key must be exported in the shell Pi starts from
(`export TYPESAFE_API_KEY=...`); Pi has no `env` block in its settings. Explain and stop; never ask for the key
in chat. Other exit 4 (bad `.lexi/review.json`, network) → quote the error and stop. `Empty diff` → say so and
stop. `omitted_files > 0` → say it first: the verdict is on a partial diff.

## 2. Report the verdict without rewriting it

From the JSON, in this order, adding no judgement of yours:

1. `verdict` + `fired_rules[].comparison` on one line (`QUALITY — deep_nesting 0.92 >= 0.7, too_many_params 0.95 >= 0.7`);
2. notable checks: `probabilities` > 0.5, or < 0.5 for `higher_is_better` checks (`adds_tests`, `docs_only`,
   `description_matches`, `outside_test_perimeter`); `scores` with their level; `choices.primary_concern` with confidence;
3. `ms`, `cost_usd`.

## 3. Handoff

`handoff` is what Jev passes to you. Three kinds of `ask`:

| `ask` | When | What you do |
|---|---|---|
| `locate` | a rule fired | open **only** `files`, find the line (`path:line`) answering `question`, propose the **minimal fix** in one line. Do not apply |
| `verify` | a critical check in the uncertainty band | open only `files`, answer `question` with one sentence and the line that proves it |
| `delegate` | `escalate_to: "agent:<name>"` | launch that agent with the `subagent` tool (`subagent({ agent: "<name>", ... })`) passing `files`, `question`, probability; report its outcome in two lines. No subagent extension → do it inline |

Rules:
- more than 3 `locate` and the subagent extension installed → one `scout` **per check, in parallel** (`subagent` with `async: true`), with `question` + `files`; collect the `path:line`s;
- `escalate_to: "skill:<name>"` on a `locate` is the remedy to name in step 4 (`/skill:<name>`), not to launch on your own;
- empty `handoff` → "nothing handed off" in one line, stop;
- the verdict **stays the policy's**: your lines are additions. `--escalate` prints the same handoff as a prompt for another session.

Arguments after `/skill:jev-code-review`: `--fix` → skip the confirmation in step 4 (the user already asked to
apply). Depth levels (`low`…`max`) → ignored: Jev always answers everything at a fixed cost.

## 4. Confirm

For any verdict other than MERGE: **one** question in chat (Pi has no guided-choice tool), options
*fix all / pick / none*, listing the proposed fixes (`check → path:line → fix`). Then stop and wait. No edits
without confirmation. For MERGE propose nothing.

## 5. Fix, then Jev measures

Apply only the confirmed fixes. A fix on a path under `.lexi.json` → `testable` goes through lexi's RED→GREEN
(`/skill:lexi-lexi`) like any other change: the guard holds it anyway. Then rerun **the same source** with
`--compare`:

```sh
$REVIEW <source> --json --compare "$SCRATCH/jev-1.json" > "$SCRATCH/jev-2.json"
```

Report `compare`: verdict before → after and the per-check `deltas`. Read them like this:

- the fired check dropped below its threshold → the fix worked;
- it stayed high → the fix missed what Jev saw: reread the `question`, never lower the threshold;
- a **new** check rose → the fix introduced a problem: say so.

Two rounds at most. Then run the project's gate (`.lexi.json` → `gate`).

## 6. Disagreement → criteria, never thresholds

If you disagree with a number, say so after the verdict as a separate opinion. If the disagreement is
systematic (same check, several diffs), propose a change to that check's `criteria` with the boundary case to
add: in `.lexi/review.json` for a project check (or to override a core check for this project), in the
package's `jev/review/checks.json` for everyone. Never move a threshold in `policy.json`, never touch
`review.py`.
