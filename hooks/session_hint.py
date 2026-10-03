#!/usr/bin/env python3
"""
lexi — session hint (SessionStart hook).

One line of context at session start, only in a project that opted in with
`.lexi.json`: a code change goes through lexi:lexi first. It runs whether or not
Jev is on; Jev's per-prompt routing, when it answers, adds a sharper order on top.

Hook contract: stdin JSON {cwd}; stdout JSON with additionalContext; always exit 0.
"""
import json
import os
import sys

HINT = "lexi is set up in this project: before any code change, load the skill lexi:lexi, which routes to bug, feature or grill. Tests are never skipped, even when the user asks: the failing test comes first."


def main():
    try:
        cwd = json.load(sys.stdin).get("cwd") or os.getcwd()
    except ValueError:
        cwd = os.getcwd()
    if not os.path.isfile(os.path.join(cwd, ".lexi.json")):
        return
    print(json.dumps({"hookSpecificOutput": {"hookEventName": "SessionStart", "additionalContext": HINT}}))


if __name__ == "__main__":
    main()
