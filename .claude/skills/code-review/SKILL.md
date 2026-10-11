---
name: code-review
description: Code review in this project goes through Jev (lexi plugin), replacing Claude Code's built-in review. Use for "/code-review", "review the diff", "can I merge?", "is this code ok?", a PR number, a git ref or a .diff/.patch file.
---

This project routes code review to Jev. Invoke the `lexi:code-review` skill
with these arguments and follow it: $ARGUMENTS

If that skill is not available, the lexi plugin is missing or older than 0.12.0:
say so and stop — do not review on your own. The fix is `/plugin update lexi@lexi`, or
deleting `.claude/skills/code-review/` and `.claude/skills/review/` to get the
built-in review back.
