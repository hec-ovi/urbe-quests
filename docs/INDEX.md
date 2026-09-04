# Box map

- root: CONTRACT.md, the coupling surface for Engine. Depends on Atlas, Naming, Simulation, and Engine investigation and mission-asset contracts.
- authoring/: GBrain-style progressive skill resolver and separate story-writing and gameplay-adaptation stages. Projects Naming output onto a closed geometry-free context, loads a lightweight index first, then selected mechanic skills; validates exact cast, parcel, district, station, stop, interaction, prerequisite, consequence, flow, and cause-effect references.
- world/: consumed dependency surface: one Naming or Atlas normalizer, a local marker only for raw Atlas, compatible Naming consumer types, consumed Simulation types, partial transit identities without geometry, fixture named worlds (two eras), deterministic stub simulation.
- flow/: questline schema and deterministic runtime: typed step DAG, branches, endings, validated saved state, exact mechanic completion events, and route-ready parcel, station, or stop guidance. No LLM.
- story/: text-only story passes: the film script from the creation prompt (characters, four movements of passages, enforced minimums) and the side situations written from it. Fixture story. Depends on world, ports.
- builder/: translation of a story arc into a questline: text plan with an id manifest, agent tool build over all 16 mechanics, immediate world-target checks, and cast resolution by type. Depends on flow, world, story, ports.
- creation/: the creation workflow: script, main translation, situations and side translations from one prompt with one port per stage; progress events per stage and build round. Sample harness, deterministic materialization, and stable engine handoff files. Depends on story, builder, world, ports, handoff.
- handoff/: validates investigation, mission item, fixed mechanic asset-anchor, and host transport capability bindings; projects every exact objective action; writes engine bundle v1.1. Depends on flow, engine investigation v1.1, engine mission-assets v1.0.
- dialog/: NPC dialog context: scoped fact store, flag-gated quest knowledge, active wants and ending reactions, verbatim-tail memory with summarized digests, cache-ordered context segments, deflection. Depends on world, flow, ports.
- ports/: injected LLM and agent interfaces shared by story, builder, dialog. prompts.ts at the root loads every box's prompt files.

Dependency edges: authoring -> flow, world, injected agent ports; creation -> story, builder, world, ports, handoff writer; handoff -> flow, engine investigation and mission asset contracts; builder -> flow, world, story, ports; story -> world, ports; dialog -> world, flow, ports; flow -> world; world -> Atlas, Naming, Simulation contracts.
