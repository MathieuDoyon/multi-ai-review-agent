import { describe, expect, it } from "vitest";
import { collectDiff, resolveBaseRef } from "./git.js";
import type { ShellRunner } from "./types.js";

function fakeShell(responses: Record<string, string | Error>): ShellRunner {
  return async (command: string) => {
    const response = responses[command];
    if (response instanceof Error) throw response;
    if (response === undefined) throw new Error(`unexpected command: ${command}`);
    return response;
  };
}

describe("resolveBaseRef", () => {
  it("uses an explicit safe base ref and computes its merge base", async () => {
    const shell = fakeShell({
      "git rev-parse --verify origin/dev^{commit}": "commit-dev\n",
      "git merge-base HEAD origin/dev": "merge-dev\n",
    });

    await expect(resolveBaseRef(shell, "origin/dev")).resolves.toEqual({
      ok: true,
      baseRef: "origin/dev",
      mergeBase: "merge-dev",
    });
  });

  it("rejects unsafe explicit refs before running git commands", async () => {
    const shell = fakeShell({});

    await expect(resolveBaseRef(shell, "origin/main; rm -rf .")).resolves.toEqual({
      ok: false,
      message: "Invalid base ref: origin/main; rm -rf .",
    });
  });

  it("rejects refs starting with a dash before running git commands", async () => {
    const shell = fakeShell({});

    await expect(resolveBaseRef(shell, "--all")).resolves.toEqual({
      ok: false,
      message: "Invalid base ref: --all",
    });
  });

  it("falls back to the first resolvable default base ref", async () => {
    const shell = fakeShell({
      "git rev-parse --verify origin/main^{commit}": new Error("missing"),
      "git rev-parse --verify origin/master^{commit}": "commit-master\n",
      "git merge-base HEAD origin/master": "merge-master\n",
    });

    await expect(resolveBaseRef(shell)).resolves.toEqual({
      ok: true,
      baseRef: "origin/master",
      mergeBase: "merge-master",
    });
  });

  it("returns a friendly failure when no base ref resolves", async () => {
    const shell = fakeShell({
      "git rev-parse --verify origin/main^{commit}": new Error("missing"),
      "git rev-parse --verify origin/master^{commit}": new Error("missing"),
      "git rev-parse --verify main^{commit}": new Error("missing"),
      "git rev-parse --verify master^{commit}": new Error("missing"),
    });

    await expect(resolveBaseRef(shell)).resolves.toEqual({
      ok: false,
      message: "Could not resolve a base ref. Try /multi-ai-review origin/main.",
    });
  });
});

describe("collectDiff", () => {
  it("collects stat, name status, and bounded diff context", async () => {
    const shell = fakeShell({
      "git diff --stat merge-base..HEAD": " file.ts | 2 +-\n",
      "git diff --name-status merge-base..HEAD": "M\tfile.ts\n",
      "git diff merge-base..HEAD": "diff --git a/file.ts b/file.ts\n+new line\n",
    });

    await expect(
      collectDiff(shell, {
        baseRef: "origin/main",
        mergeBase: "merge-base",
        limits: { maxDiffBytes: 1000, maxDiffLines: 100, maxFiles: 10 },
      }),
    ).resolves.toEqual({
      baseRef: "origin/main",
      mergeBase: "merge-base",
      stat: "file.ts | 2 +-",
      nameStatus: "M\tfile.ts",
      diff: "diff --git a/file.ts b/file.ts\n+new line",
      truncated: false,
    });
  });

  it("truncates large diffs by line and file limits", async () => {
    const shell = fakeShell({
      "git diff --stat merge-base..HEAD": " many files\n",
      "git diff --name-status merge-base..HEAD": "M\ta.ts\nM\tb.ts\nM\tc.ts\n",
      "git diff merge-base..HEAD": "1\n2\n3\n4\n",
    });

    await expect(
      collectDiff(shell, {
        baseRef: "origin/main",
        mergeBase: "merge-base",
        limits: { maxDiffBytes: 1000, maxDiffLines: 2, maxFiles: 2 },
      }),
    ).resolves.toMatchObject({
      nameStatus: "M\ta.ts\nM\tb.ts",
      diff: "1\n2",
      truncated: true,
      truncationReason: "Diff context exceeded maxFiles=2 and maxDiffLines=2.",
    });
  });
});
