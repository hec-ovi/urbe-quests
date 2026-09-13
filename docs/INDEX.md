# Quests map

[Public contract](../CONTRACT.md), [caller skill](../SKILL.md), [integration proposals](ISSUES.md).

| Folder | Purpose | Depends on | Input / output schemas |
| --- | --- | --- | --- |
| [authoring](../authoring/CONTRACT.md) | Story agent, mechanic resolver and gameplay agent | world, flow, injected agents | [requests and responses](../authoring/src/schema.ts), [JSON schemas](../authoring/schema/) |
| [world](../world/CONTRACT.md) | World projections and standalone Simulation | Atlas, Naming, Simulation contracts | [world/types](../world/types/named-world.ts), [Simulation](../world/types/simulation.ts) |
| [story](../story/CONTRACT.md) | Text script and side situations | world, ports | [requests](../story/CONTRACT.md#in), [results](../story/schema.ts) |
| [builder](../builder/CONTRACT.md) | Plans, tool builds and type-based casting | flow, story, world, ports | [requests](../builder/CONTRACT.md#in), [results](../builder/schema.ts) |
| [creation](../creation/CONTRACT.md) | Main/side orchestration and CLI file writers | story, builder, world, ports, handoff | [creation](../creation/schema.ts), [quest set](../creation/schema/questline-set.schema.json) |
| [flow](../flow/CONTRACT.md) | Validates definitions and runs accepted events | world | [definition](../flow/schema/questline.schema.json), [event](../flow/schema/player-event.schema.json), [save](../flow/schema/questline-state.schema.json), [guidance](../flow/schema/step-guidance.schema.json) |
| [handoff](../handoff/CONTRACT.md) | Checks semantic asset/interaction bindings | flow, Engine investigation/mission-asset contracts | [input](../handoff/schema/handoff-input.schema.json), [bundle](../handoff/schema.ts), [manifest](../handoff/schema/quest-bundle.schema.json) |
| [dialog](../dialog/CONTRACT.md) | Scoped context, replies and memory | world, flow, ports | [inputs](../dialog/CONTRACT.md#in), [context/memory](../dialog/schema.ts) |
| ports | Injected text and tool calls | none | [requests/replies](../ports/llm.ts) |

`index.ts` is the Node facade; `runtime.ts` is the browser facade. Prompt Markdown lives beside its owner; `prompts.ts` loads it. CLI output is local generated data. Raw requirements and verification records under `docs/` are ignored.
