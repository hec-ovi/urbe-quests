---
name: assassinate
description: "Adapts a beat whose supported completion is the death of one fictional cast target."
triggers:
  - "assassinate a character"
  - "kill a quest target"
kind: mechanic
mechanic: assassinate
---

# Assassinate a character

Use `assassinate` only when the story deliberately makes one fictional character's death the objective and later consequences acknowledge it.

- Target: one declared `roleId`.
- Completion event: `killed` with the resolved NPC id.
- Preconditions: the role is alive, present, and all step gates pass.
- State change: records death through the simulation, applies effects, and resolves the outgoing branch or ending.
- Failure: wrong NPC, absence, prior death, or failed condition does not progress.

Record why lethal action is part of the authored conflict, what alternatives or consequences exist, and how every affected ending changes. This skill defines quest state only; a game host must provide the combat action that emits the event.
