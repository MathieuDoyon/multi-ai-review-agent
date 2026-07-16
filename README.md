# cc-multi-ai-review-agent

A Claude Code plugin providing the `/multi-ai-review-agent` skill: one
branch-vs-base code review across several [Cursor `agent`](https://cursor.com/docs/cli/overview)
model families (GPT/Codex, Claude/Opus, Grok, and more), run in parallel and
synthesized into one deterministic Markdown report. Claude then ground-truths the
actionable findings before presenting them.

This is the Cursor `agent` port of
[`cc-multi-ai-review`](https://github.com/MathieuDoyon/cc-multi-ai-review) (which
uses the `pi` CLI); the two are namespaced separately and can be installed side
by side.

> **Data egress**: running a review sends the full branch diff (up to the
> configured limits) to Cursor's servers and the model providers behind the
> models you select. Don't run it on repos whose diffs must not leave the
> machine.

## Install

Prerequisite: the [Cursor `agent`](https://cursor.com/docs/cli/overview) CLI must
be installed and signed in (`agent login`; check with `agent status`).

In Claude Code:

```
/plugin marketplace add MathieuDoyon/cc-multi-ai-review-agent
/plugin install multi-ai-review-agent@cc-multi-ai-review-agent
```

Updates: `/plugin marketplace update cc-multi-ai-review-agent` (or manage
everything from the `/plugin` menu).

> If you previously installed the skill manually into
> `~/.claude/skills/multi-ai-review-agent`, remove that copy to avoid duplicates.

## Use

```
/multi-ai-review-agent
/multi-ai-review-agent origin/main
/multi-ai-review-agent origin/main focus on auth, data loss, and missing tests
```

The skill runs `prep`, asks which models + thinking level via `AskUserQuestion`
(offering your last lineup first), runs the review, then ground-truths the
actionable findings before presenting them.

Cursor bakes reasoning effort into the model id, so `--thinking low|medium|high`
is resolved to each chosen family's matching effort variant (e.g. `high` →
`claude-opus-4-8-high`), falling back to the family's base id when that effort is
not offered. Each reviewer runs read-only via
`agent --print --output-format text --mode ask --trust --model <id>`, with the
diff piped in on stdin.

## Layout

- `src/` — TypeScript engine (models, git, prompt, findings, report, agent runner, cli).
- `skills/multi-ai-review-agent/SKILL.md` — the skill instructions.
- `skills/multi-ai-review-agent/scripts/cli.mjs` — bundled zero-dependency CLI
  (committed build output, built with esbuild).
- `.claude-plugin/` — plugin + self-hosted marketplace manifests.

## Development

```sh
pnpm install
pnpm build          # esbuild -> skills/multi-ai-review-agent/scripts/cli.mjs
pnpm test:run
pnpm typecheck
```

The built `cli.mjs` is committed so the plugin works straight from a git
install; CI fails if it drifts from `src/`. Rebuild and commit it whenever the
engine changes.

`pnpm sync` copies the skill into `~/.claude/skills/multi-ai-review-agent` for
local testing without the plugin flow.

### CLI (standalone)

```sh
node skills/multi-ai-review-agent/scripts/cli.mjs prep [baseRef]
# -> JSON: { baseRef, diffStat, families[], lastModels[] }

node skills/multi-ai-review-agent/scripts/cli.mjs run \
  --models claude-opus-4-8-high,gpt-5.3-codex-high --thinking medium \
  [--base origin/main] [--focus "auth, data loss"] [--timeout 480]
# -> Markdown report; records the lineup at ~/.claude/multi-ai-review-agent/state.json
```
