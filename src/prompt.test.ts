import { describe, expect, it } from "vitest";
import { buildReviewerPrompt, extractReviewerOutput } from "./prompt.js";
import type { DiffContext } from "./types.js";

const diffContext: DiffContext = {
  baseRef: "origin/main",
  mergeBase: "abc123",
  stat: "file.ts | 2 +-",
  nameStatus: "M\tfile.ts",
  diff: "diff --git a/file.ts b/file.ts\n+new line",
  truncated: false,
};

describe("buildReviewerPrompt", () => {
  it("includes review constraints, diff context, and extra instructions", () => {
    const prompt = buildReviewerPrompt({
      diffContext,
      instructions: "Focus on regression risks.",
    });

    expect(prompt).toContain("read-only code reviewer");
    expect(prompt).toContain("Do not modify files");
    expect(prompt).toContain("origin/main");
    expect(prompt).toContain("file.ts | 2 +-");
    expect(prompt).toContain("Focus on regression risks.");
    expect(prompt).toContain('"falsePositiveRisk"');
  });
});

describe("extractReviewerOutput", () => {
  it("parses the first fenced JSON reviewer output", () => {
    const text = [
      "Here is the review.",
      "```json",
      JSON.stringify({
        summary: "Looks good",
        findings: [
          {
            title: "Bug",
            severity: "high",
            confidence: "high",
            file: "src/file.ts",
            line: 12,
            category: "bug",
            evidence: "It fails",
            recommendation: "Fix it",
            falsePositiveRisk: "Low",
          },
        ],
      }),
      "```",
    ].join("\n");

    expect(extractReviewerOutput(text)).toEqual({
      summary: "Looks good",
      findings: [
        {
          title: "Bug",
          severity: "high",
          confidence: "high",
          file: "src/file.ts",
          line: 12,
          category: "bug",
          evidence: "It fails",
          recommendation: "Fix it",
          falsePositiveRisk: "Low",
        },
      ],
    });
  });

  it("returns undefined for malformed or incomplete reviewer output", () => {
    expect(extractReviewerOutput("```json\n{bad json}\n```")).toBeUndefined();
    expect(extractReviewerOutput("```json\n{}\n```")).toBeUndefined();
  });
});

describe("extractReviewerOutput fallback", () => {
  it("parses a bare JSON object when no code fence is present", () => {
    const text = 'Here is my review: {"summary":"ok","findings":[]} — done.';
    expect(extractReviewerOutput(text)).toEqual({ summary: "ok", findings: [] });
  });

  it("returns undefined when there is no JSON at all", () => {
    expect(extractReviewerOutput("no json here")).toBeUndefined();
  });

  it("does not double-dip into a later bare object when the fenced block is invalid", () => {
    const text = '```json\n{bad}\n``` and later {"summary":"ok","findings":[]}';
    expect(extractReviewerOutput(text)).toBeUndefined();
  });
});
