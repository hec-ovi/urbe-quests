# Quests 0.11.1

Writes stories through injected agents, adapts them into typed quests, runs their rules in code, and prepares Engine handoffs and scoped NPC dialogue.

## Calls and schemas

The Node library entry is [index.ts](index.ts), compiled to `dist/index.js`; browser hosts use [runtime.ts](runtime.ts), compiled to `dist/runtime.js`. No HTTP server is required.

| Call | Input | Output |
| --- | --- | --- |
| `AuthoringHarness.writeStory(input, agent)` | [Story request](authoring/schema/story-request.schema.json), [agent port](authoring/src/schema.ts) | [Story](authoring/schema/story-output.schema.json), narrative only |
| `AuthoringHarness.adaptGameplay(input, agent)` | [Adaptation request](authoring/schema/adaptation-request.schema.json), [agent port](authoring/src/schema.ts) | [Definition and narrative trace](authoring/schema/adaptation-output.schema.json) |
| `AuthoringHarness.skillIndex()`, `route(message)`, `resolveSkills(names)` | [Resolver queries](authoring/CONTRACT.md#inputs) | [Skill index and selected bodies](authoring/CONTRACT.md#outputs) |
| `QuestlineCreation.run(input)` | [CreationInput](creation/schema.ts), prompt, named world/types, Simulation, per-stage model ports and the parcels the story may use | [CreationResult](creation/schema.ts), script, situations, main and side translations |
| `ScriptPass.run`, `SituationsPass.run`, `QuestlineTranslator.translate` | [Story](story/CONTRACT.md), [translation](builder/CONTRACT.md) | [Story text](story/schema.ts), [plan, definition and feasibility cast](builder/schema.ts) |
| `CastResolver.cast(definition, timeMin, options?)` | [Definition](flow/schema/questline.schema.json), [SimulationPort](world/types/simulation.ts), optional `StoryVenues(world, types)` and `{taken, characters}` | [CastResult](builder/CastResolver.ts): `cast` role to NPC IDs, `posts` role to the building it holds a post in, `blocked` when a role cannot be filled |
| `QuestlineRuntime`, `advance`, `restore` | [Definition](flow/schema/questline.schema.json), cast, Simulation, [event](flow/schema/player-event.schema.json), time, [saved state](flow/schema/questline-state.schema.json) | [State and advance result](flow/QuestlineRuntime.ts), [availability](flow/availability.ts), [guidance](flow/schema/step-guidance.schema.json) |
| `QuestlineRuntime.dialogueFor`, `chooseDialogue` | Exact active step, resolved NPC, current time; declared choice ID for selection | [Authored dialogue and explicit choice result](flow/CONTRACT.md), offline, scoped to one step |
| `EngineHandoff.assemble(questlines, input?)` | [Quest set](creation/schema/questline-set.schema.json), [bindings and capabilities](handoff/schema/handoff-input.schema.json) | [HandoffBundle](handoff/schema.ts), definitions, objectives, investigations, assets and bindings |
| `DialogContextService.contextFor(npcId, timeMin, { guide? })`, `recordExchange` | [Context inputs](dialog/CONTRACT.md#in), optional guided place, completed exchange | [Scoped segments and memory](dialog/schema.ts) |
| `Converse.reply`, `Converse.replyStream`, `cleanReply` | [Reply input](dialog/Converse.ts), optional companion offers and abort signal, [LLMPort or StreamingLLMPort](ports/llm.ts) | Cleaned reply string, or streamed `delta`, `offer` and `done` [events](dialog/CONTRACT.md#out) |
| `chatDeltas(body, onUsage?)`, `ChatToolCalls` | OpenAI-compatible `stream: true` response body, [chat shapes](ports/chat.ts) | Choice deltas in order and the reported token usage; whole tool calls in index order |
| `WorldContextNormalizer.normalize`, fixture loaders | [World and type projections](world/types/named-world.ts), [world calls](world/CONTRACT.md) | [Normalized context](world/WorldContextNormalizer.ts), standalone world/story fixtures |

Creation warnings report failed side translations or unusable situations. Main/script failures reject the run. `CreationResult` has no completion marker or retained side-failure record. Naming is supplied by callers; its integration is proposed in [issues](docs/ISSUES.md).

Engine receives main definition first, then side definitions, without creation-time cast IDs. The game casts against its own Simulation, through `CastResolver`, which queries each role at the hour its own steps name. The CLI writes bundle **1.1** with the [eight filenames and counts](handoff/schema/quest-bundle.schema.json). Bundle 1.1 keeps its shape: an authored place gains `name` and a step gains an optional `window`, both additive. Saved state is unchanged; bundle version and package version are separate.

An optional role `characterName { given, family }` carries the script's authored identity into player labels and scoped dialog without changing the resolved NPC, its simulation name, routine, family or saved history. Recorded `unreservedRoles` preserve their prior fixed names in this field while removing the reservation request. Dialog context and reply prompts use the same authored name; unnamed roles and bystanders keep generated names. The field is additive within bundle 1.1 and requires no saved-state migration.

Talk steps may carry `dialogue { opening, choices: [{ id, text, reply, completesStep }] }`. The recorded Weir Line and all three side stories author every talk with character speech, informational questions and explicit commitments. `dialogueFor(stepId, npcId, timeMin)` is read-only; `chooseDialogue(stepId, npcId, choiceId, timeMin)` rechecks presence, items and gates and completes only the selected step. Opening, dismissing, free chat and informational replies never progress the quest. Authored talks reject raw `talkedTo`; legacy definitions retain that event for compatibility and receive deterministic fallback choices through the same dialogue API. This optional field stays within bundle 1.1 and changes neither step IDs nor saved-state shape.

Materialize builds exact physical pickup requests and bindings from a recording's authored item-kind templates, while preserving explicit handoff bindings. The handoff rejects pickups without a portable asset and `take` anchor, so an otherwise valid story cannot silently ship an impossible collection step.

Hosts pass `new CastResolver(sim, new StoryVenues(world, types))`: with the world it looks past the pinned venue to the other buildings that publish the post, which is what keeps every character a different person, and it can move a step onto the building its character really works in. `options.taken` and `options.characters` carry both across a questline set.

A cast member stands where the step says, and where that is gets settled while the questline is built, never at play time. The creation stage casts and then pins the questline with `StoryVenues.pin(definition, posts)`, so the shipped bundle names the final buildings and a host that opens interiors from the steps opens the right ones. `cast(definition, timeMin, options?)` answers `{ cast, posts, blocked? }` and rewrites nothing: `cast` is `roleId -> npcId`, `posts` is `roleId -> the building that character was found holding a post in` and is absent for a role filled any other way, and `blocked` is `{ roleId, npcType, reason }` when nobody can play a role. A host casting at load plays the definitions the bundle carries and lists a blocked questline with its `reason` instead of dropping it.

A host that opens only part of the city names it: `parcels` on a creation run, `--parcels` on the materialize CLI. Every place then lands inside that set, a building outside it moves to one of the same kind that is in it, and a questline with nowhere to go is named with its reason instead of shipped, so the bundle only ever points at buildings the player can walk into.

A step moves for the people it meets and nobody else: the role a `talk` names, both roles a `listen` names, or the character a step is wanted by while the step stands at that character's own meeting place. It moves only to the building where that character holds a post, and only when everyone the step meets agrees on one building. A role found off a post moves nothing, so two stories never collapse onto one address because a lookup fell through.

A quest place is a named place at a real hour. Every authored place is `{ <identity>, name }`: the world's own name when Naming gave it one, else the word for that kind of building ([venue table](world/venues.ts)). A step whose text names an hour carries a `window` the runtime gates on, so a hint never promises a time nothing checks. Story venues are the buildings that publish a post for the character ([Interior staffing](../interior/CONTRACT.md)), which never includes a building published for residents and guests alone, and the simulation is asked whether it hires at a parcel before anyone is cast there, so one building it staffs nobody in costs a query and not the questline. One person plays one character across a questline set.

Time is simulation minutes since Monday 00:00. Creative calls use separate contexts; graph transitions, gates, inventory and save validation use code. Quests checks semantic targets and submitted bindings. Engine owns measured placement, reach, visibility, rendering and save coordination. A passed semantic handoff alone does not establish 3D playability.

## Errors

[QuestError](errors.ts), `{code, message, detail?}`: `E_INVALID_FLOW` (definition/save), `E_UNKNOWN_ID` (missing identity), `E_WRONG_STATE` (event/state), `E_UNAVAILABLE` (gated action), `E_CAST` (cast resolution), `E_LLM` (unusable text/build, a reply with nothing to say, or an empty memory note), `E_HANDOFF` (bindings/assets/capabilities).

[AuthoringError](authoring/schema/authoring-error.schema.json), `{code, message, details}`: `E_AUTHORING_INPUT`, `E_AUTHORING_OUTPUT`, `E_SKILL_CONTRACT`, `E_UNKNOWN_SKILL`, `E_UNSUPPORTED_MECHANIC`, `E_MECHANIC_SELECTION`, `E_WORLD_TARGET`, `E_CAUSE_EFFECT`, `E_INVALID_FLOW`. Meanings: [authoring errors](authoring/CONTRACT.md#errors).

These are closed domain sets. Injected provider/Simulation exceptions pass through, except cast reservation and exhausted vendor matches, which become `E_CAST` while a questline is built and its `blocked` reason once it is published. Standalone [SimulationError](world/types/simulation.ts) uses the consumed Simulation error set. CLI file/JSON/usage failures are ordinary exceptions, not domain codes.

## Dependencies

Data contracts only: [Atlas](../atlas/CONTRACT.md) (world projection), [Naming](../naming/CONTRACT.md) (names/types), [Simulation](../simulation/CONTRACT.md) (people/schedules), [Interior](../interior/CONTRACT.md) (the staffing roles a building publishes), Engine [investigation](../engine/src/game/investigation/CONTRACT.md) (v1.1) and [mission assets](../engine/src/mission-assets/CONTRACT.md) (v1.0). Models are injected through [ports](ports/llm.ts), streamed dialog through the OpenAI-compatible [chat shapes](ports/chat.ts), and [authoring ports](authoring/src/schema.ts); model text loses think blocks and template tokens through one [markup stage](ports/markup.ts). Ajv validates authoring and handoff schemas. Engine consumes this box.
