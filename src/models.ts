import type { ThinkingLevel } from "./types.js";

export type AgentModel = {
  id: string;
  name: string;
};

export type ParsedModelId = {
  root: string;
  effort?: string;
  thinking: boolean;
  fast: boolean;
};

export type AgentFamily = {
  family: string; // the base root shared by every variant, e.g. "claude-opus-4-8"
  label: string; // human name of the flagship, e.g. "Opus 4.8 1M"
  flagship: string; // representative concrete id, e.g. "claude-opus-4-8-high"
  variants: string[]; // every id in this family
  efforts: Record<string, string>; // effort token -> best concrete id
};

const EFFORTS = new Set(["none", "low", "medium", "high", "xhigh", "max"]);
const LIGHTWEIGHT_TOKENS = new Set(["mini", "nano", "flash", "spark", "lite", "free"]);
const FLAGSHIP_PREFERENCE = ["high", "xhigh", "max", "medium", "low", "none"];
const DEFAULT_TRIO = ["codex", "opus", "grok"]; // diverse coding-review lineup: OpenAI / Anthropic / xAI

const LEVEL_FALLBACKS: Record<ThinkingLevel, string[]> = {
  low: ["low", "medium", "none", "high", "xhigh", "max"],
  medium: ["medium", "high", "low", "xhigh", "max", "none"],
  high: ["high", "xhigh", "max", "medium", "low", "none"],
};

// `agent models` prints "Available models\n\n<id> - <Display Name>\n...\nTip: ...".
export function parseAgentModels(output: string): AgentModel[] {
  const models: AgentModel[] = [];
  for (const line of output.split("\n")) {
    const match = line.match(/^(\S+) - (.+)$/);
    if (!match) continue; // skips the header, blank lines, and the trailing tip
    const id = match[1] as string;
    if (id === "auto") continue; // meta router, not a real family
    models.push({ id, name: (match[2] as string).trim() });
  }
  return models;
}

// Strip the trailing fast/thinking/effort tokens Cursor appends to a base model
// id, leaving the family root. "gpt-5.5-extra-high" collapses to xhigh.
export function normalizeId(id: string): ParsedModelId {
  const parts = id.split("-");
  let fast = false;
  let thinking = false;
  let effort: string | undefined;

  while (parts.length > 1) {
    const last = parts[parts.length - 1] as string;
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
        if (effort === undefined) effort = "xhigh";
        parts.pop();
        parts.pop();
        continue;
      }
      if (effort === undefined) effort = last;
      parts.pop();
      continue;
    }
    break;
  }

  return { root: parts.join("-"), ...(effort ? { effort } : {}), thinking, fast };
}

function isLightweight(root: string): boolean {
  return root.split("-").some((token) => LIGHTWEIGHT_TOKENS.has(token));
}

function pickByPreference(efforts: Record<string, string>, order: string[]): string | undefined {
  for (const key of order) {
    if (efforts[key]) return efforts[key];
  }
  return undefined;
}

export function groupAgentFamilies(models: AgentModel[]): AgentFamily[] {
  const groups = new Map<string, AgentModel[]>();
  for (const m of models) {
    const { root } = normalizeId(m.id);
    const list = groups.get(root) ?? [];
    list.push(m);
    groups.set(root, list);
  }

  const families: AgentFamily[] = [];
  for (const [family, list] of groups) {
    const efforts: Record<string, string> = {};
    const scores: Record<string, number> = {};
    for (const m of list) {
      const parsed = normalizeId(m.id);
      const key = parsed.effort ?? "medium"; // a bare id (no effort suffix) is the family's medium tier
      const score = (parsed.fast ? 2 : 0) + (parsed.thinking ? 1 : 0); // prefer plain, non-fast variants
      if (!(key in efforts) || score < (scores[key] as number)) {
        efforts[key] = m.id;
        scores[key] = score;
      }
    }

    const flagship = pickByPreference(efforts, FLAGSHIP_PREFERENCE) ?? (list[0] as AgentModel).id;
    const label = list.find((m) => m.id === flagship)?.name ?? flagship;
    families.push({ family, label, flagship, variants: list.map((m) => m.id), efforts });
  }
  return families;
}

// Resolve a requested family/model id + thinking level to a concrete effort
// variant, falling back to the nearest available effort then the flagship.
// An id whose root is not a known family is passed through unchanged.
export function resolveThinkingModel(
  families: AgentFamily[],
  requestedId: string,
  level: ThinkingLevel,
): string {
  const { root } = normalizeId(requestedId);
  const family = families.find((f) => f.family === root);
  if (!family) return requestedId;
  return pickByPreference(family.efforts, LEVEL_FALLBACKS[level]) ?? family.flagship;
}

export function orderFamilies(families: AgentFamily[], lastModels: string[]): AgentFamily[] {
  const remaining = [...families];
  const ordered: AgentFamily[] = [];

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
