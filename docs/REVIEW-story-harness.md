# Review: prose-first story harness

Design review of the proposed two-stage quest creation harness (write a movie-grade script with no tools, then translate it into questlines) against the box as it stands at v0.1.

## 0. The acceptance bar

The target is Monkey Island, Cyberpunk, Full Throttle: rich characters, emotional stakes, real conflicts. The failure to avoid is the forced errand, take this from one NPC and put it in another building. That bar decides how the rest of this review is weighted, and it moves one gap to the front: a step must carry its narrative why (who wants it, what it means to them, what it changes), and that why must reach the player through a person talking. The mechanical verb is the surface, not the content.

Measured against that bar, the prose-first idea is necessary but not sufficient. A better script does not by itself change how a step feels, because of what section 2 describes: today no step narrative ever reaches an NPC's mouth.

## 1. How it maps onto what exists

The pipeline today is already two-tier: `StoryPass` makes one tool-free `LLMPort` call for prose, then `QuestlineBuilder` runs a separate `AgentPort` tool loop per premise, and `FlowValidator` gates the result before the runtime ever sees it.

Already matching the idea:

- Stage 1 is tool-free by construction. `story/prompts/story-pass.md` asks for prose only, and `WorldBrief` hands the model names, kinds and tiers with no ids, no geometry, no statistics. Attention isolation is the existing design.
- Stage 2 is a genuinely separate agent: different port type, different system prompt (`builder/prompts/builder-system.md` plus `step-catalog.md`), narrative fields ordered before structural ones in both `builder/tools.ts` and `flow/schema.ts`.
- Side quests already fan out in parallel from the same backbone call: `sidePremises` from one story call, one builder run each.
- Artifacts already enter at translation time. `QuestItem` plus the `pickup`, `deliver` and `steal` targets exist in `flow/schema.ts`, and `add_item` is a builder tool. The story pass never mentions items.
- Per-stage model choice is structurally close: no provider lives in this box, and each stage takes its own injected port (`StoryPass.run({ llm })`, `QuestlineBuilder.build({ agent })`, `DialogContextService({ llm })`).

What changes:

- `StoryDocument` grows from four prose strings plus short premises into a script document: characters with backgrounds and voice, passages inside each movement, side situations that carry their own arc.
- The builder stops taking `premise { title, premise }` and starts taking a slice of the script: the beats it must cover, the characters involved, what the part means in the whole.
- Character identity moves upstream. Today the builder invents roles and personas; with a script, it maps existing script characters onto NPC types from the catalog. `reservedName` is the hook for a character the story truly owns.
- Personas stop being written twice. The script's voice notes flow into `QuestRole.persona`, which is what `DialogContextService` already attaches, so a character sounds the same in a quest and in conversation.

## 2. Gap zero: the narrative why has no delivery path

This is the first-class gap, and it is the direct cause of the errand feeling.

**What the schema holds.** `QuestStep.narrative` is `{ description, playerHint }`: what happens in the story here, and what the player sees as the objective. Neither field names who wants this, what it costs them, or what it changes. `QuestEnding.epilogue` has the same shape problem.

**Where that text goes.** Nowhere near a person. `DialogContextService.renderQuestKnowledge` iterates `runtime.def.facts` only; `renderNpc` reads `role.persona` only. `runtime.activeSteps()` is never consulted by the dialog service at all. So:

- The quest giver does not know he gave the quest. Mid-questline, the barista who asked for the favor has no idea the favor is in progress unless the builder happened to write a `QuestFact` with a `gateFlag` that matches that exact state.
- `narrative.description` and `playerHint` are, in the dialog path, dead text. They exist for the engine's quest log. The player reads the why in a HUD line and hears nothing about it from anyone.
- `epilogue` never gets spoken either. A questline resolves and no character reacts.

That is structurally the failure the bar names. The objective lives in the interface, the character is a vending machine, and no amount of script quality upstream fixes it, because the pipe from questline to a person's mouth carries only `QuestFact`.

**Second problem: no step knows whose want it is.** `StepTarget` carries a role for `talk`, `listen`, `assassinate` and `steal` (`fromRoleId`), but `pickup`, `goto`, `observe`, `deliver` and `work` name no person. So even if dialog started reading steps, there is no field saying which character this step's why belongs to. Fetching a ledger is authored today with literally no character attached to the wanting.

**Third problem: the prompts teach the errand.** Every entry in `step-catalog.md` is a verb plus a place: recover a data chip stashed under a market stall, lift a keycard from a security desk during rounds, collect a sealed letter left inside a chapel bench. Not one example names a want, a stake or a cost. `builder-system.md` then says prefer simple quests, go somewhere, talk to someone, pick something up, deliver it, and calls a short flow a small errand. The system prompt says story is the priority and the catalog beside it demonstrates the opposite.

**Fourth, a smaller one:** `dialog-system.md` tells the NPC that what they say does not change the world and not to promise world changes. Correct for hallucination control, but as written it also flattens the register a quest giver needs (asking, pleading, bargaining, threatening). The rule to keep is cannot promise mechanical outcomes; the rule to drop is cannot express want.

**What closes it.** Three changes, small individually:

1. `QuestStep` gains the person and the stake: a `wantedByRoleId` (whose desire this step serves) and the why fields on `narrative` (what it means to them, what it changes if it lands, what it costs if it does not). Narrative fields stay first in the tool schema, as they already are.
2. `DialogContextService` gains a quest-state segment: for each attached runtime, the active steps whose `wantedByRoleId` or target role is this NPC, rendered as what this character currently wants from the player and why. Also the epilogue of a reached ending, so characters react to how it ended.
3. `step-catalog.md` entries get rewritten as want plus cost plus change, with the mechanical verb as the last line, and `builder-system.md` drops the errand framing in favour of a rule: every step names a person who wants it and what it costs them.

The closed-knowledge invariant survives because the scope stays code-decided: an NPC sees a step's narrative only when the runtime says that step is active and the cast maps that role to this NPC. Step activity is derived from flags, which are already the only persisted state. The model never chooses what enters the prompt.

## 3. The rest of the gaps

**Story output shape.** `story/schema.ts` is flat: `{ theme, mainline{introduction, development, conflict, resolution}, sidePremises[] }`, parsed by `parseStory.ts` splitting on `##` and `###` headings. A script needs one more level (characters as entries with sub-fields, movements containing passages). Keep the output prose in a heading grammar rather than JSON: `docs/RESEARCH.md` records that prompt-level format pressure costs story quality more than real constrained decoding does. Keep `raw` persisted and keep the single repair round; make the parser tolerant so only the four movements and at least one situation are required to parse.

**Builder input.** `BuildInput.premise` is two fields; `renderPrompt` pastes all four mainline movements verbatim into the prompt on every round. With a movie-length script that becomes the dominant token cost, since the loop re-sends system plus prompt plus transcript for up to 40 rounds. The builder needs an assignment (arc slice, its characters with their voice, its meaning) plus a short synopsis of the whole, not the entire script.

**The self-questioning step has no home.** The idea's questions (which characters do what, where the splits are, what each part means) can go in `builder-system.md`, but they work better as a real pre-pass: one tool-free `LLMPort` call that writes a translation plan (character to NPC type mapping, act splits, artifact list, and for each intended step the person who wants it and why), which then becomes the tool loop's prompt. Three reasons: the plan is prose so a weak local model can produce it, the plan is inspectable and fixture-able, and the tool loop gets shorter and drifts less. Under the acceptance bar this pass earns its place twice over, because whose want drives each step is exactly the question that has to be answered before any tool call.

**Per-stage model configuration.** Nothing to build providers-wise, and nothing should be built: the root contract says LLM access is injected, never owned. The gap is that there is no shape for saying which port serves which stage. Add a stage-keyed record (`story`, `expand`, `plan`, `build`, `summarize`), all `LLMPort` except `build` which is `AgentPort`, filled by the engine. Endpoints, model names and local versus cloud stay entirely on the engine side. One caveat worth planning for: the tool loop is the stage a small local model is most likely to fail at, which is a further argument for the prose plan pass.

**Item and artifact vocabulary.** The schema supports items but no prompt teaches their range, the way `step-catalog.md` teaches step scenarios. Three concrete gaps:
- No `artifact-catalog.md`: era-varied examples (data chip, sealed letter, ledger, keycard, weapon, sample case) so the model picks what fits instead of defaulting to generic objects. Same rule as the step catalog under the bar: an artifact is introduced with whose it is and what it means to them, not just what it is.
- Information is not an item. A physical thing is a `QuestItem` reached by `pickup`, `deliver` or `steal`; knowledge is a `QuestFact` with a `gateFlag`, reached by `talk`, `listen` or `observe`. Without that rule written down the model will create an item called "the rumor" and try to pick it up.
- `QuestItem` has `atParcelId` but no holder. `steal` carries `fromRoleId` on the step, so an item a character carries is expressible only through the step. Decide whether `heldByRoleId` is worth adding or whether the step is enough.

**Side-quest situation extraction.** Premises today are two to four sentences from the backbone call. The idea wants each to be a small arc with its own presentation, development, conflict and resolution. Generating the backbone in one call is what keeps quests consistent with each other (research conclusion), so keep the seeds in the backbone call and add one expansion pass that grows each seed into an arc borrowing script characters. That pass is parallel per seed and independently model-configurable, which fits the staged model requirement.

## 4. Risks and how the invariants survive

**No hallucinated knowledge.** A richer script invents people, which is the pressure point. The rule that holds: a script character reaches a player only through a `QuestRole` bound to an NPC type, and an NPC's prompt only ever contains what `DialogContextService` assembles. Adding the quest-state segment widens that surface, so its scope rule has to be as tight as the fact rule: only active steps, only this NPC's roles, only via cast mapping, never model-selected. The subtler vector is contradiction: the script says a character grew up in the flooded docks, the simulation says she lives in Kanaal. Split authority in the translator prompt: the script owns personality, needs, drives and voice; the simulation owns home, job, family and routine. Consider a build-time lint that flags a persona asserting a home, job or family.

**Emotional register versus deflection.** Pushing stakes into dialog runs against `dialog-system.md`'s flattening rules. Keep the hard rules on knowledge and on promising world changes, and separate them from expression: a character may want, fear, plead and threaten, and may say what a failure would cost them, because that is in their layers. Without that separation the new quest segment gets neutralised by the system prompt.

**Deterministic flow.** Untouched by this design, and it must stay that way: every stage is prose in, definition out, and `FlowValidator` still gates. The quest-state segment reads runtime state and never writes it. The real risk is scope creep in the vocabulary, since a cinematic script wants timers, failure states and cutscenes. Version-two scope is simple quests, no timers, no failure states. Keep `StepTarget` closed; era fit and emotional framing stay prompt and data questions.

**Attention, in both directions.** The idea is right that tools distract the story model. The same argument applies to the translator: a long script in a 40-round loop is its own distraction. Slice the assignment, keep the synopsis short, put the thinking in the plan pass.

**More stages, more failure modes.** Each new boundary is a new `E_LLM` path. Mitigate with fixtures at every boundary (a committed script fixture, a committed plan fixture) so each stage is testable without the stage before it, the same way the simulation boundary is already handled.

**Parse fragility.** More structure in the story output means more parse failures. Tolerant parser, one repair round, raw always kept. If failures show up in practice, add a reformat call (prose in, same prose in the heading grammar out) rather than tightening the story prompt.

**The translator rewriting the story.** Constrain it: expand and adapt, never contradict. If a beat cannot be expressed with the step vocabulary, drop the beat rather than invent a mechanic.

## 5. Staged plan

Smallest end-to-end slice: one committed script fixture, one situation, one questline, run to an ending on the stub simulation and the neon-bay fixture world, with the local model driving the translation stage. Its acceptance test is not that the questline validates, it is that the quest giver, asked mid-quest, says in his own voice what he wants and why it matters to him, and reacts at the end.

1. **Narrative why and its delivery path** (flow, builder, dialog). `wantedByRoleId` plus stake fields on `QuestStep.narrative`; quest-state segment in `DialogContextService` scoped to active steps and cast roles; ending reaction; `step-catalog.md` rewritten as want, cost, change with the verb last; errand framing out of `builder-system.md`; register rules separated in `dialog-system.md`. Widest change in the plan (three inner contracts) and the one the acceptance bar rests on, so it goes first and is worth doing even if nothing else in this review ships. Size: 1.5 days.
2. **Script schema, prompt and parser** (story box). Movie-script brief with minimum-must-have constraints expressed as ranges, never exact counts. Characters with background, wants and voice; passages inside movements; situation seeds. Tolerant parser, repair round and raw kept. Update `story/CONTRACT.md`. Size: 1 day.
3. **Stage model wiring** (ports plus root contract). Stage-keyed port record; story, builder and dialog read their port from it. Early, so everything after can run story on a frontier model and the rest local. Size: half a day.
4. **Translation plan pass** (builder box). One tool-free call, self-questioning prompt in its own .md, prose plan out including whose want drives each intended step, plan feeds the tool loop. Size: 1 day.
5. **Builder assignment and artifact catalog.** `BuildInput` takes an assignment instead of a premise; synopsis replaces the pasted mainline; `artifact-catalog.md` added; item versus information rule written in; persona carries script voice. Update `builder/CONTRACT.md`. Size: 1 day.
6. **Situation expansion pass** (story box). Seeds to arcs, parallel, own stage port. Size: half a day.
7. **End-to-end harness and fixtures.** Script fixture, plan fixture, scripted-agent test proving script to questline to runtime to ending, plus a dialog assertion that the giver's context contains his want mid-quest and his reaction at the end. Local-model smoke run behind an environment guard, following the `skipIf` pattern already used for the real simulation test. Size: 1 day.

Stages 1, 2 and 5 are the minimum that produces a visibly different questline. Roughly a week and a half for all seven.

## 6. Verdict on the core bet

Prose first, then translate, is right, and it is already half-built. `story-pass.md` is tool-free prose, `WorldBrief` strips every id, and `docs/RESEARCH.md` records the same two claims the idea makes: generate the backbone in one focused pass, and do not put format pressure on the creative call. What the idea correctly identifies is that tier one is too thin. Four prose sections plus two-sentence premises is a synopsis, and every piece of character depth in the current pipeline is written by `add_role`, which means depth is produced by the agent simultaneously managing ids, edges, flags and validation feedback. That is exactly the split attention the proposal names, and moving character work into a tool-free stage fixes it.

Three amendments before building it:

- Fix the delivery path first. Under the stated acceptance bar this outranks the script work: today a step's why cannot reach the player through a character at all, so a richer script would improve the quest log and leave the felt experience unchanged. Rich characters and emotional stakes are a dialog-surface property, and the dialog surface currently receives personas and gated facts and nothing else.
- Insert the tool-free plan pass between the script and the tool loop. The argument that justifies stage 1 applies again at stage 2, it costs one call, and whose want drives each step is precisely the question that has to be settled before the first tool call.
- Bound the script's authority explicitly. The script owns plot, voice and meaning; the simulation owns who people are and where they live; the step vocabulary owns what is playable. Written into the translator prompt, that hierarchy is what keeps closed knowledge and deterministic flow intact as the story gets richer.

The cost of the design is pipeline length: four LLM stages instead of two, each with its own failure mode. Fixtures at every boundary pay that back, and they give the per-stage model configuration something concrete to be tested against.
