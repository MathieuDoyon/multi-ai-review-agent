import { spawn } from "node:child_process";
import type { AgentInvocation, AgentResult, AgentRunner } from "./types.js";

export function buildAgentArgs(invocation: Pick<AgentInvocation, "model">): string[] {
  // --mode ask keeps the reviewer read-only (no edits, no shell, no permission
  // prompts that would hang a headless run); --trust skips the workspace-trust
  // gate that otherwise blocks headless runs in a directory Cursor hasn't seen
  // (it grants directory trust only, not command execution). The prompt is fed
  // via stdin and the plain result comes back on stdout.
  return ["--print", "--output-format", "text", "--mode", "ask", "--trust", "--model", invocation.model];
}

export function createAgentRunner(options: { timeoutMs?: number; command?: string } = {}): AgentRunner {
  const timeoutMs = options.timeoutMs ?? 240_000;
  const command = options.command ?? "agent";

  return (invocation) =>
    new Promise<AgentResult>((resolve) => {
      const child = spawn(command, buildAgentArgs(invocation), { stdio: ["pipe", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";

      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        resolve({ model: invocation.model, ok: false, reason: `Timed out after ${timeoutMs}ms` });
      }, timeoutMs);

      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      child.on("error", (error) => {
        clearTimeout(timer);
        resolve({ model: invocation.model, ok: false, reason: error.message });
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code === 0 && stdout.trim().length > 0) {
          resolve({ model: invocation.model, ok: true, stdout });
        } else {
          resolve({ model: invocation.model, ok: false, reason: stderr.trim() || `agent exited with code ${code}` });
        }
      });

      child.stdin.on("error", () => {
        // A stdin write failure (e.g. EPIPE when the child exits before
        // reading a large prompt) is always followed by the child's
        // "close" event, which already resolves the result based on exit
        // code / stdout. Swallow the stream error so it doesn't surface
        // as an unhandled 'error' event and crash the process.
      });
      child.stdin.end(invocation.prompt);
    });
}
