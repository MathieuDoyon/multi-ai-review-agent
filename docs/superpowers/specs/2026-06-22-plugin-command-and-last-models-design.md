# Plugin Command and Last Models Design

## Goal

Make the plugin easier to install and faster to reuse by registering the `/multi-review` command from the plugin, remembering the last selected model IDs, and cleaning personal paths out of README examples.

## Scope

This change covers three related improvements:

- Add a first model-selection option for reusing the last successful model list when one exists.
- Stop requiring users to manually copy `commands/multi-review.md` after npm install.
- Replace remaining personal local paths in README guidance with generic placeholders.

## Command Registration

The plugin should register the `multi-review` command through its `config(cfg)` hook. The command should be added only when `cfg.command.multi-review` is not already defined, so project or user config can override it.

The registered command should use OpenCode's inline command config shape:

```json
{
  "command": {
    "multi-review": {
      "description": "Run a multi-model AI code review for the current branch",
      "template": "...",
      "agent": "build"
    }
  }
}
```

The inline template should match the behavior currently documented in `commands/multi-review.md`, including model-family grouping and advanced variant selection. Keep `commands/multi-review.md` in the package as a readable source/template reference and update tests to keep the inline template and file template aligned.

If OpenCode already has a `multi-review` command configured, the plugin should not overwrite it.

## Remember Last Models

The plugin should remember the last model IDs passed to `multi_ai_code_review` after a successful tool invocation begins. The remembered list should be available to the command template on future `/multi-review` runs.

State should be stored in a project-local file:

```text
.opencode/multi-ai-review/state.json
```

The file should contain JSON like:

```json
{
  "lastModels": ["openai/gpt-5.5", "opencode-go/qwen3.7-plus"]
}
```

The plugin should expose a small read-only tool for the command template:

```text
multi_ai_code_review_last_models
```

Behavior:

- If no state file exists, the tool returns no models.
- If the state file is invalid JSON or has invalid `lastModels`, the tool returns no models instead of failing the review command.
- If `lastModels` exists and is a non-empty string array, the command should add the first question option: `Use last: <comma-separated model IDs>`.
- If the user selects `Use last: ...`, the command should call `multi_ai_code_review` with exactly those model IDs and skip the normal model-family selection.
- If the user does not select it, the command should continue with the shortened model-family selection flow.
- The label should never be passed as a model ID.

The state directory and file may be created during tool execution. The state file should not be included in npm package files and should not be committed by consumers.

## README Cleanup

Update README install guidance to match plugin-managed command registration:

- npm install/config should require only `plugin: ["opencode-multi-ai-review"]`.
- Remove the `curl` step for `commands/multi-review.md` from npm install guidance.
- Local clone setup should use generic placeholders, not a personal path.
- Use `file:///absolute/path/to/opencode-multi-ai-review/dist/index.js` for local plugin config examples.
- Use `/absolute/path/to/opencode-multi-ai-review` in shell examples.
- Mention that command registration is automatic unless the user overrides `command.multi-review`.
- Mention that the plugin stores last selected models in `.opencode/multi-ai-review/state.json`.

## Tests

Add or update tests to verify:

- the plugin `config` hook registers `command.multi-review` when missing;
- the plugin `config` hook preserves an existing `command.multi-review` override;
- the registered command template contains the same key behavior as `commands/multi-review.md`;
- the last-models tool returns an empty list when no state exists;
- the last-models tool reads a valid state file;
- invalid state is ignored safely;
- `multi_ai_code_review` writes `lastModels` when invoked with selected models;
- README no longer contains personal paths such as `~/Developer/opencode-multi-ai-review`;
- README no longer instructs npm users to manually copy or curl the command template.

## Non-Goals

- Do not implement actual `fix <numbers...>` or `ignore <numbers...>` command handling.
- Do not add global user-level state for last models.
- Do not remove `commands/multi-review.md`; keep it as package documentation/source material.
