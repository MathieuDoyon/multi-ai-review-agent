# cc-multi-ai-review — design

Date: 2026-07-15
Status: Approved (design), pending implementation plan

## Summary

Port the `opencode-multi-ai-review` engine to a Claude Code skill (`/multi-ai-review`).
The existing Claude skill (`~/.claude/skills/multi-ai-review/SKILL.md`) is a
markdown-driven orchestration where Claude runs the `pi` CLI and does all
synthesis by hand. This project turns the reusable opencode logic into a
self-contained Node CLI that the skill shells out to, and adds five input-UX
features from the opencode plugin:

1. Interactive model selection via Claude's `AskUserQuestion` tool.
2. Selectable thinking level.
3. Override of the auto-detected base ref.
4. Extra review focus.
5. Remembering the last models used and surfacing them first.

## Decisions (locked)

- **Architecture: full engine port.** Reviewers are forced into a fenced-JSON
  schema; the CLI groups/classifies/renders the report deterministically
  (`findings.ts` + `report.ts`). Claude ground-truths the FIX-classified rows on
  top — the skill's adversarial-verification value is retained as a second pass.
- **Model picker: curated multi-select.** One `AskUserQuestion` multi-select over
  the top ~4 flagship families. Last-used families are ordered first and labeled
  `· last`. (`AskUserQuestion` cannot pre-check options, so "remember last" means
  ordered-first + labeled, not arriving checked.) Families beyond the top 4 are
  reachable via the auto-provided "Other" free-text option.
- **State scope: global.** `~/.claude/multi-ai-review/state.json`. Pi models are
  not project-specific, so one remembered lineup applies across all repos.
- **Install model: repo = dev home, skill bundles the CLI.** Develop and test in
  `~/Developer/cc-multi-ai-review` (TS + vitest). `pnpm build` bundles to a single
  zero-dep `dist/cli.mjs`; `npm run sync` copies it to
  `~/.claude/skills/multi-ai-review/scripts/cli.mjs`. The skill invokes
  `node "$DIR/scripts/cli.mjs" …`. No global install, no PATH dependence.
- **Inputs: args first, questions fill gaps.** `/multi-ai-review [baseRef] [focus…]`
  is parsed like opencode's `$ARGUMENTS`. `AskUserQuestion` always asks models +
  thinking; the base-ref question appears only when auto-detection fails.

## Two artifacts

| Artifact | Location | Role |
|---|---|---|
| Dev repo | `~/Developer/cc-multi-ai-review` | TS source + vitest + bundler; where code is edited and tested. |
| Skill | `~/.claude/skills/multi-ai-review/` | `SKILL.md` + bundled `scripts/cli.mjs` (build output); what Claude runs. |

## Repo changes from the copied opencode plugin

**Reuse (pure logic, keep and extend tests):**
- `git.ts` — `resolveBaseRef` (candidates: `origin/main`, `origin/master`, `main`,
  `master`) + `collectDiff` (stat, name-status, unified diff, byte/line/file
  truncation). Unchanged.
- `prompt.ts` — `buildReviewerPrompt` (already accepts `instructions` = focus) and
  `extractReviewerOutput`. Extraction hardened: first ```json fenced block, with a
  fallback to a bare top-level `{…}` object.
- `findings.ts` — `groupFindings` (dedup by file+category+line-proximity/title
  similarity, consensus, `classifyAction` → address/investigate/likely false
  positive). Unchanged.
- `report.ts` — deterministic markdown report. Unchanged (plus a lineup/base-ref
  header if trivial).
- `types.ts` — reused; extended with CLI/pi-runner types (thinking level, family).

**Rewrite / adapt:**
- `models.ts` — replace the opencode-`models`-output parser with a `pi --list-models`
  columnar parser (`provider  model  context  max-out  thinking  images`, skipping
  the header). Add family grouping + flagship selection (rules ported from
  opencode's `command.ts` template into real, tested functions). Capture per-model
  `thinking` support.
- `review.ts` — keep as the high-level orchestration (`resolveBaseRef` → `collectDiff`
  → `buildReviewerPrompt` → run reviewers → `groupFindings` → `renderReport`), but
  swap its per-model step from the opencode session client to the new `pi.ts` runner.
  Its `ReviewClient` dependency is removed.

**Change:**
- `state.ts` — path → `~/.claude/multi-ai-review/state.json` (resolve `~` via
  `os.homedir()`). Keep atomic temp-file + rename write. Drop the per-project
  `.gitignore` write (not needed for a global file). Directory is created on write.

**Drop (opencode-specific):**
- `tool.ts`, `tool.test.ts`, `index.ts`, `command.ts`, `command.test.ts`,
  `package-docs.test.ts`, `commands/multi-review.md`, `pnpm-workspace.yaml`, and the
  `@opencode-ai/plugin` dependency.

**Add:**
- `pi.ts` — the low-level pi CLI runner (spawn `pi --print`, stdin piping, thinking
  gating, stdout capture, per-model timeout/failure isolation); injectable for tests.
- `cli.ts` — arg parsing + subcommand dispatch (`prep`, `run`).
- Bundler config (tsup or esbuild) producing `dist/cli.mjs`.
- `SKILL.md` (rewritten for the CLI flow) + a new README.

## The CLI

A single bundled `cli.mjs`, dispatched by first arg.

### `prep [baseRef]`

Composes model discovery + state + base-ref detection into one JSON blob so the
skill makes a single call before asking questions.

```json
{
  "baseRef": { "ok": true, "ref": "origin/main", "mergeBase": "abc123" },
  "diffStat": "12 files changed, 340 insertions(+), 12 deletions(-)",
  "families": [
    { "family": "openai-codex/gpt-5.6",
      "flagship": "openai-codex/gpt-5.6-sol",
      "variants": ["openai-codex/gpt-5.6-luna","openai-codex/gpt-5.6-sol","openai-codex/gpt-5.6-terra"],
      "thinking": true },
    { "family": "opencode-go/minimax", "flagship": "opencode-go/minimax-m3", "variants": ["…"], "thinking": true }
  ],
  "lastModels": ["openai-codex/gpt-5.6-sol","opencode-go/minimax-m3","opencode-go/kimi-k2.7-code"]
}
```

- On base-ref detection failure: `"baseRef": { "ok": false, "message": "…" }` (the
  skill then adds a base-ref question).
- Family ordering: last-used families first, then the default trio
  (GPT → MiniMax → Kimi), then the remaining families.

### `run --models a,b,c --thinking <low|medium|high> [--base <ref>] [--focus "…"]`

1. `resolveBaseRef` (honors `--base`; else auto-detect).
2. `collectDiff` (branch-vs-base: `mergeBase..HEAD`).
3. `buildReviewerPrompt` with the diff + optional `--focus` as `instructions`.
4. Run each model in parallel via `pi --print --model <id> --thinking <L>`, prompt
   piped over **STDIN** (not argv). `--thinking` is passed only to models whose
   `thinking` support is `yes`.
5. `extractReviewerOutput` per model → `groupFindings` → `renderReport`.
6. Print the markdown report to stdout; write `lastModels` to global state
   (best-effort — a state write failure must not fail the report).

Output format is markdown by default. (A `--format json` is a possible future
addition; not in scope.)

## Family grouping rules (`models.ts`)

- Preserve provider namespace: `openai-codex/*` and `opencode-go/*` never merge.
- Group by model-name root, dropping trailing version/variant:
  - `glm-5.1`, `glm-5.2` → `glm`
  - `kimi-k2.6`, `kimi-k2.7-code` → `kimi`
  - `minimax-m2.7`, `minimax-m3` → `minimax`
  - `qwen3.6-plus`, `qwen3.7-max`, `qwen3.7-plus` → `qwen`
  - `mimo-v2.5`, `mimo-v2.5-pro` → `mimo`
  - `deepseek-v4-flash`, `deepseek-v4-pro` → `deepseek`
- **Special case:** OpenAI `gpt-5.x` minor lines stay distinct families
  (`gpt-5.4` ≠ `gpt-5.5` ≠ `gpt-5.6`); `-luna/-sol/-terra` are variants within
  `gpt-5.6`. Family key for OpenAI is `gpt-<major.minor>`.
- **Flagship selection:** exclude lightweight variants
  (`mini`, `fast`, `flash`, `free`, `spark`, `lite`); among the remainder pick the
  newest by version-aware sort, ties broken lexicographically. If a family has only
  lightweight variants, pick the newest of those. Ambiguous peers (luna/sol/terra)
  resolve deterministically; the user overrides via "Other" when needed.

## The skill flow (`SKILL.md`)

Directory reference: the skill resolves its own dir (`DIR`) and calls
`node "$DIR/scripts/cli.mjs" …`.

1. **Parse args** `/multi-ai-review [baseRef] [focus…]`: a git-ref-looking token
   (contains `/`, or matches a safe ref pattern) → `baseRef`; remaining text →
   `focus`.
2. **`prep [baseRef]`** → read JSON (families, lastModels, detected baseRef +
   diffStat).
3. **`AskUserQuestion`** (single call):
   - **Q1 Models** — multi-select, up to 4 curated flagships, last-used families
     first and labeled `· last`; "Other" = custom model IDs / additional families.
   - **Q2 Thinking** — single-select: `medium (Recommended)` / `high` / `low`.
   - **Q3 Base ref** — included only when `prep` reported `baseRef.ok === false`;
     options offer the standard candidates + "Other". Otherwise the detected ref
     is shown in the preamble text (not a question).
4. **Map answers → exact model IDs** (flagship per selected family; parse "Other"
   into concrete IDs against the `prep` family list). Build the CSV.
5. **`run --models <csv> --thinking <level> [--base <ref>] [--focus "<text>"]`** —
   prints the deterministic report and persists last-models.
6. **Ground-truth pass:** for each finding actioned `address`/`investigate`, Claude
   verifies against the code/tools (`tsc --noEmit`, targeted tests, reading the
   file), downgrading false positives with a one-line rationale. Then present the
   final triaged report and optionally apply fixes / post a PR summary comment
   (as the current skill already does).

## Feature → mechanism map

| Feature | Mechanism |
|---|---|
| List pi models, user selects | `prep` families → `AskUserQuestion` Q1 (multi-select) |
| Select thinking level | `AskUserQuestion` Q2 → `run --thinking` (only for thinking-capable models) |
| Override auto-detected base ref | arg token → `run --base`; or Q3 when auto-detect fails |
| Add extra focus | remaining arg text → `run --focus` → `buildReviewerPrompt` instructions |
| Remember last models | `state.ts` global `state.json`; `prep` orders last-used first + `· last` label |

## Testing

Keep vitest. Coverage:
- `models.ts`: pi-list parsing (header skip, columns), family grouping incl. the
  OpenAI special case, flagship selection incl. lightweight exclusion and
  ambiguous peers, thinking-support capture.
- `state.ts`: global path resolution (inject a base dir for tests), atomic write,
  round-trip, missing-file → `[]`.
- `pi.ts`: runner with an injected fake `piRun` (DI, mirroring the existing
  `shell`/`client` injection) — parallelism, stdin piping contract, thinking flag
  gating, stdout-only capture, per-model failure isolation.
- `cli.ts`: arg parsing (`prep`/`run`, `--models` CSV, `--thinking`, `--base`,
  `--focus`), and JSON shape of `prep`.
- Reuse existing `git`/`prompt`/`findings`/`report` tests; extend `prompt` for the
  bare-object JSON fallback.

## Build & sync

- Bundler (tsup or esbuild): `src/cli.ts` → `dist/cli.mjs`, ESM, Node 24 target,
  zero runtime deps (Node builtins only: `child_process`, `fs`, `path`, `os`).
- `npm run sync`: copy `dist/cli.mjs` → `~/.claude/skills/multi-ai-review/scripts/cli.mjs`.
- Document build + sync in the README.

## Risks & non-goals

- **Risk (accepted):** models must emit one fenced JSON block via `pi --print`;
  non-compliant output degrades to a "reviewer failure" row (already handled by
  `report.ts`). Extraction stays tolerant (fenced block, then bare-object fallback).
- **pi gotchas encoded:** prompt over STDIN not argv; read stdout only and ignore
  the `supacode: OSC emit failed … /dev/tty` stderr noise; discover models at
  runtime (never hardcode versions).
- **Non-goals (YAGNI):** working-tree / staged diff mode (branch-vs-base only,
  matching opencode); publishing to npm; a `--format json` output; PR-comment
  automation beyond what the current skill already does.
