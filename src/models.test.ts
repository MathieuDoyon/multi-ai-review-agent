import { describe, expect, it } from "vitest";
import {
  groupAgentFamilies,
  normalizeId,
  orderFamilies,
  parseAgentModels,
  resolveThinkingModel,
} from "./models.js";
import type { AgentFamily } from "./models.js";

const SAMPLE = `Available models

auto - Auto (default)
gpt-5.3-codex-low - Codex 5.3 Low
gpt-5.3-codex-low-fast - Codex 5.3 Low Fast
gpt-5.3-codex - Codex 5.3
gpt-5.3-codex-high - Codex 5.3 High
gpt-5.3-codex-high-fast - Codex 5.3 High Fast
gpt-5.3-codex-xhigh - Codex 5.3 Extra High
cursor-grok-4.5-low - Cursor Grok 4.5 Low
cursor-grok-4.5-medium - Cursor Grok 4.5 Medium
cursor-grok-4.5-high - Cursor Grok 4.5
composer-2.5 - Composer 2.5 (current)
composer-2.5-fast - Composer 2.5 Fast
claude-opus-4-8-low - Opus 4.8 1M Low
claude-opus-4-8-high - Opus 4.8 1M
claude-opus-4-8-thinking-high - Opus 4.8 1M Thinking
claude-opus-4-8-xhigh - Opus 4.8 1M Extra High
gpt-5.5-high - GPT-5.5 1M High
gpt-5.5-extra-high - GPT-5.5 1M Extra High
gpt-5.4-mini-low - GPT-5.4 Mini Low
gpt-5.4-mini-medium - GPT-5.4 Mini

Tip: use --model <id> to switch. e.g. --model 'claude-opus-4-8[context=1m,effort=high,fast=false]'.
`;

describe("parseAgentModels", () => {
  it("parses id and display name, skipping header, tip, and the auto router", () => {
    const models = parseAgentModels(SAMPLE);
    expect(models).toHaveLength(19);
    expect(models).toContainEqual({ id: "gpt-5.3-codex", name: "Codex 5.3" });
    expect(models.map((m) => m.id)).not.toContain("auto");
    expect(models.map((m) => m.id)).not.toContain("Tip:");
  });
});

describe("normalizeId", () => {
  it("strips effort, thinking, and fast suffixes to the family root", () => {
    expect(normalizeId("gpt-5.3-codex")).toEqual({ root: "gpt-5.3-codex", thinking: false, fast: false });
    expect(normalizeId("gpt-5.3-codex-high")).toEqual({ root: "gpt-5.3-codex", effort: "high", thinking: false, fast: false });
    expect(normalizeId("gpt-5.3-codex-high-fast")).toEqual({ root: "gpt-5.3-codex", effort: "high", thinking: false, fast: true });
    expect(normalizeId("claude-opus-4-8-thinking-high")).toEqual({ root: "claude-opus-4-8", effort: "high", thinking: true, fast: false });
  });

  it("collapses the two-word extra-high effort to xhigh", () => {
    expect(normalizeId("gpt-5.5-extra-high")).toEqual({ root: "gpt-5.5", effort: "xhigh", thinking: false, fast: false });
  });
});

describe("groupAgentFamilies", () => {
  const families = groupAgentFamilies(parseAgentModels(SAMPLE));
  const byFamily = Object.fromEntries(families.map((f) => [f.family, f]));

  it("groups every effort/fast/thinking variant under one root", () => {
    expect(families).toHaveLength(6);
    expect(byFamily["gpt-5.3-codex"]?.variants).toHaveLength(6);
  });

  it("picks a plain, non-fast, high-effort flagship and carries its label", () => {
    expect(byFamily["claude-opus-4-8"]?.flagship).toBe("claude-opus-4-8-high"); // not -thinking-high
    expect(byFamily["claude-opus-4-8"]?.label).toBe("Opus 4.8 1M");
    expect(byFamily["gpt-5.3-codex"]?.flagship).toBe("gpt-5.3-codex-high"); // not -high-fast
  });

  it("maps a bare id to the medium effort tier", () => {
    expect(byFamily["gpt-5.3-codex"]?.efforts.medium).toBe("gpt-5.3-codex");
    expect(byFamily["gpt-5.3-codex"]?.efforts.high).toBe("gpt-5.3-codex-high");
    expect(byFamily["gpt-5.5"]?.efforts.xhigh).toBe("gpt-5.5-extra-high");
  });
});

describe("resolveThinkingModel", () => {
  const families = groupAgentFamilies(parseAgentModels(SAMPLE));

  it("resolves a family + level to its concrete effort variant", () => {
    expect(resolveThinkingModel(families, "claude-opus-4-8-high", "high")).toBe("claude-opus-4-8-high");
    expect(resolveThinkingModel(families, "claude-opus-4-8-high", "low")).toBe("claude-opus-4-8-low");
    expect(resolveThinkingModel(families, "gpt-5.3-codex", "medium")).toBe("gpt-5.3-codex");
  });

  it("falls back to the nearest available effort when the exact one is missing", () => {
    expect(resolveThinkingModel(families, "claude-opus-4-8-high", "medium")).toBe("claude-opus-4-8-high");
    expect(resolveThinkingModel(families, "composer-2.5", "high")).toBe("composer-2.5");
  });

  it("passes through an id whose family is unknown", () => {
    expect(resolveThinkingModel(families, "gemini-3.1-pro", "high")).toBe("gemini-3.1-pro");
  });
});

function fam(family: string, flagship: string): AgentFamily {
  return { family, label: family, flagship, variants: [flagship], efforts: { high: flagship } };
}

describe("orderFamilies", () => {
  const families = [
    fam("gpt-5.3-codex", "gpt-5.3-codex-high"),
    fam("cursor-grok-4.5", "cursor-grok-4.5-high"),
    fam("composer-2.5", "composer-2.5"),
    fam("claude-opus-4-8", "claude-opus-4-8-high"),
    fam("gpt-5.5", "gpt-5.5-high"),
    fam("gpt-5.4-mini", "gpt-5.4-mini-medium"),
  ];

  it("orders the default trio (codex, opus, grok) first when nothing is remembered", () => {
    expect(orderFamilies(families, []).map((f) => f.family)).toEqual([
      "gpt-5.3-codex",
      "claude-opus-4-8",
      "cursor-grok-4.5",
      "composer-2.5",
      "gpt-5.5",
      "gpt-5.4-mini",
    ]);
  });

  it("puts last-used families first, in remembered order", () => {
    const ordered = orderFamilies(families, ["claude-opus-4-8-high"]).map((f) => f.family);
    expect(ordered[0]).toBe("claude-opus-4-8");
    expect(ordered.slice(1, 3)).toEqual(["gpt-5.3-codex", "cursor-grok-4.5"]);
  });
});
