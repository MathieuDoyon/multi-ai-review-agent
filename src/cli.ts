import { exec } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { resolveBaseRef } from "./git.js";
import { groupAgentFamilies, orderFamilies, parseAgentModels, resolveThinkingModel } from "./models.js";
import { createAgentRunner } from "./agent.js";
import { runMultiAiReview } from "./review.js";
import { createReviewStateStore } from "./state.js";
import type { AgentRunner, DiffLimits, ReviewStateStore, ShellRunner, ThinkingLevel } from "./types.js";

const DEFAULT_LIMITS: DiffLimits = { maxDiffBytes: 200_000, maxDiffLines: 6_000, maxFiles: 200 };
const execAsync = promisify(exec);

export type RunArgs = {
  models: string[];
  thinking: ThinkingLevel;
  baseRef?: string;
  focus?: string;
  timeoutSeconds?: number;
};

export type CliDeps = {
  shell: ShellRunner;
  runAgent: AgentRunner;
  state: ReviewStateStore;
  limits: DiffLimits;
  saveRawOutput?: (model: string, text: string) => Promise<string | undefined>;
};

export function parseRunArgs(argv: string[]): RunArgs {
  let models: string[] = [];
  let thinking: ThinkingLevel = "medium";
  let baseRef: string | undefined;
  let focus: string | undefined;
  let timeoutSeconds: number | undefined;

  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const next = argv[i + 1];
    const value = next !== undefined && !next.startsWith("--") ? next : undefined;
    if (flag === "--models" && value !== undefined) {
      models = value.split(",").map((m) => m.trim()).filter(Boolean);
      i++;
    } else if (flag === "--thinking" && value !== undefined) {
      thinking = asThinking(value);
      i++;
    } else if (flag === "--base" && value !== undefined) {
      baseRef = value;
      i++;
    } else if (flag === "--focus" && value !== undefined) {
      focus = value;
      i++;
    } else if (flag === "--timeout" && value !== undefined) {
      timeoutSeconds = asTimeoutSeconds(value);
      i++;
    }
  }

  if (models.length === 0) throw new Error("Missing required --models id1,id2");
  return {
    models,
    thinking,
    ...(baseRef ? { baseRef } : {}),
    ...(focus ? { focus } : {}),
    ...(timeoutSeconds !== undefined ? { timeoutSeconds } : {}),
  };
}

function asThinking(value: string): ThinkingLevel {
  if (value === "low" || value === "medium" || value === "high") return value;
  throw new Error(`Invalid --thinking value: ${value} (use low|medium|high)`);
}

function asTimeoutSeconds(value: string): number {
  const n = Number(value);
  if (Number.isInteger(n) && n > 0) return n;
  throw new Error(`Invalid --timeout value: ${value} (use a positive integer of seconds)`);
}

export function parsePrepArgs(argv: string[]): { baseRef?: string } {
  const baseRef = argv.find((arg) => !arg.startsWith("--"));
  return baseRef ? { baseRef } : {};
}

export async function runPrepCommand(deps: CliDeps, args: { baseRef?: string }): Promise<string> {
  const models = parseAgentModels(await deps.shell("agent models"));
  const lastModels = await deps.state.readLastModels();
  const families = orderFamilies(groupAgentFamilies(models), lastModels);
  const base = await resolveBaseRef(deps.shell, args.baseRef);

  let diffStat = "";
  let baseRef: unknown;
  if (base.ok) {
    diffStat = (await deps.shell(`git diff --stat ${base.mergeBase}..HEAD`)).trim();
    baseRef = { ok: true, ref: base.baseRef, mergeBase: base.mergeBase };
  } else {
    baseRef = { ok: false, message: base.message };
  }

  return JSON.stringify({ baseRef, diffStat, families, lastModels }, null, 2);
}

export async function runReviewCommand(deps: CliDeps, args: RunArgs): Promise<string> {
  // Cursor has no --thinking flag, so resolve each chosen family to a concrete
  // effort-variant id up front (e.g. claude-opus-4-8 + high -> claude-opus-4-8-high).
  const families = groupAgentFamilies(parseAgentModels(await deps.shell("agent models")));
  const models = args.models.map((model) => resolveThinkingModel(families, model, args.thinking));

  const report = await runMultiAiReview({
    runAgent: deps.runAgent,
    shell: deps.shell,
    models,
    limits: deps.limits,
    ...(args.baseRef ? { baseRef: args.baseRef } : {}),
    ...(args.focus ? { instructions: args.focus } : {}),
    ...(deps.saveRawOutput ? { saveRawOutput: deps.saveRawOutput } : {}),
  });

  try {
    await deps.state.writeLastModels(models);
  } catch {
    // Persisting the lineup is best-effort; never fail the report on it.
  }
  return report;
}

async function saveRawReviewerOutput(model: string, text: string): Promise<string | undefined> {
  const dir = join(tmpdir(), "multi-ai-review-agent");
  await mkdir(dir, { recursive: true });
  const file = join(dir, `${Date.now()}-${model.replaceAll("/", "-")}.txt`);
  await writeFile(file, text, "utf8");
  return file;
}

export async function main(argv: string[]): Promise<void> {
  const [command, ...rest] = argv;
  const shell: ShellRunner = async (cmd) => (await execAsync(cmd, { maxBuffer: 64 * 1024 * 1024 })).stdout;
  const baseDeps = {
    shell,
    state: createReviewStateStore(),
    limits: DEFAULT_LIMITS,
  };

  if (command === "prep") {
    const deps: CliDeps = { ...baseDeps, runAgent: createAgentRunner() };
    process.stdout.write(await runPrepCommand(deps, parsePrepArgs(rest)));
  } else if (command === "run") {
    const args = parseRunArgs(rest);
    const deps: CliDeps = {
      ...baseDeps,
      runAgent: createAgentRunner(args.timeoutSeconds ? { timeoutMs: args.timeoutSeconds * 1000 } : {}),
      saveRawOutput: saveRawReviewerOutput,
    };
    process.stdout.write(await runReviewCommand(deps, args));
  } else {
    process.stderr.write(`Unknown command: ${command ?? "(none)"}. Use "prep" or "run".\n`);
    process.exitCode = 1;
  }
}

const invokedDirectly = import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
