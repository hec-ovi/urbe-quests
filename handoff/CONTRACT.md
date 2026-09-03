# CONTRACT: quests/handoff

Purpose: projects validated quest definitions and authored physical assets into the complete file set consumed by engine creation.

## In

- `new EngineHandoff().assemble(questlines, input)` ([EngineHandoff.ts](EngineHandoff.ts)). `questlines` is the exact set from [../creation/schema/questline-set.schema.json](../creation/schema/questline-set.schema.json).
- Optional `input` ([schema/handoff-input.schema.json](schema/handoff-input.schema.json)) carries engine investigation v1.1 requests, mission asset create requests, and quest item bindings.
- Investigation requests stay owned by engine investigation and must already satisfy its v1.1 scene-request schema. This box consumes and validates the exact binding slice in [schema/investigation-binding-slice.schema.json](schema/investigation-binding-slice.schema.json): quest, step, scene, evidence, information item, parcel or district, completion action, location, and evidence prerequisite graph.
- Mission asset create requests use the consumed v1.0 shape in [schema/mission-asset-request.schema.json](schema/mission-asset-request.schema.json). Requests remain separate from item bindings. The binding shape is exactly `{ questId, itemId, assetId }` ([schema/mission-item-bindings.schema.json](schema/mission-item-bindings.schema.json)).

## Out

`HandoffBundle` contains:

- `questlines`: definitions unchanged.
- `objectives` ([schema/objectives.schema.json](schema/objectives.schema.json)): one `{ questId, stepId, action }` per step in quest and definition order. `action` is the exact flow target, including every place, role, item, scene, evidence, access point, route, journey, passenger, cargo, mode, and completion flag field authored for that mechanic.
- `investigations`: requests unchanged after binding validation.
- `missionAssetRequests`: engine mission asset create requests unchanged after family, dimensions, material slot, interaction, clearance, and identity validation.
- `missionItemBindings`: explicit physical quest item associations.

The CLI writer emits `questlines.json`, `objectives.json`, `investigations.json`, `mission-assets.json`, `mission-item-bindings.json`, and `quest-bundle.json` ([schema/quest-bundle.schema.json](schema/quest-bundle.schema.json)). Empty catalogs are written as `[]`.

## Errors

- `E_HANDOFF`: malformed handoff input, an investigation does not exactly bind every authored investigation step and evidence item, evidence prerequisites disagree, a mission asset request is incompatible, or an item binding names an unknown, information, embedded-investigation, or missing asset.
- Questline validation errors pass through from flow.

## Invariants

- Every investigation step has exactly one v1.1 scene binding. Every scene evidence entry has exactly one quest step binding. Evidence prerequisites exist and are acyclic.
- Investigation placement and full mission asset assemblies remain outside this box. Engine investigation validates geometry, visibility, reachability, materials, media, and persistence.
- Investigation assets embedded in scene props are not also quest item bindings.
- Objective projection contains no animation or speech state. Engine derives action animation only after accepting the exact action. Live conversation owns speaker, listeners, TTS, STT, start, end, and interruption.
- Output order follows the input questline and step order. The same input produces byte-identical JSON files.

## Depends on

- ../flow questline and questline-set contracts.
- Engine investigation v1.1, through its scene-request contract.
- Engine mission-assets v1.0, through its create-request contract.
