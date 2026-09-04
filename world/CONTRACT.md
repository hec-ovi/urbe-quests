# CONTRACT: quests/world

Purpose: projects Naming or Atlas world data onto the fields Quests consumes and supplies the Simulation surface and deterministic standalone fixtures.

## In
- `loadFixtureWorld(name)` ([index.ts](index.ts)): `neon-bay` (cyberpunk) or `aldermoor` (medieval).
- `new StubSimulation({ seed, world, types })` ([stub/StubSimulation.ts](stub/StubSimulation.ts)).
- `new WorldContextNormalizer().normalize({ world, types })` ([WorldContextNormalizer.ts](WorldContextNormalizer.ts)): accepts Naming output or raw Atlas input and projects the closed [consumer types](types/named-world.ts).
- `namedWorldFromAtlas(atlas, theme)` ([fromAtlas.ts](fromAtlas.ts)): deterministic adapter for replaying a recorded story before a naming pass exists.

## Out
- `NormalizedWorldContext { world: NamedWorld, types: NPCTypeSet }`: Naming metadata, names, gender-tagged name pools, and present transit collections pass through; geometry and other unconsumed fields stay outside Quests.
- `FixtureWorld { world: NamedWorld, types: NPCTypeSet }`: standalone worlds use the same [consumer types](types/named-world.ts).
- `SimulationPort` and its value types ([types/simulation.ts](types/simulation.ts)): compatible projection of the consumed ../simulation slice, including the minutes-since-Monday time convention and `SimulationError`.
- `StubSimulation implements SimulationPort`: lazy deterministic instantiation, vendor staffing on a day shift (Mon-Sat 08:00-16:00) and an evening shift (daily 16:00-23:30), full-week routines, liveness and flag semantics per the simulation contract. Stub limits: shifts never span midnight; no crowd layer.
- Raw Atlas input has no naming metadata. Its missing district names become `<kind> <id>`, and its `namedAt` value is the deterministic local marker `derived-from-atlas`. Inputs carrying naming metadata retain that metadata and never receive fallback labels.

## Errors
`SimulationError { code }` with the simulation contract's closed set (E_INVALID_INPUT, E_UNKNOWN_ID, E_STALE_HANDLE, E_NO_MATCH, E_DEAD, E_CONFLICT, E_TIME).

## Invariants
- Same seed and call order: identical instances, names, homes, routines.
- Dead NPCs never match vendor queries; behavior and flag operations on them throw E_DEAD.
- Routines cover the full week with no gaps.
- Naming and Atlas inputs are not mutated. The normalized value contains only fields declared by the Quests consumer types.

## Depends on
- [Atlas](../../atlas/CONTRACT.md): world subset consumed by `namedWorldFromAtlas`.
- [Naming](../../naming/CONTRACT.md): [named world](../../naming/schema/named-world.schema.json) and [NPC type set](../../naming/schema/npc-types.schema.json), consumed through compatible projections with no code import.
- [Simulation](../../simulation/CONTRACT.md): compatible consumed query shapes with no code import.
