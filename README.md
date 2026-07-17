# multi-ai-review-agent

A Claude Code and Codex plugin for adversarial, cross-model code review. It
reviews one branch against a base using several
[Cursor `agent`](https://cursor.com/docs/cli/overview) model families
(GPT/Codex, Claude/Opus, Grok, and more), runs them in parallel, synthesizes one
deterministic Markdown report, and asks the host agent to ground-truth actionable
findings before presenting them.

This is the Cursor `agent` port of
[`cc-multi-ai-review`](https://github.com/MathieuDoyon/cc-multi-ai-review), which
uses the `pi` CLI. The two skills are named separately and can be installed side
by side.

> **Data egress:** Running a review sends the full branch diff, up to the
> configured limits, to Cursor's servers and the model providers behind the
> models you select. Do not run it on repositories whose diffs must not leave
> the machine.

## Prerequisite

Install the [Cursor `agent`](https://cursor.com/docs/cli/overview) CLI and sign
in:

```sh
agent login
agent status
```

## Install

The marketplace and plugin are both named `multi-ai-review-agent`. The GitHub
repository still has its original `cc-` prefix until the planned repository
rename, so the source command temporarily retains that URL.

### Codex

```sh
codex plugin marketplace add MathieuDoyon/cc-multi-ai-review-agent --ref main
codex plugin marketplace list
codex plugin list
codex plugin add multi-ai-review-agent@multi-ai-review-agent
```

Start a new Codex session after installation. You can also open Codex and use
`/plugins` to browse, install, or enable the plugin.

Upgrade the Git-backed marketplace and reinstall when a new plugin version is
released:

```sh
codex plugin marketplace upgrade multi-ai-review-agent
codex plugin remove multi-ai-review-agent@multi-ai-review-agent
codex plugin add multi-ai-review-agent@multi-ai-review-agent
```

### Claude Code

```text
/plugin marketplace add MathieuDoyon/cc-multi-ai-review-agent
/plugin install multi-ai-review-agent@multi-ai-review-agent
```

Updates: `/plugin marketplace update multi-ai-review-agent`, or manage the
installation from the `/plugin` menu.

> If you previously installed the skill manually in either
> `~/.claude/skills/multi-ai-review-agent` or
> `~/.agents/skills/multi-ai-review-agent`, remove that copy to avoid duplicates.

## Use

In Codex, mention the skill with `$`:

```text
$multi-ai-review-agent
$multi-ai-review-agent origin/main
$multi-ai-review-agent origin/main focus on auth, data loss, and missing tests
```

In Claude Code, use its slash command:

```text
/multi-ai-review-agent
/multi-ai-review-agent origin/main
/multi-ai-review-agent origin/main focus on auth, data loss, and missing tests
```

The skill runs `prep`, asks which models and thinking level to use (offering the
last lineup first), runs the reviewers, and ground-truths actionable findings.

Cursor bakes reasoning effort into the model ID, so
`--thinking low|medium|high` resolves to each selected family's matching effort
variant, falling back to its base ID when that effort is unavailable. Reviewers
run read-only via
`agent --print --output-format text --mode ask --trust --model <id>`, with the
diff piped through standard input.

## Layout

- `src/` — TypeScript review engine and tests.
- `skills/multi-ai-review-agent/` — shared skill instructions and bundled CLI.
- `.codex-plugin/plugin.json` — Codex plugin manifest.
- `.agents/plugins/marketplace.json` — Codex repository marketplace.
- `.claude-plugin/` — Claude Code plugin and marketplace manifests.

## Development

```sh
pnpm install
pnpm build
pnpm test:run
pnpm typecheck
```

The built `skills/multi-ai-review-agent/scripts/cli.mjs` is committed so the
plugin works from a Git install. CI fails if it drifts from `src/`.

For local skill-only testing:

```sh
pnpm sync:codex
pnpm sync:claude
```

### CLI standalone

```sh
node skills/multi-ai-review-agent/scripts/cli.mjs prep [baseRef]

node skills/multi-ai-review-agent/scripts/cli.mjs run \
  --models claude-opus-4-8-high,gpt-5.3-codex-high \
  --thinking medium \
  [--base origin/main] [--focus "auth, data loss"] [--timeout 480]
```
