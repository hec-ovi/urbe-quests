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
3. Define physical items before a step handles them. Information is given by a completed conversation, observation, or listening step.
4. For every step, record the story beat ids it implements, why its mechanic expresses that beat, its cause, and its resulting narrative effect.
5. Mirror every graph edge in the step's transition trace. Explain why the transition follows and what becomes possible.
6. Use flags, completed steps, role liveness, and duty predicates for branches the runtime can evaluate.
7. Map every story outcome to a reachable quest ending. Record the terminal steps, cause, and consequence for every ending.
8. Return the questline plus its complete mechanic and ending trace.

## Completion checks

- Every step has exactly one mechanic choice and it matches the target kind.
- Every selected mechanic has a loaded skill.
- Every world id and NPC type exists.
- Every edge and ending is traced.
- Every story decision outcome reaches an ending.
- The deterministic flow validator accepts the graph.
