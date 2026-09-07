import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

type ToolInput = Record<string, unknown>;

const GUARD_PATH = resolve(__dirname, "../../hooks/tdd_guard.py");

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
    if (event.toolName !== "edit" && event.toolName !== "write") return;

    const input = asRecord(event.input);
    const toolName = event.toolName === "edit" ? "MultiEdit" : "Write";
    const reason = runGuard({
      tool_name: toolName,
      tool_input: legacyInput(event.toolName, input),
      cwd: ctx.cwd,
    });
    if (reason) return { block: true, reason };
  });
}
