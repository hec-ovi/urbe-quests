# CONTRACT: quests/dialog

Purpose: assembles what an NPC is allowed to know into cache-ordered dialog context layers, asks the model for the NPC's spoken reply (whole or streamed, with companion offers), and remembers completed exchanges with tiered summarization.

## In
`new DialogContextService(input)` ([DialogContextService.ts](DialogContextService.ts)):
- `world`: [DialogWorld](schema.ts), Naming output or a world whose districts and parcels have no names yet; `meta.naming.theme` is required. `types`: NPC type set ([../world/types/named-world.ts](../world/types/named-world.ts)).
- `sim`: `SimulationPort` (instances, behavior, liveness). The instance's optional `gender`, `age` and `traits` feed the person lines.
- `llm`: `LLMPort`, used only to fold old conversation turns into memory notes.
- `memory?`: `{ tailSize?, foldSize? }` (defaults 12 and 6).

Then:
- `attachQuestline(runtime)`: a `QuestlineRuntime` whose cast personas, flag-gated facts, active wants and endings join their NPC's context. Attaching a questline of the same id again replaces the earlier runtime, so a host that restores state per turn never stacks copies.
- `contextFor(npcId, timeMin, { guide? }) -> DialogContext`. `guide` is a [DialogGuide](schema.ts) `{ placeId, kind: 'parcel' | 'stop', name?, notes? }`: the place this NPC has led the player to, what the player sees it called, and plain scene sentences the host shows there.
- `recordExchange(npcId, { line, reply, atMin }) -> Promise<void>`: stores the player turn and the NPC turn before it returns. When the tail overflows it folds the oldest window into a digest note through the LLM; the promise settles when that fold is done and rejects with the provider error when it fails. Folded turns leave the tail only once their note exists, and a failed fold keeps them for the next exchange to retry. Hosts call it after a reply completes, never for a failed or abandoned one, and catch the promise off the reply path.
- `serializeMemory()` / `restoreMemory(data)`.

`new Converse(llm)` ([Converse.ts](Converse.ts)), `llm` an `LLMPort` or a [StreamingLLMPort](../ports/llm.ts):
- `reply({ context, name, line }) -> Promise<string>`: the NPC's cleaned spoken reply to the player's typed `line`, asked from the context segments joined in order as the system prompt plus [prompts/reply.md](prompts/reply.md).
- `replyStream({ context, name, line, offers?, signal? }) -> AsyncGenerator<ReplyEvent>`: the same reply over `llm.stream`, one OpenAI-compatible request with `stream: true`. `offers` is `{ follow?: boolean, places?: [{ placeId, name }] }`, what the host lets this NPC propose; it adds the tools `follow_player` and `lead_player_to({ placeId })`, whose `placeId` is one of `places`. `signal` aborts the request. A port without `stream` yields the whole `reply` as one delta and offers nothing.

Both use `context.characterName` when supplied, otherwise the caller's `name`, so an authored character identity stays consistent between the context and the reply request. This is optional free chat; it never progresses a quest. Essential quest conversations use authored offline text and explicit replies through [QuestlineRuntime.dialogueFor / chooseDialogue](../flow/CONTRACT.md), without calling this service or a model. Context segments describe model grounding and are not player-facing NPC speech.

`cleanReply(text, names?)` and `new ReplyCleaner(names?)` with `push(text)` and `end()` ([ReplyCleaner.ts](ReplyCleaner.ts)): the one cleaner every reply and memory note passes through. It drops `<think>` blocks, `<|...|>` template tokens, a `Name:` or `assistant:` tag in front of a line, everything from a `Player:` or `User:` line on, and one pair of quotes wrapping the whole reply, and trims. Streamed pieces join to exactly the whole-text result.

## Out
`DialogContext`: ordered `segments`, each `{ id, text, shared }`, in fixed order world, type, npc, quest, memory, place, turns. Quest is omitted when this NPC has no attached quest knowledge; memory is omitted when the digest is empty; place is present only with a `guide`. `shared: true` segments (world, type) are byte-stable across calls and across NPCs of a type: the engine concatenates segments in order and may place provider cache breakpoints after shared ones.
- world: character-play, register, dark-tone and deflection rules ([prompts/dialog-system.md](prompts/dialog-system.md)), the named districts, and the theme.
- npc: the deterministic background: name with gender and age, traits, home, job and shift, family, haunts, plus quest personas.
- quest: facts whose gate flag is set, the active steps this NPC wants (what happens and what it means to them), and the epilogue of an ending this NPC's questline reached.
- place: the guided place by name and kind of building with its district, whether this NPC works, lives or spends free time there (from its own routine), and the host's scene notes.
- turns: the volatile now line and the verbatim tail.

Places are named as the world names them; an unnamed building is its kind (`an apartment block`) and an unnamed district its tier and kind (`a poor industrial district`). No segment carries a district, parcel or stop id.

`ReplyEvent`, in order: `{ type: 'delta', text }` as cleaned text arrives; `{ type: 'offer', kind: 'follow' }` or `{ type: 'offer', kind: 'lead', placeId, name }` once the model's streamed tool calls are complete, one per distinct valid offer; then `{ type: 'done', reply, offers }` with the whole cleaned reply. The deltas join to `reply`. When the model only called tools, each call gets a tool result and a second request without tools streams the spoken reply. A call naming a tool or place the host did not offer is dropped. An offer only proposes; the host decides whether anything happens.

The context retains its actual `npcId` and optionally carries `characterName { given, family }` from that person's attached cast role. The NPC background projection and explicit character prompt use that authored name consistently; the stored simulation name, body identity, schedules, relationships and memory keys are unchanged. The first attached matching named role supplies the presentation name. Unnamed roles and bystanders retain their generated identities.

## Errors
- `E_WRONG_STATE`: contextFor on a dead NPC (the dead do not talk).
- `E_UNKNOWN_ID`: NPC type missing from the type set.
- `E_LLM`: a reply with no spoken words left after cleaning.
`SimulationError` from context queries, provider exceptions and aborts pass through. `recordExchange` stores the supplied NPC ID without a Simulation lookup.

## Invariants
- Closed knowledge: context text contains only world rules, type boilerplate, simulation background, attached personas, unlocked quest facts, this NPC's active wants and lived endings, the guided place and its host notes, and recorded conversation. Scope is decided by runtime state and the cast mapping, never by the model; gated facts with unset flags and other NPCs' wants never appear.
- Shared segments are memoized per service (the cache for common instances) and stable per world/type.
- The LLM summarizes memory, writes replies and may propose offers; code selects context facts and which offers exist. Model grounding still requires evaluation with the selected provider.
- Prompts and tool descriptions live in [prompts/](prompts/): dialog-system.md, background.md, context.md, summarize.md, reply.md, offers.md. No output caps.

## Depends on
- ../world (types, SimulationPort, venue words), ../flow (runtime, steps, facts), ../ports (LLMPort, StreamingLLMPort, Chat Completions shapes)
