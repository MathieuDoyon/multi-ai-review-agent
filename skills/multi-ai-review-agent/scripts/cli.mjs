#!/usr/bin/env node

// src/cli.ts
import { exec } from "node:child_process";
import { mkdir as mkdir2, writeFile as writeFile2 } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join as join2 } from "node:path";
import { promisify } from "node:util";

// src/git.ts
var DEFAULT_BASE_REFS = ["origin/main", "origin/master", "main", "master"];
async function resolveBaseRef(shell, explicitBaseRef) {
  if (explicitBaseRef !== void 0) {
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
    message: "Could not resolve a base ref. Try invoking multi-ai-review-agent with origin/main."
  };
}
async function collectDiff(shell, input) {
  const range = `${input.mergeBase}..HEAD`;
  const stat = (await shell(`git diff --stat ${range}`)).trim();
  const rawNameStatus = (await shell(`git diff --name-status ${range}`)).trim();
  const rawDiff = (await shell(`git diff ${range}`)).trim();
  const nameStatusResult = truncateLines(rawNameStatus, input.limits.maxFiles);
  const lineResult = truncateLines(rawDiff, input.limits.maxDiffLines);
  const byteResult = truncateBytes(lineResult.text, input.limits.maxDiffBytes);
  const reasons = [
    nameStatusResult.truncated ? `maxFiles=${input.limits.maxFiles}` : void 0,
    lineResult.truncated ? `maxDiffLines=${input.limits.maxDiffLines}` : void 0,
    byteResult.truncated ? `maxDiffBytes=${input.limits.maxDiffBytes}` : void 0
  ].filter((reason) => reason !== void 0);
  return {
    baseRef: input.baseRef,
    mergeBase: input.mergeBase,
    stat,
    nameStatus: nameStatusResult.text,
    diff: byteResult.text,
    truncated: reasons.length > 0,
    ...reasons.length > 0 ? { truncationReason: `Diff context exceeded ${formatReasons(reasons)}.` } : {}
  };
}
async function resolveCandidate(shell, ref) {
  try {
    await shell(`git rev-parse --verify ${ref}^{commit}`);
    const mergeBase = (await shell(`git merge-base HEAD ${ref}`)).trim();
    return { ok: true, baseRef: ref, mergeBase };
  } catch {
    return { ok: false, message: `Could not resolve base ref: ${ref}` };
  }
}
function isSafeGitRef(ref) {
  return /^[A-Za-z0-9._/@:+-]+$/.test(ref) && !ref.includes("..") && !ref.startsWith("-");
}
function truncateLines(text, maxLines) {
  const lines = text.split("\n");
  if (lines.length <= maxLines) return { text, truncated: false };
  return { text: lines.slice(0, maxLines).join("\n"), truncated: true };
}
function truncateBytes(text, maxBytes) {
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes <= maxBytes) return { text, truncated: false };
  let result = "";
  for (const char of text) {
    if (Buffer.byteLength(result + char, "utf8") > maxBytes) break;
    result += char;
  }
  return { text: result, truncated: true };
}
function formatReasons(reasons) {
  if (reasons.length === 1) return reasons[0] ?? "limits";
  const last = reasons[reasons.length - 1];
  return `${reasons.slice(0, -1).join(", ")} and ${last}`;
}

// src/models.ts
var EFFORTS = /* @__PURE__ */ new Set(["none", "low", "medium", "high", "xhigh", "max"]);
var LIGHTWEIGHT_TOKENS = /* @__PURE__ */ new Set(["mini", "nano", "flash", "spark", "lite", "free"]);
var FLAGSHIP_PREFERENCE = ["high", "xhigh", "max", "medium", "low", "none"];
var DEFAULT_TRIO = ["codex", "opus", "grok"];
var LEVEL_FALLBACKS = {
  low: ["low", "medium", "none", "high", "xhigh", "max"],
  medium: ["medium", "high", "low", "xhigh", "max", "none"],
  high: ["high", "xhigh", "max", "medium", "low", "none"]
};
function parseAgentModels(output) {
  const models = [];
  for (const line of output.split("\n")) {
    const match = line.match(/^(\S+) - (.+)$/);
    if (!match) continue;
    const id = match[1];
    if (id === "auto") continue;
    models.push({ id, name: match[2].trim() });
  }
  return models;
}
function normalizeId(id) {
  const parts = id.split("-");
  let fast = false;
  let thinking = false;
  let effort;
  while (parts.length > 1) {
    const last = parts[parts.length - 1];
    if (last === "fast") {
      fast = true;
      parts.pop();
      continue;
    }
    if (last === "thinking") {
      thinking = true;
      parts.pop();
      continue;
    }
    if (EFFORTS.has(last)) {
      if (last === "high" && parts[parts.length - 2] === "extra") {
        if (effort === void 0) effort = "xhigh";
        parts.pop();
        parts.pop();
        continue;
      }
      if (effort === void 0) effort = last;
      parts.pop();
      continue;
    }
    break;
  }
  return { root: parts.join("-"), ...effort ? { effort } : {}, thinking, fast };
}
function isLightweight(root) {
  return root.split("-").some((token) => LIGHTWEIGHT_TOKENS.has(token));
}
function pickByPreference(efforts, order) {
  for (const key of order) {
    if (efforts[key]) return efforts[key];
  }
  return void 0;
}
function groupAgentFamilies(models) {
  const groups = /* @__PURE__ */ new Map();
  for (const m of models) {
    const { root } = normalizeId(m.id);
    const list = groups.get(root) ?? [];
    list.push(m);
    groups.set(root, list);
  }
  const families = [];
  for (const [family, list] of groups) {
    const efforts = {};
    const scores = {};
    for (const m of list) {
      const parsed = normalizeId(m.id);
      const key = parsed.effort ?? "medium";
      const score = (parsed.fast ? 2 : 0) + (parsed.thinking ? 1 : 0);
      if (!(key in efforts) || score < scores[key]) {
        efforts[key] = m.id;
        scores[key] = score;
      }
    }
    const flagship = pickByPreference(efforts, FLAGSHIP_PREFERENCE) ?? list[0].id;
    const label = list.find((m) => m.id === flagship)?.name ?? flagship;
    families.push({ family, label, flagship, variants: list.map((m) => m.id), efforts });
  }
  return families;
}
function resolveThinkingModel(families, requestedId, level) {
  const { root } = normalizeId(requestedId);
  const family = families.find((f) => f.family === root);
  if (!family) return requestedId;
  return pickByPreference(family.efforts, LEVEL_FALLBACKS[level]) ?? family.flagship;
}
function orderFamilies(families, lastModels) {
  const remaining = [...families];
  const ordered = [];
  for (const id of lastModels) {
    const idx = remaining.findIndex((f) => f.variants.includes(id));
    if (idx !== -1) ordered.push(...remaining.splice(idx, 1));
  }
  for (const term of DEFAULT_TRIO) {
    const idx = remaining.findIndex((f) => !isLightweight(f.family) && f.family.includes(term));
    if (idx !== -1) ordered.push(...remaining.splice(idx, 1));
  }
  ordered.push(...remaining);
  return ordered;
}

// src/agent.ts
import { spawn } from "node:child_process";
function buildAgentArgs(invocation) {
  return ["--print", "--output-format", "text", "--mode", "ask", "--trust", "--model", invocation.model];
}
function createAgentRunner(options = {}) {
  const timeoutMs = options.timeoutMs ?? 24e4;
  const command = options.command ?? "agent";
  return (invocation) => new Promise((resolve) => {
    const child = spawn(command, buildAgentArgs(invocation), { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve({ model: invocation.model, ok: false, reason: `Timed out after ${timeoutMs}ms` });
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ model: invocation.model, ok: false, reason: error.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0 && stdout.trim().length > 0) {
        resolve({ model: invocation.model, ok: true, stdout });
      } else {
        resolve({ model: invocation.model, ok: false, reason: stderr.trim() || `agent exited with code ${code}` });
      }
    });
    child.stdin.on("error", () => {
    });
    child.stdin.end(invocation.prompt);
  });
}

// src/findings.ts
function groupFindings(results) {
  const groups = [];
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
        ...normalized.line !== void 0 ? { line: normalized.line } : {},
        models: [result.model],
        findings: [normalized]
      });
    }
  }
  return groups.map((group) => ({ ...group, action: classifyAction(group) }));
}
function classifyAction(group) {
  if (group.confidence === "low" && (group.severity === "low" || group.category === "maintainability")) {
    return "likely false positive";
  }
  if (group.models.length > 1 && group.confidence !== "low") return "address";
  if ((group.severity === "critical" || group.severity === "high") && group.confidence === "high") {
    return group.models.length > 1 ? "address" : "investigate";
  }
  return group.confidence === "low" ? "likely false positive" : "investigate";
}
function normalizeFinding(finding) {
  return {
    ...finding,
    title: finding.title.trim(),
    file: finding.file.trim(),
    evidence: finding.evidence.trim(),
    recommendation: finding.recommendation.trim(),
    falsePositiveRisk: finding.falsePositiveRisk.trim()
  };
}
function belongsToGroup(group, finding) {
  if (group.file !== finding.file || group.category !== finding.category) return false;
  if (group.line !== void 0 && finding.line !== void 0) {
    return Math.abs(group.line - finding.line) <= 3;
  }
  return titleSimilarity(group.title, finding.title) >= 0.5;
}
function titleSimilarity(left, right) {
  const leftTokens = new Set(left.toLowerCase().split(/\W+/).filter(Boolean));
  const rightTokens = new Set(right.toLowerCase().split(/\W+/).filter(Boolean));
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  return intersection / Math.max(leftTokens.size, rightTokens.size);
}
function highestSeverity(left, right) {
  const order = ["low", "medium", "high", "critical"];
  return order.indexOf(right) > order.indexOf(left) ? right : left;
}
function highestConfidence(left, right) {
  const order = ["low", "medium", "high"];
  return order.indexOf(right) > order.indexOf(left) ? right : left;
}

// src/prompt.ts
function buildReviewerPrompt(input) {
  const partialNotice = input.diffContext.truncated ? `

Partial review notice: ${input.diffContext.truncationReason}` : "";
  const extraInstructions = input.instructions ? `

Extra user instructions:
${input.instructions}` : "";
  return `You are a read-only code reviewer. Do not modify files, run edits, or suggest broad rewrites.

Review the branch diff for concrete bugs, security issues, regressions, missing tests, and maintainability risks. Prefer specific evidence over speculation. Flag likely false positives explicitly.

Return exactly one fenced JSON block with this schema:

\`\`\`json
{
  "summary": "short reviewer summary",
  "findings": [
    {
      "title": "short issue title",
      "severity": "critical|high|medium|low",
      "confidence": "high|medium|low",
      "file": "path/to/file.ts",
      "line": 123,
      "category": "bug|security|performance|maintainability|test|docs|other",
      "evidence": "why this is a real issue",
      "recommendation": "specific fix",
      "falsePositiveRisk": "why this may be wrong"
    }
  ]
}
\`\`\`

Base ref: ${input.diffContext.baseRef}
Merge base: ${input.diffContext.mergeBase}${partialNotice}${extraInstructions}

Diff stat:
${input.diffContext.stat}

Changed files:
${input.diffContext.nameStatus}

Unified diff:
${input.diffContext.diff}`;
}
function extractReviewerOutput(text) {
  const fenced = text.match(/```json\s*([\s\S]*?)\s*```/i);
  const candidate = fenced?.[1] ?? bareObject(text);
  if (!candidate) return void 0;
  try {
    const parsed = JSON.parse(candidate);
    return isReviewerOutput(parsed) ? parsed : void 0;
  } catch {
    return void 0;
  }
}
function bareObject(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return void 0;
  return text.slice(start, end + 1);
}
function isReviewerOutput(value) {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value;
  return typeof candidate.summary === "string" && Array.isArray(candidate.findings);
}

// src/report.ts
var SEVERITY_ORDER = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3
};
function renderReport(input) {
  const lines = ["# Multi-AI Code Review", ""];
  if (input.partial) {
    lines.push(`Partial review: ${input.truncationReason ?? "diff context was truncated."}`, "");
  }
  const actionable = [...input.groups].filter((group) => group.action !== "likely false positive").sort((left, right) => SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity]).map((group, index) => ({ number: index + 1, group }));
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
    `- Investigate before fixing: ${formatNumbersForAction(actionable, "investigate")}`
  );
  const likelyFalsePositives = input.groups.filter(
    (group) => group.action === "likely false positive"
  );
  if (likelyFalsePositives.length > 0) {
    lines.push("", "## Do Not Address Yet", "");
    for (const group of likelyFalsePositives) {
      lines.push(
        `- **${escapeCell(group.title)}** (${locationFor(group)}): ${escapeCell(group.findings[0]?.falsePositiveRisk ?? "Evidence is weak.")}`
      );
    }
  }
  if (input.failures.length > 0) {
    lines.push("", "## Reviewer Failures", "");
    for (const failure of input.failures) lines.push(`- \`${failure.model}\`: ${escapeCell(failure.reason)}`);
  }
  return lines.join("\n");
}
function renderFindingRow(finding) {
  const recommendation = finding.group.findings[0]?.recommendation ?? "Investigate the cited evidence.";
  return `| ${finding.number} | ${escapeCell(finding.group.severity)} | ${escapeCell(finding.group.confidence)} | ${escapeCell(finding.group.title)} | ${escapeCell(finding.group.models.join(", "))} | ${escapeCell(locationFor(finding.group))} | ${escapeCell(recommendation)} | ${escapeCell(finding.group.action)} |`;
}
function formatNumbersForAction(findings, action) {
  const numbers = findings.filter((finding) => finding.group.action === action).map((finding) => String(finding.number));
  return numbers.length === 0 ? "none" : numbers.join(", ");
}
function locationFor(group) {
  return group.line === void 0 ? group.file : `${group.file}:${group.line}`;
}
function escapeCell(value) {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}

// src/review.ts
async function runMultiAiReview(input) {
  const base = await resolveBaseRef(input.shell, input.baseRef);
  if (!base.ok) return base.message;
  const diffContext = await collectDiff(input.shell, {
    baseRef: base.baseRef,
    mergeBase: base.mergeBase,
    limits: input.limits
  });
  const prompt = buildReviewerPrompt({
    diffContext,
    ...input.instructions ? { instructions: input.instructions } : {}
  });
  const settled = await Promise.allSettled(
    input.models.map((model) => reviewWithModel(input, model, prompt))
  );
  const results = [];
  const failures = [];
  for (const [index, item] of settled.entries()) {
    if (item.status === "fulfilled") {
      if ("output" in item.value) results.push(item.value);
      else failures.push(item.value);
      continue;
    }
    failures.push({
      model: input.models[index] ?? "unknown",
      reason: item.reason instanceof Error ? item.reason.message : String(item.reason)
    });
  }
  return renderReport({
    groups: groupFindings(results),
    failures,
    partial: diffContext.truncated,
    ...diffContext.truncationReason ? { truncationReason: diffContext.truncationReason } : {}
  });
}
async function reviewWithModel(input, model, prompt) {
  const result = await input.runAgent({ model, prompt });
  if (!result.ok) return { model, reason: result.reason };
  const output = extractReviewerOutput(result.stdout);
  if (!output) {
    let saved;
    if (input.saveRawOutput) {
      try {
        saved = await input.saveRawOutput(model, result.stdout);
      } catch {
        saved = void 0;
      }
    }
    return {
      model,
      reason: saved ? `Could not parse reviewer JSON output (raw output: ${saved})` : "Could not parse reviewer JSON output"
    };
  }
  return { model, output };
}

// src/state.ts
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
function createReviewStateStore(baseDir = join(homedir(), ".claude")) {
  const filePath = join(baseDir, "multi-ai-review-agent", "state.json");
  const stateDirectory = dirname(filePath);
  return {
    async readLastModels() {
      try {
        const parsed = JSON.parse(await readFile(filePath, "utf8"));
        return Array.isArray(parsed.lastModels) && parsed.lastModels.every((model) => typeof model === "string") ? parsed.lastModels : [];
      } catch {
        return [];
      }
    },
    async writeLastModels(models) {
      await mkdir(stateDirectory, { recursive: true });
      await writeFile(`${filePath}.tmp`, `${JSON.stringify({ lastModels: models }, null, 2)}
`, "utf8");
      await rename(`${filePath}.tmp`, filePath);
    }
  };
}

// src/cli.ts
var DEFAULT_LIMITS = { maxDiffBytes: 2e5, maxDiffLines: 6e3, maxFiles: 200 };
var execAsync = promisify(exec);
function parseRunArgs(argv) {
  let models = [];
  let thinking = "medium";
  let baseRef;
  let focus;
  let timeoutSeconds;
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const next = argv[i + 1];
    const value = next !== void 0 && !next.startsWith("--") ? next : void 0;
    if (flag === "--models" && value !== void 0) {
      models = value.split(",").map((m) => m.trim()).filter(Boolean);
      i++;
    } else if (flag === "--thinking" && value !== void 0) {
      thinking = asThinking(value);
      i++;
    } else if (flag === "--base" && value !== void 0) {
      baseRef = value;
      i++;
    } else if (flag === "--focus" && value !== void 0) {
      focus = value;
      i++;
    } else if (flag === "--timeout" && value !== void 0) {
      timeoutSeconds = asTimeoutSeconds(value);
      i++;
    }
  }
  if (models.length === 0) throw new Error("Missing required --models id1,id2");
  return {
    models,
    thinking,
    ...baseRef ? { baseRef } : {},
    ...focus ? { focus } : {},
    ...timeoutSeconds !== void 0 ? { timeoutSeconds } : {}
  };
}
function asThinking(value) {
  if (value === "low" || value === "medium" || value === "high") return value;
  throw new Error(`Invalid --thinking value: ${value} (use low|medium|high)`);
}
function asTimeoutSeconds(value) {
  const n = Number(value);
  if (Number.isInteger(n) && n > 0) return n;
  throw new Error(`Invalid --timeout value: ${value} (use a positive integer of seconds)`);
}
function parsePrepArgs(argv) {
  const baseRef = argv.find((arg) => !arg.startsWith("--"));
  return baseRef ? { baseRef } : {};
}
async function runPrepCommand(deps, args) {
  const models = parseAgentModels(await deps.shell("agent models"));
  const lastModels = await deps.state.readLastModels();
  const families = orderFamilies(groupAgentFamilies(models), lastModels);
  const base = await resolveBaseRef(deps.shell, args.baseRef);
  let diffStat = "";
  let baseRef;
  if (base.ok) {
    diffStat = (await deps.shell(`git diff --stat ${base.mergeBase}..HEAD`)).trim();
    baseRef = { ok: true, ref: base.baseRef, mergeBase: base.mergeBase };
  } else {
    baseRef = { ok: false, message: base.message };
  }
  return JSON.stringify({ baseRef, diffStat, families, lastModels }, null, 2);
}
async function runReviewCommand(deps, args) {
  const families = groupAgentFamilies(parseAgentModels(await deps.shell("agent models")));
  const models = args.models.map((model) => resolveThinkingModel(families, model, args.thinking));
  const report = await runMultiAiReview({
    runAgent: deps.runAgent,
    shell: deps.shell,
    models,
    limits: deps.limits,
    ...args.baseRef ? { baseRef: args.baseRef } : {},
    ...args.focus ? { instructions: args.focus } : {},
    ...deps.saveRawOutput ? { saveRawOutput: deps.saveRawOutput } : {}
  });
  try {
    await deps.state.writeLastModels(models);
  } catch {
  }
  return report;
}
async function saveRawReviewerOutput(model, text) {
  const dir = join2(tmpdir(), "multi-ai-review-agent");
  await mkdir2(dir, { recursive: true });
  const file = join2(dir, `${Date.now()}-${model.replaceAll("/", "-")}.txt`);
  await writeFile2(file, text, "utf8");
  return file;
}
async function main(argv) {
  const [command, ...rest] = argv;
  const shell = async (cmd) => (await execAsync(cmd, { maxBuffer: 64 * 1024 * 1024 })).stdout;
  const baseDeps = {
    shell,
    state: createReviewStateStore(),
    limits: DEFAULT_LIMITS
  };
  if (command === "prep") {
    const deps = { ...baseDeps, runAgent: createAgentRunner() };
    process.stdout.write(await runPrepCommand(deps, parsePrepArgs(rest)));
  } else if (command === "run") {
    const args = parseRunArgs(rest);
    const deps = {
      ...baseDeps,
      runAgent: createAgentRunner(args.timeoutSeconds ? { timeoutMs: args.timeoutSeconds * 1e3 } : {}),
      saveRawOutput: saveRawReviewerOutput
    };
    process.stdout.write(await runReviewCommand(deps, args));
  } else {
    process.stderr.write(`Unknown command: ${command ?? "(none)"}. Use "prep" or "run".
`);
    process.exitCode = 1;
  }
}
var invokedDirectly = import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}
`);
    process.exitCode = 1;
  });
}
export {
  main,
  parsePrepArgs,
  parseRunArgs,
  runPrepCommand,
  runReviewCommand
};
