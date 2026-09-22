# CONTRACT: quests/dialog

Purpose: assembles what an NPC is allowed to know into cache-ordered dialog context layers, remembers conversations with tiered summarization, and requests replies grounded in those layers.

## In
`new DialogContextService(input)` ([DialogContextService.ts](DialogContextService.ts)):
- `world`, `types`: named world and NPC type set ([../world/types/named-world.ts](../world/types/named-world.ts)).
- `sim`: `SimulationPort` (instances, behavior, liveness).
- `llm`: `LLMPort`, used only to fold old conversation turns into memory notes.
- `memory?`: `{ tailSize?, foldSize? }` (defaults 12 and 6).

Then:
- `attachQuestline(runtime)`: a `QuestlineRuntime` whose cast personas, flag-gated facts, active wants and endings join their NPC's context. Attaching a questline of the same id again replaces the earlier runtime, so a host that restores state per turn never stacks copies.
- `contextFor(npcId, timeMin) -> DialogContext` ([schema.ts](schema.ts)).
- `recordTurn(npcId, { speaker, text, atMin })`: async; appends memory and folds the oldest window into a digest note through the LLM when the tail overflows.
- `serializeMemory()` / `restoreMemory(data)`.

`new Converse(llm).reply({ context, name, line })` ([Converse.ts](Converse.ts)): returns a `Promise<string>`, the NPC's text reply to the player's typed `line`, asked from the context segments joined in order as the system prompt plus [prompts/reply.md](prompts/reply.md). The reply uses `context.characterName` when supplied, otherwise the caller's `name`, so an authored character identity stays consistent between the context and reply request. This is optional free chat; it never progresses a quest. Essential quest conversations use authored offline text and explicit replies through [QuestlineRuntime.dialogueFor / chooseDialogue](../flow/CONTRACT.md), without calling this service or a model. Context segments describe model grounding and are not player-facing NPC speech.

## Out
`DialogContext`: ordered `segments`, each `{ id, text, shared }`, in fixed order world, type, npc, quest, memory, turns. Quest is omitted when this NPC has no attached quest knowledge; memory is omitted when the digest is empty. `shared: true` segments (world, type) are byte-stable across calls and across NPCs of a type: the engine concatenates segments in order and may place provider cache breakpoints after shared ones. The world segment carries the character-play, register and deflection rules ([prompts/dialog-system.md](prompts/dialog-system.md)); npc carries the deterministic background (home, job, shift, family, haunts) plus quest personas; quest carries facts whose gate flag is set, the active steps this NPC wants (what happens and what it means to them), and the epilogue of an ending this NPC's questline reached; turns carries the volatile now line and the verbatim tail.

The context retains its actual `npcId` and optionally carries `characterName { given, family }` from that person's attached cast role. The NPC background projection and explicit character prompt use that authored name consistently; the stored simulation name, body identity, schedules, relationships and memory keys are unchanged. The first attached matching named role supplies the presentation name. Unnamed roles and bystanders retain their generated identities.

## Errors
- `E_WRONG_STATE`: contextFor on a dead NPC (the dead do not talk).
- `E_UNKNOWN_ID`: NPC type missing from the type set.
`SimulationError` from context queries and provider exceptions pass through. `recordTurn` stores the supplied NPC ID without a Simulation lookup.

## Invariants
- Closed knowledge: context text contains only world rules, type boilerplate, simulation background, attached personas, unlocked quest facts, this NPC's active wants and lived endings, and recorded conversation. Scope is decided by runtime state and the cast mapping, never by the model; gated facts with unset flags and other NPCs' wants never appear.
- Shared segments are memoized per service (the cache for common instances) and stable per world/type.
- The LLM summarizes memory and writes replies; code selects context facts. Model grounding still requires evaluation with the selected provider.
- Prompts live in [prompts/](prompts/): dialog-system.md, background.md, context.md, summarize.md, reply.md. No output caps.

## Depends on
- ../world (types, SimulationPort), ../flow (runtime, steps, facts), ../ports (LLMPort)
