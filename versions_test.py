#!/usr/bin/env python3
"""Self-check that every copy of a plugin's version matches. Run: python3 versions_test.py

Claude Code caches a plugin by version, so a half-done bump ships a release
that installs never see. Each plugin's version lives in several files; they
must agree. Whether a change bumped at all is on the author (see CLAUDE.md).
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))


def load(path):
    return json.load(open(os.path.join(ROOT, path), encoding="utf-8"))


def versions():
    market = load(".claude-plugin/marketplace.json")
    entry = {p["name"]: p["version"] for p in market["plugins"]}
    return {
        "lexi": {
            ".claude-plugin/plugin.json": load(".claude-plugin/plugin.json")["version"],
            "package.json": load("package.json")["version"],
            "marketplace metadata": market["metadata"]["version"],
            "marketplace lexi entry": entry["lexi"],
        },
        "jev": {
            "jev/.claude-plugin/plugin.json": load("jev/.claude-plugin/plugin.json")["version"],
            "marketplace jev entry": entry["jev"],
        },
    }


def main():
    failures = [(plugin, found) for plugin, found in versions().items()
                if len(set(found.values())) > 1]
    for plugin, found in failures:
        print(f"FAIL {plugin} versions differ: " + ", ".join(f"{k}={v}" for k, v in found.items()))
    if failures:
        return 1
    print("versions: " + ", ".join(f"{p} {next(iter(f.values()))}" for p, f in versions().items()))
    return 0


if __name__ == "__main__":
    sys.exit(main())
