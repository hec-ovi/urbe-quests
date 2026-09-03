---
name: deliver
description: "Adapts a beat as carrying a held physical item to a known place."
triggers:
  - "deliver an item"
  - "bring an object to a place"
kind: mechanic
mechanic: deliver
---

# Deliver an item

Use `deliver` when transferring a physical item at a destination is the consequential action.

- Target: one declared non-information `itemId` and one existing parcel or district in `target.place`.
- Completion event: `delivered` with the same item and place id.
- Preconditions: the item is held, the destination matches, and all graph conditions pass.
- State change: removes the delivered item from runtime inventory, applies effects, and follows the next edges.
- Failure: missing item, wrong destination, or failed condition does not progress or consume the item.

Record who receives or benefits from the transfer, what possession changes, and why the delivery causes the following beat.
