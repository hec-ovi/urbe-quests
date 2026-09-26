# CONTRACT: quests/dialog

Purpose: assembles what an NPC is allowed to know into cache-ordered dialog context layers, asks the model for the NPC's spoken reply (whole or streamed, with companion offers), and remembers completed exchanges with tiered summarization.

## In
`new DialogContextService(input)` ([DialogContextService.ts](DialogContextService.ts)):
- `world`: [DialogWorld](schema.ts), Naming output or a world whose districts and parcels have no names yet; `meta.naming.theme` is required. `types`: NPC type set ([../world/types/named-world.ts](../world/types/named-world.ts)).
- `sim`: `SimulationPort` (instances, behavior, liveness). The instance's optional `gender`, `age` and `traits` feed the person lines, and its `job` or `transitJob` the work line.
- `llm`: `LLMPort`, used only to fold old conversation turns into memory notes.
- `memory?`: `{ tailSize?, foldSize? }` (defaults 12 and 6).

Then:
- `attachQuestline(runtime)`: a `QuestlineRuntime` whose cast personas, flag-gated facts, active wants and endings join their NPC's context. Attaching a questline of the same id again replaces the earlier runtime, so a host that restores state per turn never stacks copies.
- `contextFor(npcId, timeMin, { guide? }) -> DialogContext`. `guide` is a [DialogGuide](schema.ts) `{ placeId, kind: 'parcel' | 'stop', name?, notes? }`: the place this NPC has led the player to, what the player sees it called, and plain scene sentences the host shows there.
- `recordExchange(npcId, { line, reply, atMin }) -> Promise<void>`: stores the player turn and the NPC turn, without its cues, before it returns. When the tail overflows it folds the oldest window into a digest note through the LLM; the promise settles when that fold is done and rejects with the provider error, or `E_LLM` when the note is empty. Folded turns leave the tail only once their note exists, and a failed fold keeps them for the next exchange to retry. Hosts call it after a reply completes, never for a failed or abandoned one, and catch the promise off the reply path.
- `serializeMemory()` / `restoreMemory(data)`.

`new Converse(llm)` ([Converse.ts](Converse.ts)), `llm` an `LLMPort` or a [StreamingLLMPort](../ports/llm.ts):
- `reply({ context, name, line }) -> Promise<string>`: the NPC's cleaned spoken reply to the player's typed `line`, asked from the context segments joined in order as the system prompt plus [prompts/reply.md](prompts/reply.md). The prompt lets the reply carry inline emotion cues from [CUES](../flow/cues.ts), sparingly and where they happen.
- `replyStream({ context, name, line, offers?, signal? }) -> AsyncGenerator<ReplyEvent>`: the same reply over `llm.stream`, one OpenAI-compatible request with `stream: true`. `offers` is `{ follow?: boolean, places?: [{ placeId, name }] }`, what the host lets this NPC agree to; it adds the tools `follow_player` and `lead_player_to({ placeId })`, whose `placeId` is one of `places`. [offers.md](prompts/offers.md) tells the NPC that a player who asks to be followed or led has consented, so agreeing is calling the tool, which starts it at once, and that it declines in character, in words only, when this person would not go; it calls no tool the player did not ask for. `signal` aborts the request. A port without `stream` yields the whole `reply` as one delta and offers nothing.

Both use `context.characterName` when supplied, otherwise the caller's `name`, so an authored character identity stays consistent between the context and the reply request. This is optional free chat; it never progresses a quest. Essential quest conversations use authored offline text and explicit replies through [QuestlineRuntime.dialogueFor / chooseDialogue](../flow/CONTRACT.md), without calling this service or a model. Context segments describe model grounding and are not player-facing NPC speech.

`cleanReply(text, names?)` and `new ReplyCleaner(names?)` with `push(text)`, `end()` and `done` ([ReplyCleaner.ts](ReplyCleaner.ts)): the one cleaner every reply passes through. It drops `<think>` blocks and `<|...|>` template tokens (a start token before the reply drops its role line; a token after the reply ends it), a `Name:` or `assistant:` tag in front of a line, everything from a `Player:` or `User:` line on, and one pair of quotes wrapping the whole reply, and trims. A reply that opens with a quote, after any cues, is held until that quote closes; the pair goes only when the closing quote ends the reply or only cues follow it. A bracketed tag is up to 32 letters, spaces, commas, apostrophes and hyphens in single or doubled brackets. A tag whose first or last word is a cue or a form of one becomes that cue as its lower-case name (`[Sighs heavily]` and `[[sigh]]` become `[sigh]`, `[a bitter laugh]` becomes `[laugh]`). Any other tag, a stage direction such as `[leans in]`, goes with the whitespace before it, and the text it joins is scanned again, so the reply holds no tag outside the list. `done` turns true once the model has written past the NPC's turn. Streamed pieces join to exactly the whole-text result: a tag split across model chunks, and text a dropped tag may still join, waits until settled, so no piece splits a cue. Memory notes pass only its markup stage, [cleanMarkup](../ports/markup.ts), so a note keeps any speaker labels it has.

## Out
`DialogContext`: ordered `segments`, each `{ id, text, shared }`, in fixed order world, type, npc, quest, memory, place, turns. Quest is omitted when this NPC has no attached quest knowledge; memory is omitted when the digest is empty; place is present only with a `guide`. `shared: true` segments (world, type) are byte-stable across calls and across NPCs of a type: the engine concatenates segments in order and may place provider cache breakpoints after shared ones.
- world: character-play, register, dark-tone and deflection rules ([prompts/dialog-system.md](prompts/dialog-system.md)), the named districts, and the theme.
- npc: the deterministic background: name with gender and age, traits, home, work and shift (a building, a stop or station, or the transit lines), family, haunts, plus quest personas.
- quest: facts whose gate flag is set, the active steps this NPC wants (what happens and what it means to them), and the epilogue of an ending this NPC's questline reached.
- place: the guided place by name and kind of building or stop with its district, whether this NPC works, lives or spends free time there (from its own job and routine), and the host's scene notes.
- turns: the volatile now line (day, time and what the NPC is doing, in plain words) and the verbatim tail.

Places are named as the world names them; an unnamed building or stop is its kind (`an apartment block`, `a subway station`) and an unnamed district its tier and kind (`a poor industrial district`). No segment carries a district, parcel, stop or route id.

`ReplyEvent`, in order: `{ type: 'delta', text }` as cleaned text arrives, cues included; then, once the spoken reply is complete, `{ type: 'offer', kind: 'follow' }` or `{ type: 'offer', kind: 'lead', placeId, name }`, one per distinct valid offer from the model's tool calls; then `{ type: 'done', reply, offers }` with the whole cleaned reply. The deltas join to `reply`. A host shows `stripCues` of a whole reply, a sentence or the text so far, and hands the raw text to a voice. A turn that fails yields no offer. When the model called tools and said no words, each call gets a tool result and a second request without tools streams the spoken reply, a space after any cue the first answer gave; a call whose arguments are not JSON goes back with `{}`. A call naming a tool or place the host did not offer is dropped. Once the model writes past the NPC's turn, the stream stops reading it. An offer is the NPC's agreement; the host decides whether anything happens.

The context retains its actual `npcId` and optionally carries `characterName { given, family }` from that person's attached cast role. The NPC background projection and explicit character prompt use that authored name consistently; the stored simulation name, body identity, schedules, relationships and memory keys are unchanged. The first attached matching named role supplies the presentation name. Unnamed roles and bystanders retain their generated identities.

## Errors
- `E_WRONG_STATE`: contextFor on a dead NPC (the dead do not talk).
- `E_UNKNOWN_ID`: NPC type missing from the type set.
- `E_LLM`: a reply with no spoken words left after cleaning (cues alone are none), or an empty memory note.
`SimulationError` from context queries, provider exceptions and aborts pass through. `recordExchange` stores the supplied NPC ID without a Simulation lookup.

## Invariants
- Closed knowledge: context text contains only world rules, type boilerplate, simulation background, attached personas, unlocked quest facts, this NPC's active wants and lived endings, the guided place and its host notes, and recorded conversation. Scope is decided by runtime state and the cast mapping, never by the model; gated facts with unset flags and other NPCs' wants never appear.
- Shared segments are memoized per service (the cache for common instances) and stable per world/type.
- The LLM summarizes memory, writes replies and may make offers; code selects context facts and which offers exist. Model grounding still requires evaluation with the selected provider.
- Prompts and tool descriptions live in [prompts/](prompts/): dialog-system.md, background.md, context.md, summarize.md, reply.md, offers.md. reply.md lists the cues from `CUES`. No output caps.

## Depends on
- ../world (types, SimulationPort, venue words), ../flow (runtime, steps, facts, cues), ../ports (LLMPort, StreamingLLMPort, Chat Completions shapes, model markup)
