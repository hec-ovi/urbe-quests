---
name: observe
description: "Adapts a beat as a district-wide observation supported by the runtime."
triggers:
  - "observe a district"
  - "inspect an area"
kind: mechanic
mechanic: observe
---

# Observe a district

Use `observe` when watching a district reveals a pattern or confirms a story fact.

- Target: one existing `districtId`.
- Completion event: `observed` with the same district id.
- Preconditions: graph edges, conditions, and needed inventory.
- State change: may give information, set flags, and activate later steps.
- Failure: observing a different district or failing a condition does not progress.

Record what becomes knowable through observation and why that knowledge changes the next beat. The runtime does not model individual clues, bodies, evidence transforms, or per-clue persistence. Do not describe those as implemented targets.
