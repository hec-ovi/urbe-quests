---
name: story-writing
description: "Writes the independent narrative stage that gameplay adaptation consumes later."
triggers:
  - "write a quest story"
  - "author the story stage"
  - "create a narrative quest"
kind: stage
---

# Story writing

## Purpose

Write a substantial story before choosing gameplay mechanics. The output is narrative source material, not a quest graph.

## Inputs

- The user's prompt.
- Named districts and places without geometry.
- NPC type descriptions without NPC instance ids.
- The structured story output schema.

## Workflow

1. Establish the premise, setting pressure, and central human want.
2. Write character cards with background, motivation, constraint, and a distinct speaking voice.
3. Ground the setting and every scene in a named world place.
4. Build presentation, development, conflict, and ending movements. Each beat must establish the scene, action, dialogue, and resulting change to what a character knows, wants, risks, or decides.
5. Introduce decision points only where alternatives have different consequences. Give every option a stable outcome id.
6. Carry earlier causes into later effects. Do not resolve a conflict with information, an item, or a relationship that the story never established.
7. Close each outcome at character and world level. State what changed and what remained unresolved.
8. Return only the structured story document requested by the harness.

## Constraints

- Do not choose target kinds, parcel ids, role ids, item ids, flags, or runtime events.
- Place names may ground a scene, but gameplay adaptation owns the exact ids.
- Minimums are floors. Add the material the story needs without targeting an exact length.
- Preserve ambiguity in the narrative when it matters, but make each decision and consequence explicit enough for a later adapter to trace.
