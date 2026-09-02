# CONTRACT: quests/builder

Purpose: translates a story arc into a validated questline: a text-only plan pass answers who does what, where the story splits, what each part means and where the artifacts enter; the build loop commits the plan to the flow tools; roles are cast against the simulation by type.

## In
`new QuestlineTranslator().translate(input)` ([QuestlineTranslator.ts](QuestlineTranslator.ts)):
- `assignment`: `QuestAssignment { title, synopsis, characters, arc }` ([schema.ts](schema.ts)), the slice of story to translate.
- `world`, `types`; `sim`: `SimulationPort`; `ports { plan: LLMPort, build: AgentPort }` ([../ports/llm.ts](../ports/llm.ts)).
- `referenceTimeMin?` (cast resolution time, default Tuesday 10:00), `maxRounds?` (default 40).

The halves run alone: `new TranslationPlanner().plan({ assignment, world, types, llm }) -> string` ([TranslationPlanner.ts](TranslationPlanner.ts)) and `new QuestlineBuilder().build({ assignment, plan, world, types, sim, agent, ... }) -> BuildResult` ([QuestlineBuilder.ts](QuestlineBuilder.ts)).

## Out
`TranslationResult { plan, definition, cast }`: the plan text, a `QuestlineDefinition` that passed `FlowValidator` ([../flow/schema.ts](../flow/schema.ts)), and its `ResolvedCast` (reserved identities via `reserveNPC`, reused when that person already exists so one story character is one NPC across questlines; everyone else the on-duty vendor by type; a role pinned to a parcel by its talk or listen step is cast there).

Agent-facing surface: `BUILDER_TOOLS` ([tools.ts](tools.ts)) with narrative-first schemas: items carry a kind (device, weapon, document, key, substance, valuable, information); steps carry wantedByRoleId, a stake, gives and needs. Validation problems return as tool results the agent corrects, never as aborts.

## Errors
- A questline carries at most 20 steps (`MAX_STEPS`): `add_step` past that returns an error that points at finishing, so a build ends in bounded rounds; the plan prompt sizes a main line at 6 to 16 steps and a side situation at 4 to 8.
- `E_LLM`: empty plan, agent answered in words instead of tools more than three times (each such reply is answered with [prompts/builder-nudge.md](prompts/builder-nudge.md) and the loop goes on), or exceeded `maxRounds`.
- `E_CAST`: a role has no castable NPC (underlying simulation no-match or reserve conflict in `detail`).
Other `SimulationError`s pass through.

## Invariants
- The planner sees the arc, the cards and the world brief (no ids); the builder sees the plan, the cards, the synopsis and the place catalog with ids, never the arc.
- The agent never sees or emits NPC ids or coordinates; roles bind types, the simulation resolves people. The script owns personality, needs, drives and voice; the simulation owns home, job, family and routine.
- Flags referenced by drafted steps and facts are auto-declared; the finished definition always satisfies the flow validator.
- Prompts live in [prompts/](prompts/): translate-plan.md, builder-system.md, step-catalog.md (every example reads want, cost, change, then the step), artifact-catalog.md; counts are steered, never quota'd; no output caps.

## Depends on
- ../flow (schema, validator), ../world (types, SimulationPort), ../story (world brief), ../ports (LLMPort, AgentPort)
