import type { FindingGroup, ReviewerFinding, ReviewerResult, ReviewAction } from "./types.js";

export function groupFindings(results: ReviewerResult[]): FindingGroup[] {
  const groups: Omit<FindingGroup, "action">[] = [];

  for (const result of results) {
    for (const finding of result.output.findings) {
      const normalized = normalizeFinding(finding);
      const existing = groups.find((group) => belongsToGroup(group, normalized));

      if (existing) {
        existing.findings.push(normalized);
        if (!existing.models.includes(result.model)) existing.models.push(result.model);
        existing.severity = highestSeverity(existing.severity, normalized.severity);
        existing.confidence = highestConfidence(existing.confidence, normalized.confidence);
        continue;
      }

      groups.push({
        title: normalized.title,
        severity: normalized.severity,
        confidence: normalized.confidence,
        category: normalized.category,
        file: normalized.file,
        ...(normalized.line !== undefined ? { line: normalized.line } : {}),
        models: [result.model],
        findings: [normalized],
      });
    }
  }

  return groups.map((group) => ({ ...group, action: classifyAction(group) }));
}

export function classifyAction(
  group: Pick<FindingGroup, "confidence" | "severity" | "models" | "category">,
): ReviewAction {
  if (
    group.confidence === "low" &&
    (group.severity === "low" || group.category === "maintainability")
  ) {
    return "likely false positive";
  }

  if (group.models.length > 1 && group.confidence !== "low") return "address";
  if ((group.severity === "critical" || group.severity === "high") && group.confidence === "high") {
    return group.models.length > 1 ? "address" : "investigate";
  }

  return group.confidence === "low" ? "likely false positive" : "investigate";
}

function normalizeFinding(finding: ReviewerFinding): ReviewerFinding {
  return {
    ...finding,
    title: finding.title.trim(),
    file: finding.file.trim(),
    evidence: finding.evidence.trim(),
    recommendation: finding.recommendation.trim(),
    falsePositiveRisk: finding.falsePositiveRisk.trim(),
  };
}

function belongsToGroup(group: Omit<FindingGroup, "action">, finding: ReviewerFinding): boolean {
  if (group.file !== finding.file || group.category !== finding.category) return false;

  if (group.line !== undefined && finding.line !== undefined) {
    return Math.abs(group.line - finding.line) <= 3;
  }

  return titleSimilarity(group.title, finding.title) >= 0.5;
}

function titleSimilarity(left: string, right: string): number {
  const leftTokens = new Set(left.toLowerCase().split(/\W+/).filter(Boolean));
  const rightTokens = new Set(right.toLowerCase().split(/\W+/).filter(Boolean));
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;

  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  return intersection / Math.max(leftTokens.size, rightTokens.size);
}

function highestSeverity(
  left: ReviewerFinding["severity"],
  right: ReviewerFinding["severity"],
): ReviewerFinding["severity"] {
  const order = ["low", "medium", "high", "critical"];
  return order.indexOf(right) > order.indexOf(left) ? right : left;
}

function highestConfidence(
  left: ReviewerFinding["confidence"],
  right: ReviewerFinding["confidence"],
): ReviewerFinding["confidence"] {
  const order = ["low", "medium", "high"];
  return order.indexOf(right) > order.indexOf(left) ? right : left;
}
