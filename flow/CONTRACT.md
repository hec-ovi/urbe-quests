# CONTRACT: quests/flow

Purpose: deterministic questline state machine over a condition-gated DAG of typed steps; no LLM anywhere.

## In
- `QuestlineDefinition` ([schema.ts](schema.ts), exact JSON [schema/questline.schema.json](schema/questline.schema.json)): narrative-first questline document: premise, roles (bound by NPC type, never id), typed items (device, weapon, document, key, substance, valuable, information), flag-gated facts, acts, typed steps, each with its narrative and stake, the role that wants it, the items it gives and needs, predicates on edges, effects, endings, declared flags, entry steps.
- The closed step vocabulary is `goto`, `observe`, `talk`, `listen`, `pickup`, `deliver`, `steal`, `assassinate`, `work`, `investigation`, `rescue`, `escort`, `access`, `hacking`, `sabotage`, and `transportation`, exported in that catalog order as `STEP_KINDS` ([schema.ts](schema.ts)) on both entries.
- Interaction targets are fully authored. Investigation names a scene, clue, information item, subject cast, and place. Rescue names the cast role and release target. Escort names the cast role, follow mode, route, and endpoints. Access names the access point and credential. Hacking and sabotage name their interaction target. Transportation names the journey, mode, endpoints, exact cast passengers, and cargo. Each names a declared completion flag which its step must set.
- `ResolvedCast` ([schema.ts](schema.ts)): roleId to npcId map from the builder.
- A role may publish `characterName { given, family }`, the authored name shown in player labels and dialog. It is presentation metadata only: casting, runtime events, schedules, saves and consequences still use the same resolved `npcId`. It neither reserves nor renames a simulation person. A role without it keeps that person's generated name.
- A talk may publish `dialogue { opening, choices: [{ id, text, reply, completesStep }] }`. `text` is the player's reply and `reply` is the NPC's answer. A false choice provides information; a true choice commits this talk's existing graph outcome. Different endings use separate graph steps, each with a clear commitment. Choices have unique IDs, nonempty text and at least one completing choice; dialogue is invalid on other target kinds.
- `opening` and `reply` are NPC lines and may carry inline emotion cues, the closed set `CUES` in [cues.ts](cues.ts): `[laugh] [sigh] [whisper] [angry] [gasp] [cry]`, placed where the sound or manner happens. An NPC line needs words besides its cues, writes each cue exactly as the list does (`[sigh]`, never `[Sigh]` or `[[sigh]]`) and holds no other bracketed tag; the player's `text` holds none. Hosts show a line through `stripCues(text)` and hand the raw line to a voice.
- `SimulationPort` ([../world/types/simulation.ts](../world/types/simulation.ts)) for liveness, schedules and story-consequence flags.
- `PlayerEvent` ([schema/player-event.schema.json](schema/player-event.schema.json), TypeScript [events.ts](events.ts)) plus current time in simulation minutes. Mechanic completion events repeat the authored interaction ids, cast NPC ids, item ids, modes, and places needed to match one target without inference.
- Authored places are exact `parcelId`, `districtId`, `stationId`, or `stopId` identities plus the venue's `name`: `{ parcelId, name }`. The name is the world's own when Naming gave it one, else the word for that kind of building. `PlaceIdentity` is the same record without the name; arrival and delivery events repeat the identity kind and id only.
- A step whose narrative or player hint names an hour carries `window { label, days, startMin, endMin }`: the words the text used, and the weekly slice the runtime gates on. `new StepStamp(world).definition(def)` ([StepStamp.ts](StepStamp.ts)) writes both records from the world, and the validator refuses a text that names an hour with no window.

Completion events:

| Step | Event | Exact match fields |
| --- | --- | --- |
| `goto` | `arrivedAt` | `place` |
| `observe` | `observed` | `districtId` |
| legacy `talk` without authored dialogue | `talkedTo` | resolved `npcId` |
| `talk` with authored dialogue | `chooseDialogue` | exact `stepId`, resolved `npcId`, declared `choiceId` |
| `listen` | `overheard` | resolved `npcIds` |
| `pickup` | `pickedUp` | `itemId` |
| `deliver` | `delivered` | `itemId`, `place` |
| `steal` | `stole` | `itemId` |
| `assassinate` | `killed` | resolved `npcId` |
| `work` | `workedShift` | `parcelId` |
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
- `stepAvailability(stepId, timeMin)`: liveness, presence, the step's own hour, held items and condition gate, computed on demand; reasons role_dead, not_present, off_duty, outside_window, missing_item, condition.
- `stepPlacementAvailability(stepId, timeMin)`: eligibility for a live host to arrange an authored parcel talk/listen appointment. It checks active state, every target's liveness, authored hours, inventory and predicates without requiring the cast's ordinary routine to visit that parcel. It does not authorize completion: the host must place the exact bodies and project their actual presence through its SimulationPort before `advance` accepts the interaction. Other step kinds retain ordinary availability.
- `windows(stepId)`: weekly windows for the step: the hour its text names, narrowed by the target NPC's routine, labelled with the text's own words; undefined when neither binds it.
- `stepPlace(stepId, timeMin)`: where the step points, for a marker on the map: the parcel, district, station, or stop the target names, the parcel the item sits at, or the simulation's live place for the person it targets. Undefined when the simulation has no place to give.
- `stepGuidance(stepId, timeMin)` ([schema/step-guidance.schema.json](schema/step-guidance.schema.json)): route-ready parcel, station, or stop destination. District areas, street edges, moving routes, and unavailable targets return a closed reason instead of an invalid route request. The host supplies current feet as the route origin.
- `dialogueFor(stepId, npcId, timeMin) -> QuestDialogue | undefined`: read-only conversation for one active talk and its exact cast. The DTO carries `questlineId`, `stepId`, `roleId`, `npcId`, optional `characterName`, `opening`, copied `choices`, and `availability`. Legacy steps receive deterministic fallback dialogue. Inactive, ended, wrong-person and non-talk queries return undefined. Opening and closing require no event or saved state.
- `chooseDialogue(stepId, npcId, choiceId, timeMin) -> DialogueChoiceResult`: rechecks the exact active step, cast, choice and all normal availability gates. Accepted: `{ accepted: true, reply, advanceResult? }`, where `advanceResult` is present only for a completing choice and contains `{ completedStepIds, activatedStepIds, endingId? }`. Rejected: `{ accepted: false, reason: 'stale' | 'wrong_npc' | 'unknown_choice' | 'unavailable', availability? }`; unavailable results include the current gate. Rejections and informational choices have no quest or Simulation effects. A committing choice completes exactly one step even when other active talks share that NPC. The host preserves choices after information, displays the chosen reply and newly active objectives after commitment, and offers separate topics when several questlines use that NPC.
- `advance(event, timeMin)`: completes matching available steps, applies effects (quest flags, simulation flags), activates edges (parallel or exclusive branching), reports an ending on terminal steps. Talk, listen, steal, rescue, escort, and transportation enforce liveness and available presence at advance time; completing an assassinate step records the death in the simulation.
- `serialize()` ([schema/questline-state.schema.json](schema/questline-state.schema.json)) / `QuestlineRuntime.restore(...)`. Restore accepts untrusted JSON only when step history, active frontier, ending, and replayed flags agree with the definition.

`FlowValidator` ([validate.ts](validate.ts)): structural validation (ids, references, declared flags, DAG, reachability, terminal endings, role usage, place names, window shape and the hour a text names, dialogue lines and their cues, item rules: information is never a pickup, deliver or steal target; a pickup item is placed at a parcel). Investigation stages must grant their declared information evidence. Access must need its key, information, or device credential. Transportation must need all physical cargo. Escort and transportation endpoints must differ. Every interaction mechanic must set its declared completion flag.

`QuestlineSetValidator` ([QuestlineSet.ts](QuestlineSet.ts)): validates the engine payload as one main definition followed by side definitions, with unique questline ids. Its exact JSON shape is [../creation/schema/questline-set.schema.json](../creation/schema/questline-set.schema.json).

## Errors
`QuestError` codes used here: `E_INVALID_FLOW` (definition or saved state), `E_CAST` (missing cast entry), `E_UNKNOWN_ID`, `E_WRONG_STATE` (event matches no active step, or questline ended), `E_UNAVAILABLE` (matching step gated off). See [../errors.ts](../errors.ts).

## Invariants
- Same definition, cast, event order and times: identical state. No wall clock, no randomness, no I/O.
- Completed evidence and interaction flags survive serialization, so revisiting cannot duplicate a reward or reopen a finished stage.
- Authored talks progress only through declared completing choices. Opening, reopening, closing, typing optional free chat and informational answers never progress them. Neither the choices nor their replies need an LLM. Legacy hosts retain `talkedTo` compatibility only for steps without authored dialogue; new hosts use explicit choices for both.
- An exclusive branch may have one unconditional fallback only as its last edge, so a fallback cannot make a later outcome unreachable.
- A dead NPC never satisfies presence or duty checks; availability and inventory are never stored, always derived.
- Flags used anywhere must be declared in the definition.
- A hint never promises an hour the runtime does not check: text and window are validated together.
- Saved state cannot create steps, branches, flags, or endings that the completed history did not produce.

`roles.ts`: `stepsOfRole`, `workplaceOf` and `storyWindow` read a definition for one role, for whoever places or casts it.

## Depends on
- ../world (types, SimulationPort, [venue names, staffing and posts](../world/venues.ts))
