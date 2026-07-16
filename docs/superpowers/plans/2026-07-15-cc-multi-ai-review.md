# cc-multi-ai-review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the opencode-multi-ai-review engine to a self-contained Node CLI that the Claude Code `/multi-ai-review` skill shells out to, adding interactive model selection, thinking-level, base-ref override, extra focus, and remembered-last-models.

**Architecture:** A zero-runtime-dependency Node CLI (`src/cli.ts` → bundled `dist/cli.mjs`) exposes two subcommands: `prep` (emits a JSON blob of model families + last-used models + detected base ref for the skill to build `AskUserQuestion` from) and `run` (resolves the base ref, collects the diff, runs each selected model through the `pi` CLI in parallel forcing a fenced-JSON schema, then deterministically groups/classifies/renders a Markdown report and persists the lineup). The skill (`~/.claude/skills/multi-ai-review/SKILL.md`) parses args, calls `prep`, asks the user, calls `run`, then ground-truths the FIX-classified findings.

**Tech Stack:** TypeScript (ESM, NodeNext), Node 24, vitest, esbuild (bundler). Runtime uses only Node builtins (`child_process`, `fs`, `path`, `os`, `util`). External process: the `pi` CLI.

## Global Constraints

- ESM only; `"type": "module"`; TS `module`/`moduleResolution` = `NodeNext`; `strict: true`. Import local modules with the `.js` extension.
- Zero runtime dependencies — Node builtins only. `esbuild` and `typescript` and `vitest` are devDependencies. The `@opencode-ai/plugin` dependency is removed.
- Model IDs are always `provider/model` (e.g. `openai-codex/gpt-5.6-sol`).
- `pi` invariants: prompt is piped over **STDIN** (never argv); read **stdout only** (stderr may contain noise like `supacode: OSC emit failed … /dev/tty`); discover models at runtime via `pi --list-models` (never hardcode versions).
- Thinking levels are exactly `low | medium | high`; `--thinking` is passed to a model only when that model's `thinking` column is `yes`.
- Global state path: `~/.claude/multi-ai-review/state.json` (resolved via `os.homedir()`; tests inject a temp base dir).
- Skill directory: `$HOME/.claude/skills/multi-ai-review`; the bundled CLI lives at `$HOME/.claude/skills/multi-ai-review/scripts/cli.mjs`.
- Tests use vitest globals (`describe`/`it`/`expect`); run with `pnpm test:run`. Typecheck with `pnpm typecheck`.

---

## File Structure

**Reuse unchanged:** `src/findings.ts` (+ test), `src/report.ts` (+ test).

**Modify:** `src/git.ts` (+ test — failure copy), `src/prompt.ts` (+ test — JSON fallback), `src/types.ts` (pi types in, `ReviewClient` out), `package.json`, `README.md`.

**Rewrite:** `src/models.ts` (+ test), `src/state.ts` (+ test), `src/review.ts` (+ test).

**Create:** `src/pi.ts` (+ test), `src/cli.ts` (+ test), `~/.claude/skills/multi-ai-review/SKILL.md`, `~/.claude/skills/multi-ai-review/scripts/cli.mjs` (build output).

**Delete:** `src/tool.ts`, `src/tool.test.ts`, `src/index.ts`, `src/command.ts`, `src/command.test.ts`, `src/package-docs.test.ts`, `commands/multi-review.md`, `pnpm-workspace.yaml`, `tsconfig.build.json`.

---

## Task 1: Scaffolding — strip opencode, wire the CLI build

**Files:**
- Delete: `src/tool.ts`, `src/tool.test.ts`, `src/index.ts`, `src/command.ts`, `src/command.test.ts`, `src/package-docs.test.ts`, `commands/multi-review.md`, `pnpm-workspace.yaml`, `tsconfig.build.json`
- Modify: `package.json`

**Interfaces:**
- Consumes: nothing.
- Produces: `pnpm build` (esbuild → `dist/cli.mjs`), `pnpm sync`, `pnpm test:run`, `pnpm typecheck` scripts; a `bin` named `cc-multi-ai-review`. Note: `pnpm build` will not succeed until Task 9 creates `src/cli.ts` — that is expected; only `test:run`/`typecheck` must be green after this task.

- [ ] **Step 1: Delete opencode-specific files**

```bash
cd ~/Developer/cc-multi-ai-review
git rm src/tool.ts src/tool.test.ts src/index.ts src/command.ts src/command.test.ts src/package-docs.test.ts commands/multi-review.md pnpm-workspace.yaml tsconfig.build.json
rmdir commands 2>/dev/null || true
```

- [ ] **Step 2: Replace `package.json`**

```json
{
  "name": "cc-multi-ai-review",
  "version": "0.1.0",
  "description": "Multi-model AI code review CLI for the Claude Code /multi-ai-review skill.",
  "type": "module",
  "private": false,
  "bin": {
    "cc-multi-ai-review": "./dist/cli.mjs"
  },
  "files": [
    "dist"
  ],
  "scripts": {
    "build": "esbuild src/cli.ts --bundle --platform=node --target=node20 --format=esm --outfile=dist/cli.mjs --banner:js='#!/usr/bin/env node'",
    "sync": "mkdir -p \"$HOME/.claude/skills/multi-ai-review/scripts\" && cp dist/cli.mjs \"$HOME/.claude/skills/multi-ai-review/scripts/cli.mjs\"",
    "typecheck": "tsc --noEmit",
    "test": "vitest",
    "test:run": "vitest run"
  },
  "keywords": [
    "claude-code",
    "code-review",
    "multi-agent",
    "pi"
  ],
  "license": "MIT",
  "devDependencies": {
    "@types/node": "^26.0.0",
    "esbuild": "^0.24.0",
    "typescript": "^5.7.3",
    "vitest": "^2.1.8"
  }
}
```

- [ ] **Step 3: Install deps (drops @opencode-ai/plugin, adds esbuild)**

Run: `pnpm install`
Expected: completes; `@opencode-ai/plugin` gone from `node_modules`, `esbuild` present.

- [ ] **Step 4: Verify existing tests + typecheck still pass**

Run: `pnpm test:run && pnpm typecheck`
Expected: PASS (remaining suites: `models`, `state`, `git`, `prompt`, `findings`, `report`, `review`). `review.test.ts` still uses the opencode `ReviewClient` mock — that is fine; it is rewritten in Task 8.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: strip opencode plugin scaffolding, wire CLI build"
```

---

## Task 2: `models.ts` — parse `pi --list-models`

**Files:**
- Modify: `src/models.ts`
- Test: `src/models.test.ts`

**Interfaces:**
- Consumes: raw stdout of `pi --list-models`.
- Produces: `type PiModel = { id: string; provider: string; model: string; thinking: boolean }`; `function parsePiModels(output: string): PiModel[]`. Keeps existing `parseModelID(id: string): ParsedModelID | undefined` and `type ParsedModelID`.

- [ ] **Step 1: Replace `src/models.test.ts` with parser tests**

```typescript
import { describe, expect, it } from "vitest";
import { parseModelID, parsePiModels } from "./models.js";

const SAMPLE = `provider      model                context  max-out  thinking  images
openai-codex  gpt-5.4              272K     128K     yes       yes
openai-codex  gpt-5.4-mini         272K     128K     yes       yes
opencode-go   minimax-m3           1M       131.1K   yes       yes
opencode-go   glm-5.1              202.8K   32.8K    yes       no
`;

describe("parsePiModels", () => {
  it("parses provider, model, and thinking support, skipping the header", () => {
    expect(parsePiModels(SAMPLE)).toEqual([
      { id: "openai-codex/gpt-5.4", provider: "openai-codex", model: "gpt-5.4", thinking: true },
      { id: "openai-codex/gpt-5.4-mini", provider: "openai-codex", model: "gpt-5.4-mini", thinking: true },
      { id: "opencode-go/minimax-m3", provider: "opencode-go", model: "minimax-m3", thinking: true },
      { id: "opencode-go/glm-5.1", provider: "opencode-go", model: "glm-5.1", thinking: false },
    ]);
  });

  it("ignores blank lines and non-model noise", () => {
    const noisy = "supacode: OSC emit failed: code=ENXIO\n\n" + SAMPLE;
    expect(parsePiModels(noisy).map((m) => m.id)).toContain("opencode-go/minimax-m3");
    expect(parsePiModels(noisy)).toHaveLength(4);
  });
});

describe("parseModelID", () => {
  it("splits the provider from the model ID", () => {
    expect(parseModelID("openai-codex/gpt-5.5")).toEqual({ providerID: "openai-codex", modelID: "gpt-5.5" });
  });

  it("rejects invalid model IDs", () => {
    expect(parseModelID("missing-provider")).toBeUndefined();
    expect(parseModelID("provider/")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/models.test.ts`
Expected: FAIL — `parsePiModels` is not exported.

- [ ] **Step 3: Rewrite `src/models.ts`**

```typescript
export type ParsedModelID = {
  providerID: string;
  modelID: string;
};

export type PiModel = {
  id: string;
  provider: string;
  model: string;
  thinking: boolean;
};

export function parseModelID(id: string): ParsedModelID | undefined {
  const slash = id.indexOf("/");
  if (slash <= 0 || slash === id.length - 1) return undefined;
  return { providerID: id.slice(0, slash), modelID: id.slice(slash + 1) };
}

export function parsePiModels(output: string): PiModel[] {
  const models: PiModel[] = [];
  for (const line of output.split("\n")) {
    const tokens = line.trim().split(/\s+/);
    if (tokens.length < 6) continue;
    const thinking = tokens[4];
    if (thinking !== "yes" && thinking !== "no") continue; // skips header + noise
    const provider = tokens[0];
    const model = tokens[1];
    models.push({ id: `${provider}/${model}`, provider, model, thinking: thinking === "yes" });
  }
  return models;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run src/models.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/models.ts src/models.test.ts
git commit -m "feat: parse pi --list-models output"
```

---

## Task 3: `models.ts` — group families + pick flagship

**Files:**
- Modify: `src/models.ts`
- Test: `src/models.test.ts`

**Interfaces:**
- Consumes: `PiModel[]` from Task 2.
- Produces: `type ModelFamily = { family: string; flagship: string; variants: string[]; thinking: boolean }`; `function groupModelFamilies(models: PiModel[]): ModelFamily[]`; `function thinkingSupportMap(models: PiModel[]): Record<string, boolean>`; `function familyKey(provider: string, model: string): string`.

- [ ] **Step 1: Append grouping tests to `src/models.test.ts`**

```typescript
import { familyKey, groupModelFamilies, thinkingSupportMap } from "./models.js";
import type { PiModel } from "./models.js";

function pm(id: string, thinking = true): PiModel {
  const [provider, model] = [id.slice(0, id.indexOf("/")), id.slice(id.indexOf("/") + 1)];
  return { id, provider, model, thinking };
}

describe("familyKey", () => {
  it("keeps openai gpt minor lines as distinct families", () => {
    expect(familyKey("openai-codex", "gpt-5.6-sol")).toBe("openai-codex/gpt-5.6");
    expect(familyKey("openai-codex", "gpt-5.4")).toBe("openai-codex/gpt-5.4");
  });

  it("strips version/variant to a root for other families", () => {
    expect(familyKey("opencode-go", "minimax-m3")).toBe("opencode-go/minimax");
    expect(familyKey("opencode-go", "kimi-k2.7-code")).toBe("opencode-go/kimi");
    expect(familyKey("opencode-go", "glm-5.2")).toBe("opencode-go/glm");
    expect(familyKey("opencode-go", "qwen3.7-plus")).toBe("opencode-go/qwen");
    expect(familyKey("opencode-go", "mimo-v2.5-pro")).toBe("opencode-go/mimo");
    expect(familyKey("opencode-go", "deepseek-v4-flash")).toBe("opencode-go/deepseek");
  });
});

describe("groupModelFamilies", () => {
  it("groups variants and picks the newest non-lightweight flagship", () => {
    const families = groupModelFamilies([
      pm("openai-codex/gpt-5.6-luna"),
      pm("openai-codex/gpt-5.6-sol"),
      pm("openai-codex/gpt-5.6-terra"),
      pm("opencode-go/kimi-k2.6"),
      pm("opencode-go/kimi-k2.7-code"),
      pm("opencode-go/minimax-m2.7"),
      pm("opencode-go/minimax-m3"),
    ]);

    const byFamily = Object.fromEntries(families.map((f) => [f.family, f.flagship]));
    expect(byFamily["openai-codex/gpt-5.6"]).toBe("openai-codex/gpt-5.6-terra");
    expect(byFamily["opencode-go/kimi"]).toBe("opencode-go/kimi-k2.7-code");
    expect(byFamily["opencode-go/minimax"]).toBe("opencode-go/minimax-m3");
  });

  it("excludes lightweight variants from flagship selection", () => {
    const families = groupModelFamilies([
      pm("openai-codex/gpt-5.4"),
      pm("openai-codex/gpt-5.4-mini"),
    ]);
    expect(families).toHaveLength(1);
    expect(families[0].flagship).toBe("openai-codex/gpt-5.4");
    expect(families[0].variants).toEqual(["openai-codex/gpt-5.4", "openai-codex/gpt-5.4-mini"]);
  });

  it("falls back to a lightweight variant when it is the only option", () => {
    const families = groupModelFamilies([pm("openai-codex/gpt-5.3-codex-spark")]);
    expect(families[0].flagship).toBe("openai-codex/gpt-5.3-codex-spark");
  });

  it("carries the flagship's thinking support onto the family", () => {
    const families = groupModelFamilies([pm("opencode-go/glm-5.2", false)]);
    expect(families[0].thinking).toBe(false);
  });
});

describe("thinkingSupportMap", () => {
  it("maps each model id to its thinking support", () => {
    expect(thinkingSupportMap([pm("a/b", true), pm("c/d", false)])).toEqual({ "a/b": true, "c/d": false });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/models.test.ts`
Expected: FAIL — `groupModelFamilies`/`familyKey`/`thinkingSupportMap` not exported.

- [ ] **Step 3: Append implementation to `src/models.ts`**

```typescript
const LIGHTWEIGHT_TOKENS = new Set(["mini", "fast", "flash", "free", "spark", "lite"]);

export type ModelFamily = {
  family: string;
  flagship: string;
  variants: string[];
  thinking: boolean;
};

export function familyKey(provider: string, model: string): string {
  const gpt = model.match(/^(gpt-\d+\.\d+)/);
  if (gpt) return `${provider}/${gpt[1]}`;
  return `${provider}/${familyRoot(model)}`;
}

function familyRoot(model: string): string {
  const digit = model.search(/\d/);
  const head = digit === -1 ? model : model.slice(0, digit);
  const segments = head.split("-").filter((seg) => seg.length > 0);
  if (segments.length > 1 && (segments[segments.length - 1] ?? "").length <= 2) segments.pop();
  return segments.join("-") || model;
}

function isLightweight(model: string): boolean {
  return model.split(/[-.]/).some((token) => LIGHTWEIGHT_TOKENS.has(token));
}

function pickFlagship(list: PiModel[]): PiModel {
  const full = list.filter((m) => !isLightweight(m.model));
  const pool = full.length > 0 ? full : list;
  const sorted = [...pool].sort((a, b) => a.model.localeCompare(b.model, undefined, { numeric: true }));
  return sorted[sorted.length - 1] as PiModel;
}

export function groupModelFamilies(models: PiModel[]): ModelFamily[] {
  const map = new Map<string, PiModel[]>();
  for (const m of models) {
    const key = familyKey(m.provider, m.model);
    const list = map.get(key) ?? [];
    list.push(m);
    map.set(key, list);
  }

  const families: ModelFamily[] = [];
  for (const [family, list] of map) {
    const flagship = pickFlagship(list);
    families.push({
      family,
      flagship: flagship.id,
      variants: list.map((m) => m.id),
      thinking: flagship.thinking,
    });
  }
  return families;
}

export function thinkingSupportMap(models: PiModel[]): Record<string, boolean> {
  const map: Record<string, boolean> = {};
  for (const m of models) map[m.id] = m.thinking;
  return map;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run src/models.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/models.ts src/models.test.ts
git commit -m "feat: group models into families with flagship selection"
```

---

## Task 4: `models.ts` — order families (last-used first, then trio)

**Files:**
- Modify: `src/models.ts`
- Test: `src/models.test.ts`

**Interfaces:**
- Consumes: `ModelFamily[]` (Task 3), `lastModels: string[]`.
- Produces: `function orderFamilies(families: ModelFamily[], lastModels: string[]): ModelFamily[]`.

- [ ] **Step 1: Append ordering tests to `src/models.test.ts`**

```typescript
import { orderFamilies } from "./models.js";
import type { ModelFamily } from "./models.js";

function fam(family: string, flagship: string, variants = [flagship]): ModelFamily {
  return { family, flagship, variants, thinking: true };
}

describe("orderFamilies", () => {
  const families = [
    fam("openai-codex/gpt-5.4", "openai-codex/gpt-5.4"),
    fam("openai-codex/gpt-5.5", "openai-codex/gpt-5.5"),
    fam("openai-codex/gpt-5.6", "openai-codex/gpt-5.6-terra"),
    fam("opencode-go/minimax", "opencode-go/minimax-m3"),
    fam("opencode-go/kimi", "opencode-go/kimi-k2.7-code"),
    fam("opencode-go/qwen", "opencode-go/qwen3.7-plus"),
  ];

  it("orders the default trio (newest gpt, minimax, kimi) first when nothing is remembered", () => {
    expect(orderFamilies(families, []).map((f) => f.family)).toEqual([
      "openai-codex/gpt-5.6",
      "opencode-go/minimax",
      "opencode-go/kimi",
      "openai-codex/gpt-5.4",
      "openai-codex/gpt-5.5",
      "opencode-go/qwen",
    ]);
  });

  it("puts last-used families first, in remembered order", () => {
    const ordered = orderFamilies(families, ["opencode-go/qwen3.7-plus"]).map((f) => f.family);
    expect(ordered[0]).toBe("opencode-go/qwen");
    expect(ordered.slice(1, 4)).toEqual([
      "openai-codex/gpt-5.6",
      "opencode-go/minimax",
      "opencode-go/kimi",
    ]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/models.test.ts`
Expected: FAIL — `orderFamilies` not exported.

- [ ] **Step 3: Append implementation to `src/models.ts`**

```typescript
const DEFAULT_TRIO = ["gpt", "minimax", "kimi"];

export function orderFamilies(families: ModelFamily[], lastModels: string[]): ModelFamily[] {
  const remaining = [...families];
  const ordered: ModelFamily[] = [];

  for (const id of lastModels) {
    const idx = remaining.findIndex((f) => f.variants.includes(id));
    if (idx !== -1) ordered.push(...remaining.splice(idx, 1));
  }

  for (const name of DEFAULT_TRIO) {
    const idx = name === "gpt" ? newestGptIndex(remaining) : remaining.findIndex((f) => familyModel(f) === name);
    if (idx !== -1) ordered.push(...remaining.splice(idx, 1));
  }

  ordered.push(...remaining);
  return ordered;
}

function familyModel(family: ModelFamily): string {
  return family.family.split("/")[1] ?? "";
}

function newestGptIndex(families: ModelFamily[]): number {
  let best = -1;
  for (let i = 0; i < families.length; i++) {
    if (!familyModel(families[i] as ModelFamily).startsWith("gpt")) continue;
    if (best === -1) {
      best = i;
      continue;
    }
    const a = familyModel(families[i] as ModelFamily);
    const b = familyModel(families[best] as ModelFamily);
    if (a.localeCompare(b, undefined, { numeric: true }) > 0) best = i;
  }
  return best;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run src/models.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/models.ts src/models.test.ts
git commit -m "feat: order families with last-used and default trio first"
```

---

## Task 5: `state.ts` — global state path

**Files:**
- Rewrite: `src/state.ts`
- Test: `src/state.test.ts`

**Interfaces:**
- Consumes: `type ReviewStateStore` from `./types.js` (unchanged: `readLastModels(): Promise<string[]>`, `writeLastModels(models: string[]): Promise<void>`).
- Produces: `function createReviewStateStore(baseDir?: string): ReviewStateStore` — defaults to `join(os.homedir(), ".claude")`; writes to `<baseDir>/multi-ai-review/state.json`; no `.gitignore` file.

- [ ] **Step 1: Replace `src/state.test.ts`**

```typescript
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createReviewStateStore } from "./state.js";

async function tempBase(): Promise<string> {
  return mkdtemp(join(tmpdir(), "cc-multi-ai-review-"));
}

describe("createReviewStateStore", () => {
  it("returns an empty list when state is missing", async () => {
    const store = createReviewStateStore(await tempBase());
    await expect(store.readLastModels()).resolves.toEqual([]);
  });

  it("writes and reads last models under multi-ai-review/state.json", async () => {
    const base = await tempBase();
    const store = createReviewStateStore(base);

    await store.writeLastModels(["openai-codex/gpt-5.6-sol", "opencode-go/minimax-m3"]);

    await expect(store.readLastModels()).resolves.toEqual([
      "openai-codex/gpt-5.6-sol",
      "opencode-go/minimax-m3",
    ]);
    await expect(readFile(join(base, "multi-ai-review/state.json"), "utf8")).resolves.toContain("lastModels");
  });

  it("ignores invalid state", async () => {
    const base = await tempBase();
    await mkdir(join(base, "multi-ai-review"), { recursive: true });
    await writeFile(join(base, "multi-ai-review/state.json"), "not json");
    const store = createReviewStateStore(base);
    await expect(store.readLastModels()).resolves.toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/state.test.ts`
Expected: FAIL — file still written under `.opencode/...`.

- [ ] **Step 3: Rewrite `src/state.ts`**

```typescript
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ReviewStateStore } from "./types.js";

type StateFile = {
  lastModels?: unknown;
};

export function createReviewStateStore(baseDir: string = join(homedir(), ".claude")): ReviewStateStore {
  const filePath = join(baseDir, "multi-ai-review", "state.json");
  const stateDirectory = dirname(filePath);

  return {
    async readLastModels() {
      try {
        const parsed = JSON.parse(await readFile(filePath, "utf8")) as StateFile;
        return Array.isArray(parsed.lastModels) && parsed.lastModels.every((model) => typeof model === "string")
          ? (parsed.lastModels as string[])
          : [];
      } catch {
        return [];
      }
    },
    async writeLastModels(models) {
      await mkdir(stateDirectory, { recursive: true });
      await writeFile(`${filePath}.tmp`, `${JSON.stringify({ lastModels: models }, null, 2)}\n`, "utf8");
      await rename(`${filePath}.tmp`, filePath);
    },
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run src/state.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/state.ts src/state.test.ts
git commit -m "feat: store last models globally under ~/.claude"
```

---

## Task 6: Reused-module tweaks — JSON fallback (`prompt.ts`) + base-ref copy (`git.ts`)

**Files:**
- Modify: `src/prompt.ts`, `src/prompt.test.ts`
- Modify: `src/git.ts`, `src/git.test.ts`

**Interfaces:**
- Consumes: `type ReviewerOutput` from `./types.js`.
- Produces: `extractReviewerOutput` gains a bare-`{…}` fallback when no ```json fence is present; `resolveBaseRef`'s no-ref failure message becomes `Could not resolve a base ref. Try /multi-ai-review origin/main.`

- [ ] **Step 1: Add a fallback test to `src/prompt.test.ts`**

Append:

```typescript
import { extractReviewerOutput } from "./prompt.js";

describe("extractReviewerOutput fallback", () => {
  it("parses a bare JSON object when no code fence is present", () => {
    const text = 'Here is my review: {"summary":"ok","findings":[]} — done.';
    expect(extractReviewerOutput(text)).toEqual({ summary: "ok", findings: [] });
  });

  it("returns undefined when there is no JSON at all", () => {
    expect(extractReviewerOutput("no json here")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/prompt.test.ts`
Expected: FAIL — bare-object text returns `undefined`.

- [ ] **Step 3: Update `extractReviewerOutput` in `src/prompt.ts`**

Replace the body of `extractReviewerOutput` with:

```typescript
export function extractReviewerOutput(text: string): ReviewerOutput | undefined {
  const fenced = text.match(/```json\s*([\s\S]*?)\s*```/i);
  const candidate = fenced?.[1] ?? bareObject(text);
  if (!candidate) return undefined;

  try {
    const parsed = JSON.parse(candidate) as unknown;
    return isReviewerOutput(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function bareObject(text: string): string | undefined {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return undefined;
  return text.slice(start, end + 1);
}
```

- [ ] **Step 4: Update the base-ref failure message + its test**

In `src/git.ts`, change the no-ref failure message to:

```typescript
    message: "Could not resolve a base ref. Try /multi-ai-review origin/main.",
```

In `src/git.test.ts`, update the matching expectation string to the same text.

- [ ] **Step 5: Run to verify both pass**

Run: `pnpm vitest run src/prompt.test.ts src/git.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/prompt.ts src/prompt.test.ts src/git.ts src/git.test.ts
git commit -m "feat: tolerant JSON extraction and skill-aligned base-ref copy"
```

---

## Task 7: `pi.ts` — the pi CLI runner

**Files:**
- Create: `src/pi.ts`
- Test: `src/pi.test.ts`
- Modify: `src/types.ts`

**Interfaces:**
- Consumes: the `pi` binary.
- Produces (in `src/types.ts`): `type ThinkingLevel = "low" | "medium" | "high"`; `type PiInvocation = { model: string; prompt: string; thinking?: ThinkingLevel }`; `type PiResult = { model: string; ok: true; stdout: string } | { model: string; ok: false; reason: string }`; `type PiRunner = (invocation: PiInvocation) => Promise<PiResult>`.
- Produces (in `src/pi.ts`): `function buildPiArgs(invocation: Pick<PiInvocation, "model" | "thinking">): string[]`; `function createPiRunner(options?: { timeoutMs?: number }): PiRunner`.

- [ ] **Step 1: Add pi types to `src/types.ts`**

Append to `src/types.ts`:

```typescript
export type ThinkingLevel = "low" | "medium" | "high";

export type PiInvocation = {
  model: string;
  prompt: string;
  thinking?: ThinkingLevel;
};

export type PiResult =
  | { model: string; ok: true; stdout: string }
  | { model: string; ok: false; reason: string };

export type PiRunner = (invocation: PiInvocation) => Promise<PiResult>;
```

- [ ] **Step 2: Write the failing test `src/pi.test.ts`**

```typescript
import { describe, expect, it } from "vitest";
import { buildPiArgs } from "./pi.js";

describe("buildPiArgs", () => {
  it("always uses --print and --model", () => {
    expect(buildPiArgs({ model: "openai-codex/gpt-5.6-sol" })).toEqual([
      "--print",
      "--model",
      "openai-codex/gpt-5.6-sol",
    ]);
  });

  it("adds --thinking only when a level is provided", () => {
    expect(buildPiArgs({ model: "a/b", thinking: "high" })).toEqual([
      "--print",
      "--model",
      "a/b",
      "--thinking",
      "high",
    ]);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm vitest run src/pi.test.ts`
Expected: FAIL — `./pi.js` does not exist.

- [ ] **Step 4: Write `src/pi.ts`**

```typescript
import { spawn } from "node:child_process";
import type { PiInvocation, PiResult, PiRunner } from "./types.js";

export function buildPiArgs(invocation: Pick<PiInvocation, "model" | "thinking">): string[] {
  const args = ["--print", "--model", invocation.model];
  if (invocation.thinking) args.push("--thinking", invocation.thinking);
  return args;
}

export function createPiRunner(options: { timeoutMs?: number } = {}): PiRunner {
  const timeoutMs = options.timeoutMs ?? 240_000;

  return (invocation) =>
    new Promise<PiResult>((resolve) => {
      const child = spawn("pi", buildPiArgs(invocation), { stdio: ["pipe", "pipe", "pipe"] });
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
          resolve({ model: invocation.model, ok: false, reason: stderr.trim() || `pi exited with code ${code}` });
        }
      });

      child.stdin.end(invocation.prompt);
    });
}
```

- [ ] **Step 5: Run to verify it passes + typecheck**

Run: `pnpm vitest run src/pi.test.ts && pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/pi.ts src/pi.test.ts src/types.ts
git commit -m "feat: add pi CLI runner (stdin prompt, stdout capture, timeout)"
```

---

## Task 8: `review.ts` — orchestrate reviewers via the pi runner

**Files:**
- Rewrite: `src/review.ts`
- Test: `src/review.test.ts`
- Modify: `src/types.ts`

**Interfaces:**
- Consumes: `PiRunner` (Task 7), `ShellRunner`, `groupFindings`, `buildReviewerPrompt`, `extractReviewerOutput`, `renderReport`, `resolveBaseRef`, `collectDiff`.
- Produces: `type RunReviewInput = { runPi: PiRunner; shell: ShellRunner; models: string[]; thinking?: ThinkingLevel; thinkingSupport?: Record<string, boolean>; baseRef?: string; instructions?: string; limits: DiffLimits }` (in `src/types.ts`, replacing the old opencode shape and removing `ReviewClient`); `function runMultiAiReview(input: RunReviewInput): Promise<string>`.

- [ ] **Step 1: Update `src/types.ts` — remove `ReviewClient`, retype `RunReviewInput`**

Delete the `ReviewClient` type entirely. Replace the existing `RunReviewInput` with:

```typescript
export type RunReviewInput = {
  runPi: PiRunner;
  shell: ShellRunner;
  models: string[];
  thinking?: ThinkingLevel;
  thinkingSupport?: Record<string, boolean>;
  baseRef?: string;
  instructions?: string;
  limits: DiffLimits;
};
```

(`PiRunner` and `ThinkingLevel` are already exported from this file by Task 7.)

- [ ] **Step 2: Replace `src/review.test.ts`**

```typescript
import { describe, expect, it, vi } from "vitest";
import { runMultiAiReview } from "./review.js";
import type { PiRunner, ShellRunner } from "./types.js";

function shellWithGitContext(): ShellRunner {
  return async (command: string) => {
    const responses: Record<string, string> = {
      "git rev-parse --verify origin/main^{commit}": "base\n",
      "git merge-base HEAD origin/main": "merge-base\n",
      "git diff --stat merge-base..HEAD": "src/file.ts | 2 +-\n",
      "git diff --name-status merge-base..HEAD": "M\tsrc/file.ts\n",
      "git diff merge-base..HEAD": "diff --git a/src/file.ts b/src/file.ts\n+new line\n",
    };
    const response = responses[command];
    if (response === undefined) throw new Error(`unexpected command: ${command}`);
    return response;
  };
}

const FINDING_JSON = `\`\`\`json\n${JSON.stringify({
  summary: "summary",
  findings: [
    {
      title: "Missing null guard",
      severity: "high",
      confidence: "high",
      file: "src/file.ts",
      line: 12,
      category: "bug",
      evidence: "value may be null",
      recommendation: "Add a guard",
      falsePositiveRisk: "Caller may validate",
    },
  ],
})}\n\`\`\``;

describe("runMultiAiReview", () => {
  it("runs each model through the pi runner and renders grouped findings", async () => {
    const runPi = vi.fn<PiRunner>(async ({ model }) => ({ model, ok: true, stdout: FINDING_JSON }));

    const report = await runMultiAiReview({
      runPi,
      shell: shellWithGitContext(),
      models: ["openai-codex/gpt-5.6-sol", "opencode-go/minimax-m3"],
      thinking: "medium",
      limits: { maxDiffBytes: 1000, maxDiffLines: 100, maxFiles: 10 },
    });

    expect(runPi).toHaveBeenCalledTimes(2);
    expect(report).toContain("Missing null guard");
    expect(report).toContain("openai-codex/gpt-5.6-sol, opencode-go/minimax-m3");
    expect(report).toContain("address");
  });

  it("builds the prompt once and shares it across models", async () => {
    const prompts = new Set<string>();
    const runPi = vi.fn<PiRunner>(async ({ model, prompt }) => {
      prompts.add(prompt);
      return { model, ok: true, stdout: FINDING_JSON };
    });

    await runMultiAiReview({
      runPi,
      shell: shellWithGitContext(),
      models: ["a/b", "c/d"],
      limits: { maxDiffBytes: 1000, maxDiffLines: 100, maxFiles: 10 },
    });

    expect(prompts.size).toBe(1);
  });

  it("omits --thinking for models that do not support it", async () => {
    const calls: Array<{ model: string; thinking?: string }> = [];
    const runPi = vi.fn<PiRunner>(async ({ model, thinking }) => {
      calls.push({ model, ...(thinking ? { thinking } : {}) });
      return { model, ok: true, stdout: FINDING_JSON };
    });

    await runMultiAiReview({
      runPi,
      shell: shellWithGitContext(),
      models: ["thinks/yes", "thinks/no"],
      thinking: "high",
      thinkingSupport: { "thinks/yes": true, "thinks/no": false },
      limits: { maxDiffBytes: 1000, maxDiffLines: 100, maxFiles: 10 },
    });

    expect(calls).toContainEqual({ model: "thinks/yes", thinking: "high" });
    expect(calls).toContainEqual({ model: "thinks/no" });
  });

  it("reports a failed pi run as a reviewer failure", async () => {
    const runPi = vi.fn<PiRunner>(async ({ model }) => ({ model, ok: false, reason: "boom" }));

    const report = await runMultiAiReview({
      runPi,
      shell: shellWithGitContext(),
      models: ["openai-codex/gpt-5.6-sol"],
      limits: { maxDiffBytes: 1000, maxDiffLines: 100, maxFiles: 10 },
    });

    expect(report).toContain("## Reviewer Failures");
    expect(report).toContain("boom");
  });

  it("reports malformed reviewer output as a reviewer failure", async () => {
    const runPi = vi.fn<PiRunner>(async ({ model }) => ({ model, ok: true, stdout: "not json" }));

    const report = await runMultiAiReview({
      runPi,
      shell: shellWithGitContext(),
      models: ["openai-codex/gpt-5.6-sol"],
      limits: { maxDiffBytes: 1000, maxDiffLines: 100, maxFiles: 10 },
    });

    expect(report).toContain("Could not parse reviewer JSON output");
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm vitest run src/review.test.ts`
Expected: FAIL — `runMultiAiReview` still expects an opencode `client`.

- [ ] **Step 4: Rewrite `src/review.ts`**

```typescript
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

  const outcomes = await Promise.all(
    input.models.map((model) => reviewWithModel(input, model, prompt)),
  );

  const results: ReviewerResult[] = [];
  const failures: ReviewerFailure[] = [];
  for (const outcome of outcomes) {
    if ("output" in outcome) results.push(outcome);
    else failures.push(outcome);
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
  const supportsThinking = input.thinkingSupport?.[model] !== false;
  const result = await input.runPi({
    model,
    prompt,
    ...(input.thinking && supportsThinking ? { thinking: input.thinking } : {}),
  });

  if (!result.ok) return { model, reason: result.reason };

  const output = extractReviewerOutput(result.stdout);
  if (!output) return { model, reason: "Could not parse reviewer JSON output" };
  return { model, output };
}
```

- [ ] **Step 5: Run to verify it passes + full suite + typecheck**

Run: `pnpm test:run && pnpm typecheck`
Expected: PASS (all suites).

- [ ] **Step 6: Commit**

```bash
git add src/review.ts src/review.test.ts src/types.ts
git commit -m "feat: drive reviewers through the pi runner"
```

---

## Task 9: `cli.ts` — arg parsing + prep + run commands

**Files:**
- Create: `src/cli.ts`
- Test: `src/cli.test.ts`

**Interfaces:**
- Consumes: `parsePiModels`, `groupModelFamilies`, `orderFamilies`, `thinkingSupportMap` (models); `resolveBaseRef` (git); `runMultiAiReview` (review); `createPiRunner` (pi); `createReviewStateStore` (state); `ShellRunner`, `PiRunner`, `ReviewStateStore`, `DiffLimits`, `ThinkingLevel` (types).
- Produces: `type RunArgs = { models: string[]; thinking: ThinkingLevel; baseRef?: string; focus?: string }`; `type CliDeps = { shell: ShellRunner; runPi: PiRunner; state: ReviewStateStore; limits: DiffLimits }`; `function parseRunArgs(argv: string[]): RunArgs`; `function parsePrepArgs(argv: string[]): { baseRef?: string }`; `function runPrepCommand(deps: CliDeps, args: { baseRef?: string }): Promise<string>`; `function runReviewCommand(deps: CliDeps, args: RunArgs): Promise<string>`; `function main(argv: string[]): Promise<void>`.

- [ ] **Step 1: Write the failing test `src/cli.test.ts`**

```typescript
import { describe, expect, it, vi } from "vitest";
import { parsePrepArgs, parseRunArgs, runPrepCommand, runReviewCommand } from "./cli.js";
import type { CliDeps } from "./cli.js";
import type { PiRunner, ReviewStateStore, ShellRunner } from "./types.js";

const PI_LIST = `provider      model           context  max-out  thinking  images
openai-codex  gpt-5.6-sol     372K     128K     yes       yes
opencode-go   minimax-m3      1M       131.1K   yes       yes
opencode-go   glm-5.2         1M       131.1K   no        no
`;

function fakeShell(extra: Record<string, string> = {}): ShellRunner {
  const responses: Record<string, string> = {
    "pi --list-models": PI_LIST,
    "git rev-parse --verify origin/main^{commit}": "base\n",
    "git merge-base HEAD origin/main": "merge-base\n",
    "git diff --stat merge-base..HEAD": "src/file.ts | 2 +-\n",
    "git diff --name-status merge-base..HEAD": "M\tsrc/file.ts\n",
    "git diff merge-base..HEAD": "diff --git a/src/file.ts b/src/file.ts\n+x\n",
    ...extra,
  };
  return async (command) => {
    const value = responses[command];
    if (value === undefined) throw new Error(`unexpected command: ${command}`);
    return value;
  };
}

function memoryState(initial: string[] = []): ReviewStateStore {
  let models = initial;
  return {
    readLastModels: async () => models,
    writeLastModels: async (next) => {
      models = next;
    },
  };
}

function deps(overrides: Partial<CliDeps> = {}): CliDeps {
  return {
    shell: fakeShell(),
    runPi: (async ({ model }) => ({ model, ok: true, stdout: "not json" })) as PiRunner,
    state: memoryState(),
    limits: { maxDiffBytes: 1000, maxDiffLines: 100, maxFiles: 10 },
    ...overrides,
  };
}

describe("parseRunArgs", () => {
  it("parses models, thinking, base, and focus", () => {
    expect(
      parseRunArgs(["--models", "a/b,c/d", "--thinking", "high", "--base", "origin/dev", "--focus", "auth and tests"]),
    ).toEqual({ models: ["a/b", "c/d"], thinking: "high", baseRef: "origin/dev", focus: "auth and tests" });
  });

  it("defaults thinking to medium", () => {
    expect(parseRunArgs(["--models", "a/b"])).toEqual({ models: ["a/b"], thinking: "medium" });
  });

  it("throws when models are missing", () => {
    expect(() => parseRunArgs(["--thinking", "low"])).toThrow(/--models/);
  });

  it("throws on an invalid thinking level", () => {
    expect(() => parseRunArgs(["--models", "a/b", "--thinking", "deep"])).toThrow(/thinking/);
  });
});

describe("parsePrepArgs", () => {
  it("reads an optional base ref positional", () => {
    expect(parsePrepArgs(["origin/main"])).toEqual({ baseRef: "origin/main" });
    expect(parsePrepArgs([])).toEqual({});
  });
});

describe("runPrepCommand", () => {
  it("emits families ordered with last-used first, plus base ref and diff stat", async () => {
    const out = JSON.parse(
      await runPrepCommand(deps({ state: memoryState(["opencode-go/minimax-m3"]) }), {}),
    );
    expect(out.baseRef).toEqual({ ok: true, ref: "origin/main", mergeBase: "merge-base" });
    expect(out.diffStat).toBe("src/file.ts | 2 +-");
    expect(out.families[0].family).toBe("opencode-go/minimax");
    expect(out.lastModels).toEqual(["opencode-go/minimax-m3"]);
  });

  it("reports a base-ref failure without throwing", async () => {
    const shell = fakeShell({ "git rev-parse --verify origin/main^{commit}": "" });
    const failing: ShellRunner = async (cmd) => {
      if (cmd.startsWith("git rev-parse")) throw new Error("missing");
      return shell(cmd);
    };
    const out = JSON.parse(await runPrepCommand(deps({ shell: failing }), {}));
    expect(out.baseRef.ok).toBe(false);
  });
});

describe("runReviewCommand", () => {
  it("persists the selected lineup after running", async () => {
    const state = memoryState();
    await runReviewCommand(deps({ state }), { models: ["openai-codex/gpt-5.6-sol"], thinking: "medium" });
    await expect(state.readLastModels()).resolves.toEqual(["openai-codex/gpt-5.6-sol"]);
  });

  it("gates thinking on pi's reported support", async () => {
    const seen: Array<{ model: string; thinking?: string }> = [];
    const runPi: PiRunner = async ({ model, thinking }) => {
      seen.push({ model, ...(thinking ? { thinking } : {}) });
      return { model, ok: true, stdout: "not json" };
    };
    await runReviewCommand(deps({ runPi }), {
      models: ["opencode-go/glm-5.2", "opencode-go/minimax-m3"],
      thinking: "high",
    });
    expect(seen).toContainEqual({ model: "opencode-go/glm-5.2" }); // glm-5.2 thinking=no
    expect(seen).toContainEqual({ model: "opencode-go/minimax-m3", thinking: "high" });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/cli.test.ts`
Expected: FAIL — `./cli.js` does not exist.

- [ ] **Step 3: Write `src/cli.ts`**

```typescript
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { resolveBaseRef } from "./git.js";
import { groupModelFamilies, orderFamilies, parsePiModels, thinkingSupportMap } from "./models.js";
import { createPiRunner } from "./pi.js";
import { runMultiAiReview } from "./review.js";
import { createReviewStateStore } from "./state.js";
import type { DiffLimits, PiRunner, ReviewStateStore, ShellRunner, ThinkingLevel } from "./types.js";

const DEFAULT_LIMITS: DiffLimits = { maxDiffBytes: 200_000, maxDiffLines: 6_000, maxFiles: 200 };
const execAsync = promisify(exec);

export type RunArgs = {
  models: string[];
  thinking: ThinkingLevel;
  baseRef?: string;
  focus?: string;
};

export type CliDeps = {
  shell: ShellRunner;
  runPi: PiRunner;
  state: ReviewStateStore;
  limits: DiffLimits;
};

export function parseRunArgs(argv: string[]): RunArgs {
  let models: string[] = [];
  let thinking: ThinkingLevel = "medium";
  let baseRef: string | undefined;
  let focus: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
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
    }
  }

  if (models.length === 0) throw new Error("Missing required --models a/b,c/d");
  return { models, thinking, ...(baseRef ? { baseRef } : {}), ...(focus ? { focus } : {}) };
}

function asThinking(value: string): ThinkingLevel {
  if (value === "low" || value === "medium" || value === "high") return value;
  throw new Error(`Invalid --thinking value: ${value} (use low|medium|high)`);
}

export function parsePrepArgs(argv: string[]): { baseRef?: string } {
  const baseRef = argv.find((arg) => !arg.startsWith("--"));
  return baseRef ? { baseRef } : {};
}

export async function runPrepCommand(deps: CliDeps, args: { baseRef?: string }): Promise<string> {
  const models = parsePiModels(await deps.shell("pi --list-models"));
  const lastModels = await deps.state.readLastModels();
  const families = orderFamilies(groupModelFamilies(models), lastModels);
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
  const support = thinkingSupportMap(parsePiModels(await deps.shell("pi --list-models")));

  const report = await runMultiAiReview({
    runPi: deps.runPi,
    shell: deps.shell,
    models: args.models,
    thinking: args.thinking,
    thinkingSupport: support,
    limits: deps.limits,
    ...(args.baseRef ? { baseRef: args.baseRef } : {}),
    ...(args.focus ? { instructions: args.focus } : {}),
  });

  try {
    await deps.state.writeLastModels(args.models);
  } catch {
    // Persisting the lineup is best-effort; never fail the report on it.
  }
  return report;
}

export async function main(argv: string[]): Promise<void> {
  const [command, ...rest] = argv;
  const shell: ShellRunner = async (cmd) => (await execAsync(cmd, { maxBuffer: 64 * 1024 * 1024 })).stdout;
  const deps: CliDeps = {
    shell,
    runPi: createPiRunner(),
    state: createReviewStateStore(),
    limits: DEFAULT_LIMITS,
  };

  if (command === "prep") {
    process.stdout.write(await runPrepCommand(deps, parsePrepArgs(rest)));
  } else if (command === "run") {
    process.stdout.write(await runReviewCommand(deps, parseRunArgs(rest)));
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
```

- [ ] **Step 4: Run to verify it passes + full suite + typecheck**

Run: `pnpm test:run && pnpm typecheck`
Expected: PASS (all suites, including `cli`).

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts src/cli.test.ts
git commit -m "feat: add prep and run CLI commands"
```

---

## Task 10: Build, sync, and smoke-test the CLI

**Files:**
- Build output: `dist/cli.mjs`
- Synced: `~/.claude/skills/multi-ai-review/scripts/cli.mjs`

**Interfaces:**
- Consumes: `pnpm build`, `pnpm sync` (Task 1).
- Produces: an executable bundled `dist/cli.mjs` and a synced copy under the skill dir.

- [ ] **Step 1: Build the bundle**

Run: `pnpm build`
Expected: creates `dist/cli.mjs` starting with `#!/usr/bin/env node`.

- [ ] **Step 2: Smoke-test `prep` against a real repo**

Run (from a repo that has an `origin/main` or local `main`, e.g. this repo):
```bash
node dist/cli.mjs prep | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log('families:',j.families.length,'| first:',j.families[0]?.flagship,'| baseRef.ok:',j.baseRef.ok)})"
```
Expected: prints a non-zero family count and a flagship id like `openai-codex/gpt-5.6-…`; `baseRef.ok: true` (or `false` with a friendly message if no base ref exists — acceptable).

- [ ] **Step 3: Confirm the unknown-command guard**

Run: `node dist/cli.mjs bogus; echo "exit=$?"`
Expected: stderr `Unknown command: bogus. Use "prep" or "run".` and `exit=1`.

- [ ] **Step 4: Sync into the skill directory**

Run: `pnpm sync && ls -l "$HOME/.claude/skills/multi-ai-review/scripts/cli.mjs"`
Expected: the file exists.

- [ ] **Step 5: Commit the build output**

```bash
git add -f dist/cli.mjs
git commit -m "build: bundle cli.mjs and sync to skill"
```

Note: `dist/` is normally gitignored; committing the bundle here keeps the plan's artifact reproducible. If you prefer not to track `dist/`, skip this commit — the sync step is what matters for the skill.

---

## Task 11: Rewrite `SKILL.md`

**Files:**
- Create/overwrite: `~/.claude/skills/multi-ai-review/SKILL.md`

**Interfaces:**
- Consumes: `scripts/cli.mjs` (`prep`, `run`).
- Produces: the `/multi-ai-review` skill instructions driving the full flow.

- [ ] **Step 1: Write `~/.claude/skills/multi-ai-review/SKILL.md`**

````markdown
---
name: multi-ai-review
description: >-
  Adversarial multi-AI peer review of a code change via the pi CLI across
  diverse model families, with interactive model selection (AskUserQuestion),
  selectable thinking level, base-ref override, extra focus, and a remembered
  last-used lineup. Use when the user asks for a "multi-AI review", "cross-AI
  review", "peer review", "review with pi / multiple models", or wants an
  independent second/third opinion on a diff, PR, or commit before merging.
---

# Multi-AI Peer Review (pi, engine-backed)

This skill drives a bundled Node CLI at `scripts/cli.mjs` that discovers pi
models, runs the selected ones in parallel forcing a JSON schema, and returns a
deterministic Markdown report. Claude then **ground-truths** the actionable
findings before presenting them.

Set the CLI path once:

```bash
DIR="$HOME/.claude/skills/multi-ai-review"
```

## Procedure

### 1. Parse invocation args

Invocation may include a base ref and/or extra focus:
`/multi-ai-review [baseRef] [focus text…]`.
- A token that looks like a git ref (contains `/` such as `origin/main`, or is a
  bare `main`/`master`/tag) → `baseRef`.
- All remaining words → `focus`.
Either may be absent.

### 2. Run prep

```bash
node "$DIR/scripts/cli.mjs" prep <baseRef-if-any>
```
Read the JSON: `families` (ordered — last-used first, then GPT/MiniMax/Kimi,
then the rest; each has `family`, `flagship`, `variants`, `thinking`),
`lastModels`, `baseRef` (`ok` + `ref`/`mergeBase`, or `ok:false` + `message`),
and `diffStat`.

### 3. Ask the user (AskUserQuestion)

Make a single `AskUserQuestion` call:

- **Q1 "Which models should review this?" (multiSelect: true).**
  Options = the flagship of each of the **first up to 4** families from `prep`.
  - Label each `Family (flagship-id)`, e.g. `GPT (openai-codex/gpt-5.6-terra)`.
  - For families whose flagship appears in `lastModels`, order them first and
    append ` · last` to the label. (AskUserQuestion cannot pre-check options, so
    surfacing them first + labeled is how "remember last" shows up.)
  - The auto-provided **Other** lets the user type exact model IDs or family
    names not shown; map that text to concrete IDs using the `prep` `families`
    list (a family name → its `flagship`; an exact `provider/model` → itself).
- **Q2 "Thinking level?" (single-select).** Options: `medium (Recommended)`,
  `high`, `low`.
- **Q3 "Base ref?"** — include **only if** `prep` returned `baseRef.ok:false`.
  Options: `origin/main`, `origin/master`, `main`, plus **Other**. If `prep`
  succeeded, do not ask; instead state the detected ref (`baseRef.ref`) and
  `diffStat` in your preamble.

### 4. Resolve selections to model IDs

Turn the selected family labels (and any "Other" text) into an exact
comma-separated list of `provider/model` IDs. Never pass a label — only IDs.

### 5. Run the review

```bash
node "$DIR/scripts/cli.mjs" run \
  --models <csv-of-ids> \
  --thinking <low|medium|high> \
  [--base <ref>] \
  [--focus "<focus text>"]
```
This prints the deterministic report (findings table with severity, confidence,
consensus models, location, recommendation, action; a "Do Not Address Yet"
section; and any reviewer failures) and records the lineup globally for next
time. Run it with `run_in_background: true` if you want to keep working; it
typically takes 1–3 minutes for three models.

### 6. Ground-truth, then present

Reviewers hallucinate. Before presenting, verify every finding actioned
`address` or `investigate` against the actual code and tools:
- type claims → `tsc --noEmit` (a green `vite`/`esbuild` build does NOT type-check);
- behavior claims → read the cited file / run the relevant test.
Downgrade false positives with a one-line rationale. Present the report plus your
triage. Optionally apply the confirmed fixes, re-run the project gates
(lint/type-check/tests/build), and — for a PR — post a short summary comment with
the lineup, verdicts, and what was addressed vs. ignored.

## Notes

- The CLI forces each model into one fenced-JSON block; a non-compliant model
  degrades to a "Reviewer Failures" row rather than breaking the run.
- Model discovery is at runtime (`pi --list-models`); versions are never
  hardcoded. Keep family diversity — don't pick three variants of one family.
- Rebuild + resync the CLI after changing the engine:
  `cd ~/Developer/cc-multi-ai-review && pnpm build && pnpm sync`.
````

- [ ] **Step 2: Smoke-test the skill wiring**

Run: `node "$HOME/.claude/skills/multi-ai-review/scripts/cli.mjs" prep >/dev/null && echo OK`
Expected: `OK` (prep runs from the synced copy).

- [ ] **Step 3: Commit the SKILL.md into the dev repo for versioning**

Copy the authored SKILL.md into the repo so it is tracked alongside the engine:
```bash
mkdir -p ~/Developer/cc-multi-ai-review/skill
cp "$HOME/.claude/skills/multi-ai-review/SKILL.md" ~/Developer/cc-multi-ai-review/skill/SKILL.md
cd ~/Developer/cc-multi-ai-review
git add skill/SKILL.md
git commit -m "docs: add /multi-ai-review SKILL.md"
```

---

## Task 12: Rewrite `README.md`

**Files:**
- Overwrite: `README.md`

**Interfaces:**
- Consumes: the finished CLI + skill.
- Produces: install/build/sync/use docs.

- [ ] **Step 1: Overwrite `README.md`**

```markdown
# cc-multi-ai-review

A self-contained Node CLI that powers the Claude Code `/multi-ai-review` skill:
one branch-vs-base code review across several `pi` model families, synthesized
into one deterministic Markdown report.

## Layout

- `src/` — TypeScript engine (models, git, prompt, findings, report, pi runner, cli).
- `dist/cli.mjs` — bundled zero-dependency CLI (built with esbuild).
- `skill/SKILL.md` — the tracked copy of the skill instructions.

## Build & install

```sh
pnpm install
pnpm build          # esbuild -> dist/cli.mjs
pnpm sync           # copy dist/cli.mjs -> ~/.claude/skills/multi-ai-review/scripts/cli.mjs
```

Also copy `skill/SKILL.md` to `~/.claude/skills/multi-ai-review/SKILL.md` the
first time (or whenever it changes).

## CLI

```sh
node dist/cli.mjs prep [baseRef]
# -> JSON: { baseRef, diffStat, families[], lastModels[] }

node dist/cli.mjs run --models a/b,c/d --thinking medium [--base origin/main] [--focus "auth, data loss"]
# -> Markdown report; records the lineup at ~/.claude/multi-ai-review/state.json
```

## Use (in Claude Code)

```
/multi-ai-review
/multi-ai-review origin/main
/multi-ai-review origin/main focus on auth, data loss, and missing tests
```

The skill runs `prep`, asks which models + thinking level via `AskUserQuestion`
(offering your last lineup first), runs the review, then ground-truths the
actionable findings before presenting them.

## Test

```sh
pnpm test:run
pnpm typecheck
```
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: rewrite README for the Claude Code CLI + skill"
```

---

## Self-Review

**Spec coverage:**
- Full engine port (fenced-JSON, findings, report, Claude ground-truths) → Tasks 6–9 + SKILL.md step 6. ✔
- Curated multi-select, last-used first + `· last` → Task 4 (`orderFamilies`) + SKILL.md step 3. ✔
- Global state → Task 5. ✔
- Repo = dev home, bundle + sync → Tasks 1, 10; SKILL.md rebuild note. ✔
- Args-first, questions fill gaps; base-ref question only on auto-detect failure → SKILL.md steps 1–3; `prep` reports `baseRef.ok`. ✔
- Feature map: model list (Tasks 2–4, SKILL Q1), thinking level (Tasks 7–9, SKILL Q2, gated by support), base-ref override (arg → `--base`; Task 6 copy; SKILL Q3), extra focus (arg → `--focus` → prompt instructions), remember last (Task 5 + `orderFamilies`). ✔
- Family grouping incl. OpenAI `gpt-5.x` special case, lightweight exclusion, deterministic flagship → Task 3. ✔
- pi gotchas (STDIN, stdout-only, runtime discovery) → Task 7 + `parsePiModels` noise-skipping. ✔
- Testing across models/state/pi/cli + reused git/prompt/findings/report → Tasks 2–9. ✔
- Non-goals (working-tree mode, npm publish, `--format json`) → not implemented, correct. ✔

**Placeholder scan:** No TBD/TODO; every code step contains complete code and exact commands. ✔

**Type consistency:** `PiRunner`/`PiInvocation`/`PiResult`/`ThinkingLevel` defined in `types.ts` (Task 7), consumed by `pi.ts`, `review.ts`, `cli.ts` identically. `ModelFamily`/`PiModel` defined in `models.ts` (Tasks 2–3), consumed by `cli.ts`. `RunReviewInput` shape (Task 8) matches the object `runReviewCommand` builds (Task 9): `runPi`, `shell`, `models`, `thinking`, `thinkingSupport`, `baseRef`, `instructions`, `limits`. `CliDeps` consistent across Task 9 impl + tests. ✔
