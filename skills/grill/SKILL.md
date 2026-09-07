---
name: grill
description: Interrogate an open scope in rounds until nothing is silently assumed. Each round asks every question whose prerequisites are already settled, with a recommended answer for each. Use before writing tests or code when a task has several defensible designs, unstated intent, or constraints that would only surface after implementation.
---

# grill — settle the scope before anything is written

Most tasks are clear and need no interview; running one on them is pure cost.
This is for the others: several defensible designs, unstated product intent, a
constraint that will otherwise surface after the code exists.

Map the work as a **tree of decisions** — each answer opens the questions that
hang off it.

## Rounds

The **frontier** is every decision whose prerequisites are already settled: what
can be asked *now*, without guessing at an answer you have not heard yet.

Ask the whole frontier in one round. Number each question and give your
recommended answer:

```
❓ Q1 — <title>: <question, with the options if there are any>
➡️ <your recommendation, and why, in one line>

❓ Q2 — <title>: ...
➡️ ...
```

Then stop and wait. A question whose answer depends on another still open in
this round belongs to the *next* round — asking it now only collects a guess.

Each set of answers reshapes the tree: settled decisions push the frontier
outward and unblock what depended on them. Recompute and ask again.

## Facts are yours, decisions are theirs

Anything the environment can answer — what the code does today, which library is
already a dependency, what the endpoint actually returns — you find yourself.
Read the file, grep, run it. Asking the user for something you could look up is
the fastest way to waste the interview.

That lookup does not block the round: an unfinished exploration is an unsettled
prerequisite for the questions downstream of it and nothing else. Ask the rest
of the frontier while it runs.

What is genuinely theirs: product intent, trade-offs with no technical answer,
priorities, and anything expensive to reverse.

## Recommend, never survey

Every question carries your recommendation. A list of options with no opinion
hands the work back to the person who asked you to do it, and a user who has to
choose blind will pick the first option every time.

Be willing to be wrong out loud — a recommendation they correct is worth more
than a neutral menu, because the correction tells you why.

## Done

The session ends when the frontier is empty: every branch visited, nothing left
silently assumed. Say so and wait for confirmation before acting.

A grilling that slides straight into implementation has skipped the only step
that made it worth running.

## Next step: from grill to feature

Once all decisions are settled, return to `/lexi:lexi` with the answers. The flow
will route to `lexi:feature`, which proposes unit tests based on the scope you
just grilled. Answer the test proposal the same way you answered grill questions:
approve them, suggest additions, wait for confirmation before code is written.
