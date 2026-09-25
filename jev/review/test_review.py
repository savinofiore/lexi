"""Minimal check of review.py's pure logic: `python3 jev/review/test_review.py`."""
import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import review  # noqa: E402

CORE_CHECKS = review.load_checks()
CORE_POLICY = review.load_json("policy.json")
# A project overlay as `.lexi/review.json` would carry it: one convention check and one delegated trigger.
OVERLAY = {
    "checks": {
        "layer_bypass": {"label": "Layer bypass", "critical": False, "escalation_patterns": ["provider"],
                         "type": "noul", "instructions": "Does the UI call the HTTP client directly?"},
        "new_translation_key": {"label": "New translation key", "critical": True, "escalation_patterns": ["\\.tr\\("],
                                "escalate_when": {"op": "gte", "value": 0.5}, "escalate_to": "agent:translator",
                                "type": "noul", "instructions": "Does the diff add a translation key?"},
    },
    "rules": {"CONVENTIONS": [{"check": "layer_bypass", "op": "gte", "value": 0.7}]},
}
CHECKS, POLICY = review.merge_overlay(CORE_CHECKS, CORE_POLICY, OVERLAY)


def nouls(**values):
    return {cid: {"type": "noul", "noul": value} for cid, value in values.items()}


class PolicyTest(unittest.TestCase):
    def test_block_wins_over_lower_lanes(self):
        verdict, fired = review.evaluate(POLICY, nouls(hardcoded_secret=0.96, debug_leftovers=0.9))
        self.assertEqual(verdict["name"], "BLOCK")
        self.assertEqual([f["comparison"] for f in fired], ["hardcoded_secret 0.96 >= 0.7", "debug_leftovers 0.90 >= 0.7"])

    def test_unless_cancels_adds_tests_on_docs_only(self):
        verdict, fired = review.evaluate(POLICY, nouls(adds_tests=0.05, docs_only=0.9))
        self.assertEqual((verdict["name"], fired), ("MERGE", []))

    def test_adds_tests_fires_when_not_docs_only(self):
        verdict, _ = review.evaluate(POLICY, nouls(adds_tests=0.05, docs_only=0.1))
        self.assertEqual(verdict["name"], "NITS")

    def test_missing_answer_never_fires(self):
        verdict, _ = review.evaluate(POLICY, {})
        self.assertEqual(verdict["name"], "MERGE")

    def test_merge_ready_is_outside_policy(self):
        self.assertNotIn("merge_ready", review.checks_in_policy(POLICY))
        self.assertIn("docs_only", review.checks_in_policy(POLICY))

    def test_core_policy_only_names_core_checks(self):
        self.assertEqual(review.checks_in_policy(CORE_POLICY) - set(CORE_CHECKS), set())


class OverlayTest(unittest.TestCase):
    def test_project_rules_append_to_their_lane_without_touching_the_core_policy(self):
        lane = next(lane for lane in POLICY["verdicts"] if lane["name"] == "CONVENTIONS")
        self.assertEqual([rule["check"] for rule in lane["rules"]], ["layer_bypass"])
        core_lane = next(lane for lane in CORE_POLICY["verdicts"] if lane["name"] == "CONVENTIONS")
        self.assertEqual(core_lane["rules"], [])

    def test_project_check_wins_over_core_check_with_same_id(self):
        overlay = {"checks": {"debug_leftovers": {**CORE_CHECKS["debug_leftovers"], "label": "Project leftovers"}}}
        checks, _ = review.merge_overlay(CORE_CHECKS, CORE_POLICY, overlay)
        self.assertEqual(checks["debug_leftovers"]["label"], "Project leftovers")

    def test_unknown_lane_is_an_error(self):
        with self.assertRaisesRegex(review.ReviewError, "unknown lane 'STYLE'"):
            review.merge_overlay(CORE_CHECKS, CORE_POLICY, {"rules": {"STYLE": []}})

    def test_rule_on_a_missing_check_is_an_error(self):
        overlay = {"rules": {"CONVENTIONS": [{"check": "ghost", "op": "gte", "value": 0.7}]}}
        with self.assertRaisesRegex(review.ReviewError, "ghost"):
            review.merge_overlay(CORE_CHECKS, CORE_POLICY, overlay)

    def test_missing_overlay_file_is_no_overlay(self):
        with tempfile.TemporaryDirectory() as root:
            self.assertEqual(review.read_project_json(root, review.OVERLAY), {})
            with open(os.path.join(root, ".lexi.json"), "w") as handle:
                json.dump({"testable": ["src/domain/"]}, handle)
            self.assertEqual(review.read_project_json(root, ".lexi.json")["testable"], ["src/domain/"])


class DiffTest(unittest.TestCase):
    def test_split_keeps_order_and_paths(self):
        diff = "diff --git a/a.py b/a.py\n+x\ndiff --git a/b.py b/b.py\n+y\n"
        self.assertEqual([p for p, _ in review.split_diff(diff)], ["a.py", "b.py"])

    def test_truncation_drops_lockfile_first_and_keeps_critical(self):
        files = [("package-lock.json", "diff --git" + "x" * 500), ("src/auth/session.py", "diff --git" + "y" * 500),
                 ("README.md", "diff --git" + "z" * 500)]
        policy = {**POLICY, "state_limits": {**POLICY["state_limits"], "chars_per_token": 1, "max_state_tokens": 1100}}
        kept, omitted = review.fit_diff(files, CHECKS, policy)
        self.assertEqual([p for p, _ in kept], ["src/auth/session.py", "README.md"])
        self.assertEqual(omitted, ["package-lock.json"])

    def test_commit_parsing(self):
        self.assertEqual(review.parse_commits("Fix login\x1fBody here\x1e"), ("Fix login", "Body here"))
        self.assertEqual(review.parse_commits("Second\x1f\x1eFirst\x1fb\x1e"), ("Second", "- Second\n- First"))


class UnlessListTest(unittest.TestCase):
    def test_any_condition_in_the_list_cancels_the_rule(self):
        verdict, fired = review.evaluate(POLICY, nouls(adds_tests=0.05, docs_only=0.1, outside_test_perimeter=0.9))
        self.assertEqual((verdict["name"], fired), ("MERGE", []))

    def test_rule_fires_when_no_condition_holds(self):
        verdict, _ = review.evaluate(POLICY, nouls(adds_tests=0.05, docs_only=0.1, outside_test_perimeter=0.1))
        self.assertEqual(verdict["name"], "NITS")

    def test_conventions_lane_wins_over_nits_and_loses_to_block(self):
        self.assertEqual(review.evaluate(POLICY, nouls(layer_bypass=0.9, debug_leftovers=0.9))[0]["name"], "CONVENTIONS")
        self.assertEqual(review.evaluate(POLICY, nouls(layer_bypass=0.9, hardcoded_secret=0.9))[0]["name"], "BLOCK")


class EscalationTest(unittest.TestCase):
    def test_escalate_when_overrides_the_band_and_carries_the_delegate(self):
        files = [("src/pages/home.ts", "diff --git\n+'home.title'.tr()")]
        items = review.escalations(CHECKS, POLICY, nouls(new_translation_key=0.95), files)
        self.assertEqual([(i["check"], i["escalate_to"]) for i in items], [("new_translation_key", "agent:translator")])
        handed = review.handoff([], items, CHECKS, files, POLICY)
        self.assertEqual(handed[0]["ask"], "delegate")
        self.assertIn("Delegate/remedy: agent:translator", review.handoff_prompt("PR", "MERGE", handed, POLICY["uncertainty_band"]))
        self.assertEqual(review.escalations(CHECKS, POLICY, nouls(new_translation_key=0.2), files), [])

    def test_only_critical_checks_in_band_escalate(self):
        files = [("src/auth/guard.py", "diff --git\n+jwt"), ("README.md", "diff --git\n+doc")]
        answers = nouls(touches_auth=0.5, hardcoded_secret=0.9, adds_tests=0.5)
        items = review.escalations(CHECKS, POLICY, answers, files)
        self.assertEqual([(i["check"], i["files"]) for i in items], [("touches_auth", ["src/auth/guard.py"])])
        prompt = review.handoff_prompt("PR", "MERGE", review.handoff([], items, CHECKS, files, POLICY), POLICY["uncertainty_band"])
        self.assertIn("[verify] touches_auth — Jev: 0.50", prompt)
        self.assertIn("Files: src/auth/guard.py", prompt)


class HandoffTest(unittest.TestCase):
    def test_fired_rules_become_locate_and_escalations_verify_or_delegate(self):
        files = [("src/state/cart_provider.ts", "diff --git\n+state.items.push(x)"), ("README.md", "diff --git\n+doc")]
        answers = nouls(layer_bypass=0.9, touches_auth=0.5, new_translation_key=0.8)
        _, fired = review.evaluate(POLICY, answers)
        items = review.handoff(fired, review.escalations(CHECKS, POLICY, answers, files), CHECKS, files, POLICY)
        self.assertEqual([(i["ask"], i["check"]) for i in items],
                         [("locate", "layer_bypass"), ("verify", "touches_auth"), ("delegate", "new_translation_key")])
        self.assertEqual(items[0]["files"], ["src/state/cart_provider.ts"])
        prompt = review.handoff_prompt("PR", "CONVENTIONS", items, POLICY["uncertainty_band"])
        self.assertIn("## [locate] layer_bypass — Jev: 0.90 (CONVENTIONS)", prompt)
        self.assertIn("Delegate/remedy: agent:translator", prompt)

    def test_compare_reports_only_meaningful_deltas(self):
        previous = {"verdict": "CONVENTIONS", "probabilities": {"layer_bypass": 0.92, "adds_tests": 0.9},
                    "scores": {"readability": {"score": 2.4}}}
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as handle:
            json.dump(previous, handle)
            path = handle.name
        report = {"verdict": "MERGE", "probabilities": {"layer_bypass": 0.08, "adds_tests": 0.85},
                  "scores": {"readability": {"score": 0.9}}}
        result = review.compare(report, path, POLICY)
        os.unlink(path)
        self.assertEqual(result["previous_verdict"], "CONVENTIONS")
        self.assertEqual(set(result["deltas"]), {"layer_bypass", "readability"})
        self.assertEqual(result["deltas"]["layer_bypass"]["delta"], -0.84)


if __name__ == "__main__":
    unittest.main()
