---
name: steal
description: "Adapts a beat as taking a physical item from a living cast character."
triggers:
  - "steal an object"
  - "take an item from a character"
kind: mechanic
mechanic: steal
---

# Steal an object

Use `steal` when a specific living character holds the physical object and taking it without a normal handoff is the story action.

- Target: one declared non-information `itemId` and one declared `fromRoleId`.
- Completion event: `stole` with the same item id.
- Preconditions: the source role is alive and all step gates pass. The host enforces targeting, reach, and visibility.
- State change: the target item enters runtime inventory on completion; `gives` can add other declared items, then effects and branches apply.
- Failure: a dead source, wrong item, failed gate, or host interaction failure leaves progress unchanged.

Record why the holder has the item, why consent is unavailable, what risk the theft creates, and how possession changes the next step. The runtime does not model stealth detection or ownership consequences unless explicit flags and later steps represent them.
