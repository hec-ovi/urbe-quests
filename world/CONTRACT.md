# CONTRACT: quests/world

Purpose: everything the quests layer knows about the outside world: mirror types of the naming and simulation contracts, fixture named worlds, and a deterministic stub simulation for standalone runs.

## In
- `loadFixtureWorld(name)` ([index.ts](index.ts)): `neon-bay` (cyberpunk) or `aldermoor` (medieval).
- `new StubSimulation({ seed, world, types })` ([stub/StubSimulation.ts](stub/StubSimulation.ts)).
- `namedWorldFromAtlas(atlas, theme)` ([fromAtlas.ts](fromAtlas.ts)): deterministic adapter for replaying a recorded story before a naming pass exists. It consumes the Atlas world subset and fills only missing district labels.

## Out
- `FixtureWorld { world: NamedWorld, types: NPCTypeSet }`: shapes in [types/named-world.ts](types/named-world.ts), mirrors of ../naming's world-state and npc-types schemas.
- `SimulationPort` and its value types ([types/simulation.ts](types/simulation.ts)): mirror of the consumed ../simulation slice, including the minutes-since-Monday time convention and `SimulationError`.
- `StubSimulation implements SimulationPort`: lazy deterministic instantiation, vendor staffing on a day shift (Mon-Sat 08:00-16:00) and an evening shift (daily 16:00-23:30), full-week routines, liveness and flag semantics per the simulation contract. Stub limits: shifts never span midnight; no crowd layer.
- `namedWorldFromAtlas` returns the exact `NamedWorld` shape. Existing names and transit identities pass through; transit geometry stays in Atlas and Connections. Missing district names become `<kind> <id>` and `namedAt` is the stable value `derived-from-atlas`.

## Errors
`SimulationError { code }` with the simulation contract's closed set (E_INVALID_INPUT, E_UNKNOWN_ID, E_STALE_HANDLE, E_NO_MATCH, E_DEAD, E_CONFLICT, E_TIME).

## Invariants
- Same seed and call order: identical instances, names, homes, routines.
- Dead NPCs never match vendor queries; behavior and flag operations on them throw E_DEAD.
- Routines cover the full week with no gaps.

## Depends on
- [Atlas](../../atlas/CONTRACT.md): world subset consumed by `namedWorldFromAtlas`.
- ../naming/CONTRACT.md, ../simulation/CONTRACT.md (mirrored shapes only; no code import)
