# CONTRACT: quests

Purpose: authors the world's story and playable questlines, runs them as deterministic typed step flows whose NPCs resolve by type through simulation queries, and assembles scoped NPC dialog context.

Status: v0.5. Built against naming v0.1 and simulation v0.8.

## In
- Named world and NPC type set: shapes in [world/types/named-world.ts](world/types/named-world.ts), mirrors of ../naming/schema/world-state.schema.json and npc-types.schema.json.
- Recorded creation may consume an Atlas world before naming through `namedWorldFromAtlas` ([world/CONTRACT.md](world/CONTRACT.md)); its generated labels are deterministic fallbacks, not authored place names.
- Simulation: a `SimulationPort` ([world/types/simulation.ts](world/types/simulation.ts)), the consumed slice of ../simulation's CitySimulation (getNPCVendor, reserveNPC, findNPCs, getNPC, behaviorAt, interrupt, resume, applyFlag). The real simulation satisfies it; [world/stub/StubSimulation.ts](world/stub/StubSimulation.ts) ships for standalone runs.
- Creation prompt: the user's words ("create a dark cynical sci fi cyberpunk story").
- Creation keeps a failure local to what failed: a side quest whose build fails is dropped, and a situations pass that cannot be read drops all of them, both reported through `warn` on the input; the script or the main line failing fails the run.
- LLM access is injected per stage, never owned: `StagePorts { script, situations, plan: LLMPort; build: AgentPort }` ([creation/schema.ts](creation/schema.ts)); dialog summarization takes its own `LLMPort`. Ports in [ports/llm.ts](ports/llm.ts). No output caps anywhere.
- Two-stage skill authoring accepts schema-validated story and adaptation requests through [authoring/CONTRACT.md](authoring/CONTRACT.md). Its optional mechanic list is an allowlist; unsupported names fail before an agent runs.
- At runtime: closed player events, exact JSON [flow/schema/player-event.schema.json](flow/schema/player-event.schema.json) and TypeScript [flow/events.ts](flow/events.ts), plus current time in simulation minutes. Events cover talked, arrived, picked up, investigated, released, escorted, accessed, hacked, sabotaged, transported, and the remaining declared actions.

## Out
- Agent authoring: `AuthoringHarness` ([authoring/CONTRACT.md](authoring/CONTRACT.md)) exposes a lightweight GBrain-style skill index and separate `writeStory` and `adaptGameplay` calls. The adaptation output carries a validated questline plus the exact story-beat, mechanic, transition, and ending trace.
- Creation: `new QuestlineCreation().run(input) -> CreationResult` ([creation/CONTRACT.md](creation/CONTRACT.md)): text-only script pass, translation of the script into the main questline (plan pass closing with a manifest of ids, then the flow tool build bounded by it), text-only situations pass and one side questline per situation; `progress` events report each stage and build round. Every stage runs alone too:
  - Story: `ScriptPass`, `SituationsPass` ([story/CONTRACT.md](story/CONTRACT.md)).
  - Translation: `QuestlineTranslator`, `TranslationPlanner`, `QuestlineBuilder` ([builder/CONTRACT.md](builder/CONTRACT.md)).
- Engine quest set: the main `QuestlineDefinition` first, followed by side quest definitions in stable situation order, exactly [creation/schema/questline-set.schema.json](creation/schema/questline-set.schema.json). Each definition is exactly [flow/schema/questline.schema.json](flow/schema/questline.schema.json). Creation-time casts are omitted because each game casts against its own simulation.
- Browser hosts import [runtime.ts](runtime.ts) (dist/runtime.js): the flow runtime, validator, cast resolver, errors and types, with no node APIs behind them; index.ts adds creation, story and dialog, which read prompt files from disk.
- Cast: `new CastResolver(sim).resolve(definition, timeMin) -> ResolvedCast` ([builder/CastResolver.ts](builder/CastResolver.ts)) binds every role to an NPC through the host's simulation (reserved names, else whoever is on duty by type, else anyone of that type already in the world); a host casts at load so ids are its own simulation's.
- Flow runtime: `QuestlineRuntime` ([flow/CONTRACT.md](flow/CONTRACT.md)): pure code state machine over the questline DAG. Availability (schedule, liveness, held items) and the place each step points at are evaluated on demand; flags and step history are the only persisted state; a dead NPC voids its quests. Added interaction steps repeat exact interaction, cast, item, mode, and place ids in their completion events and persist a required authored completion flag.
- Dialog: `Converse` ([dialog/CONTRACT.md](dialog/CONTRACT.md)) answers one player line from an NPC's context with an injected `LLMPort`; `DialogContextService` ([dialog/CONTRACT.md](dialog/CONTRACT.md)): per-NPC-instance scoped fact store (background, persona, flag-gated quest knowledge, the steps this NPC currently wants and the endings it lived), scored memory with summarization tiers, cache-ordered context segments, deflection guidance. Facts outside the scope never enter the prompt.

## Errors
Closed set, thrown as `QuestError { code, message, detail? }` ([errors.ts](errors.ts)):
- `E_INVALID_FLOW`: questline graph invalid (unknown ids, unreachable steps, cycles, undeclared flags, roles or items, information handled as a physical item, unplaced pickup).
- `E_UNKNOWN_ID`: questline, step, role, npc type or cast entry not found.
- `E_WRONG_STATE`: event matches no active step, questline already ended, or dialog with a dead NPC.
- `E_UNAVAILABLE`: step acted on outside its availability (dead, absent, off duty, missing item, condition).
- `E_CAST`: a role cannot be resolved or reserved against the simulation (cause in detail).
- `E_LLM`: model output unusable after repair (detail: stage, raw, problems: a script, a situations list or a plan manifest), or a build that ran out of its plan-sized round budget.
`SimulationError` from the port passes through untouched, except cast resolution, which wraps its no-match and reserve conflicts into `E_CAST`.
The authoring harness has its own closed `AuthoringError` envelope and codes in [authoring/schema/authoring-error.schema.json](authoring/schema/authoring-error.schema.json).

## Invariants
- No LLM inside generation-state or flow-state code paths: only the script, the situations, the translation plan, questline drafting and memory summarization are creative; every transition, gate and availability check is deterministic code.
- The authoring resolver sends a lightweight skill index first and loads only the selected skill bodies. Structured agent responses still pass deterministic schema, world, flow, and cause-effect checks.
- The flow and authoring vocabularies contain 16 exact mechanic kinds. Staged investigation, rescue and escort, credentialed access, hacking, sabotage, and transportation are additive target variants; existing questline documents remain valid.
- Authority is split: the script owns plot, character and voice; the simulation owns who people are, where they live and work and when; the closed step and item vocabulary owns what is playable.
- The builder never places NPCs by id or coordinates: steps bind roles, roles resolve by type through the SimulationPort; one story character is one NPC across questlines.
- NPC knowledge is closed: a fact enters dialog context only from simulation background, persona overlay, unlocked quest grants, active steps this NPC wants, endings this NPC was part of, or recorded interaction, all decided by runtime state and the cast mapping; deflection applies to everything else.
- Every prompt, boilerplate and few-shot set lives in its own .md file under the owning box's prompts/ folder; output length is never capped; minimums are floors, never exact counts.
- Standalone: everything runs on the 2D plane against [world/fixtures/](world/fixtures/), [story/fixtures/](story/fixtures/) and the stub simulation, no other layer present.

## Depends on
- ../naming/CONTRACT.md (named world, NPC type set)
- ../simulation/CONTRACT.md (query surface, time convention, flags)

## Consumers
- ../engine
