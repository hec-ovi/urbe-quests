# Quests 0.9.0

Writes stories through injected agents, adapts them into typed quests, runs their rules in code, and prepares Engine handoffs and scoped NPC dialogue.

## Calls and schemas

The Node library entry is [index.ts](index.ts), compiled to `dist/index.js`; browser hosts use [runtime.ts](runtime.ts), compiled to `dist/runtime.js`. No HTTP server is required.

| Call | Input | Output |
| --- | --- | --- |
| `AuthoringHarness.writeStory(input, agent)` | [Story request](authoring/schema/story-request.schema.json), [agent port](authoring/src/schema.ts) | [Story](authoring/schema/story-output.schema.json), narrative only |
| `AuthoringHarness.adaptGameplay(input, agent)` | [Adaptation request](authoring/schema/adaptation-request.schema.json), [agent port](authoring/src/schema.ts) | [Definition and narrative trace](authoring/schema/adaptation-output.schema.json) |
| `AuthoringHarness.skillIndex()`, `route(message)`, `resolveSkills(names)` | [Resolver queries](authoring/CONTRACT.md#inputs) | [Skill index and selected bodies](authoring/CONTRACT.md#outputs) |
| `QuestlineCreation.run(input)` | [CreationInput](creation/schema.ts), prompt, named world/types, Simulation and per-stage model ports | [CreationResult](creation/schema.ts), script, situations, main and side translations |
| `ScriptPass.run`, `SituationsPass.run`, `QuestlineTranslator.translate` | [Story](story/CONTRACT.md), [translation](builder/CONTRACT.md) | [Story text](story/schema.ts), [plan, definition and feasibility cast](builder/schema.ts) |
| `CastResolver.cast(definition, timeMin, options?)` | [Definition](flow/schema/questline.schema.json), [SimulationPort](world/types/simulation.ts), optional `StoryVenues(world, types)` and `{taken, characters}` | [CastResult](builder/CastResolver.ts): `definition` pinned to its cast, `cast` role to NPC IDs, `blocked` when a role cannot be filled |
| `QuestlineRuntime`, `advance`, `restore` | [Definition](flow/schema/questline.schema.json), cast, Simulation, [event](flow/schema/player-event.schema.json), time, [saved state](flow/schema/questline-state.schema.json) | [State and advance result](flow/QuestlineRuntime.ts), [availability](flow/availability.ts), [guidance](flow/schema/step-guidance.schema.json) |
| `EngineHandoff.assemble(questlines, input?)` | [Quest set](creation/schema/questline-set.schema.json), [bindings and capabilities](handoff/schema/handoff-input.schema.json) | [HandoffBundle](handoff/schema.ts), definitions, objectives, investigations, assets and bindings |
| `DialogContextService`, `Converse.reply` | [Context inputs](dialog/DialogContextService.ts), [reply input](dialog/Converse.ts), injected model | [Scoped segments and memory](dialog/schema.ts), reply string (async) |
| `WorldContextNormalizer.normalize`, fixture loaders | [World and type projections](world/types/named-world.ts), [world calls](world/CONTRACT.md) | [Normalized context](world/WorldContextNormalizer.ts), standalone world/story fixtures |

Creation warnings report failed side translations or unusable situations. Main/script failures reject the run. `CreationResult` has no completion marker or retained side-failure record. Naming is supplied by callers; its integration is proposed in [issues](docs/ISSUES.md).

Engine receives main definition first, then side definitions, without creation-time cast IDs. The game casts against its own Simulation, through `CastResolver`, which queries each role at the hour its own steps name. The CLI writes bundle **1.1** with the [eight filenames and counts](handoff/schema/quest-bundle.schema.json). Bundle 1.1 keeps its shape: an authored place gains `name` and a step gains an optional `window`, both additive. Saved state is unchanged; bundle version and package version are separate.

Hosts pass `new CastResolver(sim, new StoryVenues(world, types))`: with the world it looks past the pinned venue to the other buildings that publish the post, which is what keeps every character a different person, and it can move a step onto the building its character really works in. `options.taken` and `options.characters` carry both across a questline set.

A cast member stands where the step says. `cast(definition, timeMin, options?)` answers `{ definition, cast, blocked? }`: `definition` is the questline to play, with every step that meets a role moved onto the parcel that role's person works at and the place names moved with it; `cast` is `roleId -> npcId`; `blocked` is `{ roleId, npcType, reason }` when nobody can play a role. The host plays the returned `definition`, not the one it carried in, and shows a blocked questline with its `reason` instead of dropping it. Without `StoryVenues` the roles still resolve at the story's hour and nothing moves.

A quest place is a named place at a real hour. Every authored place is `{ <identity>, name }`: the world's own name when Naming gave it one, else the word for that kind of building ([venue table](world/venues.ts)). A step whose text names an hour carries a `window` the runtime gates on, so a hint never promises a time nothing checks. Story venues are the buildings that publish a post for the character ([Interior staffing](../interior/CONTRACT.md)), which never includes a building published for residents and guests alone, and the simulation is asked whether it hires at a parcel before anyone is cast there, so one building it staffs nobody in costs a query and not the questline. One person plays one character across a questline set.

Time is simulation minutes since Monday 00:00. Creative calls use separate contexts; graph transitions, gates, inventory and save validation use code. Quests checks semantic targets and submitted bindings. Engine owns measured placement, reach, visibility, rendering and save coordination. A passed semantic handoff alone does not establish 3D playability.

## Errors

[QuestError](errors.ts), `{code, message, detail?}`: `E_INVALID_FLOW` (definition/save), `E_UNKNOWN_ID` (missing identity), `E_WRONG_STATE` (event/state), `E_UNAVAILABLE` (gated action), `E_CAST` (cast resolution), `E_LLM` (unusable text/build), `E_HANDOFF` (bindings/assets/capabilities).

[AuthoringError](authoring/schema/authoring-error.schema.json), `{code, message, details}`: `E_AUTHORING_INPUT`, `E_AUTHORING_OUTPUT`, `E_SKILL_CONTRACT`, `E_UNKNOWN_SKILL`, `E_UNSUPPORTED_MECHANIC`, `E_MECHANIC_SELECTION`, `E_WORLD_TARGET`, `E_CAUSE_EFFECT`, `E_INVALID_FLOW`. Meanings: [authoring errors](authoring/CONTRACT.md#errors).

These are closed domain sets. Injected provider/Simulation exceptions pass through, except cast reservation and exhausted vendor matches, which become `E_CAST` while a questline is built and its `blocked` reason once it is published. Standalone [SimulationError](world/types/simulation.ts) uses the consumed Simulation error set. CLI file/JSON/usage failures are ordinary exceptions, not domain codes.

## Dependencies

Data contracts only: [Atlas](../atlas/CONTRACT.md) (world projection), [Naming](../naming/CONTRACT.md) (names/types), [Simulation](../simulation/CONTRACT.md) (people/schedules), [Interior](../interior/CONTRACT.md) (the staffing roles a building publishes), Engine [investigation](../engine/src/game/investigation/CONTRACT.md) (v1.1) and [mission assets](../engine/src/mission-assets/CONTRACT.md) (v1.0). Models are injected through [ports](ports/llm.ts) and [authoring ports](authoring/src/schema.ts). Ajv validates authoring and handoff schemas. Engine consumes this box.
