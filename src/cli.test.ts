import { describe, expect, it } from "vitest";
import { parsePrepArgs, parseRunArgs, runPrepCommand, runReviewCommand } from "./cli.js";
import type { CliDeps } from "./cli.js";
import type { AgentRunner, ReviewStateStore, ShellRunner } from "./types.js";

const AGENT_LIST = `Available models

auto - Auto (default)
gpt-5.3-codex - Codex 5.3
gpt-5.3-codex-high - Codex 5.3 High
cursor-grok-4.5-high - Cursor Grok 4.5
claude-opus-4-8-low - Opus 4.8 1M Low
claude-opus-4-8-medium - Opus 4.8 1M Medium
claude-opus-4-8-high - Opus 4.8 1M
`;

function fakeShell(extra: Record<string, string> = {}): ShellRunner {
  const responses: Record<string, string> = {
    "agent models": AGENT_LIST,
    "git rev-parse --verify origin/main^{commit}": "base\n",
    "git merge-base HEAD origin/main": "merge-base\n",
    "git diff --stat merge-base..HEAD": "src/file.ts | 2 +-\n",
    "git diff --name-status merge-base..HEAD": "M\tsrc/file.ts\n",
    "git diff merge-base..HEAD": "diff --git a/src/file.ts b/src/file.ts\n+x\n",
    ...extra,
  };
  return async (command) => {
    const value = responses[command];
    if (value === undefined) throw new Error(`unexpected command: ${command}`);
    return value;
  };
}

function memoryState(initial: string[] = []): ReviewStateStore {
  let models = initial;
  return {
    readLastModels: async () => models,
    writeLastModels: async (next) => {
      models = next;
    },
  };
}

function deps(overrides: Partial<CliDeps> = {}): CliDeps {
  return {
    shell: fakeShell(),
    runAgent: (async ({ model }) => ({ model, ok: true, stdout: "not json" })) as AgentRunner,
    state: memoryState(),
    limits: { maxDiffBytes: 1000, maxDiffLines: 100, maxFiles: 10 },
    ...overrides,
  };
}

describe("parseRunArgs", () => {
  it("parses models, thinking, base, and focus", () => {
    expect(
      parseRunArgs(["--models", "a,b", "--thinking", "high", "--base", "origin/dev", "--focus", "auth and tests"]),
    ).toEqual({ models: ["a", "b"], thinking: "high", baseRef: "origin/dev", focus: "auth and tests" });
  });

  it("defaults thinking to medium", () => {
    expect(parseRunArgs(["--models", "a"])).toEqual({ models: ["a"], thinking: "medium" });
  });

  it("throws when models are missing", () => {
    expect(() => parseRunArgs(["--thinking", "low"])).toThrow(/--models/);
  });

  it("throws on an invalid thinking level", () => {
    expect(() => parseRunArgs(["--models", "a", "--thinking", "deep"])).toThrow(/thinking/);
  });

  it("does not consume a following flag as a value", () => {
    expect(() => parseRunArgs(["--models", "--thinking", "high"])).toThrow(/--models/);
  });

  it("parses a --timeout value in seconds", () => {
    expect(parseRunArgs(["--models", "a", "--timeout", "480"])).toEqual({
      models: ["a"],
      thinking: "medium",
      timeoutSeconds: 480,
    });
  });

  it("throws on a non-numeric --timeout value", () => {
    expect(() => parseRunArgs(["--models", "a", "--timeout", "abc"])).toThrow(/timeout/);
  });

  it("throws on a non-positive --timeout value", () => {
    expect(() => parseRunArgs(["--models", "a", "--timeout", "0"])).toThrow(/timeout/);
  });
});

describe("parsePrepArgs", () => {
  it("reads an optional base ref positional", () => {
    expect(parsePrepArgs(["origin/main"])).toEqual({ baseRef: "origin/main" });
    expect(parsePrepArgs([])).toEqual({});
  });
});

describe("runPrepCommand", () => {
  it("emits families ordered with last-used first, plus base ref and diff stat", async () => {
    const out = JSON.parse(
      await runPrepCommand(deps({ state: memoryState(["claude-opus-4-8-high"]) }), {}),
    );
    expect(out.baseRef).toEqual({ ok: true, ref: "origin/main", mergeBase: "merge-base" });
    expect(out.diffStat).toBe("src/file.ts | 2 +-");
    expect(out.families[0].family).toBe("claude-opus-4-8");
    expect(out.lastModels).toEqual(["claude-opus-4-8-high"]);
  });

  it("reports a base-ref failure without throwing", async () => {
    const shell = fakeShell({ "git rev-parse --verify origin/main^{commit}": "" });
    const failing: ShellRunner = async (cmd) => {
      if (cmd.startsWith("git rev-parse")) throw new Error("missing");
      return shell(cmd);
    };
    const out = JSON.parse(await runPrepCommand(deps({ shell: failing }), {}));
    expect(out.baseRef.ok).toBe(false);
  });
});

describe("runReviewCommand", () => {
  it("persists the resolved lineup after running", async () => {
    const state = memoryState();
    await runReviewCommand(deps({ state }), { models: ["claude-opus-4-8-high"], thinking: "high" });
    await expect(state.readLastModels()).resolves.toEqual(["claude-opus-4-8-high"]);
  });

  it("still resolves the report when persisting the lineup fails", async () => {
    const state: ReviewStateStore = {
      readLastModels: async () => [],
      writeLastModels: async () => {
        throw new Error("disk full");
      },
    };
    await expect(
      runReviewCommand(deps({ state }), { models: ["claude-opus-4-8-high"], thinking: "medium" }),
    ).resolves.toContain("# Multi-AI Code Review");
  });

  it("resolves the thinking level to a concrete effort variant before invoking agent", async () => {
    const seen: string[] = [];
    const runAgent: AgentRunner = async ({ model }) => {
      seen.push(model);
      return { model, ok: true, stdout: "not json" };
    };
    await runReviewCommand(deps({ runAgent }), {
      models: ["claude-opus-4-8-high", "gpt-5.3-codex-high"],
      thinking: "low",
    });
    expect(seen).toContain("claude-opus-4-8-low"); // -high downgraded to -low
    expect(seen).toContain("gpt-5.3-codex"); // codex has no -low, falls back to its medium base
  });
});
