## description

Add a character role. Bind it to an NPC type from the catalog, never to an id or a location; the simulation decides who, where and when. Write the persona as story: personality, needs, drives. Preserve the script's named character in characterName so dialog and player labels use the same name as the story.

## persona

Personality, needs, drives and voice, written as story in the script's voice. The simulation supplies this person's home, job, family and schedule, so leave those out.

## npcType

Type string from the NPC type catalog.

## reservedName

A fixed identity in the simulation: a living person of this type with this name is reused, and when no one holds a post for the role the city creates one with this name. Set it for a character who must stay the same person across questlines, and for anyone the player meets away from a workplace (a neighbour, a relative, someone at home), since people without it are found by where they work. The name shown in dialog comes from characterName.

## characterName

The given and family name used by the script, dialog and player labels for this character. This is a story presentation name: the cast keeps its existing NPC identity, schedule and saved history. Set it for a named story character without requiring reservedName. Leave it absent when the story leaves the character unnamed.
