# CONTRACT: quests/dialog

Purpose: assembles what an NPC is allowed to know into cache-ordered dialog context layers, remembers conversations with tiered summarization, and makes deflection structural: a fact outside the layers is not in the prompt and cannot leak.

## In
`new DialogContextService(input)` ([DialogContextService.ts](DialogContextService.ts)):
- `world`, `types`: named world and NPC type set ([../world/types/named-world.ts](../world/types/named-world.ts)).
- `sim`: `SimulationPort` (instances, behavior, liveness).
- `llm`: `LLMPort`, used only to fold old conversation turns into memory notes.
- `memory?`: `{ tailSize?, foldSize? }` (defaults 12 and 6).

Then:
- `attachQuestline(runtime)`: a `QuestlineRuntime` whose cast personas, flag-gated facts, active wants and endings join their NPC's context. Attaching a questline of the same id again replaces the earlier runtime, so a host that restores state per turn never stacks copies.
- `contextFor(npcId, timeMin) -> DialogContext` ([schema.ts](schema.ts)).
- `recordTurn(npcId, { speaker, text, atMin })`: appends memory; folds the oldest window into a digest note through the LLM when the tail overflows.
- `serializeMemory()` / `restoreMemory(data)`.

`new Converse(llm).reply({ context, name, line }) -> string` ([Converse.ts](Converse.ts)): the NPC's text reply to the player's typed `line`, asked from the context segments joined in order as the system prompt plus [prompts/reply.md](prompts/reply.md). The only path that produces NPC reply text.

## Out
`DialogContext`: ordered `segments`, each `{ id, text, shared }`, in fixed order world, type, npc, quest, memory, turns. `shared: true` segments (world, type) are byte-stable across calls and across NPCs of a type: the engine concatenates segments in order and may place provider cache breakpoints after shared ones. The world segment carries the character-play, register and deflection rules ([prompts/dialog-system.md](prompts/dialog-system.md)); npc carries the deterministic background (home, job, shift, family, haunts) plus quest personas; quest carries facts whose gate flag is set, the active steps this NPC wants (what happens and what it means to them), and the epilogue of an ending this NPC's questline reached; turns carries the volatile now line and the verbatim tail.

## Errors
- `E_WRONG_STATE`: contextFor on a dead NPC (the dead do not talk).
- `E_UNKNOWN_ID`: NPC type missing from the type set.
`SimulationError` (unknown npc, dead on record) passes through.

## Invariants
- Closed knowledge: context text contains only world rules, type boilerplate, simulation background, attached personas, unlocked quest facts, this NPC's active wants and lived endings, and recorded conversation. Scope is decided by runtime state and the cast mapping, never by the model; gated facts with unset flags and other NPCs' wants never appear.
- Shared segments are memoized per service (the cache for common instances) and stable per world/type.
- The LLM is used for summarization only; what an NPC knows is decided by flags and code.
- Prompts live in [prompts/](prompts/) .md files; no output caps.

## Depends on
- ../world (types, SimulationPort), ../flow (runtime, steps, facts), ../ports (LLMPort)
