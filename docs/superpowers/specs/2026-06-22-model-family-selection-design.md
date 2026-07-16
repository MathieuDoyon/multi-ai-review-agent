# Model Family Selection Design

## Goal

Keep `/multi-review` model selection short while still allowing precise variant control. The command should present one recommended default per model family, with an advanced escape hatch for choosing specific variants.

## Current Behavior

`commands/multi-review.md` runs `opencode models` and asks the user to choose from every available model ID. When providers expose many variants, the list becomes too long and includes near-duplicates such as `fast`, `mini`, `pro`, `free`, and older version variants.

## Desired Behavior

The command should instruct the agent to group the available model IDs by model family and auto-pick one recommended default per family. The normal user question should show only those recommended defaults plus an advanced option.

Recommended question text:

```text
Which model families should review this branch?

I picked one recommended model per family to keep the list short. Select "Advanced: choose specific model variants" if you want to override variants.
```

The normal multi-select choices should contain the shortened recommended list and `Advanced: choose specific model variants`.

## Grouping Rules

Family grouping is prompt-level behavior in the command template. No runtime TypeScript logic is needed for this change.

The command should tell the agent to:

- Preserve provider namespace, so `opencode/mimo` and `opencode-go/mimo` are separate families.
- Treat model name roots as families, so `glm-5.1` and `glm-5.2` group as `opencode-go/glm`.
- Treat OpenAI `gpt-5.x` minor lines as distinct product families, so `openai/gpt-5.4` and `openai/gpt-5.5` both remain visible.
- Prefer the most recent numeric version in a family.
- Prefer stable/full variants over `mini`, `fast`, `flash`, `free`, `spark`, or similar reduced/specialized variants unless the family only has those variants.
- Keep distinct top-level model products as separate choices, such as `openai/gpt-5.4` and `openai/gpt-5.5`.

For the sample list from the request, expected normal choices are:

```text
opencode/big-pickle
opencode/mimo-v2.5-free
opencode/nemotron-3-ultra-free
opencode/north-mini-code-free
opencode-go/deepseek-v4-flash
opencode-go/glm-5.2
opencode-go/kimi-k2.7-code
opencode-go/mimo-v2.5
opencode-go/minimax-m3
opencode-go/qwen3.7-plus
openai/gpt-5.4
openai/gpt-5.5
Advanced: choose specific model variants
```

## Advanced Flow

If the user selects `Advanced: choose specific model variants`, the command should ask follow-up questions only for families that have multiple variants or where the user needs to override the recommended default.

The follow-up should stay concise. It should not show all models in one large list unless the agent cannot confidently group them. The final `models` argument passed to `multi_ai_code_review` should contain exact model IDs only, never the advanced sentinel label.

## Error Handling

If grouping is ambiguous, the command should prefer a conservative short list over an exhaustive list and offer advanced selection. If the available model list is already short, it may ask directly with all available model IDs plus the advanced option only if variants exist.

## Tests

Update `src/package-docs.test.ts` to assert that the command template documents:

- grouping model IDs by family;
- choosing one recommended default per family;
- preferring recent stable/full variants;
- exposing an advanced variant-selection option;
- passing only exact selected model IDs to `multi_ai_code_review`.

No runtime tests are required because the behavior is encoded in the opencode command prompt, not TypeScript code.
