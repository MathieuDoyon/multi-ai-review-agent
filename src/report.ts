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
        `- **${escapeCell(group.title)}** (${locationFor(group)}): ${escapeCell(group.findings[0]?.falsePositiveRisk ?? "Evidence is weak.")}`,
      );
    }
  }

  if (input.failures.length > 0) {
    lines.push("", "## Reviewer Failures", "");
    for (const failure of input.failures) lines.push(`- \`${failure.model}\`: ${escapeCell(failure.reason)}`);
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
