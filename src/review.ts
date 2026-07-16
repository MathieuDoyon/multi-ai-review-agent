import { collectDiff, resolveBaseRef } from "./git.js";
import { groupFindings } from "./findings.js";
import { buildReviewerPrompt, extractReviewerOutput } from "./prompt.js";
import { renderReport } from "./report.js";
import type { ReviewerFailure, ReviewerResult, RunReviewInput } from "./types.js";

export async function runMultiAiReview(input: RunReviewInput): Promise<string> {
  const base = await resolveBaseRef(input.shell, input.baseRef);
  if (!base.ok) return base.message;

  const diffContext = await collectDiff(input.shell, {
    baseRef: base.baseRef,
    mergeBase: base.mergeBase,
    limits: input.limits,
  });

  const prompt = buildReviewerPrompt({
    diffContext,
    ...(input.instructions ? { instructions: input.instructions } : {}),
  });

  const settled = await Promise.allSettled(
    input.models.map((model) => reviewWithModel(input, model, prompt)),
  );

  const results: ReviewerResult[] = [];
  const failures: ReviewerFailure[] = [];
  for (const [index, item] of settled.entries()) {
    if (item.status === "fulfilled") {
      if ("output" in item.value) results.push(item.value);
      else failures.push(item.value);
      continue;
    }

    failures.push({
      model: input.models[index] ?? "unknown",
      reason: item.reason instanceof Error ? item.reason.message : String(item.reason),
    });
  }

  return renderReport({
    groups: groupFindings(results),
    failures,
    partial: diffContext.truncated,
    ...(diffContext.truncationReason ? { truncationReason: diffContext.truncationReason } : {}),
  });
}

async function reviewWithModel(
  input: RunReviewInput,
  model: string,
  prompt: string,
): Promise<ReviewerResult | ReviewerFailure> {
  const result = await input.runAgent({ model, prompt });

  if (!result.ok) return { model, reason: result.reason };

  const output = extractReviewerOutput(result.stdout);
  if (!output) {
    let saved: string | undefined;
    if (input.saveRawOutput) {
      try {
        saved = await input.saveRawOutput(model, result.stdout);
      } catch {
        saved = undefined;
      }
    }
    return {
      model,
      reason: saved
        ? `Could not parse reviewer JSON output (raw output: ${saved})`
        : "Could not parse reviewer JSON output",
    };
  }
  return { model, output };
}
