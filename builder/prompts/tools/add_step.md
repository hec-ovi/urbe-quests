## description

Add a step. Write the narrative and the stake first, then the mechanics. Every step names the role who wants it. Steps connect through next edges; a step with no edges is terminal and needs an endingId. Mark starting steps with entry: true.

## narrative

What happens in the story at this step.

## playerHint

What the player sees as the objective. Name an hour ("during the slow hour", "after dark", "before noon", "at 21:00") only when the step really is open then: the city turns those words into a gate the runtime checks, and the character is cast from whoever holds that post at that hour.

## stake

What this step means to the person who wants it and what it costs them if it does not happen, in their own truth.

## wantedByRoleId

The role whose want this step serves; they speak the stake to the player.

## dialogue

For talk targets, author the conversation the player actually reads: opening in the named character's voice, then choices with unique id, the player's spoken text, the NPC's reply, and completesStep. Include a question with completesStep false and an explicit commitment with completesStep true. The commitment reply explains the next lead or the ending's consequences. Do not copy the objective or retrospective narrative into the opening. All completing choices on a step have that step's outcome; represent different outcomes with separate graph steps, and name the consequences in their choices. Opening, typing free chat, or closing the conversation never commits a choice. No dialogue on other mechanic targets.

## target

The typed objective. Use the exact fields in the step catalog. Investigation, rescue, escort, access, hacking, sabotage, and transportation require a completionFlag set by the step effects.

## gives

Item ids the player receives when the step completes (handed over, or information told).

## needs

Item ids the player must hold to act on the step.

## conditions

Extra gates; usually empty.

## next

Outgoing edges. Empty means terminal (set endingId).

## branching

exclusive: only the first passing edge activates.

## entry

true for steps active when the questline starts.
