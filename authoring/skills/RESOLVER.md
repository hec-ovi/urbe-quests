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

## Disambiguation

1. Pick the mechanic that represents the player's consequential action, not a noun in the prose.
2. `pickup` is an unowned placed object. `steal` is a physical item held by a living character.
3. `observe` records a district-wide observation. It cannot represent individual clues or staged evidence.
4. `listen` needs exactly two roles at one parcel. A direct exchange is `talk`.
5. `goto` proves arrival only. It cannot transport another person or object.
6. Information is granted by `talk`, `listen`, or `observe`; it is never picked up, delivered, or stolen.
7. Hacking, sabotage, rescue, escort, entry codes, and transportation are unsupported. Do not approximate or silently rename them.
