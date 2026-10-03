#!/usr/bin/env python3
"""Self-check for session_hint.py. Run: python3 hooks/session_hint_test.py

Drives the real hook contract (stdin JSON -> stdout, exit code) against a
throwaway directory.
"""
import json
import os
import subprocess
import sys
import tempfile

HINT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "session_hint.py")


def run(cwd):
    proc = subprocess.run(
        [sys.executable, HINT], input=json.dumps({"cwd": cwd}),
        capture_output=True, text=True,
    )
    return proc.returncode, proc.stdout


def main():
    with tempfile.TemporaryDirectory() as project:
        with open(os.path.join(project, ".lexi.json"), "w", encoding="utf-8") as fh:
            fh.write("{}")
        code, out = run(project)
        context = json.loads(out)["hookSpecificOutput"]["additionalContext"]
        assert code == 0, code
        assert "lexi:lexi" in context and "\n" not in context, context
    with tempfile.TemporaryDirectory() as bare:
        assert run(bare) == (0, ""), "no .lexi.json -> no hint"
    print("OK — session_hint")


if __name__ == "__main__":
    main()
