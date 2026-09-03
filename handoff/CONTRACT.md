# CONTRACT: quests/handoff

Purpose: projects validated quest definitions, physical assets, interaction anchors, and host capabilities into engine bundle v1.1.

## In

- `new EngineHandoff().assemble(questlines, input)` ([EngineHandoff.ts](EngineHandoff.ts)). `questlines` is the exact set from [../creation/schema/questline-set.schema.json](../creation/schema/questline-set.schema.json).
- `input` ([schema/handoff-input.schema.json](schema/handoff-input.schema.json)) carries engine investigation v1.1 requests, mission asset create requests, quest item bindings, fixed mechanic target bindings, and host capabilities. Every property is optional when its mechanic is absent.
- Investigation requests stay owned by engine investigation and must already satisfy its v1.1 scene-request schema. This box consumes and validates the exact binding slice in [schema/investigation-binding-slice.schema.json](schema/investigation-binding-slice.schema.json): quest, step, scene, evidence, information item, parcel or district, completion action, location, and evidence prerequisite graph.
- Mission asset create requests use the consumed v1.0 shape in [schema/mission-asset-request.schema.json](schema/mission-asset-request.schema.json). Requests remain separate from item bindings. The binding shape is exactly `{ questId, itemId, assetId }` ([schema/mission-item-bindings.schema.json](schema/mission-item-bindings.schema.json)).
- Fixed target bindings use [schema/mechanic-target-bindings.schema.json](schema/mechanic-target-bindings.schema.json). Rescue binds `{ questId, stepId, releaseTargetId, assetId, interactionId }`, where `interactionId` is `open` or `use`. Access uses `accessPointId` and `access`; hacking and sabotage use `targetId` and `hack` or `sabotage`. The referenced request must describe a fixed asset and declare that interaction anchor. See [fixtures/engine-public-transit.input.json](fixtures/engine-public-transit.input.json).
- Host capabilities use [schema/host-capabilities.schema.json](schema/host-capabilities.schema.json). `transportationModes` is the exact set the target gameplay host can complete. A host with only measured transit declares `{"transportationModes":["public-transit"]}`.

## Out

`HandoffBundle` contains:

- `questlines`: definitions unchanged.
- `objectives` ([schema/objectives.schema.json](schema/objectives.schema.json)): one `{ questId, stepId, action }` per step in quest and definition order. `action` is the exact flow target, including every place, role, item, scene, evidence, access point, route, journey, passenger, cargo, mode, and completion flag field authored for that mechanic.
- `investigations`: requests unchanged after binding validation.
- `mechanicTargetBindings`: exact fixed mechanic asset and anchor associations.
- `missionAssetRequests`: engine mission asset create requests unchanged after family, dimensions, material slot, interaction, clearance, and identity validation.
- `missionItemBindings`: explicit physical quest item associations.
- `hostCapabilities`: the validated host declaration used to admit transportation steps.

The CLI writer emits `questlines.json`, `objectives.json`, `investigations.json`, `mechanic-target-bindings.json`, `mission-assets.json`, `mission-item-bindings.json`, `host-capabilities.json`, and `quest-bundle.json` ([schema/quest-bundle.schema.json](schema/quest-bundle.schema.json)). Empty catalogs are `[]`; an omitted host declaration becomes `{"transportationModes":[]}`.

## Errors

- `E_HANDOFF`: malformed input; an investigation or fixed mechanic lacks an exact binding; evidence prerequisites disagree; a mission asset, item association, target identity, fixed-asset requirement, or interaction anchor is incompatible; or an authored transportation mode is absent from host capabilities.
- Questline validation errors pass through from flow.

## Invariants

- Every investigation step has exactly one v1.1 scene binding. Every scene evidence entry has exactly one quest step binding. Evidence prerequisites exist and are acyclic.
- Investigation placement and full mission asset assemblies remain outside this box. Engine investigation validates geometry, visibility, reachability, materials, media, and persistence.
- Investigation assets embedded in scene props are not also quest item bindings.
- Every rescue, access, hacking, and sabotage step has exactly one binding, unique by `(questId, stepId)`. Assassination, escort, investigation, and transportation do not use this mapping.
- Host transportation support is declared, never inferred. Authoring may use all five flow modes; a bundle admits only declared modes.
- Objective projection contains no animation or speech state. Engine derives action animation only after accepting the exact action. Live conversation owns speaker, listeners, TTS, STT, start, end, and interruption.
- Output order follows the input questline and step order. The same input produces byte-identical JSON files.

## Depends on

- ../flow questline and questline-set contracts.
- Engine investigation v1.1, through its scene-request contract.
- Engine mission-assets v1.0, through its create-request contract.
