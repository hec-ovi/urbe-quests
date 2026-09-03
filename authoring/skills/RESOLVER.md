# Quest authoring skill resolver

This is the compact dispatcher. Skill frontmatter triggers are authoritative. Read the matched skill before acting. The story stage and gameplay stage are separate; gameplay adaptation resolves only the mechanics it needs.

## Stages

| Trigger | Skill |
| --- | --- |
| "write a quest story", "author the story stage", "create a narrative quest" | `skills/story-writing/SKILL.md` |
| "adapt story to gameplay", "build a playable questline", "choose quest mechanics" | `skills/gameplay-adaptation/SKILL.md` |

## Supported mechanics

| Trigger | Skill |
| --- | --- |
| "go to a place", "reach a location" | `skills/goto/SKILL.md` |
| "observe a district", "inspect an area" | `skills/observe/SKILL.md` |
| "talk to a character", "have a conversation" | `skills/talk/SKILL.md` |
| "overhear a conversation", "listen to two characters" | `skills/listen/SKILL.md` |
| "pick up an item", "collect an object" | `skills/pickup/SKILL.md` |
| "deliver an item", "bring an object to a place" | `skills/deliver/SKILL.md` |
| "steal an object", "take an item from a character" | `skills/steal/SKILL.md` |
| "assassinate a character", "kill a quest target" | `skills/assassinate/SKILL.md` |
| "work a shift", "perform a job" | `skills/work/SKILL.md` |
| "investigate a scene", "inspect staged evidence" | `skills/investigation/SKILL.md` |
| "release a captive", "rescue a character" | `skills/rescue/SKILL.md` |
| "escort a character", "follow a character" | `skills/escort/SKILL.md` |
| "use an entry code", "open a restricted access point" | `skills/access/SKILL.md` |
| "hack a target", "breach a terminal" | `skills/hacking/SKILL.md` |
| "sabotage a target", "disable a system" | `skills/sabotage/SKILL.md` |
| "take a ride", "call a ride-hail" | `skills/transportation/SKILL.md` |

## Disambiguation

1. Pick the mechanic that represents the player's consequential action, not a noun in the prose.
2. `pickup` is an unowned placed object. `steal` is a physical item held by a living character.
3. `observe` records a district-wide pattern. `investigation` records one fixed clue in a staged scene; link several investigation steps for ordered evidence.
4. `listen` needs exactly two roles at one parcel. A direct exchange is `talk`.
5. `rescue` ends with release. Use `escort` for a cast character following or leading to safety afterward.
6. `access` uses an already obtained credential. `hacking` is one supported way to obtain data or change a compatible target; do not use it in an incompatible era.
7. `goto` proves player arrival only. `transportation` completes an authored journey with exact endpoints, passengers, and cargo. `deliver` transfers a held object at the destination.
8. Information is granted by `talk`, `listen`, `observe`, `investigation`, or `hacking`; it is never picked up, delivered, or stolen.
9. `sabotage` changes one named target through an authored interaction. It never means random destruction or violence.
10. `assassinate` remains available only when the story explicitly authors the fictional target and traces the consequences. Do not add a lethal objective to make a scene more eventful.
