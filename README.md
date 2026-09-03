# urbe-quests

The story layer for a generated world. From one creation prompt it writes the story as a film script, translates that script into a main questline and its side quests as typed step graphs whose characters are resolved by type instead of by id, runs those graphs deterministically, and assembles the scoped context an NPC dialog prompt is allowed to see.

Only the script, the situations, the translation plan, questline drafting and memory summarization go through a language model. Every transition, gate and availability check is plain code, so quest state is reproducible from the flags and step history alone.

`AuthoringHarness` also exposes story writing and gameplay adaptation as separate agent calls. It uses a GBrain-style lightweight skill index, loads only the mechanics selected for the story, and rejects any questline whose places, mechanics, interaction targets, cast, prerequisites, branches, story beats, or endings do not match their contracts.

## Run

```
npm install
npm test           # contract tests, no model needed (fixture story, scripted agent)
npm run typecheck
npm run sample -- "create a dark cynical sci fi cyberpunk story" cyberpunk
npm run replay -- creation/samples/<name>/recording.json <name>
npm run materialize -- <recording.json> <profile> <city-blueprint.json> <npc-types.json> <questlines.json>
npm run bundle -- creation/samples/<name> <questlines.json>
```

The sample command runs one real pass against an OpenAI-compatible endpoint (`LLM_BASE_URL`, default `http://localhost:8080/v1`; `LLM_MODEL`, default the first model listed) and writes every stage's output under `creation/samples/<name>/`. The replay command rebuilds the same sample from a recorded run: the model's text and tool calls come from a JSON file and everything else is the real workflow, so a sample can be rebuilt and checked with no model present. Two fixture worlds, a fixture story and a stub population layer ship with the box, so everything else runs on the 2D plane with no other layer present.

`creation/samples/games/{small,medium,large}/questlines.json` are ready engine payloads. Each contains the main line first and three side jobs after it. They were materialized against their concrete city, and all three cast against the real simulation with `creation/fixtures/urbe-cyberpunk.npc-types.json`. Semantic bindings choose matching parcels and districts per city instead of relying on the same numeric parcel id across sizes.

## The creation workflow

1. **Script.** One text-only call, no tools: the whole story written the way a film is written. Character cards (role in the city, background, want, voice with example lines), then presentation, development, conflict and resolution, each made of passages that turn. Minimums (characters, passages per movement) are floors enforced in code with one repair round.
2. **Translation.** A text-only plan pass questions the script (which characters do what, where the story splits, what each part means, what the personalities are, where the artifacts enter) and writes a plan that closes with a manifest: the ids of every role, item, act, ending and step. An agent then commits exactly that manifest to the flow tool: create, then step by step, each step a kind (talk, listen, pickup, deliver, steal, goto, observe, work, assassinate), with the person who wants it and what it costs them. The manifest is the bound, so the build has a size before it starts and a round budget that follows from it.
3. **Situations.** In parallel, from the same script: related situations with their own small presentation, development, conflict and resolution. Each goes through the same translation and becomes a side quest.

Items are typed artifacts (a device, a weapon, a document, a key, a substance, a valuable, or information that is told rather than picked up). The translation decides where they enter: a step gives them, a later step needs them, and the runtime derives what the player holds.

## In

- **A named world and an NPC type set** from the naming pass.
- **A population port**: the consumed slice of a city population library. The real library satisfies it; `world/stub/StubSimulation.ts` stands in.
- **A creation prompt**, in the user's words.
- **LLM access, injected per stage**: `StagePorts` with a text port for the script, the situations and the plan, and a tool-loop port for the build, so each stage can run on a different model. The box never owns a client or a key.
- **At runtime**: player events (talked, arrived, picked up) and the current world time in minutes.

## Out

- **`QuestlineCreation.run(input)`**: the script, the main questline with its plan and cast, the situations, and one side questline per situation. `ScriptPass`, `SituationsPass`, `TranslationPlanner`, `QuestlineBuilder` and `QuestlineTranslator` run alone too.
- **`QuestlineRuntime`**: a pure state machine over the questline graph. Availability comes from the cast's real schedules, liveness and held items, evaluated on demand, and every step resolves the place to mark on a map; a dead NPC voids its quests.
- **`DialogContextService`**: a per-NPC fact store (background, persona, flag-gated quest knowledge, what this character currently wants from the player and why, how a finished questline ended for them) with scored memory and summarization tiers, emitted as cache-ordered context segments plus deflection guidance. A fact enters the prompt only through runtime state and the cast mapping; everything else gets deflected.

Each part carries its own contract: [story/CONTRACT.md](story/CONTRACT.md), [builder/CONTRACT.md](builder/CONTRACT.md), [creation/CONTRACT.md](creation/CONTRACT.md), [flow/CONTRACT.md](flow/CONTRACT.md), [dialog/CONTRACT.md](dialog/CONTRACT.md). The root `CONTRACT.md` is the surface and the closed error set.

The two-stage agent and skill resolver are documented in [authoring/CONTRACT.md](authoring/CONTRACT.md). Its 16 mechanics add `investigation`, `rescue`, `escort`, `access`, `hacking`, `sabotage`, and `transportation` to the original vocabulary. Each added interaction names the exact target, cast, place, prerequisites, completion event, and persisted consequence flag expected by the runtime.

Every prompt, boilerplate and few-shot set lives in its own `.md` file under the owning folder's `prompts/`, and output length is never capped.

## In the urbe family

It reads the named world and NPC types from [naming](../naming) and queries [simulation](../simulation) for its cast, then hands questlines and dialog context to [engine](../engine), which runs the game. The full picture lives in the parent workspace.
