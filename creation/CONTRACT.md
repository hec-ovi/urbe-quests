# CONTRACT: quests/creation

Purpose: the questline creation workflow: one creation prompt in; the film script, its main questline, the side situations and one side questline each out.

## In
`new QuestlineCreation().run(input)` ([QuestlineCreation.ts](QuestlineCreation.ts)), `CreationInput` ([schema.ts](schema.ts)):
- `prompt`: the user's creation prompt.
- `world`, `types`; `sim`: `SimulationPort`.
- `ports`: `StagePorts { script, situations, plan: LLMPort; build: AgentPort }`, one per stage so the engine chooses the model for each.
- `minimums? { script?, situations? }`, `referenceTimeMin?`, `maxRounds?`, passed through to the inner boxes.
- `parcels?`: the buildings the story may use, when the host opens only part of the city. Every venue and every named place lands inside it. Omitted, the whole world is open.
- `mechanics?`: the step kinds the host can play, when it cannot play all 16. The planner and builder see only these kinds' catalog sections and tool fields, and a step of another kind is refused back to the builder by name. Omitted, every kind. A list naming no real kind throws before any model is asked.
- `warn?`: told about a dropped side quest, one by id or all of them when the situations text could not be read, and about a questline the recast published blocked. `progress?`: told as each stage lands (`script`, `situations`, `questline` with `'main'` or the situation id and its `TranslationResult`) and on every build round (`build` carrying the builder's `BuildProgress`), so a host logs where a long run is and keeps what is already made.

## Out
`CreationResult`: `script` (ScriptPassResult), `situations` (SituationsPassResult), `main` (TranslationResult: plan, definition, cast), `side` (one `SideQuest`, a TranslationResult with its `situationId`, per situation, in situation order).

`UniqueCast` ([UniqueCast.ts](UniqueCast.ts)) recasts the finished set in one order (main, then sides in situation order): a person playing a part is held back from the next one, and a character the set already cast (same role id and NPC type, borrowed from the same script) keeps the person it has. Each questline comes back pinned to the buildings its own people hold posts in, which is where the shipped bundle names them; one the city cannot staff keeps its place in the set and its reason goes to `warn`. Same inputs, same casting.

`Assignments` ([Assignments.ts](Assignments.ts)) is how story becomes translator input: the main line takes the logline as synopsis, every character card and the four movements as arc; a situation takes its four parts as arc, borrowed characters with their full script card, new ones with the situation's line about them.

## Steps
1. Script pass, text only.
2. Main translation (plan, then build), in parallel with 3.
3. Situations pass, text only, then one translation per situation, in parallel.

## Errors
The side branch never fails the run: a side quest whose translation throws is dropped by id, a side quest built under a questline id the main line or an earlier side quest already holds is dropped, and an `E_LLM` from the situations pass drops all of them (`situations` comes back empty, holding the unusable text as `raw`), both through `warn`. Everything else passes through from the inner boxes and fails the run: `E_LLM` from the script or the main translation (detail names the stage), `E_CAST` from the main cast, `SimulationError`.

## Invariants
- Each stage reads its own port; nothing here calls a model directly or caps output.
- Story text flows downstream as prose renders of the parsed script, never as ids.

## Sample

CLI scripts use the documented [Node import loader](https://tsx.is/dev-api/) from the installed tsx package.

`npm run author -- --world <named-world|atlas.json> --types <npc-types.json> --out <dir> [--prompt <text|@file>] [--parcels=<ids|@file>] [--mechanics <kind,kind,...>] [--templates <file>] [--handoff <file>] [--questlines <path>] [--profile <label>]` ([samples/author.ts](samples/author.ts)) authors a story with a live model and makes it a bundle in one run. Options take `--name value` or `--name=value`.
- Inputs: the world and types go through the [world projection](../world/WorldContextNormalizer.ts). `--prompt` is the creation prompt, literal or `@file`; omitted or empty, the world's theme. `--parcels` and `--mechanics` are the run's `parcels` and `mechanics`. `--templates` defaults to [samples/mission-item-templates.json](samples/mission-item-templates.json). `--handoff` carries explicit bindings and host capabilities. `--profile` (default `author`) seeds the stub simulation exactly as materialize seeds it. Every file and option is read and checked before the first model call.
- Model: [samples/OpenAICompatibleClient.ts](samples/OpenAICompatibleClient.ts) streams text and indexed tool calls from an OpenAI-compatible Chat Completions endpoint: `LLM_BASE_URL` (default `http://localhost:8080/v1`), `LLM_MODEL` (default the first listed model), `LLM_API_KEY` (sent only when set). An empty variable counts as unset. A tool request asks for parallel tool calls, which llama.cpp otherwise holds to one per turn.
- Out: `--out` gets each stage as it lands: `script.md`, `situations.md`, `main.plan.md`, `main.questline.json`, `side-<id>.plan.md`, `side-<id>.questline.json`, then `questlines.json`. `recording.json` holds what the model said, written even when the run stops. `meta.json` holds the prompt, model, world, types, profile, mechanics, open parcel count, start time and `seconds` (elapsed seconds at which the script, situations, each questline and the bundle landed), plus the bundle path, counts and `blocked` list, or `failed { stage, message }`. The bundle is that recording materialized in-process to `--questlines` (default `<out>/bundle/questlines.json`), byte-identical to a later `npm run materialize` of the same recording, world, types, profile and parcels.
- Progress goes to stderr with elapsed seconds: one line per text call, script, situations, build round, refused tool call and finished questline. A failure exits 1 with `author failed at <stage>: <code> <message>`, where the stage is `script`, `plan (<title>)` or `main questline` (side quests never stop a run) or `materialize`.

`recordingPorts(live, meta)` ([samples/RecordingPorts.ts](samples/RecordingPorts.ts)) wraps live stage ports and returns `{ ports, recording() }`. A text stage keeps its last answer, which after a repair round is the one that parsed, so replay parses it on the first call. A plan is kept per assignment title. A build keeps the tool-call rounds only: the draft is the ordered calls, so replies in words and their nudges change nothing a replay needs. A title keys one questline, which the situations pass guarantees.

`npm run replay -- <recording json> <output dir> [<world json> <npc types json>]` ([samples/replay.ts](samples/replay.ts), ports in [samples/RecordedPorts.ts](samples/RecordedPorts.ts)) rebuilds the stage files from a recorded run: the model's text and tool calls come from JSON (`prompt`, `model`, `script`, `situations`, `plans` and `builds` keyed by assignment title, optional `mechanics`), everything else is the real workflow, so a run is rebuilt and checked with no model present. Without inputs it uses the `world.json` and `npc-types.json` beside the recording, else the neon-bay fixture.

Recording `bindings.unreservedRoles` removes the fixed simulation reservation while preserving its `reservedName` as `characterName` unless an explicit `characterName` already exists. The resulting role is played by the city's generated person under the story's authored display name; unnamed roles and bystanders keep their generated names. Replay does not mutate the recording or rename simulation records.

`npm run materialize -- <recording> <profile> <atlas-or-named-world> <npc-types> <questlines-output> [<handoff-input>] [--parcels=<ids|@file>]` ([samples/materialize.ts](samples/materialize.ts), in-process `materializeRecording(input)`) replays semantic parcel, district and fallback role-type bindings against a concrete city, under the recording's `mechanics` when it has them. `--parcels` names the buildings the story may use, as `p0,p3,p12` or `@path` to a file holding a JSON array, a `{ "parcels": [...] }` object, or ids separated by commas or whitespace; omitted, the whole city is open. Every place then lands inside that set: a role's venue is chosen from it, and a building outside it moves to one of the same kind inside it, its own district first. A side quest with a place that has nowhere to go is left out of the bundle and named in `blocked` (`{ questlineId, reason }`, on the result and in `questlines.meta.json`, also printed); the same on the main line stops the run, because a story nobody can walk into is not a bundle. The set is recorded in `questlines.meta.json`, and the same set and seed produce the same bundle. Naming output keeps its metadata; raw Atlas input alone receives the local `derived-from-atlas` marker. Both inputs use the [world projection](../world/WorldContextNormalizer.ts). `npm run bundle -- <sample-dir> [<questlines-output>] [<handoff-input>]` packages a completed sample. Both write the stable [../handoff/CONTRACT.md](../handoff/CONTRACT.md) bundle v1.1 files beside the questlines: `objectives.json`, `investigations.json`, `mechanic-target-bindings.json`, `mission-assets.json`, `mission-item-bindings.json`, `host-capabilities.json`, and `quest-bundle.json`, plus `questlines.meta.json` for materialize. Omitted catalogs are empty. Missing investigation or fixed mechanic bindings and unsupported transportation modes fail closed. Same inputs produce byte-identical outputs.

A recording may also carry `missionItemTemplates`, keyed by physical item kind. Each template supplies the mission asset family, dimensions, existing material key/variant assignments, interactions and clearance. The shipped [templates](samples/mission-item-templates.json) cover every physical kind in the cyberpunk material catalog: device and key as data drives, weapon as a tool with a rubber grip, document as a document, substance and valuable as packages; each fits every geometry variant of its family. `checkMissionItemTemplates(value)` refuses a key that is no physical item kind and a template the handoff would refuse or a player could not pick up. Materialize applies a template to every otherwise unbound pickup, deriving its purpose from the authored item and a stable asset identity and seed from the quest/item pair. Explicit handoff item bindings take precedence. Missing templates, absent pickup bindings or assets without a portable `take` anchor fail before publication. Templates produce standard mission asset requests; Engine's existing registry creates and validates their actual geometry and material catalog references. No world position is embedded in an asset request.

[samples/urbe-small/](samples/urbe-small/) contains one source recording and its named world/type inputs. Replay writes local generated outputs. Replay and materialize read the type set from [samples/urbe-small/npc-types.json](samples/urbe-small/npc-types.json).

The sample transport follows the [Chat Completions delta format](https://developers.openai.com/api/docs/guides/function-calling#streaming) supported by [llama.cpp](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md). It sends `stream: true`, assembles complete text/tool arguments, and rejects incomplete streams or provider errors. It sets no output limit.

## Depends on
- ../story, ../builder, ../world, ../ports, ../handoff
