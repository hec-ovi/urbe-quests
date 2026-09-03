---
name: transportation
description: "Adapts one story-directed journey between exact places with declared passengers and cargo."
triggers:
  - "take a ride"
  - "call a ride-hail"
kind: mechanic
mechanic: transportation
---

# Transportation

Use `transportation` when completing the journey itself changes the story. The player is always the implicit rider; every additional passenger and cargo item is explicit.

- Target: one `journeyId`, a mode (`ride-hail`, `public-transit`, `vehicle`, `animal`, or `aircraft`), distinct existing `from` and `to` places, exact `passengerRoleIds`, exact physical `cargoItemIds`, and one declared `completionFlag`.
- Completion event: `transported` with the same journey, mode, endpoints, resolved passenger NPC ids, and cargo item ids.
- Preconditions: all cast passengers are alive and available at the start, every cargo item is in `needs`, and all other conditions pass.
- State change: effects set the completion flag and any authored arrival or world consequences. Cargo remains held unless a later `deliver` step transfers it.
- Failure: an unregistered ride, wrong mode, passenger, cargo, origin, destination, or failed prerequisite does not progress.

Examples: call a named ride-hail from a market to a tower, drive a specific car and its evidence to a garage, guide a camel carrying medicine to an oasis, or complete a declared aircraft leg. This mechanic does not authorize theft, collisions, attacks, or unrelated vehicle behavior.
