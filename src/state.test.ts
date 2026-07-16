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

  it("writes and reads last models under multi-ai-review-agent/state.json", async () => {
    const base = await tempBase();
    const store = createReviewStateStore(base);

    await store.writeLastModels(["openai-codex/gpt-5.6-sol", "opencode-go/minimax-m3"]);

    await expect(store.readLastModels()).resolves.toEqual([
      "openai-codex/gpt-5.6-sol",
      "opencode-go/minimax-m3",
    ]);
    await expect(readFile(join(base, "multi-ai-review-agent/state.json"), "utf8")).resolves.toContain("lastModels");
  });

  it("ignores invalid state", async () => {
    const base = await tempBase();
    await mkdir(join(base, "multi-ai-review-agent"), { recursive: true });
    await writeFile(join(base, "multi-ai-review-agent/state.json"), "not json");
    const store = createReviewStateStore(base);
    await expect(store.readLastModels()).resolves.toEqual([]);
  });
});
