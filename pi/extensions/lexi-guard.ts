import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

type ToolInput = Record<string, unknown>;

const GUARD_PATH = resolve(__dirname, "../../hooks/tdd_guard.py");
// Pi tool name -> the Claude Code name the guard speaks. Bash writes answer to the same rules.
const TOOL_NAMES: Record<string, string> = { edit: "MultiEdit", write: "Write", bash: "Bash" };

const asRecord = (value: unknown): ToolInput =>
  typeof value === "object" && value !== null ? value as ToolInput : {};

const runGuard = (payload: ToolInput): string | undefined => {
  const result = spawnSync("python3", [GUARD_PATH], {
    input: JSON.stringify(payload),
    encoding: "utf8",
  });
  if (result.error) return `lexi guard unavailable: ${result.error.message}`;
  return result.status === 0 ? undefined : String(result.stderr).trim();
};

const legacyInput = (toolName: string, input: ToolInput): ToolInput => {
  if (toolName === "edit") {
    const edits = Array.isArray(input.edits) ? input.edits : [];
    return {
      file_path: input.path,
      edits: edits.map((edit) => {
        const item = asRecord(edit);
        return { old_string: item.oldText, new_string: item.newText };
      }),
    };
  }
  return { file_path: input.path };
};

export default function (pi: ExtensionAPI) {
  pi.on("tool_call", (event, ctx) => {
    if (!(event.toolName in TOOL_NAMES)) return;

    const input = asRecord(event.input);
    const reason = runGuard({
      tool_name: TOOL_NAMES[event.toolName],
      tool_input: event.toolName === "bash" ? { command: input.command } : legacyInput(event.toolName, input),
      cwd: ctx.cwd,
    });
    if (reason) return { block: true, reason };
  });
}
