#!/usr/bin/env python3
"""Self-check for every SKILL.md frontmatter. Run: python3 skills_frontmatter_test.py

A frontmatter that is not valid YAML is dropped without a word: Pi skipped
lexi-init over one unquoted colon. Standard library only, so this checks the
plain `key: value` subset the skills use — the rules that caught that bug.
"""
import glob
import os
import re
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
PATTERNS = ["skills/*/SKILL.md", "pi/skills/*/SKILL.md", "jev/skills/*/SKILL.md"]
LINE = re.compile(r"^([a-z][a-z0-9-]*): (.+)$")
# A plain (unquoted) YAML scalar cannot start with an indicator character.
INDICATORS = tuple("[]{}>|*&!%@`#,?-:")


def frontmatter(text):
    if not text.startswith("---\n"):
        return None
    end = text.find("\n---", 4)
    return None if end < 0 else text[4:end]


def value_errors(key, value):
    if value[0] in "\"'":
        return [] if value[-1] == value[0] and len(value) > 1 else [f"`{key}` has an unclosed quote"]
    errors = [f"`{key}` contains `{token.strip()}` unquoted: quote the value or reword"
              for token in (": ", " #") if token in value]
    if value.startswith(INDICATORS):
        errors.append(f"`{key}` starts with `{value[0]}` unquoted")
    return errors


def skill_errors(path):
    block = frontmatter(open(path, encoding="utf-8").read())
    if block is None:
        return ["no frontmatter between `---` lines"]
    errors, fields = [], {}
    for line in filter(str.strip, block.splitlines()):
        match = LINE.match(line)
        if not match:
            errors.append(f"not a `key: value` line: {line[:60]}")
            continue
        fields[match.group(1)] = match.group(2)
        errors += value_errors(*match.groups())
    folder = os.path.basename(os.path.dirname(path))
    if fields.get("name") != folder:
        errors.append(f"`name` is {fields.get('name')!r}, the folder is {folder!r}")
    if not fields.get("description"):
        errors.append("`description` is missing")
    return errors


def check_rules():
    """The rules themselves, on the exact line that broke lexi-init."""
    assert value_errors("description", "after updating lexi: on an existing .lexi.json")
    assert not value_errors("description", "after updating lexi — on an existing .lexi.json")
    assert not value_errors("description", '"quoted: colons are fine"')
    assert value_errors("description", "[not a list]")


def main():
    check_rules()
    paths = sorted(p for pattern in PATTERNS for p in glob.glob(os.path.join(ROOT, pattern)))
    failures = [(os.path.relpath(p, ROOT), e) for p in paths for e in skill_errors(p)]
    for path, error in failures:
        print(f"FAIL {path}: {error}")
    if failures or not paths:
        return 1
    print(f"skills frontmatter: {len(paths)} files ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
