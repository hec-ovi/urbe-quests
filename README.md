# urbe-quests

Story authoring and deterministic quest flow for generated cities.

One workflow writes a film-style story, plans a main quest and related situations, then builds typed quest graphs. A second public workflow keeps story writing and gameplay adaptation as separate agent calls. Its GBrain-style resolver loads a small skill index first and only the selected mechanic skills afterward.

Quest state contains completed steps, active steps, flags, and an ending. Availability, inventory, NPC location, and route guidance are derived from the definition, cast, simulation, and current time. Untrusted saves are checked against the graph before restoration.

## Run

```sh
npm install
npm test
npm run typecheck
npm run build

npm run sample -- "create a dark cynical sci fi cyberpunk story" cyberpunk
npm run replay -- creation/samples/<name>/recording.json <name>
npm run materialize -- <recording.json> <profile> <atlas-or-named-world.json> <npc-types.json> <questlines.json> [<handoff-input.json>]
npm run bundle -- creation/samples/<name> [<questlines.json>] [<handoff-input.json>]
```

The live sample uses an OpenAI-compatible endpoint through `LLM_BASE_URL`, `LLM_MODEL`, and optional `LLM_API_KEY`. Replay uses recorded text and tool calls, so it needs no model. The local fixtures and stub simulation keep the box runnable without the other repositories.

## Authoring

The closed mechanic set is:

`goto`, `observe`, `talk`, `listen`, `pickup`, `deliver`, `steal`, `assassinate`, `work`, `investigation`, `rescue`, `escort`, `access`, `hacking`, `sabotage`, `transportation`.

Every step carries its narrative reason, player hint, stake, prerequisites, effects, transitions, and exact mechanic target. Roles bind NPC types, not instance ids. Places bind one known parcel, district, station, or stop. The authoring and builder boundaries reject unknown roles, items, interactions, places, branches, flags, and endings.

The authoring vocabulary supports five transportation modes. A runnable engine bundle accepts only modes declared by its host capability profile. The current Engine fixture declares `public-transit`.

`AuthoringHarness.writeStory` returns story only. `AuthoringHarness.adaptGameplay` receives that completed story unchanged, selects compatible mechanic skills, and returns a questline with cause-effect traces. Full inputs and outputs are in [authoring/CONTRACT.md](authoring/CONTRACT.md).

## Runtime

`QuestlineRuntime` advances only exact completion events. It exposes active steps, inventory, availability, schedule windows, the current objective place, and route-ready guidance. Parcel, station, and stop targets become route destinations; district areas, street edges, moving routes, and unavailable targets return a closed reason.

The browser-safe entry is `runtime.ts`. The full entry is `index.ts`.

## Engine handoff

Materialize and bundle write this file set beside the requested questlines path:

- `questlines.json`: main quest first, then side quests.
- `objectives.json`: ordered `{ questId, stepId, action }` projections. `action` is the exact typed target.
- `investigations.json`: engine investigation v1.1 scene requests.
- `mechanic-target-bindings.json`: rescue, access, hacking, and sabotage target ids mapped to fixed mission assets and exact interaction anchors.
- `mission-assets.json`: engine mission asset v1.0 create requests.
- `mission-item-bindings.json`: explicit `{ questId, itemId, assetId }` associations.
- `host-capabilities.json`: transportation modes the target host can run.
- `quest-bundle.json`: filenames and counts.

The handoff input uses [handoff/schema/handoff-input.schema.json](handoff/schema/handoff-input.schema.json); [handoff/fixtures/engine-public-transit.input.json](handoff/fixtures/engine-public-transit.input.json) is a complete fixed-target example. Missing catalogs are written as empty arrays. An investigation or fixed mechanic step without its exact binding fails. A transportation step whose mode is absent from the host profile also fails.

Animation begins only after the engine accepts an exact quest action. Speaker, listeners, TTS, STT, and conversation start, end, or interruption come from the live conversation. They are not persisted in quest definitions.

## Contracts

Start with [docs/INDEX.md](docs/INDEX.md) and [CONTRACT.md](CONTRACT.md). Each inner box has its own contract. Ready quest sets for small, medium, and large fixture cities live under `creation/samples/games/`.
