# Quests map 0.14.1

[Public contract](../CONTRACT.md), [caller skill](../SKILL.md), [integration proposals](ISSUES.md).

| Folder | Purpose | Depends on | Input / output schemas |
| --- | --- | --- | --- |
| [authoring](../authoring/CONTRACT.md) | Story agent, mechanic resolver and gameplay agent | world, flow, injected agents | [requests and responses](../authoring/src/schema.ts), [JSON schemas](../authoring/schema/) |
| [world](../world/CONTRACT.md) | World projections, venue names and staffing, standalone Simulation | Atlas, Naming, Simulation, Interior contracts | [world/types](../world/types/named-world.ts), [venues](../world/venues.ts), [Simulation](../world/types/simulation.ts) |
| [story](../story/CONTRACT.md) | Text script and side situations | world, ports | [requests](../story/CONTRACT.md#in), [results](../story/schema.ts) |
| [builder](../builder/CONTRACT.md) | Plans and tool builds over the playable step kinds, staged scenes in the host's scenery vocabulary, story venues and casting at the story's hour, pinned to where the cast works | flow, story, world, ports, handoff | [requests](../builder/CONTRACT.md#in), [results](../builder/schema.ts) |
| [creation](../creation/CONTRACT.md) | Main/side orchestration; live authoring into a replayable recording and a bundle; replay, materialize and bundle CLIs | story, builder, world, ports, handoff | [creation](../creation/schema.ts), [quest set](../creation/schema/questline-set.schema.json), [recording](../creation/samples/RecordedPorts.ts), [item templates](../creation/samples/mission-item-templates.json), [scene templates](../creation/samples/SceneTemplates.ts) |
| [flow](../flow/CONTRACT.md) | Validates definitions, runs accepted events and names the speech cues | world | [definition](../flow/schema/questline.schema.json), [event](../flow/schema/player-event.schema.json), [save](../flow/schema/questline-state.schema.json), [guidance](../flow/schema/step-guidance.schema.json), [cues](../flow/cues.ts) |
| [handoff](../handoff/CONTRACT.md) | Checks semantic asset/interaction bindings and staged scenes; turns stagings into scene specs and linked investigations | flow, Engine investigation/scenery/mission-asset contracts | [input](../handoff/schema/handoff-input.schema.json), [scene slice](../handoff/schema/scenery-binding-slice.schema.json), [bundle](../handoff/schema.ts), [manifest](../handoff/schema/quest-bundle.schema.json) |
| [dialog](../dialog/CONTRACT.md) | Scoped context, guided places, whole or streamed replies with companion offers, and memory | world, flow, ports | [inputs](../dialog/CONTRACT.md#in), [context/memory](../dialog/schema.ts), [events](../dialog/Converse.ts) |
| ports | Injected text, tool calls, streamed chat and model markup | none | [requests/replies](../ports/llm.ts), [chat stream](../ports/chat.ts), [markup](../ports/markup.ts) |

`index.ts` is the Node facade; `runtime.ts` is the browser facade. Prompt Markdown lives beside its owner; `prompts.ts` loads it. CLI output is local generated data. Raw requirements and verification records under `docs/` are ignored.
