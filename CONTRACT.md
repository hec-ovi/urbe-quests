# CONTRACT: quests

Purpose: writes the world's main story and side quests, builds questlines as typed step flows resolved against real NPCs by type, and provides the NPC dialog context runtime (memory, knowledge graph, deflection).

Status: draft, schemas pending research.

## In (must cover)
- named world state and NPC types (naming)
- simulation query functions and routine schedules
- world description prompt
- player input and world flags at runtime

## Out (must cover)
- story document: main line plus side premises
- questline flows: steps with kind, target type, place, schedule window, branches
- NPC reservation requests toward simulation (pre-instanced quest NPCs with name and backstory)
- dialog context API: per-instance memory, knowledge graph queries, deflection behavior

## Errors
Closed set, to be defined.

## Depends on
- ../naming/CONTRACT.md
- ../simulation/CONTRACT.md
