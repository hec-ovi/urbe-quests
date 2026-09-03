# Box map

- root: CONTRACT.md, the coupling surface for ../engine.
- authoring/: GBrain-style progressive skill resolver and the separate story-writing and gameplay-adaptation agent stages. Loads a lightweight index first, then only selected mechanic skills; validates structured output, world targets, flow, and cause-effect traces.
- world/: consumed dependency surface: mirror types of naming and simulation contracts, fixture named worlds (two eras), deterministic stub simulation.
- flow/: questline schema and deterministic runtime: typed step DAG, acts, branches, flags, typed items with gives and needs, schedule-gated availability, the place each step points at. No LLM.
- story/: text-only story passes: the film script from the creation prompt (characters, four movements of passages, enforced minimums) and the side situations written from it. Fixture story. Depends on world, ports.
- builder/: translation of a story arc into a questline: text-only plan pass (self-questioning, closing with a manifest of ids), agent-driven build over the flow tools bounded by that manifest (planned ids only, missing pieces reported, plan-sized round budget, progress per round), cast resolution by type through the simulation port. Depends on flow, world, story, ports.
- creation/: the creation workflow: script, main translation, situations and side translations from one prompt with one port per stage; progress events per stage and build round. Sample harness (a live endpoint, recorded replay, or cross-size deterministic materialization) and exact engine quest-set output. Depends on story, builder, world, ports.
- dialog/: NPC dialog context: scoped fact store, flag-gated quest knowledge, active wants and ending reactions, scored memory with summarization, cache-ordered context segments, deflection. Depends on world, flow, ports.
- ports/: injected LLM and agent interfaces shared by story, builder, dialog. prompts.ts at the root loads every box's prompt files.

Dependency edges: authoring -> flow, world, injected agent ports; creation -> story, builder, world, ports; builder -> flow, world, story, ports; story -> world, ports; dialog -> world, flow, ports; flow -> world; world -> (nothing).

Later version, approved and parked: NPC-initiated contact, messages and calls between NPCs and to the player.
