# Numbered Report Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add numbered, severity-sorted actionable findings with report-only follow-up guidance and recommended finding numbers to address now.

**Architecture:** Keep finding aggregation unchanged and apply ordering/numbering only in `src/report.ts` at render time. The report renderer will sort actionable findings, render a leading `#` table column, and derive recommendation number lists from each rendered finding's existing `action` value. Tests in `src/report.test.ts` will cover table shape, sorted numbering, guidance text, recommendation lists, and empty actionable findings.

**Tech Stack:** TypeScript, Vitest, pnpm, Markdown report rendering.

## Global Constraints

- This is report-only behavior.
- Do not implement `fix` or `ignore` command handling in this change.
- Sort actionable findings at render time in `src/report.ts`.
- Do not change `groupFindings` or persist IDs on `FindingGroup`.
- Severity order is `critical -> high -> medium -> low`.
- Number actionable findings starting at `1` after sorting.
- Keep `## Do Not Address Yet` separate and unnumbered.
- Use `none` when `Address now` or `Investigate before fixing` has no finding numbers.
- Do not commit unless the user explicitly asks for a commit in the active session.

---

## File Structure

- Modify `src/report.ts`: owns Markdown report rendering, including table shape, sorting, numbering, and recommendation text.
- Modify `src/report.test.ts`: owns report renderer behavior tests.

No type changes are needed because finding numbers are display-only and derived from render order.

### Task 1: Number and Sort Report Findings

**Files:**
- Modify: `src/report.ts`
- Modify: `src/report.test.ts`

**Interfaces:**
- Consumes: `renderReport(input: ReportInput): string`, where `input.groups` contains `FindingGroup[]` with existing `severity` and `action` values.
- Produces: the same `renderReport(input: ReportInput): string` API, with changed Markdown output format.

- [ ] **Step 1: Write the failing tests**

Replace `src/report.test.ts` with:

```ts
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
```

- [ ] **Step 2: Run focused tests and verify they fail**

Run:

```sh
pnpm test:run src/report.test.ts
```

Expected result: at least one `src/report.test.ts` test fails because the report does not yet include the `#` column, finding numbers, sorted severity order, or recommendation lists.

- [ ] **Step 3: Implement render-time sorting, numbering, and recommendations**

Replace `src/report.ts` with:

```ts
import type { FindingGroup, FindingSeverity, ReportInput, ReviewAction } from "./types.js";

const SEVERITY_ORDER: Record<FindingSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

type NumberedFindingGroup = {
  number: number;
  group: FindingGroup;
};

export function renderReport(input: ReportInput): string {
  const lines = ["# Multi-AI Code Review", ""];

  if (input.partial) {
    lines.push(`Partial review: ${input.truncationReason ?? "diff context was truncated."}`, "");
  }

  const actionable = [...input.groups]
    .filter((group) => group.action !== "likely false positive")
    .sort((left, right) => SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity])
    .map((group, index) => ({ number: index + 1, group }));

  lines.push("## Findings", "");
  lines.push("| # | Severity | Confidence | Finding | Models | Location | Recommendation | Action |");
  lines.push("| - | -------- | ---------- | ------- | ------ | -------- | -------------- | ------ |");

  if (actionable.length === 0) {
    lines.push("| - | - | - | No actionable findings | - | - | - | - |");
  } else {
    for (const finding of actionable) lines.push(renderFindingRow(finding));
  }

  lines.push(
    "",
    "Use finding numbers to choose next actions, for example: fix 1 3 or ignore 2.",
    "",
    "Recommended next action:",
    `- Address now: ${formatNumbersForAction(actionable, "address")}`,
    `- Investigate before fixing: ${formatNumbersForAction(actionable, "investigate")}`,
  );

  const likelyFalsePositives = input.groups.filter(
    (group) => group.action === "likely false positive",
  );
  if (likelyFalsePositives.length > 0) {
    lines.push("", "## Do Not Address Yet", "");
    for (const group of likelyFalsePositives) {
      lines.push(
        `- **${group.title}** (${locationFor(group)}): ${group.findings[0]?.falsePositiveRisk ?? "Evidence is weak."}`,
      );
    }
  }

  if (input.failures.length > 0) {
    lines.push("", "## Reviewer Failures", "");
    for (const failure of input.failures) lines.push(`- \`${failure.model}\`: ${failure.reason}`);
  }

  return lines.join("\n");
}

function renderFindingRow(finding: NumberedFindingGroup): string {
  const recommendation = finding.group.findings[0]?.recommendation ?? "Investigate the cited evidence.";
  return `| ${finding.number} | ${escapeCell(finding.group.severity)} | ${escapeCell(finding.group.confidence)} | ${escapeCell(finding.group.title)} | ${escapeCell(finding.group.models.join(", "))} | ${escapeCell(locationFor(finding.group))} | ${escapeCell(recommendation)} | ${escapeCell(finding.group.action)} |`;
}

function formatNumbersForAction(findings: NumberedFindingGroup[], action: Exclude<ReviewAction, "likely false positive">): string {
  const numbers = findings
    .filter((finding) => finding.group.action === action)
    .map((finding) => String(finding.number));
  return numbers.length === 0 ? "none" : numbers.join(", ");
}

function locationFor(group: FindingGroup): string {
  return group.line === undefined ? group.file : `${group.file}:${group.line}`;
}

function escapeCell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}
```

- [ ] **Step 4: Run focused tests and verify they pass**

Run:

```sh
pnpm test:run src/report.test.ts
```

Expected result: `src/report.test.ts` passes with 5 tests.

- [ ] **Step 5: Run full verification**

Run:

```sh
pnpm test:run && pnpm typecheck && pnpm build
```

Expected result: all tests pass, TypeScript typecheck exits 0, and build exits 0.

- [ ] **Step 6: Inspect the final diff**

Run:

```sh
git diff -- src/report.ts src/report.test.ts docs/superpowers/specs/2026-06-22-numbered-report-actions-design.md docs/superpowers/plans/2026-06-22-numbered-report-actions.md
```

Expected result: diff contains only the numbered/sorted report behavior, its tests, the approved design spec, and this implementation plan.

- [ ] **Step 7: Commit only if explicitly requested**

If the user requests a commit, run:

```sh
git status --short --branch
git diff -- src/report.ts src/report.test.ts docs/superpowers/specs/2026-06-22-numbered-report-actions-design.md docs/superpowers/plans/2026-06-22-numbered-report-actions.md
git add src/report.ts src/report.test.ts docs/superpowers/specs/2026-06-22-numbered-report-actions-design.md docs/superpowers/plans/2026-06-22-numbered-report-actions.md
git commit -m "feat: number review findings"
```

Expected result: commit succeeds and includes only the intended files.

---

## Self-Review

- Spec coverage: Task 1 covers report-only scope, render-time sorting, the `#` column, sorted numbering, follow-up guidance, recommendation number lists, `none` empty states, and unnumbered likely false positives.
- Placeholder scan: no placeholder tasks or unresolved requirements remain.
- Type consistency: the public `renderReport(input: ReportInput): string` interface is unchanged, and the internal `NumberedFindingGroup` type is used only in `src/report.ts`.
