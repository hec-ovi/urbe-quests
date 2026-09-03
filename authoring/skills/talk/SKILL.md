---
name: talk
description: "Adapts a beat as direct conversation with one cast character."
triggers:
  - "talk to a character"
  - "have a conversation"
kind: mechanic
mechanic: talk
---

# Talk to a character

Use `talk` when the player's direct exchange with a character is the consequential action.

- Target: one declared `roleId`, optionally pinned to an existing `atParcelId`.
- Completion event: `talkedTo` with the role's resolved NPC id.
- Preconditions: the role is alive, approachable, present at the pinned parcel when supplied, and all step gates pass.
- State change: may give information or an item, apply effects, and open branches.
- Failure: the wrong NPC, absence, death, duty mismatch, or failed condition does not progress.

Record what the character wants from the exchange, what the player learns or commits to, and why it causes the next step.
