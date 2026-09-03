---
name: sabotage
description: "Adapts one deliberate non-random state change against an exact target at a known place."
triggers:
  - "sabotage a target"
  - "disable a system"
kind: mechanic
mechanic: sabotage
---

# Sabotage

Use `sabotage` when the authored story requires changing or disabling a particular target, including a data-bearing target whose state must change rather than be stolen.

- Target: one `targetId`, one existing `place`, and one declared `completionFlag`.
- Completion event: `sabotaged` with the same target and place ids after the supported interaction succeeds.
- Preconditions: tools, information, access, and prior discoveries are named in `needs` and `conditions`.
- State change: effects set the completion flag plus every authored quest or simulation consequence. Later branches must test those declared consequences.
- Failure: damage to another object, random violence, the wrong place, host interaction failure, or an unmet prerequisite does not progress.

Examples: alter one archive record at its terminal, disable a factory relay with the specified tool, or remove a named pin from a carriage brake before an unmanned test. The action is story-directed and target-bound, not freeform destruction.
