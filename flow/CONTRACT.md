# CONTRACT: quests/flow

Purpose: deterministic questline state machine over a condition-gated DAG of typed steps; no LLM anywhere.

## In
- `QuestlineDefinition` ([schema.ts](schema.ts)): narrative-first questline document: premise, roles (bound by NPC type, never id), items, flag-gated facts, acts, typed steps (goto, observe, talk, listen, pickup, deliver, steal, assassinate, work), predicates on edges, effects, endings, declared flags, entry steps.
- `ResolvedCast` ([schema.ts](schema.ts)): roleId to npcId map from the builder.
- `SimulationPort` ([../world/types/simulation.ts](../world/types/simulation.ts)) for liveness, schedules and story-consequence flags.
- `PlayerEvent` ([events.ts](events.ts)) plus current time in simulation minutes.

## Out
`QuestlineRuntime` ([QuestlineRuntime.ts](QuestlineRuntime.ts)):
- `status()`: active, completed, or stalled (every active step targets a dead NPC).
- `activeSteps()`, `flags()`, `ending()`.
- `stepAvailability(stepId, timeMin)`: liveness, presence and condition gate, computed on demand; reasons role_dead, not_present, off_duty, condition.
- `windows(stepId)`: weekly availability windows derived from the target NPC's routine; undefined for schedule-free steps.
- `advance(event, timeMin)`: completes matching available steps, applies effects (quest flags, simulation flags), activates edges (parallel or exclusive branching), reports an ending on terminal steps. Talk, listen and steal enforce presence at advance time; a kill event records the death in the simulation.
- `serialize()` / `QuestlineRuntime.restore(...)`.

`FlowValidator` ([validate.ts](validate.ts)): structural validation (ids, references, declared flags, DAG, reachability, terminal endings, role usage).

## Errors
`QuestError` codes used here: `E_INVALID_FLOW` (construction), `E_CAST` (missing cast entry), `E_UNKNOWN_ID`, `E_WRONG_STATE` (event matches no active step, or questline ended), `E_UNAVAILABLE` (matching step gated off). See [../errors.ts](../errors.ts).

## Invariants
- Same definition, cast, event order and times: identical state. No wall clock, no randomness, no I/O.
- A dead NPC never satisfies presence or duty checks; availability is never stored, always derived.
- Flags used anywhere must be declared in the definition.

## Depends on
- ../world (types, SimulationPort)
