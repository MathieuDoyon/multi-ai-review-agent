# Plugin Command Last Models Publish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Register `/multi-review` from the plugin, remember the last selected models, clean README install guidance, bump to `0.1.1`, push commits, and publish to npm.

**Architecture:** Add command-template and state helpers as focused TypeScript modules, then wire them into `src/index.ts` and `src/tool.ts`. Persist last selected models in a project-local JSON state file through a small state store and expose a read-only last-models tool for the command template. Keep `commands/multi-review.md` as a package reference, but make the plugin register the inline command config automatically.

**Tech Stack:** TypeScript, `@opencode-ai/plugin`, Node.js `fs/promises`, Vitest, pnpm, npm publish.

## Global Constraints

- The plugin should register `command.multi-review` through its `config(cfg)` hook only when `cfg.command.multi-review` is not already defined.
- The registered command must use OpenCode's inline command config shape with `description`, `template`, and `agent` fields.
- Keep `commands/multi-review.md` in the package as a readable source/template reference.
- Remember last model IDs in `.opencode/multi-ai-review/state.json`.
- Expose a read-only tool named `multi_ai_code_review_last_models`.
- If no state file exists, the last-models tool returns no models.
- If state is invalid JSON or has invalid `lastModels`, the last-models tool returns no models.
- If last models exist, the command should show the first option `Use last: <comma-separated model IDs>`.
- The `Use last: ...` label must never be passed as a model ID.
- Do not implement actual `fix <numbers...>` or `ignore <numbers...>` command handling.
- Replace personal README paths with generic absolute path placeholders.
- Bump package version from `0.1.0` to `0.1.1`.
- Do not stage or commit `opencode-multi-ai-review-0.1.0.tgz`.
- Do not stage or commit `docs/superpowers/specs/2026-06-21-opencode-multi-ai-review-design.md` unless explicitly requested separately.

---

## File Structure

- Create `src/command.ts`: owns the command template string and `registerMultiReviewCommand(cfg)`.
- Create `src/state.ts`: owns `.opencode/multi-ai-review/state.json` reads/writes.
- Modify `src/index.ts`: wires command registration and both plugin tools.
- Modify `src/tool.ts`: accepts an optional `state` dependency and records selected models when `multi_ai_code_review` executes.
- Modify `src/types.ts`: adds `ReviewStateStore`.
- Modify `src/package-docs.test.ts`: checks README and command template documentation.
- Create `src/command.test.ts`: verifies command registration and template behavior.
- Create `src/state.test.ts`: verifies state read/write behavior.
- Modify `src/tool.test.ts`: verifies last models are saved when the review tool runs.
- Modify `README.md`: removes manual command-copy install steps and personal paths.
- Modify `package.json`: bumps version to `0.1.1`.

### Task 1: Register the Command Template from the Plugin

**Files:**
- Create: `src/command.ts`
- Create: `src/command.test.ts`
- Modify: `src/index.ts`

**Interfaces:**
- Produces: `MULTI_REVIEW_COMMAND_TEMPLATE: string`
- Produces: `registerMultiReviewCommand(cfg: { command?: Record<string, unknown> }): void`

- [ ] **Step 1: Write failing command registration tests**

Create `src/command.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { MULTI_REVIEW_COMMAND_TEMPLATE, registerMultiReviewCommand } from "./command.js";

describe("registerMultiReviewCommand", () => {
  it("registers command.multi-review when missing", () => {
    const cfg: { command?: Record<string, unknown> } = {};

    registerMultiReviewCommand(cfg);

    expect(cfg.command?.["multi-review"]).toEqual({
      description: "Run a multi-model AI code review for the current branch",
      template: MULTI_REVIEW_COMMAND_TEMPLATE,
      agent: "build",
    });
  });

  it("preserves an existing command.multi-review override", () => {
    const existing = { description: "custom", template: "custom template", agent: "plan" };
    const cfg = { command: { "multi-review": existing } };

    registerMultiReviewCommand(cfg);

    expect(cfg.command["multi-review"]).toBe(existing);
  });
});

describe("MULTI_REVIEW_COMMAND_TEMPLATE", () => {
  it("contains selection, last-model, and review tool instructions", () => {
    expect(MULTI_REVIEW_COMMAND_TEMPLATE).toContain("multi_ai_code_review_last_models");
    expect(MULTI_REVIEW_COMMAND_TEMPLATE).toContain("Use last:");
    expect(MULTI_REVIEW_COMMAND_TEMPLATE).toContain("Group the available model IDs by model family");
    expect(MULTI_REVIEW_COMMAND_TEMPLATE).toContain("Advanced: choose specific model variants");
    expect(MULTI_REVIEW_COMMAND_TEMPLATE).toContain("Never pass the advanced option label");
    expect(MULTI_REVIEW_COMMAND_TEMPLATE).toContain("Never pass the `Use last:` label");
    expect(MULTI_REVIEW_COMMAND_TEMPLATE).toContain("multi_ai_code_review");
  });
});
```

- [ ] **Step 2: Run focused command tests and verify they fail**

Run:

```sh
pnpm test:run src/command.test.ts
```

Expected: fails because `src/command.ts` does not exist yet.

- [ ] **Step 3: Add command helper implementation**

Create `src/command.ts`:

```ts
export const MULTI_REVIEW_COMMAND_TEMPLATE = `Run a multi-model code review of the current branch against its base ref.

Arguments from the user, if present: \`$ARGUMENTS\`

Steps:
1. Read the model list below, generated by \`opencode models\`.
2. Call \`multi_ai_code_review_last_models\` to read the last selected models.
3. If last models exist, include \`Use last: <comma-separated model IDs>\` as the first choice in the model-family question.
   - If the user selects \`Use last: ...\`, use exactly those remembered model IDs and skip normal model-family selection.
   - Never pass the \`Use last:\` label as a model ID.
4. If the user does not select \`Use last: ...\`, group the available model IDs by model family before asking which models to use.
   - Preserve provider namespace, so \`opencode/mimo\` and \`opencode-go/mimo\` are separate families.
   - Treat model name roots as families, so \`glm-5.1\` and \`glm-5.2\` group as \`opencode-go/glm\`.
   - Treat OpenAI \`gpt-5.x\` minor lines as distinct product families, so \`openai/gpt-5.4\` and \`openai/gpt-5.5\` both remain visible.
   - Prefer the newest stable/full variant in each family over reduced or specialized variants such as \`mini\`, \`fast\`, \`flash\`, \`free\`, and \`spark\`, unless the family only has those variants.
5. Ask the user: \`Which model families should review this branch?\`
   - Explain: \`I picked one recommended model per family to keep the list short. Select "Advanced: choose specific model variants" if you want to override variants.\`
   - Use the built-in \`question\` tool with \`multiple: true\`.
   - Include one recommended model per family as choices.
   - Include \`Advanced: choose specific model variants\` as the final choice when any family has multiple variants.
6. If the user selects \`Advanced: choose specific model variants\`, ask concise follow-up questions only for families with multiple variants or families the user wants to override. Avoid showing every model in one large list unless grouping is not possible.
7. Build the final exact model ID list.
   - Never pass the advanced option label to \`multi_ai_code_review\`.
   - Pass only exact selected model IDs in \`models\`.
8. If \`$ARGUMENTS\` contains a token that looks like a git ref such as \`origin/main\`, pass it as \`baseRef\`. Pass the remaining argument text as \`instructions\`.
9. Call the \`multi_ai_code_review\` tool with the selected \`models\`, optional \`baseRef\`, and optional \`instructions\`.
10. Return the Markdown report from the tool without rewriting its table.

Available models:
!\`opencode models\``;

type CommandConfig = {
  command?: Record<string, unknown>;
};

export function registerMultiReviewCommand(cfg: CommandConfig): void {
  cfg.command ??= {};
  if (cfg.command["multi-review"] !== undefined) return;

  cfg.command["multi-review"] = {
    description: "Run a multi-model AI code review for the current branch",
    template: MULTI_REVIEW_COMMAND_TEMPLATE,
    agent: "build",
  };
}
```

- [ ] **Step 4: Wire command registration into the plugin**

Modify `src/index.ts` to import and return a `config` hook:

```ts
import { registerMultiReviewCommand } from "./command.js";
```

Then add this hook to the returned object:

```ts
    config: (cfg) => {
      registerMultiReviewCommand(cfg);
    },
```

- [ ] **Step 5: Run focused command tests and verify they pass**

Run:

```sh
pnpm test:run src/command.test.ts
```

Expected: command tests pass.

### Task 2: Persist and Expose Last Selected Models

**Files:**
- Create: `src/state.ts`
- Create: `src/state.test.ts`
- Modify: `src/types.ts`
- Modify: `src/tool.ts`
- Modify: `src/tool.test.ts`
- Modify: `src/index.ts`

**Interfaces:**
- Produces: `type ReviewStateStore = { readLastModels(): Promise<string[]>; writeLastModels(models: string[]): Promise<void> }`
- Produces: `createReviewStateStore(directory: string): ReviewStateStore`
- Produces plugin tool `multi_ai_code_review_last_models`

- [ ] **Step 1: Add failing state tests**

Create `src/state.test.ts`:

```ts
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { createReviewStateStore } from "./state.js";

async function tempRepo(): Promise<string> {
  return mkdtemp(join(tmpdir(), "multi-ai-review-"));
}

describe("createReviewStateStore", () => {
  it("returns an empty list when state is missing", async () => {
    const store = createReviewStateStore(await tempRepo());

    await expect(store.readLastModels()).resolves.toEqual([]);
  });

  it("writes and reads last models", async () => {
    const directory = await tempRepo();
    const store = createReviewStateStore(directory);

    await store.writeLastModels(["openai/gpt-5.5", "opencode-go/qwen3.7-plus"]);

    await expect(store.readLastModels()).resolves.toEqual([
      "openai/gpt-5.5",
      "opencode-go/qwen3.7-plus",
    ]);
    await expect(readFile(join(directory, ".opencode/multi-ai-review/state.json"), "utf8"))
      .resolves.toContain("lastModels");
  });

  it("ignores invalid state", async () => {
    const directory = await tempRepo();
    await mkdir(join(directory, ".opencode/multi-ai-review"), { recursive: true });
    await writeFile(join(directory, ".opencode/multi-ai-review/state.json"), "not json");
    const store = createReviewStateStore(directory);

    await expect(store.readLastModels()).resolves.toEqual([]);
  });
});
```

- [ ] **Step 2: Add failing tool persistence tests**

Update `src/tool.test.ts` with two tests:

```ts
  it("saves selected models after running a review", async () => {
    const client = { session: { create: vi.fn(), prompt: vi.fn() } } as unknown as ReviewClient;
    const shell: ShellRunner = vi.fn();
    const runReview = vi.fn().mockResolvedValue("# report");
    const writeLastModels = vi.fn().mockResolvedValue(undefined);
    const reviewTool = createMultiAiCodeReviewTool({
      client,
      shell,
      runReview,
      state: { readLastModels: vi.fn(), writeLastModels },
    });

    await reviewTool.execute({ models: ["openai/gpt-5.5"] }, { sessionID: "session-1" } as never);

    expect(writeLastModels).toHaveBeenCalledWith(["openai/gpt-5.5"]);
  });

  it("still returns the report if saving selected models fails", async () => {
    const client = { session: { create: vi.fn(), prompt: vi.fn() } } as unknown as ReviewClient;
    const shell: ShellRunner = vi.fn();
    const runReview = vi.fn().mockResolvedValue("# report");
    const reviewTool = createMultiAiCodeReviewTool({
      client,
      shell,
      runReview,
      state: {
        readLastModels: vi.fn(),
        writeLastModels: vi.fn().mockRejectedValue(new Error("disk full")),
      },
    });

    await expect(
      reviewTool.execute({ models: ["openai/gpt-5.5"] }, { sessionID: "session-1" } as never),
    ).resolves.toBe("# report");
  });
```

- [ ] **Step 3: Run focused tests and verify they fail**

Run:

```sh
pnpm test:run src/state.test.ts src/tool.test.ts
```

Expected: tests fail because state helpers and state wiring do not exist.

- [ ] **Step 4: Add state type and implementation**

Add to `src/types.ts`:

```ts
export type ReviewStateStore = {
  readLastModels(): Promise<string[]>;
  writeLastModels(models: string[]): Promise<void>;
};
```

Create `src/state.ts`:

```ts
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ReviewStateStore } from "./types.js";

type StateFile = {
  lastModels?: unknown;
};

export function createReviewStateStore(directory: string): ReviewStateStore {
  const filePath = join(directory, ".opencode", "multi-ai-review", "state.json");

  return {
    async readLastModels() {
      try {
        const parsed = JSON.parse(await readFile(filePath, "utf8")) as StateFile;
        return Array.isArray(parsed.lastModels) && parsed.lastModels.every((model) => typeof model === "string")
          ? parsed.lastModels
          : [];
      } catch {
        return [];
      }
    },
    async writeLastModels(models) {
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(`${filePath}.tmp`, `${JSON.stringify({ lastModels: models }, null, 2)}\n`, "utf8");
      await rename(`${filePath}.tmp`, filePath);
    },
  };
}
```

- [ ] **Step 5: Wire state into review tool**

Modify `src/tool.ts`:

```ts
import type { DiffLimits, ReviewClient, ReviewStateStore, RunReviewInput, ShellRunner } from "./types.js";
```

Add `state?: ReviewStateStore;` to `CreateToolInput`.

In `execute`, after `runReview(...)` resolves, call `input.state?.writeLastModels(args.models)` inside a `try/catch` and return the report either way.

- [ ] **Step 6: Expose last-models tool from plugin**

Modify `src/index.ts` to import `tool` and `createReviewStateStore`, instantiate `state`, pass it into `createMultiAiCodeReviewTool`, and register:

```ts
multi_ai_code_review_last_models: tool({
  description: "Return the last model IDs selected for multi_ai_code_review in this project.",
  args: {},
  async execute() {
    return { models: await state.readLastModels() };
  },
})
```

- [ ] **Step 7: Run focused tests and verify they pass**

Run:

```sh
pnpm test:run src/state.test.ts src/tool.test.ts
```

Expected: focused tests pass.

### Task 3: Update Command File, README, Docs Tests, and Version

**Files:**
- Modify: `commands/multi-review.md`
- Modify: `README.md`
- Modify: `src/package-docs.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: command behavior from `src/command.ts`.
- Produces: user-facing docs for npm install, local development, last-model reuse, and version `0.1.1`.

- [ ] **Step 1: Update docs tests first**

In `src/package-docs.test.ts`, add expectations that README does not contain personal paths or command-copy npm install steps:

```ts
    expect(readme).not.toContain("~/Developer/opencode-multi-ai-review");
    expect(readme).not.toContain("curl -fsSL https://raw.githubusercontent.com/MathieuDoyon/opencode-multi-ai-review/main/commands/multi-review.md");
    expect(readme).not.toContain("cp /absolute/path/to/opencode-multi-ai-review/commands/multi-review.md");
    expect(readme).toContain("Command registration is automatic");
    expect(readme).toContain(".opencode/multi-ai-review/state.json");
```

- [ ] **Step 2: Run docs test and verify it fails**

Run:

```sh
pnpm test:run src/package-docs.test.ts
```

Expected: fails until README is updated.

- [ ] **Step 3: Update command markdown to match inline template behavior**

Update `commands/multi-review.md` so its steps mention `multi_ai_code_review_last_models`, `Use last:`, and never passing that label as a model ID. Keep the frontmatter description unchanged.

- [ ] **Step 4: Update README**

Make README install guidance say npm users only add the plugin config, because command registration is automatic. Replace local paths with:

```text
/absolute/path/to/opencode-multi-ai-review
file:///absolute/path/to/opencode-multi-ai-review/dist/index.js
```

Mention `.opencode/multi-ai-review/state.json` in the Use section.

- [ ] **Step 5: Bump package version**

Update `package.json`:

```json
"version": "0.1.1"
```

- [ ] **Step 6: Run docs test and full verification**

Run:

```sh
pnpm test:run src/package-docs.test.ts && pnpm test:run && pnpm typecheck && pnpm build
```

Expected: docs test passes, all tests pass, typecheck exits 0, build exits 0.

### Task 4: Commit, Push, Pack, and Publish

**Files:**
- Modify: git index only for intended implementation files.
- Create: npm tarball from `pnpm pack`.

**Interfaces:**
- Consumes: verified implementation from Tasks 1-3.
- Produces: pushed git commits and published npm package `opencode-multi-ai-review@0.1.1`.

- [ ] **Step 1: Inspect status and staged intent**

Run:

```sh
git status --short --branch
git diff --stat
git log --oneline -5
```

Expected: branch is `main`, ahead of origin by the previous commit plus new uncommitted implementation changes. `opencode-multi-ai-review-0.1.0.tgz` remains untracked and is not staged.

- [ ] **Step 2: Run final verification before commit**

Run:

```sh
pnpm test:run && pnpm typecheck && pnpm build
```

Expected: all tests pass, typecheck exits 0, build exits 0.

- [ ] **Step 3: Commit implementation and version bump**

Run:

```sh
git add src/command.ts src/command.test.ts src/state.ts src/state.test.ts src/index.ts src/tool.ts src/tool.test.ts src/types.ts commands/multi-review.md README.md src/package-docs.test.ts package.json docs/superpowers/specs/2026-06-22-plugin-command-and-last-models-design.md docs/superpowers/plans/2026-06-22-plugin-command-last-models-publish.md
git commit -m "feat: register command and remember models"
```

Expected: commit succeeds and excludes `opencode-multi-ai-review-0.1.0.tgz` and `docs/superpowers/specs/2026-06-21-opencode-multi-ai-review-design.md`.

- [ ] **Step 4: Push commits**

Run:

```sh
git push origin main
```

Expected: `main` pushes successfully.

- [ ] **Step 5: Check npm auth and package availability**

Run:

```sh
npm whoami
npm view opencode-multi-ai-review version
```

Expected: `npm whoami` prints the logged-in username. `npm view` returns 404 or a version lower than `0.1.1`.

- [ ] **Step 6: Pack and inspect**

Run:

```sh
pnpm pack --dry-run
pnpm pack
npm publish --dry-run --access public opencode-multi-ai-review-0.1.1.tgz
```

Expected: tarball contains `dist`, `commands`, `README.md`, `LICENSE`, and `package.json`; dry-run publish reports `opencode-multi-ai-review@0.1.1`.

- [ ] **Step 7: Publish**

Run:

```sh
npm publish --access public opencode-multi-ai-review-0.1.1.tgz
```

Expected: npm publishes `opencode-multi-ai-review@0.1.1`. If auth fails, stop and report the exact auth command needed.

---

## Self-Review

- Spec coverage: Tasks cover command registration, preserving overrides, last-model state, read-only last-model tool, writing last models, README cleanup, tests, version bump, push, pack, and publish.
- Placeholder scan: no placeholder tasks or unresolved requirements remain.
- Type consistency: `ReviewStateStore` is introduced once in `src/types.ts` and consumed by `src/state.ts`, `src/tool.ts`, and plugin wiring.
