# CONTRACT: quests/builder

Purpose: turns a story premise into a validated questline: an agent drives the create/step/finish drafting tools, era-fit scenarios come from the step catalog, and roles are cast against the simulation by type.

## In
`new QuestlineBuilder().build(input)` ([QuestlineBuilder.ts](QuestlineBuilder.ts)):
- `premise { title, premise }`: usually a side premise from the story pass.
- `story?`: `StoryDocument` for main-line context.
- `world`, `types`: named world and NPC type set.
- `sim`: `SimulationPort`; `agent`: `AgentPort` ([../ports/llm.ts](../ports/llm.ts)).
- `referenceTimeMin?` (cast resolution time, default Tuesday 10:00), `maxRounds?` (default 40).

## Out
`BuildResult`: a `QuestlineDefinition` that passed `FlowValidator` ([../flow/schema.ts](../flow/schema.ts)), plus its `ResolvedCast` (reserved identities via `reserveNPC`, everyone else the on-duty vendor by type; a role pinned to a parcel by its talk or listen step is cast there).

Agent-facing surface: `BUILDER_TOOLS` ([tools.ts](tools.ts)) with narrative-first schemas; validation problems return as tool results the agent corrects, never as aborts.

## Errors
- `E_LLM`: the agent stopped without finishing or exceeded `maxRounds`.
- `E_CAST`: a role has no castable NPC (underlying simulation no-match or reserve conflict in `detail`).
Other `SimulationError`s pass through.

## Invariants
- The agent never sees or emits NPC ids or coordinates; roles bind types, the simulation resolves people.
- Flags referenced by drafted steps and facts are auto-declared; the finished definition always satisfies the flow validator.
- Prompts and the step catalog live in [prompts/](prompts/) as .md; scenario counts and step counts are steered, never quota'd; no output caps.

## Depends on
- ../flow (schema, validator), ../world (types, SimulationPort), ../story (StoryDocument shape), ../ports (AgentPort)
