# Codex Plugin Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `multi-ai-review-agent` installable from this GitHub repository in Codex while retaining Claude Code support.

**Architecture:** Keep the shared skill and bundled CLI at the repository root, retain the existing Claude manifests, and add native Codex manifest and marketplace files that point to the same skill. Make host-facing instructions neutral and verify both static packaging invariants and an isolated real Codex installation.

**Tech Stack:** JSON manifests, Markdown skill/docs, TypeScript/Vitest packaging checks, GitHub Actions, Codex CLI.

## Global Constraints

- Use `multi-ai-review-agent` as the plugin, marketplace, package, and GitHub repository identity.
- Preserve existing Claude Code installation support.
- Use version `0.1.0` consistently across package and host manifests.

---

### Task 1: Encode cross-host packaging requirements

**Files:**
- Create: `src/plugin-packaging.test.ts`

**Interfaces:**
- Consumes: repository manifests, skill instructions, README, package metadata, and release workflow.
- Produces: executable assertions for neutral naming, Codex paths, version alignment, and host-neutral skill wording.

- [ ] Write tests that require `.codex-plugin/plugin.json`, `.agents/plugins/marketplace.json`, aligned versions, `skills: "./skills/"`, and neutral marketplace identity.
- [ ] Run `pnpm vitest run src/plugin-packaging.test.ts` and verify failure because Codex packaging is absent.

### Task 2: Add native Codex manifests and neutral shared instructions

**Files:**
- Create: `.codex-plugin/plugin.json`
- Create: `.agents/plugins/marketplace.json`
- Modify: `skills/multi-ai-review-agent/SKILL.md`
- Modify: `src/git.ts`
- Modify: `src/git.test.ts`

**Interfaces:**
- Consumes: the existing `skills/multi-ai-review-agent/` plugin root layout.
- Produces: a Codex-installable plugin and host-neutral workflow instructions.

- [ ] Add the Codex plugin manifest with plugin identity `multi-ai-review-agent` and `skills: "./skills/"`.
- [ ] Add the repo marketplace with marketplace identity `multi-ai-review-agent`, local source `./`, required policy metadata, and category.
- [ ] Replace Claude-only tool/runtime wording in the shared skill with host-neutral instructions while documenting Claude and Codex invocation forms.
- [ ] Replace the Claude-style fallback command in the git error message and update its test.
- [ ] Run the packaging and git tests until green.

### Task 3: Document and automate dual-host support

**Files:**
- Modify: `README.md`
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/release.yml`

**Interfaces:**
- Consumes: the native Codex packaging from Task 2.
- Produces: installation instructions and release checks that prevent host manifest drift.

- [ ] Reframe the README around the neutral project name and add distinct Claude Code and Codex install/update/use commands.
- [ ] Add a Codex-local sync script without removing the Claude sync script.
- [ ] Add Codex packaging validation to CI and enforce version parity in releases.
- [ ] Run all tests, typecheck, build, bundle drift check, and JSON parsing checks.

### Task 4: Verify installation using Codex CLI

**Files:**
- No committed files.

**Interfaces:**
- Consumes: the completed repository worktree.
- Produces: evidence that Codex can add and install `multi-ai-review-agent@multi-ai-review-agent`.

- [ ] Create a temporary isolated `CODEX_HOME`.
- [ ] Run `codex plugin marketplace add <worktree>`.
- [ ] Run `codex plugin list` and `codex plugin add multi-ai-review-agent@multi-ai-review-agent --json`.
- [ ] Confirm the installed plugin version and bundled skill files, then inspect the final Git diff.
