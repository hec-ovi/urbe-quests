# CONTRACT: quests/story

Purpose: writes the story as text only: the film script from the creation prompt (characters with background and voice, four movements of passages that turn), and from the script the side situations, each with its own presentation, development, conflict and resolution.

## In
- `new ScriptPass().run(input)` ([ScriptPass.ts](ScriptPass.ts)): `world`, `types` ([../world/types/named-world.ts](../world/types/named-world.ts)), `llm` ([../ports/llm.ts](../ports/llm.ts)), `prompt?` (the creation prompt; defaults to the world's theme), `minimums?` (defaults `{ characters: 5, passagesPerMovement: 2 }`), `stagesScenes?`.
- `new SituationsPass().run(input)` ([SituationsPass.ts](SituationsPass.ts)): `script`, `world`, `types`, `llm`, `minimums?` (default `{ situations: 3 }`), `stagesScenes?`.
- `stagesScenes: true` when the host stands what a scene leaves in a place: both passes are told the city can show a body, blood, an object left there or people keeping watch, so a death, a crime or an aftermath the protagonist walks into is written as it is found, and only when the story calls for one ([prompts/staging.md](prompts/staging.md)).
Only names, kinds, tiers and type boilerplates reach the model ([worldBrief.ts](worldBrief.ts)).

## Out
- `ScriptPassResult { script, raw }` ([schema.ts](schema.ts)): `StoryScript` with prompt, title, logline, characters (name, role, background, want, voice) and movements (presentation, development, conflict, resolution, each passages with heading and text).
- `SituationsPassResult { situations, raw }`: each `Situation` with id, title, characters (name, description) and its four parts. Every title is its own, distinct from the script's and each other's (case aside), because a questline and its recording are known by title; a repeated one is a shortfall for the repair round. A title copied from the format (`<...>` or the bare word Title) is a shortfall too, for the script and for a situation.
- `renderScript`, `renderCards`, `renderMovements` ([renderScript.ts](renderScript.ts)): prose views for the stages that read the story.
- `loadFixtureStory('cyberpunk')` ([fixtures.ts](fixtures.ts)): committed raw texts of both passes, so later stages run without a model.

## Errors
- `E_LLM`: output unusable after one repair round; detail `{ stage, raw, problems }`.
Provider errors from the port pass through.

## Invariants
- Text only: neither pass uses tools; parsing and minimum checks are code; a shortfall lists every problem in one repair round; raw text is always kept.
- Minimums are floors rendered into the prompt, never exact counts.
- Prompts live in [prompts/](prompts/): pass-input.md, script-pass.md, script-repair.md, situations-pass.md, situations-repair.md, repair-input.md, staging.md. Output length is never capped.

## Depends on
- ../world (types), ../ports (LLMPort)
