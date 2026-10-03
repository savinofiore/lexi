import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

// Pi side of hooks/session_hint.py: the same one line, from the same script, appended to the
// system prompt of a lexi project. Read once per session so the system prompt never shifts.
const HINT_PATH = resolve(__dirname, "../../hooks/session_hint.py");

const readHint = (cwd: string): string | undefined => {
  const result = spawnSync("python3", [HINT_PATH], { input: JSON.stringify({ cwd }), encoding: "utf8" });
  try {
    return JSON.parse(result.stdout).hookSpecificOutput.additionalContext as string;
  } catch {
    return undefined; // no .lexi.json, or no python3: no hint
  }
};

export default function (pi: ExtensionAPI) {
  let hint: string | undefined | null = null; // null: not read yet
  pi.on("session_start", async () => {
    hint = null;
  });
  pi.on("before_agent_start", async (event, ctx) => {
    hint ??= readHint(ctx.cwd);
    return hint ? { systemPrompt: `${event.systemPrompt}\n\n${hint}` } : undefined;
  });
}
