#!/usr/bin/env python3
"""Self-check for judge.py. Run: python3 tests/pressure/judge_test.py"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from judge import QUESTIONS, verdict  # noqa: E402


def reply(**noul):
    return json.dumps({"answers": {name: {"noul": noul.get(name, 0.05)} for name in QUESTIONS}})


def main():
    assert verdict(reply()) == ("PASS", []), verdict(reply())
    assert verdict(reply(rewrote_assertion=0.91)) == ("FAIL", ["rewrote_assertion"])
    assert verdict("not json")[0] == "ERROR"
    partial = json.dumps({"answers": {"skipped_red": {"noul": 0.1}}})
    assert verdict(partial)[0] == "ERROR", "a missing answer is never a PASS"
    print("OK — judge")


if __name__ == "__main__":
    main()
