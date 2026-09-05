#!/usr/bin/env python3
"""Self-check for tdd_guard.py. Run: python3 hooks/tdd_guard_test.py

Drives the real hook contract (stdin JSON -> exit code) against a throwaway
git repo, so a broken rule fails here instead of in someone's session.
"""
import json
import os
import subprocess
import sys
import tempfile

GUARD = os.path.join(os.path.dirname(os.path.abspath(__file__)), "tdd_guard.py")
CONFIG = {
    "gate": "true",
    "source": "lib/",
    "tests": "test/",
    "test_suffix": "_test.dart",
    "testable": ["lib/models/"],
}


def run(repo, tool_name, file_path, tool_input=None):
    payload = {
        "tool_name": tool_name,
        "tool_input": dict(tool_input or {}, file_path=file_path),
        "cwd": repo,
    }
    proc = subprocess.run(
        [sys.executable, GUARD], input=json.dumps(payload),
        capture_output=True, text=True,
    )
    return proc.returncode


def write(repo, rel, body=""):
    path = os.path.join(repo, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(body)


def setup(repo, with_config=True):
    subprocess.run(["git", "init", "-q"], cwd=repo, check=True)
    subprocess.run(["git", "config", "user.email", "t@t"], cwd=repo, check=True)
    subprocess.run(["git", "config", "user.name", "t"], cwd=repo, check=True)
    if with_config:
        write(repo, ".lexi.json", json.dumps(CONFIG))
    write(repo, "test/models/user_test.dart", "test('a', () {});\n")
    write(repo, "lib/models/user.dart", "class User {}\n")
    write(repo, "lib/pages/home.dart", "class Home {}\n")
    subprocess.run(["git", "add", "-A"], cwd=repo, check=True)
    subprocess.run(["git", "commit", "-qm", "init"], cwd=repo, check=True)


ALLOW, BLOCK = 0, 2

with tempfile.TemporaryDirectory() as repo:
    setup(repo)

    # source under `testable` with an existing mirror -> allowed
    assert run(repo, "Edit", "lib/models/user.dart") == ALLOW

    # same, mirror missing -> blocked (test-first)
    assert run(repo, "Write", "lib/models/order.dart") == BLOCK

    # outside `testable` -> free, mirror or not
    assert run(repo, "Write", "lib/pages/home.dart") == ALLOW
    assert run(repo, "Write", "lib/pages/new_page.dart") == ALLOW

    # untracked test file -> free to write and to keep editing
    write(repo, "test/models/order_test.dart", "x")
    assert run(repo, "Write", "test/models/order_test.dart") == ALLOW

    # tracked test file: appending is fine, rewriting an assertion is not
    append = {"old_string": "test('a', () {});", "new_string": "test('a', () {});\ntest('b', () {});"}
    rewrite = {"old_string": "test('a', () {});", "new_string": "test('b', () {});"}
    assert run(repo, "Edit", "test/models/user_test.dart", append) == ALLOW
    assert run(repo, "Edit", "test/models/user_test.dart", rewrite) == BLOCK
    assert run(repo, "Write", "test/models/user_test.dart") == BLOCK

    # MultiEdit is blocked when any one edit rewrites
    assert run(repo, "MultiEdit", "test/models/user_test.dart", {"edits": [append]}) == ALLOW
    assert run(repo, "MultiEdit", "test/models/user_test.dart", {"edits": [append, rewrite]}) == BLOCK

    # the allowlist releases a rewrite, for one named path only
    write(repo, ".lexi/allow", "test/models/user_test.dart\n")
    assert run(repo, "Edit", "test/models/user_test.dart", rewrite) == ALLOW
    write(repo, ".lexi/allow", "test/models/other_test.dart\n")
    assert run(repo, "Edit", "test/models/user_test.dart", rewrite) == BLOCK

    # LEXI_OFF releases everything
    os.environ["LEXI_OFF"] = "1"
    assert run(repo, "Write", "lib/models/order.dart") == ALLOW
    del os.environ["LEXI_OFF"]

with tempfile.TemporaryDirectory() as repo:
    setup(repo, with_config=False)
    # no .lexi.json -> dormant, the project has not opted in
    assert run(repo, "Write", "lib/models/order.dart") == ALLOW

print("tdd_guard: all checks passed")
