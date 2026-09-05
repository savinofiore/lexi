#!/usr/bin/env python3
"""
lexi — TDD guard (PreToolUse hook).

Two rules, both driven by `<project>/.lexi.json`:

1. A source file under `testable` cannot be written before its mirror test file
   exists. Test-first, enforced by the machine instead of by prose.
2. A test file that git already tracks cannot have its assertions rewritten.
   Appending a new test is fine; replacing or deleting existing content is a
   breaking change and needs the user's agreement, recorded in `.lexi/allow`.

Everything else is allowed: no `.lexi.json` -> dormant, path outside `testable`
-> free. The whitelist is deliberately narrow so the guard bites on logic and
stays out of the UI layer, where a deterministic unit test does not exist.

Escape hatch: `LEXI_OFF=1`.

ponytail: Bash is not matched, so `sed -i` and heredocs walk past this guard.
Add a Bash command parser only if that turns out to be a real leak in practice.

Hook contract: stdin JSON {tool_name, tool_input, cwd}; exit 0 = allow,
exit 2 + stderr = block and show the reason to the agent.
"""
import json
import os
import subprocess
import sys

GUARDED_TOOLS = ("Edit", "Write", "MultiEdit", "NotebookEdit")

NO_MIRROR_MSG = """\
lexi — write to `{rel}` BLOCKED.

`{rel}` is under a `testable` path and its mirror test does not exist yet:
  {mirror}

Write the failing test first. One slice at a time:
  1. confirm the seam with the user (skill: lexi)
  2. write ONE test in {mirror} -> run the gate -> it must be RED for the reason under test
  3. only then change {rel}, the least that makes it pass

If this file genuinely cannot carry a deterministic unit test, it does not
belong in `testable`: fix `.lexi.json`, do not work around the guard.
"""

REWRITE_MSG = """\
lexi — edit to `{rel}` BLOCKED.

This test file is tracked by git and the edit replaces existing content rather
than adding to it. Rewriting an assertion to reach green is the one move this
guard exists to stop.

If the test is RED, the production code is wrong: fix the code.

If the expected behaviour genuinely changed (a breaking feature), it has to be
agreed first, not discovered mid-implementation:
  1. tell the user which tests change and why, and wait
  2. on confirmation, add `{rel}` to `.lexi/allow` (one path per line)
  3. rewrite the test to the new expected behaviour, one slice at a time
  4. empty `.lexi/allow` once the gate is green

Session-wide escape hatch, outside the process: LEXI_OFF=1
"""


def load_config(cwd):
    try:
        with open(os.path.join(cwd, ".lexi.json"), encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return None


def to_rel(file_path, cwd):
    rel = os.path.relpath(file_path, cwd) if os.path.isabs(file_path) else file_path
    return rel.replace(os.sep, "/")


def is_test_file(rel, cfg):
    return rel.startswith(cfg["tests"]) and rel.endswith(cfg["test_suffix"])


def mirror_of(rel, cfg):
    """lib/models/user.dart -> test/models/user_test.dart"""
    source = cfg["source"]
    if not rel.startswith(source):
        return None
    stem = os.path.splitext(rel[len(source):])[0]
    return cfg["tests"] + stem + cfg["test_suffix"]


def is_testable(rel, cfg):
    return any(rel.startswith(p) for p in cfg.get("testable", []))


def git_tracks(cwd, rel):
    try:
        return subprocess.run(
            ["git", "ls-files", "--error-unmatch", "--", rel],
            cwd=cwd, capture_output=True, timeout=3,
        ).returncode == 0
    except (OSError, subprocess.SubprocessError):
        return False  # no git -> cannot tell what pre-existed -> do not block


def is_pure_insertion(tool_name, tool_input):
    """True when the edit only adds text, keeping every existing line intact.

    ponytail: substring containment, not a real diff. It reads an append as an
    append and a rewritten assertion as a rewrite, which is the distinction the
    rule needs; a hand-crafted edit could still fool it.
    """
    if tool_name == "Edit":
        edits = [tool_input]
    elif tool_name == "MultiEdit":
        edits = tool_input.get("edits") or []
    else:
        return False  # Write / NotebookEdit replace wholesale
    if not edits:
        return False
    return all(
        e.get("old_string", "") in e.get("new_string", "") for e in edits
    )


def allowlisted(cwd, rel):
    try:
        with open(os.path.join(cwd, ".lexi", "allow"), encoding="utf-8") as fh:
            return rel in {line.strip() for line in fh if line.strip()}
    except OSError:
        return False


def block(msg):
    sys.stderr.write(msg)
    sys.exit(2)


def main():
    try:
        data = json.loads(sys.stdin.read())
    except (json.JSONDecodeError, ValueError):
        sys.exit(0)  # unreadable input -> never block

    tool_name = data.get("tool_name")
    if tool_name not in GUARDED_TOOLS or os.environ.get("LEXI_OFF"):
        sys.exit(0)

    tool_input = data.get("tool_input") or {}
    file_path = tool_input.get("file_path") or tool_input.get("notebook_path") or ""
    if not file_path:
        sys.exit(0)

    cwd = data.get("cwd") or os.getcwd()
    cfg = load_config(cwd)
    if not cfg:
        sys.exit(0)  # project has not opted in -> dormant

    rel = to_rel(file_path, cwd)

    if is_test_file(rel, cfg):
        if not git_tracks(cwd, rel):
            sys.exit(0)  # new test file -> free
        if allowlisted(cwd, rel) or is_pure_insertion(tool_name, tool_input):
            sys.exit(0)
        block(REWRITE_MSG.format(rel=rel))

    if is_testable(rel, cfg):
        mirror = mirror_of(rel, cfg)
        if mirror and not os.path.exists(os.path.join(cwd, mirror)):
            block(NO_MIRROR_MSG.format(rel=rel, mirror=mirror))

    sys.exit(0)


if __name__ == "__main__":
    main()
