import { describe, expect, it } from "vitest";
import { buildAgentArgs, createAgentRunner } from "./agent.js";

describe("buildAgentArgs", () => {
  it("runs read-only print mode with text output for the given model", () => {
    expect(buildAgentArgs({ model: "claude-opus-4-8-high" })).toEqual([
      "--print",
      "--output-format",
      "text",
      "--mode",
      "ask",
      "--trust",
      "--model",
      "claude-opus-4-8-high",
    ]);
  });
});

describe("createAgentRunner", () => {
  it("resolves ok:false instead of crashing on stdin EPIPE (large prompt, process exits early)", async () => {
    const runner = createAgentRunner({ command: "/usr/bin/true", timeoutMs: 5000 });
    const largePrompt = "x".repeat(5 * 1024 * 1024);

    const result = await runner({ model: "test-model", prompt: largePrompt });

    expect(result).toMatchObject({ ok: false });
  });

  it("resolves ok:false (never rejects) when the binary does not exist", async () => {
    const runner = createAgentRunner({ command: "definitely-not-a-real-binary-xyz", timeoutMs: 5000 });

    await expect(runner({ model: "test-model", prompt: "hello" })).resolves.toMatchObject({
      ok: false,
    });
  });
});
