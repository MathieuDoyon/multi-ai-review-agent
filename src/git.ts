import type { BaseResolution, DiffContext, DiffLimits, ShellRunner } from "./types.js";

const DEFAULT_BASE_REFS = ["origin/main", "origin/master", "main", "master"];

export async function resolveBaseRef(
  shell: ShellRunner,
  explicitBaseRef?: string,
): Promise<BaseResolution> {
  if (explicitBaseRef !== undefined) {
    if (!isSafeGitRef(explicitBaseRef)) {
      return { ok: false, message: `Invalid base ref: ${explicitBaseRef}` };
    }

    return resolveCandidate(shell, explicitBaseRef);
  }

  for (const candidate of DEFAULT_BASE_REFS) {
    const result = await resolveCandidate(shell, candidate);
    if (result.ok) return result;
  }

  return {
    ok: false,
    message: "Could not resolve a base ref. Try /multi-ai-review origin/main.",
  };
}

export async function collectDiff(
  shell: ShellRunner,
  input: { baseRef: string; mergeBase: string; limits: DiffLimits },
): Promise<DiffContext> {
  const range = `${input.mergeBase}..HEAD`;
  const stat = (await shell(`git diff --stat ${range}`)).trim();
  const rawNameStatus = (await shell(`git diff --name-status ${range}`)).trim();
  const rawDiff = (await shell(`git diff ${range}`)).trim();

  const nameStatusResult = truncateLines(rawNameStatus, input.limits.maxFiles);
  const lineResult = truncateLines(rawDiff, input.limits.maxDiffLines);
  const byteResult = truncateBytes(lineResult.text, input.limits.maxDiffBytes);

  const reasons = [
    nameStatusResult.truncated ? `maxFiles=${input.limits.maxFiles}` : undefined,
    lineResult.truncated ? `maxDiffLines=${input.limits.maxDiffLines}` : undefined,
    byteResult.truncated ? `maxDiffBytes=${input.limits.maxDiffBytes}` : undefined,
  ].filter((reason): reason is string => reason !== undefined);

  return {
    baseRef: input.baseRef,
    mergeBase: input.mergeBase,
    stat,
    nameStatus: nameStatusResult.text,
    diff: byteResult.text,
    truncated: reasons.length > 0,
    ...(reasons.length > 0
      ? { truncationReason: `Diff context exceeded ${formatReasons(reasons)}.` }
      : {}),
  };
}

async function resolveCandidate(shell: ShellRunner, ref: string): Promise<BaseResolution> {
  try {
    await shell(`git rev-parse --verify ${ref}^{commit}`);
    const mergeBase = (await shell(`git merge-base HEAD ${ref}`)).trim();
    return { ok: true, baseRef: ref, mergeBase };
  } catch {
    return { ok: false, message: `Could not resolve base ref: ${ref}` };
  }
}

function isSafeGitRef(ref: string): boolean {
  return /^[A-Za-z0-9._/@:+-]+$/.test(ref) && !ref.includes("..") && !ref.startsWith("-");
}

function truncateLines(text: string, maxLines: number): { text: string; truncated: boolean } {
  const lines = text.split("\n");
  if (lines.length <= maxLines) return { text, truncated: false };
  return { text: lines.slice(0, maxLines).join("\n"), truncated: true };
}

function truncateBytes(text: string, maxBytes: number): { text: string; truncated: boolean } {
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes <= maxBytes) return { text, truncated: false };

  let result = "";
  for (const char of text) {
    if (Buffer.byteLength(result + char, "utf8") > maxBytes) break;
    result += char;
  }
  return { text: result, truncated: true };
}

function formatReasons(reasons: string[]): string {
  if (reasons.length === 1) return reasons[0] ?? "limits";
  const last = reasons[reasons.length - 1];
  return `${reasons.slice(0, -1).join(", ")} and ${last}`;
}
