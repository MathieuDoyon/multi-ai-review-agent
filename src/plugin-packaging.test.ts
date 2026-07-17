import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");

async function readJson(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(resolve(root, path), "utf8")) as Record<string, unknown>;
}

describe("cross-host plugin packaging", () => {
  it("uses the neutral plugin identity in every manifest", async () => {
    const packageJson = await readJson("package.json");
    const claudePlugin = await readJson(".claude-plugin/plugin.json");
    const claudeMarketplace = await readJson(".claude-plugin/marketplace.json");
    const codexPlugin = await readJson(".codex-plugin/plugin.json");
    const codexMarketplace = await readJson(".agents/plugins/marketplace.json");

    expect(packageJson.name).toBe("multi-ai-review-agent");
    expect(claudePlugin.name).toBe("multi-ai-review-agent");
    expect(claudeMarketplace.name).toBe("multi-ai-review-agent");
    expect(codexPlugin.name).toBe("multi-ai-review-agent");
    expect(codexMarketplace.name).toBe("multi-ai-review-agent");
  });

  it("keeps package and plugin versions aligned", async () => {
    const packageJson = await readJson("package.json");
    const claudePlugin = await readJson(".claude-plugin/plugin.json");
    const claudeMarketplace = await readJson(".claude-plugin/marketplace.json");
    const codexPlugin = await readJson(".codex-plugin/plugin.json");
    const claudeMetadata = claudeMarketplace.metadata as Record<string, unknown>;

    expect(claudePlugin.version).toBe(packageJson.version);
    expect(claudeMetadata.version).toBe(packageJson.version);
    expect(codexPlugin.version).toBe(packageJson.version);
  });

  it("points the Codex plugin and marketplace at the shared skill", async () => {
    const codexPlugin = await readJson(".codex-plugin/plugin.json");
    const codexMarketplace = await readJson(".agents/plugins/marketplace.json");
    const pluginInterface = codexPlugin.interface as Record<string, unknown>;
    const plugins = codexMarketplace.plugins as Array<Record<string, unknown>>;
    const entry = plugins[0];

    expect(codexPlugin.skills).toBe("./skills/");
    expect(pluginInterface.displayName).toBe("Multi-AI Review Agent");
    expect(pluginInterface.shortDescription).toBeTypeOf("string");
    expect(pluginInterface.longDescription).toBeTypeOf("string");
    expect(pluginInterface.developerName).toBe("Mathieu Doyon");
    expect(pluginInterface.category).toBe("Productivity");
    expect(entry.name).toBe("multi-ai-review-agent");
    expect(entry.source).toEqual({ source: "local", path: "./" });
    expect(entry.policy).toEqual({ installation: "AVAILABLE", authentication: "ON_INSTALL" });
    expect(entry.category).toBe("Productivity");
  });

  it("keeps the shared skill instructions host-neutral", async () => {
    const skill = await readFile(resolve(root, "skills/multi-ai-review-agent/SKILL.md"), "utf8");

    expect(skill).not.toContain("AskUserQuestion");
    expect(skill).not.toContain("run_in_background");
    expect(skill).not.toContain("Claude then");
    expect(skill).toContain("$multi-ai-review-agent");
  });

  it("uses the renamed GitHub repository in manifests and installation docs", async () => {
    const packageJson = await readJson("package.json");
    const claudePlugin = await readJson(".claude-plugin/plugin.json");
    const codexPlugin = await readJson(".codex-plugin/plugin.json");
    const readme = await readFile(resolve(root, "README.md"), "utf8");
    const repository = packageJson.repository as Record<string, unknown>;

    expect(readme).toMatch(/^# multi-ai-review-agent/m);
    expect(repository.url).toBe("git+https://github.com/MathieuDoyon/multi-ai-review-agent.git");
    expect(claudePlugin.repository).toBe("https://github.com/MathieuDoyon/multi-ai-review-agent");
    expect(codexPlugin.repository).toBe("https://github.com/MathieuDoyon/multi-ai-review-agent");
    expect(readme).toContain("codex plugin marketplace add MathieuDoyon/multi-ai-review-agent --ref main");
    expect(readme).toContain("codex plugin marketplace upgrade multi-ai-review-agent");
    expect(readme).toContain("codex plugin add multi-ai-review-agent@multi-ai-review-agent");
    expect(readme).not.toContain("codex plugin remove multi-ai-review-agent@multi-ai-review-agent");
    expect(readme).not.toContain("cc-multi-ai-review-agent");
  });

  it("validates Codex packaging and version parity in automation", async () => {
    const packageJson = await readJson("package.json");
    const scripts = packageJson.scripts as Record<string, string>;
    const ci = await readFile(resolve(root, ".github/workflows/ci.yml"), "utf8");
    const release = await readFile(resolve(root, ".github/workflows/release.yml"), "utf8");

    expect(scripts["validate:packaging"]).toBe("vitest run src/plugin-packaging.test.ts");
    expect(ci).toContain("pnpm validate:packaging");
    expect(release).toContain(".codex-plugin/plugin.json");
    expect(release).toContain(".claude-plugin/marketplace.json");
    expect(release).toContain("package.json");
  });
});
