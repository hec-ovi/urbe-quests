# Quest authoring skill contract

Discover skills by reading the YAML frontmatter of every `skills/<slug>/SKILL.md` file. The `triggers` list is authoritative for message routing. `RESOLVER.md` is the compact human-readable map and must agree with those lists.

Read the index before loading skill bodies. Resolve the story or gameplay stage skill first, then load only the mechanic skills selected for the current story. Read every selected `SKILL.md` in full before producing output.

Skills contain judgment and procedure. TypeScript below `authoring/src/` owns schema validation, supported-mechanic checks, world-id checks, flow validation, and cause-effect trace checks. An agent must not bypass those deterministic checks.

Every skill has these frontmatter fields:

```yaml
---
name: pickup
description: "When and how to adapt a story beat as a physical item pickup."
triggers:
  - "pick up an item"
kind: mechanic
mechanic: pickup
---
```

Stage skills omit `mechanic`. Optional fields are omitted, not left empty.
