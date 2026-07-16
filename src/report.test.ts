import { describe, expect, it } from "vitest";
import { renderReport } from "./report.js";
import type { FindingGroup, ReviewerFailure } from "./types.js";

function findingGroup(input: Partial<FindingGroup> = {}): FindingGroup {
  const severity = input.severity ?? "high";
  const confidence = input.confidence ?? "high";
  const title = input.title ?? "Missing null guard";
  const file = input.file ?? "src/user.ts";
  const line = input.line ?? 42;

  return {
    title,
    severity,
    confidence,
    category: input.category ?? "bug",
    file,
    ...(line !== undefined ? { line } : {}),
    models: input.models ?? ["openai/gpt-5.5", "anthropic/claude"],
    findings: input.findings ?? [
      {
        title,
        severity,
        confidence,
        file,
        ...(line !== undefined ? { line } : {}),
        category: input.category ?? "bug",
        evidence: "value can be null",
        recommendation: "Add a guard",
        falsePositiveRisk: "Caller may validate it",
      },
    ],
    action: input.action ?? "address",
  };
}

describe("renderReport", () => {
  it("renders numbered actionable findings sorted by severity", () => {
    const report = renderReport({
      groups: [
        findingGroup({ title: "Medium issue", severity: "medium", line: 30, action: "investigate" }),
        findingGroup({ title: "Critical issue", severity: "critical", line: 10, action: "address" }),
        findingGroup({ title: "Low issue", severity: "low", line: 40, action: "investigate" }),
        findingGroup({ title: "High issue", severity: "high", line: 20, action: "address" }),
      ],
      failures: [],
      partial: false,
    });

    expect(report).toContain(
      "| # | Severity | Confidence | Finding | Models | Location | Recommendation | Action |",
    );
    expect(report).toContain("| 1 | critical | high | Critical issue | openai/gpt-5.5, anthropic/claude | src/user.ts:10 | Add a guard | address |");
    expect(report).toContain("| 2 | high | high | High issue | openai/gpt-5.5, anthropic/claude | src/user.ts:20 | Add a guard | address |");
    expect(report).toContain("| 3 | medium | high | Medium issue | openai/gpt-5.5, anthropic/claude | src/user.ts:30 | Add a guard | investigate |");
    expect(report).toContain("| 4 | low | high | Low issue | openai/gpt-5.5, anthropic/claude | src/user.ts:40 | Add a guard | investigate |");
    expect(report.indexOf("Critical issue")).toBeLessThan(report.indexOf("High issue"));
    expect(report.indexOf("High issue")).toBeLessThan(report.indexOf("Medium issue"));
    expect(report.indexOf("Medium issue")).toBeLessThan(report.indexOf("Low issue"));
  });

  it("renders follow-up guidance and recommendation number lists", () => {
    const report = renderReport({
      groups: [
        findingGroup({ title: "Investigate first", severity: "medium", line: 30, action: "investigate" }),
        findingGroup({ title: "Fix first", severity: "critical", line: 10, action: "address" }),
        findingGroup({ title: "Fix second", severity: "high", line: 20, action: "address" }),
      ],
      failures: [],
      partial: false,
    });

    expect(report).toContain("Use finding numbers to choose next actions, for example: fix 1 3 or ignore 2.");
    expect(report).toContain("Recommended next action:");
    expect(report).toContain("- Address now: 1, 2");
    expect(report).toContain("- Investigate before fixing: 3");
  });

  it("renders none recommendations when there are no actionable findings", () => {
    const report = renderReport({ groups: [], failures: [], partial: false });

    expect(report).toContain("| # | Severity | Confidence | Finding | Models | Location | Recommendation | Action |");
    expect(report).toContain("| - | - | - | No actionable findings | - | - | - | - |");
    expect(report).toContain("- Address now: none");
    expect(report).toContain("- Investigate before fixing: none");
  });

  it("renders reviewer failures and partial review notices", () => {
    const failures: ReviewerFailure[] = [{ model: "bad/model", reason: "timeout" }];
    const report = renderReport({
      groups: [],
      failures,
      partial: true,
      truncationReason: "Diff context exceeded maxDiffLines=2.",
    });

    expect(report).toContain("Partial review: Diff context exceeded maxDiffLines=2.");
    expect(report).toContain("## Reviewer Failures");
    expect(report).toContain("- `bad/model`: timeout");
  });

  it("flattens a multi-line reviewer failure reason onto a single list line", () => {
    const failures: ReviewerFailure[] = [
      { model: "bad/model", reason: "timeout\nstack trace line 2\nstack trace line 3" },
    ];
    const report = renderReport({ groups: [], failures, partial: false });

    expect(report).not.toContain("timeout\nstack trace line 2");
    expect(report).toContain("- `bad/model`: timeout stack trace line 2 stack trace line 3");
  });

  it("renders likely false positives separately without numbering them", () => {
    const report = renderReport({
      groups: [findingGroup({ action: "likely false positive", confidence: "low", severity: "low" })],
      failures: [],
      partial: false,
    });

    expect(report).toContain("## Do Not Address Yet");
    expect(report).toContain("Missing null guard");
    expect(report).not.toContain("| 1 | low | low | Missing null guard");
  });
});
