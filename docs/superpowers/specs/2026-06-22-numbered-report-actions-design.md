# Numbered Report Actions Design

## Goal

Make the multi-model review report easier to act on by numbering actionable findings, sorting them by severity, and recommending which numbered findings to address now.

## Scope

This is report-only behavior. The plugin should not implement `fix` or `ignore` command handling in this change. The report should expose numbers that a user can refer to in follow-up messages, such as `fix 1 3` or `ignore 2`.

## Findings Table

`src/report.ts` should sort actionable findings at render time. Do not change `groupFindings` or persist IDs on `FindingGroup`.

Severity order is:

```text
critical -> high -> medium -> low
```

The main `## Findings` table should add a leading `#` column and number actionable findings starting at `1` after sorting. The existing columns should remain after `#`: `Severity`, `Confidence`, `Finding`, `Models`, `Location`, `Recommendation`, and `Action`.

If there are no actionable findings, the table should still include the `#` column and use `-` for the number cell.

## Follow-Up Guidance

After the findings table, the report should include:

```text
Use finding numbers to choose next actions, for example: fix 1 3 or ignore 2.
```

Then include a recommendation block based on the existing `action` field:

```text
Recommended next action:
- Address now: 1, 3
- Investigate before fixing: 2
```

Rules:

- Include findings with `action === "address"` under `Address now`.
- Include findings with `action === "investigate"` under `Investigate before fixing`.
- Use `none` when a list is empty.
- Do not include `likely false positive` findings in the recommendation block, because those remain under `## Do Not Address Yet`.

## Do Not Address Yet

Keep `## Do Not Address Yet` separate and unnumbered in this change. It should continue listing likely false positives with the existing bullet format.

## Tests

Update `src/report.test.ts` to verify:

- the findings table includes the `#` column;
- actionable findings are sorted by severity order `critical`, `high`, `medium`, `low`;
- finding numbers follow the sorted order;
- the follow-up guidance mentions `fix 1 3` and `ignore 2`;
- the recommendation block lists `address` findings under `Address now` and `investigate` findings under `Investigate before fixing`;
- empty actionable findings render `none` in both recommendation lists.
