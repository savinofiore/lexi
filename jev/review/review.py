#!/usr/bin/env python3
"""jev-review: has Jev (TypeSafe) judge a diff and leaves the verdict to the policy.

Jev answers the closed questions in checks.json with calibrated probabilities. The verdict is
never asked of the model: this file applies the thresholds in policy.json. No question, threshold
or check name lives here: correcting a judgement means editing JSON. A project adds its own
checks and rules in `.lexi/review.json` and passes its `testable` paths through `.lexi.json`.
"""
from __future__ import annotations

import argparse
import copy
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
API_URL = "https://api.typesafe.ai/v1/systemone"
MODEL = "jev-latest"
EXIT_ERROR = 4
MAX_ATTEMPTS = 3
RETRY_STATUSES = {429, 529}
QUESTION_FIELDS = {"type", "instructions", "criteria"}
OVERLAY = os.path.join(".lexi", "review.json")
OPS = {"gte": (">=", lambda a, b: a >= b), "gt": (">", lambda a, b: a > b),
       "lte": ("<=", lambda a, b: a <= b), "lt": ("<", lambda a, b: a < b)}
FILE_HEADER = re.compile(r"^diff --git a/(.+?) b/(.+)$", re.M)
BAR_WIDTH = 24
ANSI = {"red": "1;31", "yellow": "1;33", "yellow_dim": "33", "green": "1;32", "blue": "34", "cyan": "1;36",
        "magenta": "1;35", "gray": "90", "bold": "1", "warn": "1;30;43"}


class ReviewError(Exception):
    """Error that ends the CLI with EXIT_ERROR (never a verdict)."""


# --- configuration ------------------------------------------------------------

def load_json(name):
    with open(os.path.join(HERE, name), encoding="utf-8") as handle:
        return json.load(handle)


def only_checks(entries):
    """String entries (`_read_me`, `_quality`) are comments for whoever edits the file, not questions."""
    return {cid: check for cid, check in entries.items() if isinstance(check, dict)}


def load_checks():
    return only_checks(load_json("checks.json"))


def project_root():
    result = subprocess.run(["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True)
    return result.stdout.strip() if result.returncode == 0 else os.getcwd()


def read_project_json(root, name):
    path = os.path.join(root, name)
    if not os.path.exists(path):
        return {}
    try:
        with open(path, encoding="utf-8") as handle:
            return json.load(handle)
    except ValueError as error:
        raise ReviewError(f"{name} is not valid JSON: {error}") from None


def merge_overlay(checks, policy, overlay):
    """Project checks win over core ones with the same id; project rules append to the named lane."""
    checks = {**checks, **only_checks(overlay.get("checks", {}))}
    policy = copy.deepcopy(policy)
    lanes = {lane["name"]: lane for lane in policy["verdicts"]}
    for name, rules in overlay.get("rules", {}).items():
        if name not in lanes:
            raise ReviewError(f"{OVERLAY}: unknown lane {name!r}; lanes are {', '.join(lanes)}")
        lanes[name]["rules"] = lanes[name]["rules"] + rules
    policy["state_limits"]["drop_first_patterns"] += overlay.get("drop_first_patterns", [])
    unknown = sorted(checks_in_policy(policy) - set(checks))
    if unknown:  # a rule on a missing check would never fire, silently
        raise ReviewError(f"policy rules name checks that do not exist: {', '.join(unknown)}")
    return checks, policy


def load_config(root):
    return merge_overlay(load_checks(), load_json("policy.json"), read_project_json(root, OVERLAY))


def read_api_key():
    key = os.environ.get("TYPESAFE_API_KEY", "").strip()
    if key:
        return key
    raise ReviewError(
        "TYPESAFE_API_KEY not set. Export it in the shell (`export TYPESAFE_API_KEY=...`) "
        "or add it under \"env\" in ~/.claude/settings.json. The key is never printed.")


# --- diff source --------------------------------------------------------------

def run_git(*args):
    result = subprocess.run(["git", *args], capture_output=True, text=True)
    if result.returncode != 0:
        raise ReviewError(f"git {' '.join(args)}: {result.stderr.strip()}")
    return result.stdout


def parse_commits(raw):
    """Title and description from commit messages (records split by \\x1e, fields by \\x1f)."""
    commits = [record.split("\x1f", 1) for record in raw.split("\x1e") if record.strip()]
    if not commits:
        return "", ""
    if len(commits) == 1:
        subject, body = commits[0]
        return subject.strip(), body.strip()
    return commits[0][0].strip(), "\n".join(f"- {subject.strip()}" for subject, _ in commits)


def working_diff():
    """git diff HEAD plus untracked files: a new file is exactly where a secret is born."""
    diff = run_git("diff", "HEAD")
    for path in run_git("ls-files", "--others", "--exclude-standard").splitlines():
        # --no-index exits 1 when it finds differences: not an error
        diff += subprocess.run(["git", "diff", "--no-index", "--", "/dev/null", path], capture_output=True, text=True).stdout
    return diff


def load_source(args):
    if args.diff:
        with open(args.diff, encoding="utf-8", errors="replace") as handle:
            diff = handle.read()
        title, description = os.path.basename(args.diff), ""
    elif args.git:
        diff = run_git("diff", args.git, "HEAD")
        title, description = parse_commits(run_git("log", "--format=%s%x1f%b%x1e", f"{args.git}..HEAD"))
    else:
        diff = working_diff()
        title, description = f"Uncommitted changes on {run_git('branch', '--show-current').strip()}", ""
    return diff, args.title or title, args.description or description


def split_diff(diff):
    """[(path, chunk)] in diff order; a diff without headers stays one chunk."""
    starts = [match.start() for match in FILE_HEADER.finditer(diff)]
    if not starts:
        return [("", diff)] if diff.strip() else []
    files = []
    for index, start in enumerate(starts):
        end = starts[index + 1] if index + 1 < len(starts) else len(diff)
        chunk = diff[start:end]
        files.append((FILE_HEADER.match(chunk).group(2), chunk))
    return files


# --- truncation ---------------------------------------------------------------

def compile_patterns(patterns):
    return [re.compile(pattern, re.I) for pattern in patterns]


def matches_any(patterns, path, content=""):
    return any(pattern.search(path) or (content and pattern.search(content)) for pattern in patterns)


def critical_patterns(checks):
    return compile_patterns(p for check in checks.values() if check.get("critical") for p in check["escalation_patterns"])


def rank(path, chunk, critical, drop_first):
    """0 = relevant to a critical check, 1 = normal, 2 = lockfile/generated/asset (dropped first)."""
    if matches_any(drop_first, path):
        return 2
    return 0 if matches_any(critical, path, chunk) else 1


def fit_diff(files, checks, policy, overhead=0):
    """Keeps the files that fit the budget, by priority. Returns (kept, omitted)."""
    limits = policy["state_limits"]
    budget = limits["max_state_tokens"] * limits["chars_per_token"] - overhead
    critical, drop_first = critical_patterns(checks), compile_patterns(limits["drop_first_patterns"])
    ranked = sorted(enumerate(files), key=lambda item: (rank(*item[1], critical, drop_first), item[0]))
    kept, used = {}, 0
    for index, (path, chunk) in ranked:
        if used + len(chunk) <= budget:
            kept[index], used = (path, chunk), used + len(chunk)
    if files and not kept:  # the first file alone overflows: better cut it than send an empty diff
        index, (path, chunk) = ranked[0]
        kept[index] = (path, chunk[:budget] + "\n[... truncated by jev-review: file over budget ...]\n")
    omitted = [path for index, (path, _) in enumerate(files) if index not in kept]
    return [kept[index] for index in sorted(kept)], omitted


def build_state(title, description, files, omitted):
    changed = [path for path, _ in files] + [f"{path} [omitted: over size limit]" for path in omitted]
    return {"pr_title": title, "pr_description": description, "changed_files": changed,
            "omitted_files": len(omitted), "diff": "".join(chunk for _, chunk in files)}


# --- calling Jev --------------------------------------------------------------

def public_questions(checks):
    """Only the fields the API knows: label, critical, patterns and _why stay here."""
    return {cid: {k: v for k, v in check.items() if k in QUESTION_FIELDS} for cid, check in checks.items()}


def describe_http_error(error):
    detail = error.read().decode("utf-8", "replace")[:600]
    if error.code == 401:
        return "invalid TYPESAFE_API_KEY (HTTP 401)."
    if error.code == 400:
        return f"Jev refused the request (HTTP 400, usually max_tokens_exceeded: lower max_state_tokens in policy.json): {detail}"
    if error.code == 422:
        return f"malformed request (HTTP 422), check checks.json and {OVERLAY}: {detail}"
    if error.code in RETRY_STATUSES:
        return f"Jev unavailable after {MAX_ATTEMPTS} attempts (HTTP {error.code})."
    return f"HTTP {error.code}: {detail}"


def call_jev(key, state, questions):
    body = json.dumps({"state": state, "model": MODEL, "questions": questions}).encode("utf-8")
    headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    request = urllib.request.Request(API_URL, data=body, method="POST", headers=headers)
    started = time.monotonic()
    for attempt in range(MAX_ATTEMPTS):
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                return json.load(response), int((time.monotonic() - started) * 1000)
        except urllib.error.HTTPError as error:
            if error.code not in RETRY_STATUSES or attempt == MAX_ATTEMPTS - 1:
                raise ReviewError(describe_http_error(error)) from None
            time.sleep(2 ** attempt)
        except urllib.error.URLError as error:
            raise ReviewError(f"network unreachable: {error.reason}") from None
    raise ReviewError("Jev did not answer.")


# --- policy -------------------------------------------------------------------

def numeric(answers, check_id):
    answer = answers.get(check_id, {})
    return answer.get("noul", answer.get("score"))


def unless_of(rule):
    """`unless` can be one object or a list: any condition that holds cancels the rule."""
    unless = rule.get("unless") or []
    return unless if isinstance(unless, list) else [unless]


def holds(rule, answers):
    value = numeric(answers, rule["check"])
    if value is None or not OPS[rule["op"]][1](value, rule["value"]):
        return False
    return not any(holds(condition, answers) for condition in unless_of(rule))


def describe(rule, answers):
    return f"{rule['check']} {numeric(answers, rule['check']):.2f} {OPS[rule['op']][0]} {rule['value']}"


def evaluate(policy, answers):
    """Lanes in order: the first with a firing rule wins; the last is the default."""
    fired = [{"lane": lane["name"], "check": rule["check"], "op": rule["op"], "threshold": rule["value"],
              "value": numeric(answers, rule["check"]), "comparison": describe(rule, answers)}
             for lane in policy["verdicts"] for rule in lane["rules"] if holds(rule, answers)]
    lanes_hit = {entry["lane"] for entry in fired}
    winner = next((lane for lane in policy["verdicts"] if lane["name"] in lanes_hit), policy["verdicts"][-1])
    return winner, fired


def checks_in_policy(policy):
    rules = [rule for lane in policy["verdicts"] for rule in lane["rules"]]
    return {rule["check"] for rule in rules} | {c["check"] for rule in rules for c in unless_of(rule)}


def question_text(check):
    instructions = check["instructions"]
    return instructions["question"] if isinstance(instructions, dict) else str(instructions)


def files_for(check, files):
    hits = [path for path, chunk in files if matches_any(compile_patterns(check["escalation_patterns"]), path, chunk)]
    return hits or [path for path, _ in files]


def needs_escalation(check, value, band):
    """Uncertainty band for critical checks; `escalate_when` replaces it (e.g. an always-on trigger)."""
    if value is None or not check.get("critical"):
        return False
    when = check.get("escalate_when")
    if when:
        return OPS[when["op"]][1](value, when["value"])
    return band["low"] <= value <= band["high"]


def escalations(checks, policy, answers, files):
    band = policy["uncertainty_band"]
    return [{"check": cid, "value": answers[cid]["noul"], "question": question_text(check),
             "files": files_for(check, files), "escalate_to": check.get("escalate_to")}
            for cid, check in checks.items() if needs_escalation(check, answers.get(cid, {}).get("noul"), band)]


def handoff(fired, escalation, checks, files, policy):
    """The handoff to the coding agent: every fired rule gets located, every uncertainty verified,
    every trigger delegated. The labels (`locate`/`verify`/`delegate`) come from policy.json."""
    asks = policy["handoff"]
    located = [{"check": f["check"], "value": f["value"], "lane": f["lane"], "ask": asks["fired_rules"],
                "question": question_text(checks[f["check"]]), "files": files_for(checks[f["check"]], files),
                "escalate_to": checks[f["check"]].get("escalate_to")} for f in fired]
    verified = [{**item, "ask": asks["delegated"] if item.get("escalate_to") else asks["uncertain"]} for item in escalation]
    return located + verified


ASK_RULES = {
    "locate": "the rule fired: find the exact line (`path:line`) in the listed files only and propose the minimal fix, without applying it",
    "verify": "Jev is uncertain: open the listed files only and answer the question with one sentence and the line that proves it",
    "delegate": "hand files and question to the named delegate and report its outcome in two lines",
}


def handoff_prompt(title, verdict, items, band):
    lines = [f"Jev computed the verdict {verdict} on \"{title}\": do not rewrite it. Handoff, "
             f"{len(items)} items (uncertainty band {band['low']}-{band['high']}):"]
    lines += [f"- {ask}: {rule}" for ask, rule in ASK_RULES.items() if any(i["ask"] == ask for i in items)] + [""]
    for item in items:
        lane = f" ({item['lane']})" if item.get("lane") else ""
        lines += [f"## [{item['ask']}] {item['check']} — Jev: {item['value']:.2f}{lane}", f"Question: {item['question']}",
                  "Files: " + ", ".join(item["files"])]
        lines += [f"Delegate/remedy: {item['escalate_to']}"] if item.get("escalate_to") else []
        lines.append("")
    return "\n".join(lines)


def compare(report, previous_path, policy):
    """Agent → Jev: after a fix, rerun and compare numbers, not opinions."""
    with open(previous_path, encoding="utf-8") as handle:
        previous = json.load(handle)
    before = {**previous.get("probabilities", {}), **{k: v["score"] for k, v in previous.get("scores", {}).items()}}
    after = {**report["probabilities"], **{k: v["score"] for k, v in report["scores"].items()}}
    deltas = {cid: {"before": before[cid], "after": after[cid], "delta": round(after[cid] - before[cid], 2)}
              for cid in after if cid in before and abs(after[cid] - before[cid]) >= policy["compare_min_delta"]}
    return {"previous_file": previous_path, "previous_verdict": previous.get("verdict"), "deltas": deltas}


# --- output -------------------------------------------------------------------

def paint(text, color, enabled):
    return f"\033[{ANSI[color]}m{text}\033[0m" if enabled and color in ANSI else text


def bar_color(value, higher_is_better, thresholds):
    risk = 1 - value if higher_is_better else value
    if risk >= thresholds["red_from"]:
        return "red"
    return "yellow" if risk >= thresholds["yellow_from"] else "blue"


def noul_row(cid, check, value, unused, policy, color_on):
    filled = round(value * BAR_WIDTH)
    bar = "█" * filled + "░" * (BAR_WIDTH - filled)
    if unused:
        return paint(f"  {check['label']:<23} {bar} {value:5.2f}  (not used by the policy)", "gray", color_on)
    color = bar_color(value, check.get("higher_is_better", False), policy["bar_colors"])
    return f"  {check['label']:<23} {paint(bar, color, color_on)} {value:5.2f}"


def nearest_level(answer):
    return answer["legend"].get(str(round(answer["score"])), "?")


def render(report, checks, policy, color_on):
    answers, lines = report["answers"], []
    if report["omitted_files"]:
        lines.append(paint(f" WARNING: diff truncated, {report['omitted_files']} files omitted: "
                           f"{', '.join(report['omitted_paths'])} ", "warn", color_on))
    lines += [paint(report["title"], "bold", color_on), paint("  " + ", ".join(report["changed_files"]), "gray", color_on), ""]
    used = checks_in_policy(policy)
    nouls = [cid for cid, c in checks.items() if c["type"] == "noul"]
    for cid in sorted(nouls, key=lambda cid: cid not in used):  # checks outside the policy go last
        lines.append(noul_row(cid, checks[cid], answers[cid]["noul"], cid not in used, policy, color_on))
    lines.append("")
    for cid, check in checks.items():
        if check["type"] == "score":
            lines.append(f"  {check['label']:<23} {answers[cid]['score']:.1f}  {nearest_level(answers[cid])}")
        elif check["type"] == "choice":
            lines.append(f"  {check['label']:<23} {answers[cid]['choice']}  (confidence {answers[cid]['confidence']:.2f})")
    lines += ["", paint(f"  ══ {report['verdict']} ══", report["verdict_color"], color_on)]
    lines += [f"    {f['comparison']}  → {f['lane']}" for f in report["fired_rules"]] or ["    no rule fired"]
    lines += ["", render_escalation(report, policy)]
    lines += [render_compare(report)] if report.get("compare") else []
    usage = report["usage"]
    lines.append(paint(f"  {report['ms']} ms · {usage['input_tokens']} input tokens · ${report['cost_usd']:.5f}", "gray", color_on))
    return "\n".join(lines)


def render_compare(report):
    delta = report["compare"]
    lines = [f"  COMPARED with {delta['previous_file']}: {delta['previous_verdict']} → {report['verdict']}"]
    lines += [f"    {cid} {d['before']:.2f} → {d['after']:.2f} ({d['delta']:+.2f})" for cid, d in delta["deltas"].items()]
    return "\n".join(lines) + "\n"


def render_escalation(report, policy):
    band = policy["uncertainty_band"]
    if report.get("handoff_prompt"):
        return report["handoff_prompt"]
    if not report["escalation"]:
        return f"  no escalation: every critical check is outside the band {band['low']}-{band['high']}"
    lines = [f"  ESCALATION: {len(report['escalation'])} checks to look into (band {band['low']}-{band['high']} or trigger)"]
    lines += [f"    {item['check']} {item['value']:.2f} → {', '.join(item['files'])}"
              + (f"  [{item['escalate_to']}]" if item.get("escalate_to") else "") for item in report["escalation"]]
    return "\n".join(lines) + "\n"


# --- main ---------------------------------------------------------------------

def parse_args(argv):
    parser = argparse.ArgumentParser(prog="jev-review", description=__doc__.splitlines()[0])
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--diff", metavar="FILE", help="unified diff from a file")
    source.add_argument("--git", metavar="REF", help="diff between REF and HEAD, title and description from the commits")
    source.add_argument("--working", action="store_true", help="uncommitted changes (git diff HEAD plus untracked files)")
    parser.add_argument("--title", help="PR title (overrides the inferred one)")
    parser.add_argument("--description", help="PR description (overrides the inferred one)")
    parser.add_argument("--json", action="store_true", help="JSON output for CI and skills")
    parser.add_argument("--escalate", action="store_true", help="print the handoff as a prompt (fired rules, uncertain checks, delegates)")
    parser.add_argument("--compare", metavar="FILE", help="JSON of a previous review: print per-check deltas")
    return parser.parse_args(argv)


def summarise(answers):
    """Jev's answers in the output JSON shape: probabilities, scores with level, choices."""
    return {"probabilities": {cid: a["noul"] for cid, a in answers.items() if a["type"] == "noul"},
            "scores": {cid: {"score": a["score"], "level": nearest_level(a), "confidence": a["confidence"]}
                       for cid, a in answers.items() if a["type"] == "score"},
            "choices": {cid: {"choice": a["choice"], "confidence": a["confidence"], "probabilities": a["probabilities"]}
                        for cid, a in answers.items() if a["type"] == "choice"}}


def build_report(args, checks, policy, testable):
    diff, title, description = load_source(args)
    files = split_diff(diff)
    if not files:
        return None
    overhead = len(title) + len(description) + sum(len(path) for path, _ in files)
    kept, omitted = fit_diff(files, checks, policy, overhead)
    state = {**build_state(title, description, kept, omitted), "testable_paths": testable}
    response, ms = call_jev(read_api_key(), state, public_questions(checks))
    answers = response["answers"]
    verdict, fired = evaluate(policy, answers)
    escalation = escalations(checks, policy, answers, kept)
    tokens = response.get("usage", {}).get("input_tokens", 0)
    report = {"title": title, "changed_files": [p for p, _ in files], "omitted_files": len(omitted), "omitted_paths": omitted,
              "verdict": verdict["name"], "exit_code": verdict["exit_code"], "verdict_color": verdict["color"],
              "fired_rules": fired, **summarise(answers), "escalation": escalation, "ms": ms,
              "model": response.get("model"), "usage": response.get("usage", {}), "answers": answers,
              "cost_usd": round(tokens * policy["pricing"]["input_usd_per_million_tokens"] / 1_000_000, 6)}
    report["handoff"] = handoff(fired, escalation, checks, kept, policy)
    if args.escalate and report["handoff"]:
        report["handoff_prompt"] = handoff_prompt(title, verdict["name"], report["handoff"], policy["uncertainty_band"])
    if args.compare:
        report["compare"] = compare(report, args.compare, policy)
    return report


def main(argv=None):
    args = parse_args(argv)
    try:
        root = project_root()
        checks, policy = load_config(root)
        report = build_report(args, checks, policy, read_project_json(root, ".lexi.json").get("testable", []))
    except ReviewError as error:
        print(f"jev-review: {error}", file=sys.stderr)
        return EXIT_ERROR
    if report is None:
        print("Empty diff: nothing to review.")
        return 0
    if args.json:
        print(json.dumps({k: v for k, v in report.items() if k != "answers"}, indent=2, ensure_ascii=False))
    else:
        print(render(report, checks, policy, sys.stdout.isatty() and not os.environ.get("NO_COLOR")))
    return report["exit_code"]


if __name__ == "__main__":
    sys.exit(main())
