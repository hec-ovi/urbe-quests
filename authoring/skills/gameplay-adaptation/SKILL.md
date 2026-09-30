---
name: gameplay-adaptation
description: "Selects supported mechanics and converts a completed story into a validated questline."
triggers:
  - "adapt story to gameplay"
  - "build a playable questline"
  - "choose quest mechanics"
kind: stage
---

# Gameplay adaptation

## Purpose

Translate the completed story into a playable questline while preserving why events happen and what each outcome changes.

## Inputs

- A completed story-stage document.
- Named world places and NPC types.
- A lightweight index of supported mechanic skills.
- The structured adaptation output schema.

## Phases

### Select mechanics

1. Read the story and identify what the player learns, does, risks, chooses, and changes.
2. Scan the skill index. Select only mechanics needed to express those beats.
3. Respect the caller's mechanic allowlist when present.
4. If a required story action has no supported skill, stop with the unsupported mechanic. Do not replace it with a nearby label and claim equivalent behavior.
5. Load every selected mechanic skill in full.

### Build the adaptation

1. Bind characters to NPC types, never NPC instance ids.
2. Use only parcel and district ids present in the supplied world.
3. Define every item before a step references it. Information is granted only by a completed talk, listen, observe, investigation, or hacking step.
4. For investigation, rescue, escort, access, hacking, sabotage, and transportation, name every required interaction id, cast role, item, and place. Never ask the host to infer which prop, person, code, route, or journey the prose means.
5. Give each of those interaction steps its own declared completion flag and a matching `setFlag` effect. Put prior evidence, credentials, cargo, and state in `needs` and `conditions`.
6. For every step, record the story beat ids it implements, why its mechanic expresses that beat, its cause, and its resulting narrative effect.
7. Mirror every graph edge in the step's transition trace. Explain why the transition follows and what becomes possible.
8. Use flags, completed steps, role liveness, and duty predicates for branches the runtime can evaluate.
9. Map every story outcome to a reachable quest ending. Record the terminal steps, cause, and consequence for every ending.
10. Return the questline plus its complete mechanic and ending trace.

## Completion checks

- Every step has exactly one mechanic choice and it matches the target kind.
- Every selected mechanic has a loaded skill.
- Every world id and NPC type exists.
- Every edge and ending is traced.
- Every story decision outcome reaches an ending.
- The deterministic flow validator accepts the graph.
- No step introduces random violence, unrelated theft, vehicle mayhem, or an inferred hostile target. `assassinate` is available only for a death explicitly authored by the story and traced through its consequences.

## Player reading budget

Write an imperative objective with person/object and real place, aiming for 8 words
(maximum 10 words / 90 characters / one sentence). Scene and stake each take at
most 24 words / 180 characters / one sentence; the scene may be empty. Openings
and NPC replies take at most 45 words / 300 characters / 3 sentences. Choices take
at most 12 words / 100 characters / 2 sentences. These fields fit one line.
Titles take at most 6 words / 60 characters. A prologue takes at most 45 words /
300 characters / 3 sentences. Speech cues are excluded from visible counts.

Explain unfamiliar names by relationship or job. Introduce one lead at a time,
with one entry step and a simple go, talk, choose chain before branching. The
opening greets the player and explains the immediate problem. Put longer context
in the journal premise and act summaries or optional question replies. Keep
choices explicit about their consequences. Authoring rejects oversized text with
field-specific E_AUTHORING_OUTPUT details; revise it without clipping. These are
field budgets, with no model token cap or saved-definition migration.
