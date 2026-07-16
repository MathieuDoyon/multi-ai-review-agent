import { describe, expect, it, vi } from "vitest";
import { runMultiAiReview } from "./review.js";
import type { AgentRunner, ShellRunner } from "./types.js";

function shellWithGitContext(): ShellRunner {
  return async (command: string) => {
    const responses: Record<string, string> = {
      "git rev-parse --verify origin/main^{commit}": "base\n",
      "git merge-base HEAD origin/main": "merge-base\n",
      "git diff --stat merge-base..HEAD": "src/file.ts | 2 +-\n",
      "git diff --name-status merge-base..HEAD": "M\tsrc/file.ts\n",
      "git diff merge-base..HEAD": "diff --git a/src/file.ts b/src/file.ts\n+new line\n",
    };
    const response = responses[command];
    if (response === undefined) throw new Error(`unexpected command: ${command}`);
    return response;
  };
}

const FINDING_JSON = `\`\`\`json\n${JSON.stringify({
  summary: "summary",
  findings: [
    {
      title: "Missing null guard",
      severity: "high",
      confidence: "high",
      file: "src/file.ts",
      line: 12,
      category: "bug",
      evidence: "value may be null",
      recommendation: "Add a guard",
      falsePositiveRisk: "Caller may validate",
    },
  ],
})}\n\`\`\``;

describe("runMultiAiReview", () => {
  it("runs each model through the agent runner and renders grouped findings", async () => {
    const runAgent = vi.fn<AgentRunner>(async ({ model }) => ({ model, ok: true, stdout: FINDING_JSON }));

    const report = await runMultiAiReview({
      runAgent,
      shell: shellWithGitContext(),
      models: ["claude-opus-4-8-high", "gpt-5.3-codex-high"],
      limits: { maxDiffBytes: 1000, maxDiffLines: 100, maxFiles: 10 },
    });

    expect(runAgent).toHaveBeenCalledTimes(2);
    expect(report).toContain("Missing null guard");
    expect(report).toContain("claude-opus-4-8-high, gpt-5.3-codex-high");
    expect(report).toContain("address");
  });

  it("builds the prompt once and shares it across models", async () => {
    const prompts = new Set<string>();
    const runAgent = vi.fn<AgentRunner>(async ({ model, prompt }) => {
      prompts.add(prompt);
      return { model, ok: true, stdout: FINDING_JSON };
    });

    await runMultiAiReview({
      runAgent,
      shell: shellWithGitContext(),
      models: ["claude-opus-4-8-high", "gpt-5.3-codex-high"],
      limits: { maxDiffBytes: 1000, maxDiffLines: 100, maxFiles: 10 },
    });

    expect(prompts.size).toBe(1);
  });

  it("reports a failed agent run as a reviewer failure", async () => {
    const runAgent = vi.fn<AgentRunner>(async ({ model }) => ({ model, ok: false, reason: "boom" }));

    const report = await runMultiAiReview({
      runAgent,
      shell: shellWithGitContext(),
      models: ["claude-opus-4-8-high"],
      limits: { maxDiffBytes: 1000, maxDiffLines: 100, maxFiles: 10 },
    });

    expect(report).toContain("## Reviewer Failures");
    expect(report).toContain("boom");
  });

  it("reports malformed reviewer output as a reviewer failure", async () => {
    const runAgent = vi.fn<AgentRunner>(async ({ model }) => ({ model, ok: true, stdout: "not json" }));

    const report = await runMultiAiReview({
      runAgent,
      shell: shellWithGitContext(),
      models: ["claude-opus-4-8-high"],
      limits: { maxDiffBytes: 1000, maxDiffLines: 100, maxFiles: 10 },
    });

    expect(report).toContain("Could not parse reviewer JSON output");
  });

  it("persists raw reviewer output on parse failure and includes the path in the reason", async () => {
    const runAgent = vi.fn<AgentRunner>(async ({ model }) => ({ model, ok: true, stdout: "not json" }));
    const saveRawOutput = vi.fn(async () => "/tmp/fake/raw.txt");

    const report = await runMultiAiReview({
      runAgent,
      shell: shellWithGitContext(),
      models: ["claude-opus-4-8-high"],
      limits: { maxDiffBytes: 1000, maxDiffLines: 100, maxFiles: 10 },
      saveRawOutput,
    });

    expect(report).toContain(
      "Could not parse reviewer JSON output (raw output: /tmp/fake/raw.txt)",
    );
    expect(saveRawOutput).toHaveBeenCalledWith("claude-opus-4-8-high", "not json");
  });

  it("falls back to the plain parse-failure reason when saveRawOutput rejects", async () => {
    const runAgent = vi.fn<AgentRunner>(async ({ model }) => ({ model, ok: true, stdout: "not json" }));
    const saveRawOutput = vi.fn(async () => {
      throw new Error("disk full");
    });

    const report = await runMultiAiReview({
      runAgent,
      shell: shellWithGitContext(),
      models: ["claude-opus-4-8-high"],
      limits: { maxDiffBytes: 1000, maxDiffLines: 100, maxFiles: 10 },
      saveRawOutput,
    });

    expect(report).toContain("Could not parse reviewer JSON output");
    expect(report).not.toContain("raw output:");
  });

  it("isolates a rejecting runAgent to a reviewer failure for that model", async () => {
    const runAgent = vi.fn<AgentRunner>(async ({ model }) => {
      if (model === "bad-model") throw new Error("spawn exploded");
      return { model, ok: true, stdout: FINDING_JSON };
    });

    const report = await runMultiAiReview({
      runAgent,
      shell: shellWithGitContext(),
      models: ["bad-model", "claude-opus-4-8-high"],
      limits: { maxDiffBytes: 1000, maxDiffLines: 100, maxFiles: 10 },
    });

    expect(report).toContain("Missing null guard");
    expect(report).toContain("## Reviewer Failures");
    expect(report).toContain("bad-model");
    expect(report).toContain("spawn exploded");
  });
});
