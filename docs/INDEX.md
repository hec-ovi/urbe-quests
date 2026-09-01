# Box map

- root: CONTRACT.md, the coupling surface for ../engine.
- world/: consumed dependency surface: mirror types of naming and simulation contracts, fixture named worlds (two eras), deterministic stub simulation.
- flow/: questline schema and deterministic runtime: typed step DAG, acts, branches, flags, schedule-gated availability. No LLM.
- builder/: agent-driven questline drafting tool, era-fit step scenario catalogs, cast resolution and reservation through the simulation port. Depends on flow, world.
- story/: story pass: main history line and side quest premises from theme and named zones. Depends on world.
- dialog/: NPC dialog context: scoped fact store, flag-gated quest knowledge, scored memory with summarization, cache-ordered context segments, deflection. Depends on world, flow.
- ports/: injected LLM and agent interfaces shared by story, builder, dialog.

Dependency edges: builder -> flow, world, ports; story -> world, ports; dialog -> world, flow, ports; flow -> world; world -> (nothing).
