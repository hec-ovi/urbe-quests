# CONTRACT: quests/builder

Purpose: translates a story arc into a validated questline: a text-only plan pass answers who does what, where the story splits, what each part means and where the artifacts enter, and closes with a manifest of ids; the build loop commits exactly that manifest to the flow tools; roles are cast against the simulation by type.

## In
`new QuestlineTranslator().translate(input)` ([QuestlineTranslator.ts](QuestlineTranslator.ts)):
- `assignment`: `QuestAssignment { title, synopsis, characters, arc }` ([schema.ts](schema.ts)), the slice of story to translate.
- `world`, `types`; `sim`: `SimulationPort`; `ports { plan: LLMPort, build: AgentPort }` ([../ports/llm.ts](../ports/llm.ts)).
- `referenceTimeMin?` (cast resolution time, default Tuesday 10:00), `maxRounds?` (overrides the plan's budget), `progress?` (one `BuildProgress` per build round: title, round, maxRounds, committed and planned pieces, the tools called or what happened instead).

The halves run alone: `new TranslationPlanner().plan({ assignment, world, types, llm }) -> PlanResult { text, manifest }` ([TranslationPlanner.ts](TranslationPlanner.ts)) and `new QuestlineBuilder().build({ assignment, plan, manifest, world, types, sim, agent, ... }) -> BuildResult` ([QuestlineBuilder.ts](QuestlineBuilder.ts)).

## Out
`TranslationResult { plan, definition, cast }`: the plan text (manifest included), a `QuestlineDefinition` that passed `FlowValidator` ([../flow/schema.ts](../flow/schema.ts)), and its `ResolvedCast` (reserved identities via `reserveNPC`, reused when that person already exists so one story character is one NPC across questlines; everyone else the on-duty vendor by type; a role pinned to a parcel by its talk or listen step is cast there).

The manifest ([PlanManifest.ts](PlanManifest.ts)): the plan's last section, `## Manifest` with one line each of `roles:`, `items:`, `acts:`, `endings:`, `steps:` listing machine ids (a kind in parentheses is ignored, `none` is an empty list). `parsePlanManifest(plan)` reads it; a plan without a usable one gets one repair round ([prompts/translate-plan-repair.md](prompts/translate-plan-repair.md)). Facts are not planned: the builder adds them freely.

Agent-facing surface: `BUILDER_TOOLS` ([tools.ts](tools.ts)) with narrative-first schemas: items carry a kind (device, weapon, document, key, substance, valuable, information); steps carry wantedByRoleId, a stake, gives and needs. Every call is checked against its own schema first ([checkToolInput.ts](checkToolInput.ts)), so a half-written one comes back naming the fields it needs. The draft is bound by the manifest: an id the plan does not list is refused with the planned list, every reference a step or fact makes is checked against the manifest the moment it is made (all problems in one message), each success reports `n of m planned pieces in`, and `finish_questline` names the planned pieces still missing before it validates. Problems return as tool results the agent corrects, never as aborts.

## Errors
- The round budget is two rounds per planned piece plus eight, so a build ends deterministically; the plan prompt sizes a main line at 6 to 16 steps and a side situation at 4 to 8.
- `E_LLM`: no usable manifest after the repair round (detail: stage, raw, problems), the agent answered in words instead of tools more than three times (each such reply is answered with [prompts/builder-nudge.md](prompts/builder-nudge.md) naming what is still missing, and the loop goes on), or the round budget ran out; the message carries the committed count.
- `E_CAST`: a role has no castable NPC (underlying simulation no-match or reserve conflict in `detail`).
Other `SimulationError`s pass through.

## Invariants
- The planner sees the arc, the cards and the world brief (no ids); the builder sees the plan, the cards, the synopsis and the place catalog with ids, never the arc.
- The manifest is the bound: the finished questline carries exactly the planned roles, items, acts, endings and steps, plus whatever facts the agent added.
- The agent never sees or emits NPC ids or coordinates; roles bind types, the simulation resolves people. The script owns personality, needs, drives and voice; the simulation owns home, job, family and routine.
- Flags referenced by drafted steps and facts are auto-declared; the finished definition always satisfies the flow validator.
- Prompts live in [prompts/](prompts/): translate-plan.md, translate-plan-repair.md, builder-system.md, builder-nudge.md, step-catalog.md (every example reads want, cost, change, then the step), artifact-catalog.md; counts are steered, never quota'd; no output caps.

## Depends on
- ../flow (schema, validator), ../world (types, SimulationPort), ../story (world brief, repair loop), ../ports (LLMPort, AgentPort)
