import { describe, expect, it } from "vitest";
import { classifyAction, groupFindings } from "./findings.js";
import type { ReviewerResult } from "./types.js";

const baseFinding = {
  title: "Missing null guard",
  severity: "high" as const,
  confidence: "high" as const,
  file: "src/user.ts",
  line: 42,
  category: "bug" as const,
  evidence: "value can be null",
  recommendation: "Add a guard before reading the property",
  falsePositiveRisk: "Only safe if caller validates it",
};

describe("groupFindings", () => {
  it("groups nearby findings from different models", () => {
    const results: ReviewerResult[] = [
      { model: "openai/gpt-5.5", output: { summary: "a", findings: [baseFinding] } },
      {
        model: "anthropic/claude",
        output: {
          summary: "b",
          findings: [{ ...baseFinding, title: "Missing null check", line: 44 }],
        },
      },
    ];

    const groups = groupFindings(results);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.models).toEqual(["openai/gpt-5.5", "anthropic/claude"]);
    expect(groups[0]?.action).toBe("address");
  });

  it("classifies plausible single-model findings as investigate", () => {
    const [group] = groupFindings([
      { model: "openai/gpt-5.5", output: { summary: "a", findings: [baseFinding] } },
    ]);

    expect(group).toBeDefined();
    expect(classifyAction(group!)).toBe("investigate");
  });

  it("classifies low-confidence stylistic findings as likely false positive", () => {
    const [group] = groupFindings([
      {
        model: "openai/gpt-5.5",
        output: {
          summary: "a",
          findings: [
            {
              ...baseFinding,
              severity: "low",
              confidence: "low",
              category: "maintainability",
              title: "Could rename variable",
              evidence: "Naming could be clearer",
            },
          ],
        },
      },
    ]);

    expect(group).toBeDefined();
    expect(classifyAction(group!)).toBe("likely false positive");
  });
});
