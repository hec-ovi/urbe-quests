---
name: escort
description: "Adapts one cast character following or leading along an authored route between exact places."
triggers:
  - "escort a character"
  - "follow a character"
kind: mechanic
mechanic: escort
---

# Escort and follow

Use `escort` after the story establishes why one cast character must reach another place with the player.

- Target: one declared `roleId`, one `routeId`, `mode` set to `follow-player` or `lead-player`, distinct existing `from` and `to` places, and one declared `completionFlag`.
- Completion event: `escorted` with the resolved NPC id and the same route, mode, and endpoints.
- Preconditions: the role is alive and available at the authored start, and `needs` and `conditions` pass. A prior rescue normally gates the route through its completion flag.
- State change: effects set the completion flag and exact later character or world consequences.
- Failure: the wrong cast member, route, mode, endpoint, death, absence, or failed prerequisite does not progress.

Examples: have a witness follow the player to a safe office, follow a guide from a bazaar to a hidden gate, or lead an injured crew member from a hangar to medical care. The host owns pathing, stopping, interruption, and routine resumption.
