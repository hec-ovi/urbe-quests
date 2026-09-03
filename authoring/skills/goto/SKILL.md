---
name: goto
description: "Adapts a beat whose playable action is reaching a known parcel, district, station, or stop."
triggers:
  - "go to a place"
  - "reach a location"
kind: mechanic
mechanic: goto
---

# Go to a place

Use `goto` when arrival itself changes the story or unlocks the next action.

- Target: exactly one existing `parcelId`, `districtId`, `stationId`, or `stopId` in `target.place`.
- Completion event: `arrivedAt` with the same place id.
- Preconditions: graph edges, step conditions, and any `needs` items.
- State change: completes the step, applies effects, and follows passing edges.
- Failure: arrival at another place or an unavailable condition does not progress.

Record why reaching this place matters now and what the arrival enables. This mechanic does not transport characters or items and does not prove that the player inspected anything.
