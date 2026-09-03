---
name: pickup
description: "Adapts a beat as collecting a placed physical quest item."
triggers:
  - "pick up an item"
  - "collect an object"
kind: mechanic
mechanic: pickup
---

# Pick up an item

Use `pickup` when an unowned physical object is already placed in the world and taking it is the action.

- Target: a declared non-information `itemId` whose item has an existing `atParcelId`.
- Completion event: `pickedUp` with the same item id.
- Preconditions: graph conditions and required items pass. The host enforces reach, visibility, collision, and duplicate removal.
- State change: the target item enters runtime inventory on completion; `gives` can add other declared items, and later delivery removes the delivered item.
- Failure: wrong item, failed gate, or host interaction failure retains the object and inventory state.

Record who the object matters to, why it was placed there, why taking it changes the story, and what holding it enables. Information cannot be picked up.
