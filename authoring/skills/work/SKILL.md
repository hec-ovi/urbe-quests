---
name: work
description: "Adapts a beat as completing a named work shift at an existing parcel."
triggers:
  - "work a shift"
  - "perform a job"
kind: mechanic
mechanic: work
---

# Work a shift

Use `work` when performing an ordinary job provides access, cover, income context, or a story consequence.

- Target: one existing `atParcelId` and a nonempty human-readable `role` for the shift.
- Completion event: `workedShift` with the same parcel id.
- Preconditions: the player is at the parcel and all inventory and graph gates pass.
- State change: completes the shift step, applies effects, and follows passing edges.
- Failure: wrong workplace or failed gate does not progress.

Record why this job is available, what the player does during the shift, and why completing it changes the story. The runtime records shift completion; detailed job minigames require a separate supported mechanic.
