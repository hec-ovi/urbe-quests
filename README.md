# urbe-quests 0.9.0

Writes a story from city context, adapts it to typed gameplay, and runs quest rules in code. Models are injected per creative stage. Engine receives definitions, objectives, asset requests and exact interaction bindings.

```sh
npm install
npm test
npm run typecheck
npm run build
```

Start with [SKILL.md](SKILL.md) for a copyable library call, [CONTRACT.md](CONTRACT.md) for the API and [docs/INDEX.md](docs/INDEX.md) for individual responsibilities.

`AuthoringHarness.writeStory` writes narrative only. `adaptGameplay` receives the completed story, named places and NPC types, selects mechanic skills, and checks the resulting definition and story trace. `QuestlineCreation.run` provides the text script, plan and tool-build workflow with main and side quests. Both paths remain public; canonical orchestration and Naming integration are [open proposals](docs/ISSUES.md).

A quest place is a named place at a real hour: every authored place carries the venue's name (the world's own name, else the word for that kind of building), a step whose text names an hour carries the window the runtime checks, story venues are the buildings that publish a post for the character, and the cast is queried at the hour the story meets them, one person per character.

A cast member stands where the step says: casting answers with the questline pinned to the buildings its people work in, and a role the city cannot fill comes back as a blocked questline with its reason rather than a questline that disappears.

Node callers import `dist/index.js` (authoring, creation, dialog, handoff). Browser hosts import `dist/runtime.js` (definitions, runtime, cast, guidance). Runtime completion requires an exact accepted event and available target. Inventory, objective location and route guidance are derived from state. Dialogue, on the Node entry, supplies scoped facts, text replies and serializable memory; the host controls the visible person and their routine.

## CLI

```sh
npm run sample -- "A debt threatens a night-shift worker" local-story
npm run replay -- creation/samples/urbe-small/recording.json local-replay
npm run materialize -- <recording.json> <profile> <atlas-or-named-world.json> <npc-types.json> <questlines.json> [<handoff-input.json>]
npm run bundle -- <sample-directory> [<questlines.json>] [<handoff-input.json>]
```

The live sample streams text and tool calls without output caps. It takes `LLM_BASE_URL` (default `http://localhost:8080/v1`), `LLM_MODEL` (default first listed model), and optional `LLM_API_KEY`. Replay and materialize run without a model. Named input retains its metadata; raw Atlas input receives deterministic fallback district labels.

Engine bundle **1.1** has [eight stable JSON files](handoff/CONTRACT.md#out). Place names and step windows are additive fields inside it. The host declares supported transportation modes. Quests validates semantic bindings; Engine validates physical placement and playability. [Creation](creation/CONTRACT.md) documents CLI defaults and partial side results.
