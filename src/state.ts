import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ReviewStateStore } from "./types.js";

type StateFile = {
  lastModels?: unknown;
};

export function createReviewStateStore(baseDir: string = join(homedir(), ".claude")): ReviewStateStore {
  const filePath = join(baseDir, "multi-ai-review-agent", "state.json");
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
