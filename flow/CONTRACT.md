# CONTRACT: quests/flow

Purpose: deterministic questline state machine over a condition-gated DAG of typed steps; no LLM anywhere.

## In
- `QuestlineDefinition` ([schema.ts](schema.ts), exact JSON [schema/questline.schema.json](schema/questline.schema.json)): narrative-first questline document: premise, roles (bound by NPC type, never id), typed items (device, weapon, document, key, substance, valuable, information), flag-gated facts, acts, typed steps, each with its narrative and stake, the role that wants it, the items it gives and needs, predicates on edges, effects, endings, declared flags, entry steps.
- The closed step vocabulary is `goto`, `observe`, `talk`, `listen`, `pickup`, `deliver`, `steal`, `assassinate`, `work`, `investigation`, `rescue`, `escort`, `access`, `hacking`, `sabotage`, and `transportation`.
- Interaction targets are fully authored. Investigation names a scene, clue, information item, subject cast, and place. Rescue names the cast role and release target. Escort names the cast role, follow mode, route, and endpoints. Access names the access point and credential. Hacking and sabotage name their interaction target. Transportation names the journey, mode, endpoints, exact cast passengers, and cargo. Each names a declared completion flag which its step must set.
- `ResolvedCast` ([schema.ts](schema.ts)): roleId to npcId map from the builder.
- `SimulationPort` ([../world/types/simulation.ts](../world/types/simulation.ts)) for liveness, schedules and story-consequence flags.
- `PlayerEvent` ([schema/player-event.schema.json](schema/player-event.schema.json), TypeScript [events.ts](events.ts)) plus current time in simulation minutes. Mechanic completion events repeat the authored interaction ids, cast NPC ids, item ids, modes, and places needed to match one target without inference.
- Authored places are exact `parcelId`, `districtId`, `stationId`, or `stopId` identities. Arrival and delivery events repeat the same identity kind and id.

Mechanic completion events:

| Step | Event | Exact match fields |
| --- | --- | --- |
| `investigation` | `investigated` | `sceneId`, `evidenceId`, `place` |
| `rescue` | `released` | resolved `npcId`, `releaseTargetId`, `place` |
| `escort` | `escorted` | resolved `npcId`, `routeId`, `mode`, `from`, `to` |
| `access` | `accessed` | `accessPointId`, `credentialItemId`, `place` |
| `hacking` | `hacked` | `targetId`, `place` |
| `sabotage` | `sabotaged` | `targetId`, `place` |
| `transportation` | `transported` | `journeyId`, `mode`, `from`, `to`, resolved `passengerNpcIds`, `cargoItemIds` |

## Out
`QuestlineRuntime` ([QuestlineRuntime.ts](QuestlineRuntime.ts)):
- `status()`: active, completed, or stalled (every active step targets a dead NPC).
- `activeSteps()`, `flags()`, `ending()`, `inventory()` (items held now: taken or given by completed steps, minus delivered).
- `stepAvailability(stepId, timeMin)`: liveness, presence, held items and condition gate, computed on demand; reasons role_dead, not_present, off_duty, missing_item, condition.
- `windows(stepId)`: weekly availability windows derived from the target NPC's routine; undefined for schedule-free steps.
- `stepPlace(stepId, timeMin)`: where the step points, for a marker on the map: the parcel, district, station, or stop the target names, the parcel the item sits at, or the simulation's live place for the person it targets. Undefined when the simulation has no place to give.
- `stepGuidance(stepId, timeMin)` ([schema/step-guidance.schema.json](schema/step-guidance.schema.json)): route-ready parcel, station, or stop destination. District areas, street edges, moving routes, and unavailable targets return a closed reason instead of an invalid route request. The host supplies current feet as the route origin.
- `advance(event, timeMin)`: completes matching available steps, applies effects (quest flags, simulation flags), activates edges (parallel or exclusive branching), reports an ending on terminal steps. Talk, listen, steal, rescue, escort, and transportation with cast passengers enforce liveness and available presence at advance time; a kill event records the death in the simulation.
- `serialize()` ([schema/questline-state.schema.json](schema/questline-state.schema.json)) / `QuestlineRuntime.restore(...)`. Restore accepts untrusted JSON only when step history, active frontier, ending, and replayed flags agree with the definition.

`FlowValidator` ([validate.ts](validate.ts)): structural validation (ids, references, declared flags, DAG, reachability, terminal endings, role usage, item rules: information is never a pickup, deliver or steal target; a pickup item is placed at a parcel). Investigation stages must grant their declared information evidence. Access must need its key, information, or device credential. Transportation must need all physical cargo. Escort and transportation endpoints must differ. Every interaction mechanic must set its declared completion flag.

`QuestlineSetValidator` ([QuestlineSet.ts](QuestlineSet.ts)): validates the engine payload as one main definition followed by side definitions, with unique questline ids. Its exact JSON shape is [../creation/schema/questline-set.schema.json](../creation/schema/questline-set.schema.json).

## Errors
`QuestError` codes used here: `E_INVALID_FLOW` (definition or saved state), `E_CAST` (missing cast entry), `E_UNKNOWN_ID`, `E_WRONG_STATE` (event matches no active step, or questline ended), `E_UNAVAILABLE` (matching step gated off). See [../errors.ts](../errors.ts).

## Invariants
- Same definition, cast, event order and times: identical state. No wall clock, no randomness, no I/O.
- Completed evidence and interaction flags survive serialization, so revisiting cannot duplicate a reward or reopen a finished stage.
- An exclusive branch may have one unconditional fallback only as its last edge, so a fallback cannot make a later outcome unreachable.
- A dead NPC never satisfies presence or duty checks; availability and inventory are never stored, always derived.
- Flags used anywhere must be declared in the definition.
- Saved state cannot create steps, branches, flags, or endings that the completed history did not produce.

## Depends on
- ../world (types, SimulationPort)
