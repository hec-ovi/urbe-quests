---
name: listen
description: "Adapts a beat as overhearing exactly two cast characters at one parcel."
triggers:
  - "overhear a conversation"
  - "listen to two characters"
kind: mechanic
mechanic: listen
---

# Listen to two characters

Use `listen` when information is obtained by overhearing two characters rather than addressing them.

- Target: exactly two distinct declared `roleIds` and one existing `atParcelId`.
- Completion event: `overheard` with both resolved NPC ids.
- Preconditions: both roles are alive, approachable, and present at the parcel; step gates also pass.
- State change: normally gives an information item or sets a knowledge flag before later steps.
- Failure: one missing character, the wrong location, death, schedule mismatch, or a failed gate does not progress.

Record why the conversation happens there, why the player is able to hear it, what is learned, and how that knowledge changes later choices.
