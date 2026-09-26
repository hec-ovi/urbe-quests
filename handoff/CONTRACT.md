# CONTRACT: quests/handoff

Purpose: projects validated quest definitions, physical assets, interaction anchors, staged scenes and host capabilities into engine bundle v1.2.

## In

- `new EngineHandoff().assemble(questlines, input)` ([EngineHandoff.ts](EngineHandoff.ts)). `questlines` is the exact set from [../creation/schema/questline-set.schema.json](../creation/schema/questline-set.schema.json).
- `input` ([schema/handoff-input.schema.json](schema/handoff-input.schema.json)) carries engine investigation requests, mission asset create requests, quest item bindings, fixed mechanic target bindings, scene specs and host capabilities. Every property is optional when its mechanic is absent. The complete consumed input is schema-validated before semantic audits.
- Investigation requests stay owned by engine investigation and must already satisfy its scene-request schemas. This box consumes and validates the exact binding slice in [schema/investigation-binding-slice.schema.json](schema/investigation-binding-slice.schema.json): quest, step, scene, evidence, information item, parcel or district, completion action and evidence prerequisite graph, and then either a version 1.1 measured location, or a version 1.2 link to the scenery scene it stands over (`scenery.sceneId`) with one element of that scene per evidence (`evidenceVisuals`).
- Scene specs stay owned by Engine scenery ([scene spec 1.0](../../engine/src/game/scenery/CONTRACT.md)). This box consumes the slice in [schema/scenery-binding-slice.schema.json](schema/scenery-binding-slice.schema.json): scene and quest ids, the place kind and building, each actor's identity and pose, each prop's kind, asset and neighbour, the lighting preset, the `activeWhen` and `retireWhen` conditions and the linked investigation. Its `$defs` mirror Engine's scenery vocabulary.
- Mission asset create requests use the consumed v1.0 shape in [schema/mission-asset-request.schema.json](schema/mission-asset-request.schema.json). Requests remain separate from item bindings. The binding shape is exactly `{ questId, itemId, assetId }` ([schema/mission-item-bindings.schema.json](schema/mission-item-bindings.schema.json)).
- Fixed target bindings use [schema/mechanic-target-bindings.schema.json](schema/mechanic-target-bindings.schema.json). Rescue binds `{ questId, stepId, releaseTargetId, assetId, interactionId }`, where `interactionId` is `open` or `use`. Access uses `accessPointId` and `access`; hacking and sabotage use `targetId` and `hack` or `sabotage`. The referenced request must describe a fixed asset and declare that interaction anchor. See [fixtures/engine-public-transit.input.json](fixtures/engine-public-transit.input.json).
- Host capabilities use [schema/host-capabilities.schema.json](schema/host-capabilities.schema.json). `transportationModes` is the exact set the target gameplay host can complete. A host with only measured transit declares `{"transportationModes":["public-transit"]}`. `scenery` is what the host stages, in Engine's capabilities shape: place kinds, poses, prop kinds, lighting presets and the actor and prop limits.

### Stagings

A questline stages a scene in a closed vocabulary ([SceneStagings.ts](SceneStagings.ts)): `{ sceneId, purpose, description, stagedBy, stagedWhen, place: { kind, atStepId, roomKinds? }, actors, props, evidence?, clearedBy?, lasting? }`. An actor is `{ actorId, role, pose, roleId? | gender?, zone?, nearActorId? }` and a prop `{ propId, kind, itemId?, nearActorId? | nearPropId? }`.

- `stagingProblems(staging)` names what is wrong inside one staging: repeated element ids, an actor with both or neither of `roleId` and `gender`, a quest character in a living pose, a neighbour not listed before its element, a mission asset without the item it shows or a mark with one, a clue shown twice or on no element, and a scene both cleared by a step and lasting.
- `stagedScenery(definition, stagings)` returns `{ scenery, investigations, assets }`. Each staging becomes one scene spec `<questId>.<sceneId>` in the building its `atStepId` step happens in (where it meets its people, goes to or ends at, or where its item lies), on the ground floor: a questline does not know how tall its buildings are. A room or story slot without `roomKinds` may be any room. The scene stands once `stagedBy` is active (`stagedWhen: active`) or done, and a quest character in it only once the simulation holds them dead (`roleDead`). It clears after `clearedBy`, never when `lasting`, else when the questline ends. Seeds and appearance seeds hash the questline, scene and actor ids. The investigation steps naming its `sceneId` become one 1.2 investigation over it, and the scene must stand before each of them is done (staged by an earlier step, or by the clue step while it is active), since a clue is found only while its scene stands: the step's evidence item gives the evidence label and description, each clue is inspected on the element `evidence` names, and a clue on a mission asset is portable and read before it is taken. `assets` lists each mission-asset prop with its asset id (`sceneAssetId`) and the quest item it shows; the caller requests that asset.
- `unstagedClues(definition, stagings)` lists the investigation steps no staging shows.
- `SCENERY_VOCABULARY` is everything a host can declare; `SCENE_PURPOSES`, `SCENE_ROLES`, `SCENE_ZONES`, `ROOM_KINDS` and `CORPSE_POSES` are the rest of the vocabulary.

## Out

`HandoffBundle` contains:

- `questlines`: definitions unchanged.
- `objectives` ([schema/objectives.schema.json](schema/objectives.schema.json)): one `{ questId, stepId, action }` per step in quest and definition order. `action` is the exact flow target, including every place, role, item, scene, evidence, access point, route, journey, passenger, cargo, mode, and completion flag field authored for that mechanic. A place is `{ <identity>, name }`; the hour a step is gated on stays on the step, in `questlines`.
- `investigations`: requests unchanged after binding validation, version 1.1 or 1.2.
- `mechanicTargetBindings`: exact fixed mechanic asset and anchor associations.
- `missionAssetRequests`: engine mission asset create requests unchanged after family, dimensions, material slot and kind, interaction, clearance, and identity validation. Dimensions follow engine mission-assets' family rules, except that a document or data drive is at least 12.5 mm high: the creator's document clip and drive ridge are 8% of the height and no primitive is under 1 mm, so anything thinner fails in the game. A material's kind is the middle part of its key (`cyberpunk/metal/mid` is metal); a family's surface and accent take the kinds engine mission-assets allows it, and grip, seal, display and upholstery take their own. Material keys and variants resolve in Engine's catalog, not here.
- `missionItemBindings`: explicit physical quest item associations.
- `scenery`: scene specs unchanged after validation.
- `hostCapabilities`: the validated host declaration used to admit transportation steps and scenes.

The CLI writer emits the questlines file at the given path plus `objectives.json`, `investigations.json`, `mechanic-target-bindings.json`, `mission-assets.json`, `mission-item-bindings.json`, `scenery.json`, `host-capabilities.json`, and `quest-bundle.json` ([schema/quest-bundle.schema.json](schema/quest-bundle.schema.json), version 1.2). The manifest records the questlines filename. Empty catalogs are `[]`; an omitted host declaration becomes `{"transportationModes":[]}`.

## Errors

- `E_HANDOFF`: malformed input; an investigation or fixed mechanic lacks an exact binding; evidence prerequisites disagree; a mission asset, item association, target identity, fixed-asset requirement, or interaction anchor is incompatible; an authored transportation mode is absent from host capabilities; a scene names what its questline lacks, stands outside its questline's buildings, holds a quest character its story never kills or before the kill, names an asset nobody requests or an investigation that does not link it back, or asks for scenery the host does not declare; a staging cannot become a scene spec.
- Questline validation errors pass through from flow.

## Invariants

- Every investigation step has exactly one scene binding. Every scene evidence entry has exactly one quest step binding. Evidence prerequisites exist and are acyclic. A 1.2 investigation stands in its scenery scene's building and shows each evidence on an element of its own.
- Every pickup step has an exact quest/item binding to a portable mission asset declaring a `take` interaction. An empty asset catalog cannot publish a quest that needs a physical pickup.
- Investigation placement and full mission asset assemblies remain outside this box. Engine investigation validates geometry, visibility, reachability, materials, media, and persistence; Engine scenery measures and stands scenes.
- Investigation assets embedded in scene props are not also quest item bindings.
- Every rescue, access, hacking, and sabotage step has exactly one binding, unique by `(questId, stepId)`. Assassination, escort, investigation, and transportation do not use this mapping.
- Host transportation support and scenery are declared, never inferred. Authoring may use all five flow modes; a bundle admits only declared modes, and carries a scene only for a host that declares scenery, within its lists and limits.
- A scene names only its own questline's steps, flags, roles and buildings. A quest character stands in it only as a corpse, and its `activeWhen` requires the step that kills them or `roleDead`. A scene and its 1.2 investigation name each other.
- Objective projection contains no conversation or animation state. Engine starts animation only after accepting the exact action and owns completion, interruption, routine resumption, conversation open and close, and speaker and listener gestures.
- Output order follows the input questline and step order. The same input produces byte-identical JSON files.

## Depends on

- ../flow questline and questline-set contracts.
- Ajv, schema validation at the input boundary.
- Engine investigation v1.1 and v1.2, through its scene-request contracts.
- Engine scenery 1.0, through its scene spec and capabilities contracts.
- Engine mission-assets v1.0, through its create-request contract.
