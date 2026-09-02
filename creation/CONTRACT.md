# CONTRACT: quests/creation

Purpose: the questline creation workflow: one creation prompt in; the film script, its main questline, the side situations and one side questline each out.

## In
`new QuestlineCreation().run(input)` ([QuestlineCreation.ts](QuestlineCreation.ts)), `CreationInput` ([schema.ts](schema.ts)):
- `prompt`: the user's creation prompt.
- `world`, `types`; `sim`: `SimulationPort`.
- `ports`: `StagePorts { script, situations, plan: LLMPort; build: AgentPort }`, one per stage so the engine chooses the model for each.
- `minimums? { script?, situations? }`, `referenceTimeMin?`, `maxRounds?`, passed through to the inner boxes.
- `warn?`: told about a dropped side quest, one by id or all of them when the situations text could not be read. `progress?`: told as each stage lands (`script`, `situations`, `questline` with `'main'` or the situation id and its `TranslationResult`) and on every build round (`build` carrying the builder's `BuildProgress`), so a host logs where a long run is and keeps what is already made.

## Out
`CreationResult`: `script` (ScriptPassResult), `situations` (SituationsPassResult), `main` (TranslationResult: plan, definition, cast), `side` (one `SideQuest`, a TranslationResult with its `situationId`, per situation, in situation order).

`Assignments` ([Assignments.ts](Assignments.ts)) is how story becomes translator input: the main line takes the logline as synopsis, every character card and the four movements as arc; a situation takes its four parts as arc, borrowed characters with their full script card, new ones with the situation's line about them.

## Steps
1. Script pass, text only.
2. Main translation (plan, then build), in parallel with 3.
3. Situations pass, text only, then one translation per situation, in parallel.

## Errors
The side branch never fails the run: a side quest whose translation throws is dropped by id, and an `E_LLM` from the situations pass drops all of them (`situations` comes back empty, holding the unusable text as `raw`), both through `warn`. Everything else passes through from the inner boxes and fails the run: `E_LLM` from the script or the main translation (detail names the stage), `E_CAST` from the main cast, `SimulationError`.

## Invariants
- Each stage reads its own port; nothing here calls a model directly or caps output.
- Story text flows downstream as prose renders of the parsed script, never as ids.

## Sample
`npm run sample -- "<prompt>" <name> [<named world json> <npc types json>]` ([samples/run-local.ts](samples/run-local.ts), client in [samples/OpenAICompatibleClient.ts](samples/OpenAICompatibleClient.ts)) runs one real pass against an OpenAI-compatible endpoint (`LLM_BASE_URL`, `LLM_MODEL`, `LLM_API_KEY`) and writes `samples/<name>/` as each stage lands: `script.md`, `situations.md`, `main.plan.md`, `main.questline.json`, `side-<id>.plan.md`, `side-<id>.questline.json`, then `meta.json` (prompt, model, world). Progress goes to stderr with elapsed seconds, one line per text call, build round and finished questline.

`npm run replay -- <recording json> <name> [<named world json> <npc types json>]` ([samples/replay.ts](samples/replay.ts), ports in [samples/RecordedPorts.ts](samples/RecordedPorts.ts)) rebuilds a sample from a recorded run: the model's text and tool calls come from JSON (`prompt`, `model`, `script`, `situations`, `plans` and `builds` keyed by assignment title), everything else is the real workflow, so a sample is rebuilt and checked with no model present.

## Depends on
- ../story, ../builder, ../world, ../ports
