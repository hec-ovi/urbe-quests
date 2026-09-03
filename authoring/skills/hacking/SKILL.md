---
name: hacking
description: "Adapts one authored digital intrusion against an exact target at a known place."
triggers:
  - "hack a target"
  - "breach a terminal"
kind: mechanic
mechanic: hacking
---

# Hacking

Use `hacking` only when the world's era and the story provide an eligible digital or electronic target.

- Target: one `targetId`, one existing `place`, and one declared `completionFlag`.
- Completion event: `hacked` with the same target and place ids after the host's supported interaction succeeds.
- Preconditions: required devices, credentials, discoveries, and prior state are named in `needs` and `conditions`.
- State change: `gives` records authored data learned or recovered; effects set the completion flag and any access or world consequences.
- Failure: the wrong target or place, a failed host interaction, or an unmet prerequisite does not progress.

Examples: extract a service code from a cyberpunk terminal or rewrite a drone's authorized route in a near-future depot. Do not select hacking for a setting without compatible technology; use investigation, access, talk, or sabotage when those actions fit instead.
