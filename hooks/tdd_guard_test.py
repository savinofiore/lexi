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

    # Windows locale (cp1252) must not garble or crash on a non-ASCII path
    payload = json.dumps({"tool_name": "Write", "tool_input": {"file_path": "lib/models/città_😁.dart"}, "cwd": repo})
    proc = subprocess.run([sys.executable, GUARD], input=payload.encode("utf-8"), capture_output=True,
                          env=dict(os.environ, PYTHONIOENCODING="cp1252"))
    assert proc.returncode == BLOCK and "città_😁" in proc.stderr.decode("utf-8"), proc.stderr

def run_bash(repo, command):
    return run(repo, "Bash", None, {"command": command})


with tempfile.TemporaryDirectory() as repo:
    setup(repo)
    # Bash writes answer to the same rules as Write: a heredoc cannot create a source without its mirror
    assert run_bash(repo, "cat > lib/models/order.dart <<'EOF'\nclass Order {}\nEOF") == BLOCK
    # ...and with the mirror in place it is as free as Write
    assert run_bash(repo, "echo 'class User {}' > lib/models/user.dart") == ALLOW
    # sed -i on a tracked test rewrites it: blocked, BSD and GNU spellings alike
    assert run_bash(repo, "sed -i '' 's/a/b/' test/models/user_test.dart") == BLOCK
    assert run_bash(repo, "sed -i 's/a/b/' test/models/user_test.dart") == BLOCK
    # appending to a tracked test is an insertion
    assert run_bash(repo, "echo \"test('b', () {});\" >> test/models/user_test.dart") == ALLOW
    # truncating it is a rewrite, released only by the allowlist
    assert run_bash(repo, "echo x > test/models/user_test.dart") == BLOCK
    write(repo, ".lexi/allow", "test/models/user_test.dart\n")
    assert run_bash(repo, "echo x > test/models/user_test.dart") == ALLOW
    os.remove(os.path.join(repo, ".lexi", "allow"))
    # reading, running the gate, writing outside the perimeter: nothing to guard
    assert run_bash(repo, "cat lib/models/user.dart && node --test 2>&1 | tail -5") == ALLOW
    assert run_bash(repo, "echo x > /tmp/lexi-out.txt") == ALLOW
    # every command of a chain is checked, tee included
    assert run_bash(repo, "ls && make; gen | tee lib/models/order.dart") == BLOCK

with tempfile.TemporaryDirectory() as repo:
    setup(repo, with_config=False)
    # no .lexi.json -> dormant, the project has not opted in
    assert run(repo, "Write", "lib/models/order.dart") == ALLOW

MIRRORS_CONFIG = {
    "gate": "true",
    "mirrors": [
        {"source": "src/", "test": "tests/{dir}test_{name}.py"},
        {"source": "packages/api/src/", "test": "packages/api/src/{dir}__tests__/{name}.test.ts"},
    ],
    "testable": ["src/", "packages/api/src/"],
}


def setup_repo(repo, config, files):
    subprocess.run(["git", "init", "-q"], cwd=repo, check=True)
    subprocess.run(["git", "config", "user.email", "t@t"], cwd=repo, check=True)
    subprocess.run(["git", "config", "user.name", "t"], cwd=repo, check=True)
    write(repo, ".lexi.json", json.dumps(config))
    for rel, body in files.items():
        write(repo, rel, body)
    subprocess.run(["git", "add", "-A"], cwd=repo, check=True)
    subprocess.run(["git", "commit", "-qm", "init"], cwd=repo, check=True)


with tempfile.TemporaryDirectory() as repo:
    setup_repo(repo, MIRRORS_CONFIG, {"src/pkg/cart.py": "", "tests/pkg/test_cart.py": "def test_a(): pass\n"})
    # python_prefix_mirror_blocks_source_without_test: a `mirrors` template puts the prefix where Python wants it
    assert run(repo, "Write", "src/pkg/order.py") == BLOCK
    assert run(repo, "Edit", "src/pkg/cart.py") == ALLOW
    # python_prefix_test_file_is_recognised: the template also says what a test file is
    py_append = {"old_string": "def test_a(): pass", "new_string": "def test_a(): pass\ndef test_b(): pass"}
    py_rewrite = {"old_string": "def test_a(): pass", "new_string": "def test_b(): pass"}
    assert run(repo, "Edit", "tests/pkg/test_cart.py", py_append) == ALLOW
    assert run(repo, "Edit", "tests/pkg/test_cart.py", py_rewrite) == BLOCK
    # dunder_tests_dir_mirror: the test sits in a folder next to the source, not in a parallel tree
    assert run(repo, "Write", "packages/api/src/cart/total.ts") == BLOCK
    write(repo, "packages/api/src/cart/__tests__/total.test.ts", "x")
    assert run(repo, "Write", "packages/api/src/cart/total.ts") == ALLOW

print("tdd_guard: all checks passed")
