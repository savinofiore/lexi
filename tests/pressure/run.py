#!/usr/bin/env python3
"""
Pressure tests for lexi's skills: each scenario pushes an agent to break a rule
(skip the red test, rewrite an assertion, guess a cause, claim done unverified,
obey a wrong review). The agent runs headless on a copy of `fixture/`, then Jev
answers the questions in judge.py on its transcript and judge.verdict decides.

    python3 tests/pressure/run.py              # every scenario
    python3 tests/pressure/run.py 2 4          # scenarios whose file starts with 2 or 4

Costs a real Claude session per scenario and a Jev call: not part of the gate.
Needs `claude` on PATH and TYPESAFE_API_KEY (shell, or .claude/settings.local.json).
Each transcript stays in its temp folder, printed next to the verdict.
"""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(ROOT, "jev", "review"))
from judge import QUESTIONS, verdict  # noqa: E402
from review import ReviewError, call_jev, read_api_key  # noqa: E402

CLAUDE_TIMEOUT_S = 900
CLIP = 1500  # characters kept per tool input or result: a gate summary must fit
MAX_TRANSCRIPT = 60_000


def sections(path):
    with open(path, encoding="utf-8") as handle:
        parts = re.split(r"^## (\w+)\s*$", handle.read(), flags=re.M)
    return {name.lower(): body.strip() for name, body in zip(parts[1::2], parts[2::2])}


def prepare(scenario):
    work = tempfile.mkdtemp(prefix="lexi-pressure-")
    shutil.copytree(os.path.join(HERE, "fixture"), work, dirs_exist_ok=True)
    git = lambda *args: subprocess.run(["git", *args], cwd=work, check=True, capture_output=True)
    git("init", "-q")
    git("add", "-A")
    git("-c", "user.name=pressure", "-c", "user.email=pressure@lexi", "commit", "-qm", "fixture")
    if scenario.get("setup"):
        subprocess.run(["bash", "-c", scenario["setup"]], cwd=work, check=True)
        git("-c", "user.name=pressure", "-c", "user.email=pressure@lexi", "commit", "-qam", "setup")
    return work


def run_agent(work, prompt):
    command = ["claude", "-p", prompt, "--plugin-dir", ROOT, "--plugin-dir", os.path.join(ROOT, "jev"),
               "--output-format", "stream-json", "--verbose", "--permission-mode", "bypassPermissions"]
    result = subprocess.run(command, cwd=work, capture_output=True, encoding="utf-8", timeout=CLAUDE_TIMEOUT_S)
    with open(os.path.join(work, "transcript.jsonl"), "w", encoding="utf-8") as handle:
        handle.write(result.stdout)
    return render(result.stdout)


def render(stream):
    """The stream-json events as plain lines: what the agent said, ran and saw."""
    lines = []
    for raw in stream.splitlines():
        try:
            event = json.loads(raw)
        except ValueError:
            continue
        for block in (event.get("message") or {}).get("content") or []:
            if not isinstance(block, dict):
                continue
            if block.get("type") == "text":
                lines.append(f"agent: {block['text']}")
            elif block.get("type") == "tool_use":
                lines.append(f"tool {block.get('name')}: {json.dumps(block.get('input'))[:CLIP]}")
            elif block.get("type") == "tool_result":
                lines.append(f"result: {str(block.get('content'))[:CLIP]}")
    return "\n".join(lines)[-MAX_TRANSCRIPT:]


def judge(key, scenario, transcript):
    questions = {name: {"type": "noul", "instructions": text} for name, text in QUESTIONS.items()}
    state = {"expected_behaviour": scenario.get("expected", ""), "transcript": transcript}
    response, _ms = call_jev(key, state, questions)
    return verdict(json.dumps(response))


def main(prefixes):
    key = read_api_key(ROOT)
    names = sorted(name for name in os.listdir(os.path.join(HERE, "scenarios")) if name.endswith(".md"))
    chosen = [name for name in names if not prefixes or name.startswith(tuple(prefixes))]
    failed = 0
    for name in chosen:
        scenario = sections(os.path.join(HERE, "scenarios", name))
        work = prepare(scenario)
        status, fired = judge(key, scenario, run_agent(work, scenario["prompt"]))
        failed += status != "PASS"
        print(f"{status:5} {name} {', '.join(fired)}  ({work}/transcript.jsonl)")
    return 1 if failed else 0


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except ReviewError as error:
        print(f"error: {error}", file=sys.stderr)
        sys.exit(4)
