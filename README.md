# urbe-quests 0.14.1

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

A cast member stands where the step says: the creation stage casts and pins each questline to the buildings its own people hold posts in, so the shipped bundle names the final places and play time reads them. A role the city cannot fill comes back as a blocked questline with its reason rather than a questline that disappears.

Node callers import `dist/index.js` (authoring, creation, dialog, handoff). Browser hosts import `dist/runtime.js` (definitions, runtime, cast, guidance, speech cues). Runtime completion requires an exact accepted event and available target. Inventory, objective location and route guidance are derived from state. Dialogue, on the Node entry, supplies scoped facts, whole or streamed replies that may propose companion actions, and serializable memory of completed exchanges; the host controls the visible person, their routine and whether any proposal happens.

## CLI

```sh
npm run author -- --world <named-world|atlas.json> --types <npc-types.json> --out <dir> [--prompt <text|@file>] [--parcels=<ids|@file>] [--mechanics <kind,kind,...>] [--templates <file>] [--handoff <file>] [--questlines <path>] [--profile <label>]
npm run replay -- creation/samples/urbe-small/recording.json <output-dir>
npm run materialize -- <recording.json> <profile> <atlas-or-named-world.json> <npc-types.json> <questlines.json> [<handoff-input.json>] [--parcels=<ids|@file>]
npm run bundle -- <sample-directory> [<questlines.json>] [<handoff-input.json>]
```

`author` streams text and tool calls from a live model without output caps, checks every input before it asks the model server anything, logs each stage to stderr, and writes the stages, `recording.json`, `meta.json` and a materialized bundle under `--out`. It takes `LLM_BASE_URL` (default `http://localhost:8080/v1`), `LLM_MODEL` (default first listed model), and optional `LLM_API_KEY`. `--mechanics` limits the story to the step kinds the host can play. A `--handoff` whose host capabilities declare scenery lets the story stage the scenes it has (a body where it fell, blood, what was left behind) and name investigation among its mechanics. Replay and materialize run without a model and replay a recording's mechanics and scenery. Named input retains its metadata; raw Atlas input receives deterministic fallback district labels. `--parcels` names the buildings the story may use (`p0,p3,p12`, or `@file` holding a JSON array or a plain list), so a host that opens part of the city gets a bundle that only names buildings the player can walk into.

Engine bundle **1.2** has [nine stable JSON files](handoff/CONTRACT.md#out), `scenery.json` among them. The host declares supported transportation modes and the scenery it stages. Quests validates semantic bindings; Engine validates physical placement and playability. [Creation](creation/CONTRACT.md) documents CLI defaults and partial side results.
