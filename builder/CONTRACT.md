# CONTRACT: quests/builder

Purpose: translates a story arc into a validated questline: a text-only plan pass answers who does what, where the story splits, what each part means and where the artifacts enter, and closes with a manifest of ids; the build loop commits exactly that manifest to the flow tools; roles are cast against the simulation by type.

## In
`new QuestlineTranslator().translate(input)` ([QuestlineTranslator.ts](QuestlineTranslator.ts)):
- `assignment`: `QuestAssignment { title, synopsis, characters, arc }` ([schema.ts](schema.ts)), the slice of story to translate.
- `world`, `types`; `sim`: `SimulationPort`; `ports { plan: LLMPort, build: AgentPort }` ([../ports/llm.ts](../ports/llm.ts)).
- `referenceTimeMin?` (cast resolution time, default Tuesday 10:00), `maxRounds?` (overrides the plan's budget), `progress?` (one `BuildProgress` per build round: title, round, maxRounds, committed and planned pieces, the tools called or what happened instead).

The halves run alone: `new TranslationPlanner().plan({ assignment, world, types, llm }) -> PlanResult { text, manifest }` ([TranslationPlanner.ts](TranslationPlanner.ts)) and `new QuestlineBuilder().build({ assignment, plan, manifest, world, types, sim, agent, ... }) -> BuildResult` ([QuestlineBuilder.ts](QuestlineBuilder.ts)).

## Out
`TranslationResult { plan, definition, cast }`: the plan text (manifest included), a `QuestlineDefinition` that passed `FlowValidator` ([../flow/schema.ts](../flow/schema.ts)), and its `ResolvedCast`.

`StoryVenues` ([StoryVenues.ts](StoryVenues.ts)) finishes the questline before it validates: each role's meeting place moves to a building that publishes a post for that character (the staffing role read from the type's own words, else its category, against the [venue table](../world/venues.ts)) and, when the role's steps name an hour, publishes that post; every parcel that role's steps named moves with it. Then every authored place gets the venue's name and every step whose text names an hour gets its window ([../flow/StepStamp.ts](../flow/StepStamp.ts)).

`CastResolver.resolve(definition, referenceTimeMin, options?)` ([CastResolver.ts](CastResolver.ts)) casts at the hour the story meets each role (the start of the first window its own steps name, on the reference day when that day has it, else the reference time): a person of that name already in the world, then whoever holds the post at that hour at the pinned venue and then at the other buildings that publish it, then a `reserveNPC` identity for a character who works no post, then anyone of that type already in the world. `options.taken` holds the people already playing a part and `options.characters` the characters already cast, so one person is one character across a set of questlines.

The manifest ([PlanManifest.ts](PlanManifest.ts)): the plan's last section, `## Manifest` with one line each of `roles:`, `items:`, `acts:`, `endings:`, `steps:` listing machine ids (a kind in parentheses is ignored, `none` is an empty list). `parsePlanManifest(plan)` reads it; a plan without a usable one gets one repair round ([prompts/translate-plan-repair.md](prompts/translate-plan-repair.md)). Facts are not planned: the builder adds them freely.

Agent-facing surface: `BUILDER_TOOLS` ([tools.ts](tools.ts)) with narrative-first schemas: items carry a kind (device, weapon, document, key, substance, valuable, information); steps carry wantedByRoleId, a stake, gives and needs. Its target catalog is the flow contract's complete 16-kind vocabulary. Places use one catalog `parcelId`, `districtId`, `stationId`, or `stopId`. Investigation, rescue, escort, access, hacking, sabotage and transportation carry their exact evidence, cast, credential, route, target, journey and completion identities. Every call is checked against its own schema first ([checkToolInput.ts](checkToolInput.ts)), so a half-written one comes back naming the fields it needs. `WorldTargetAudit` rejects unknown NPC types and world identities before a role, item, or step enters the draft. The draft is bound by the manifest: an id the plan does not list is refused with the planned list, every role and item referenced by any target is checked against the manifest the moment it is made (all problems in one message), each success reports `n of m planned pieces in`, and `finish_questline` names the planned pieces still missing before it validates. Problems return as tool results the agent corrects, never as aborts.

## Errors
- `E_LLM`: no usable manifest after the repair round (detail: stage, raw, problems), the agent answered in words instead of tools more than three times (each such reply is answered with [prompts/builder-nudge.md](prompts/builder-nudge.md) naming what is still missing, and the loop goes on), or the round budget ran out; the message carries the committed count.
- `E_CAST`: a role has no castable NPC (underlying simulation no-match or reserve conflict in `detail`).
Other `SimulationError`s pass through.

## Invariants
- The plan asks for at least six steps and two acts in a main line, and at least four steps in a side situation. Step, act and branch counts have no upper bound.
- Tool execution is process-bounded at two rounds per planned manifest piece plus eight. `maxRounds` may override this safety budget; it never limits the manifest or model output length.
- The planner sees the arc, the cards and the world brief (no ids); the builder sees the plan, the cards, the synopsis and the parcel, district, station, and stop catalog with ids, never the arc.
- The manifest is the bound: the finished questline carries exactly the planned roles, items, acts, endings and steps, plus whatever facts the agent added.
- The agent never sees or emits NPC ids or coordinates; roles bind types, the simulation resolves people. The script owns personality, needs, drives and voice; the simulation owns home, job, family and routine.
- Flags referenced by drafted steps and facts are auto-declared; the finished definition always satisfies the flow validator.
- Prompts live in [prompts/](prompts/), including tool descriptions under `prompts/tools/`. Step-catalog examples read want, cost, then change. Minimums are floors, story breadth has no upper count, and model output has no token, word or character cap.

## Depends on
- ../flow (schema, validator), ../world (types, SimulationPort), ../story (world brief, repair loop), ../ports (LLMPort, AgentPort)
