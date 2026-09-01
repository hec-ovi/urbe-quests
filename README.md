# urbe-quests

The story layer for a generated world. It writes the main line and the side premises, builds each questline as a typed step graph whose characters are resolved by type instead of by id, runs those graphs deterministically, and assembles the scoped context an NPC dialog prompt is allowed to see.

Only story text, questline drafting and memory summarization go through a language model. Every transition, gate and availability check is plain code, so quest state is reproducible from the flags alone.

## Run

```
npm install
npm test           # contract tests, including one against the real population library
npm run typecheck
```

Two fixture worlds (`world/fixtures/`) and a stub population layer ship with the box, so everything runs on the 2D plane with no other layer present.

## In

- **A named world and an NPC type set** from the naming pass.
- **A population port**: the consumed slice of a city population library (`getNPCVendor`, `reserveNPC`, `findNPCs`, `getNPC`, `behaviorAt`, `interrupt`, `resume`, `applyFlag`). The real library satisfies it; `world/stub/StubSimulation.ts` stands in.
- **A world description prompt** for the story pass.
- **LLM access, injected**: an `LLMPort` for text completion and an `AgentPort` for a tool loop. The box never owns a client or a key.
- **At runtime**: player events (talked, arrived, picked up) and the current world time in minutes.

## Out

- **`runStoryPass(input)`**: a story document with a main line (introduction, development, conflict, resolution) plus side quest premises. One backbone call, context isolated from geometry.
- **`buildQuestline(premise, deps)`**: an agent-driven build over create, step and branch tools, with era-fit step scenario catalogs. Roles resolve by type through the population port and the cast is reserved with persona overlays, so the builder never places a character by id or by coordinate.
- **`QuestlineRuntime`**: a pure state machine over the questline graph. Availability comes from the cast's real schedules and liveness, evaluated on demand; flags are the only persisted state; a dead NPC voids its quests.
- **`DialogContextService`**: a per-NPC fact store (background, persona, flag-gated quest knowledge) with scored memory and summarization tiers, emitted as cache-ordered context segments plus deflection guidance. A fact enters the prompt only from population background, a persona overlay, an unlocked quest grant or a recorded interaction. Everything else gets deflected, so an NPC cannot answer what it was never told.

Each part carries its own contract: [story/CONTRACT.md](story/CONTRACT.md), [builder/CONTRACT.md](builder/CONTRACT.md), [flow/CONTRACT.md](flow/CONTRACT.md), [dialog/CONTRACT.md](dialog/CONTRACT.md). The root `CONTRACT.md` is the surface and the closed error set, which covers invalid flows, unresolvable cast and unusable model output after repair.

Every prompt, boilerplate and few-shot set lives in its own `.md` file under the owning folder's `prompts/`, and output length is never capped.

## In the urbe family

It reads the named world and NPC types from [urbe-namer](../urbe-namer) and queries [urbe-population](../urbe-population) for its cast, then hands questlines and dialog context to [urbe-engine](../urbe-engine), which runs the conversation. The full picture lives in [urbe](../urbe).
