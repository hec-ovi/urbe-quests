# CONTRACT: quests

Purpose: writes the world's story (main line plus side premises), builds questlines as deterministic typed step flows whose NPCs are resolved by type through simulation queries, and assembles NPC dialog context (scoped knowledge, memory, deflection) for the engine's LLM calls.

Status: v0.1. Built against naming v0.1 and simulation v0.1.

## In
- Named world and NPC type set: shapes in [world/types/named-world.ts](world/types/named-world.ts), mirrors of ../naming/schema/world-state.schema.json and npc-types.schema.json.
- Simulation: a `SimulationPort` ([world/types/simulation.ts](world/types/simulation.ts)), the consumed slice of ../simulation's CitySimulation (getNPCVendor, reserveNPC, findNPCs, getNPC, behaviorAt, interrupt, resume, applyFlag). The real simulation satisfies it; [world/stub/StubSimulation.ts](world/stub/StubSimulation.ts) ships for standalone runs.
- World description prompt (theme string) for the story pass.
- LLM access is injected, never owned: `LLMPort` (text completion) and `AgentPort` (tool loop), [ports/llm.ts](ports/llm.ts). No output caps anywhere.
- At runtime: player events (talked, arrived, picked up, ...) and current time in simulation minutes.

## Out
- Story pass: `runStoryPass(input) -> StoryDocument` ([story/CONTRACT.md](story/CONTRACT.md)): main line with introduction, development, conflict, resolution, plus side quest premises. One backbone call, context isolated from geometry.
- Questline builder: `buildQuestline(premise, deps) -> QuestlineDefinition` ([builder/CONTRACT.md](builder/CONTRACT.md)): agent-driven create/step/branch tool with era-fit step scenario catalogs; roles resolved by type via SimulationPort, cast reserved with persona overlays.
- Flow runtime: `QuestlineRuntime` ([flow/CONTRACT.md](flow/CONTRACT.md)): pure code state machine over the questline DAG. Availability (schedule and liveness) is evaluated on demand from routines; flags are the only persisted state; a dead NPC voids its quests.
- Dialog context: `DialogContextService` ([dialog/CONTRACT.md](dialog/CONTRACT.md)): per-NPC-instance scoped fact store (background, persona, flag-gated quest knowledge), scored memory with summarization tiers, cache-ordered context segments, deflection guidance. Facts outside the scope never enter the prompt.

## Errors
Closed set, thrown as `QuestError { code, message, detail? }` ([errors.ts](errors.ts)):
- `E_INVALID_INPUT`: input fails validation; message names the field.
- `E_INVALID_FLOW`: questline graph invalid (unknown ids, unreachable steps, cycles, undeclared flags or roles).
- `E_UNKNOWN_ID`: questline, step, role, fact or NPC id not found.
- `E_WRONG_STATE`: event does not apply to any active step, or operation conflicts with quest state.
- `E_UNAVAILABLE`: step acted on outside its availability window.
- `E_CAST`: a role cannot be resolved or reserved against the simulation.
- `E_LLM`: provider failure after retries, or output that fails repair.
`SimulationError` from the port passes through untouched.

## Invariants
- No LLM inside generation-state or flow-state code paths: only story text, questline drafting and memory summarization are creative; every transition, gate and availability check is deterministic code.
- The builder never places NPCs by id or coordinates: steps bind roles, roles resolve by type through the SimulationPort.
- NPC knowledge is closed: a fact enters dialog context only from simulation background, persona overlay, unlocked quest grants or recorded interaction; deflection applies to everything else.
- Every prompt, boilerplate and few-shot set lives in its own .md file under the owning box's prompts/ folder; output length is never capped in params or wording.
- Standalone: everything runs on the 2D plane against [world/fixtures/](world/fixtures/) and the stub simulation, no other layer present.

## Depends on
- ../naming/CONTRACT.md (named world, NPC type set)
- ../simulation/CONTRACT.md (query surface, time convention, flags)

## Consumers
- ../engine
