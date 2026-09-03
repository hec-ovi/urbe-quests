---
name: investigation
description: "Adapts one stage of an authored incident as inspection of exact evidence at a known place."
triggers:
  - "investigate a scene"
  - "inspect staged evidence"
kind: mechanic
mechanic: investigation
---

# Investigation

Use `investigation` for one fixed clue in a deliberately staged incident. Model a sequence of clues as separate ordered steps, with earlier evidence in `needs` or a prior completion flag in `conditions`.

- Target: one `sceneId`, one interactable `evidenceId`, one information `evidenceItemId`, the exact `subjectRoleIds` implicated by the clue, one existing `place`, and one declared `completionFlag`.
- Completion event: `investigated` with the same scene, evidence, and place ids.
- Preconditions: graph edges, `needs`, and `conditions` define which earlier discoveries are required. The named evidence item must be granted in `gives`.
- State change: the information item records what the clue proves; effects set the completion flag and any separately authored consequences.
- Failure: another clue, scene, or place does not progress. A physical object that leaves the scene uses `pickup` instead.

Examples: inspect a blood-spatter direction in a city apartment, compare wheel scoring at a street collision, or read disturbed ash around a medieval forge. Decorative bodies, furniture, stains, and damage are not evidence unless named by an investigation step.
