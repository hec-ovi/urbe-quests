---
name: rescue
description: "Adapts releasing one cast character through an exact authored interaction at a known place."
triggers:
  - "release a captive"
  - "rescue a character"
kind: mechanic
mechanic: rescue
---

# Rescue and release

Use `rescue` when the consequential action is releasing or directly assisting one character. Reaching safety afterward is a separate `escort` step.

- Target: one declared `roleId`, one `releaseTargetId`, one existing `place`, and one declared `completionFlag`.
- Completion event: `released` with the role's resolved NPC id and the same release target and place.
- Preconditions: the cast character is alive and available, and the step's exact `needs` and `conditions` pass.
- State change: effects set the completion flag and any authored character or world consequences before following edges.
- Failure: the wrong person, interaction, or place, a dead or unavailable role, or a failed prerequisite does not progress.

Examples: open a hostage restraint in a corporate clinic, lift a trapped traveler from a crashed carriage, or release a pilot from a disabled aircraft. Do not turn a rescue into an unauthored combat encounter.
