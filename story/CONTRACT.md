# CONTRACT: quests/story

Purpose: writes the world's main history line (introduction, development, conflict, resolution) and side quest premises from the theme and the named world; context isolated from geometry and simulation detail.

## In
`new StoryPass().run(input)` ([StoryPass.ts](StoryPass.ts)):
- `world`, `types`: named world and NPC type set ([../world/types/named-world.ts](../world/types/named-world.ts)). Only names, kinds, tiers and type boilerplates reach the model.
- `llm`: [../ports/llm.ts](../ports/llm.ts) `LLMPort`.
- `theme?`: overrides the world's theme prompt.

## Out
`StoryPassResult` ([schema.ts](schema.ts)): `document` (theme, four-movement mainline, side premises with ids) plus `raw` (unvalidated model text, kept so nothing creative is lost).

## Errors
- `E_LLM`: output unusable after one repair round (raw text in `detail`).
Provider errors from the port pass through.

## Invariants
- One backbone call writes mainline and premises together; parsing and validation are code.
- Prompts live in [prompts/](prompts/) .md files; side premise counts are steered as a range, never an exact quota; output length is never capped.

## Depends on
- ../world (types), ../ports (LLMPort)
