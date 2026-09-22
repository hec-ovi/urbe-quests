## description

Add a character role. Bind it to an NPC type from the catalog, never to an id or a location; the simulation decides who, where and when. Write the persona as story: personality, needs, drives. Preserve the script's named character in characterName so dialog and player labels use the same name as the story.

## persona

Personality, needs and story on top of the mathematical background.

## npcType

Type string from the NPC type catalog.

## reservedName

Only for a pre-instanced story NPC with a fixed identity.

## characterName

The given and family name used by the script, dialog and player labels for this character. This is a story presentation name: the cast keeps its existing NPC identity, schedule and saved history. Set it for a named story character without requiring reservedName. Leave it absent when the story leaves the character unnamed.
