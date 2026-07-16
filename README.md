# cc-multi-ai-review-agent

A self-contained Node CLI that powers the Claude Code `/multi-ai-review-agent`
skill: one branch-vs-base code review across several Cursor `agent` model
families, synthesized into one deterministic Markdown report. This is the Cursor
`agent` port of `cc-multi-ai-review` (which uses the `pi` CLI).

Running a review sends the full branch diff (up to the configured limits) to
Cursor's servers and the model providers behind the models you select. Don't run
it on repos whose diffs must not leave the machine. You must be signed in to
Cursor (`agent status`; `agent login` if not).

## Layout

- `src/` — TypeScript engine (models, git, prompt, findings, report, agent runner, cli).
- `dist/cli.mjs` — bundled zero-dependency CLI (built with esbuild).
- `skill/SKILL.md` — the tracked copy of the skill instructions.

## Build & install

```sh
pnpm install
pnpm build          # esbuild -> dist/cli.mjs
pnpm sync           # copy dist/cli.mjs -> ~/.claude/skills/multi-ai-review-agent/scripts/cli.mjs
                    # and skill/SKILL.md -> ~/.claude/skills/multi-ai-review-agent/SKILL.md
```

## CLI

```sh
node dist/cli.mjs prep [baseRef]
# -> JSON: { baseRef, diffStat, families[], lastModels[] }
#    each family: { family, label, flagship, variants[], efforts{} }

node dist/cli.mjs run --models claude-opus-4-8-high,gpt-5.3-codex-high --thinking medium \
  [--base origin/main] [--focus "auth, data loss"] [--timeout 480]
# -> Markdown report; records the lineup at ~/.claude/multi-ai-review-agent/state.json
```

Cursor bakes reasoning effort into the model id, so `--thinking low|medium|high`
is resolved to each chosen family's matching effort variant (e.g. `high` →
`claude-opus-4-8-high`), falling back to the family's base id when that effort is
not offered. Each reviewer runs read-only via
`agent --print --output-format text --mode ask --trust --model <id>`, with the
diff piped in on stdin.

## Use (in Claude Code)

```
/multi-ai-review-agent
/multi-ai-review-agent origin/main
/multi-ai-review-agent origin/main focus on auth, data loss, and missing tests
```

The skill runs `prep`, asks which models + thinking level via `AskUserQuestion`
(offering your last lineup first), runs the review, then ground-truths the
actionable findings before presenting them.

## Test

```sh
pnpm test:run
pnpm typecheck
```
