## description

Add a step. Write the narrative and the stake first, then the mechanics. Every step names the role who wants it. Steps connect through next edges; a step with no edges is terminal and needs an endingId. Mark starting steps with entry: true.

## narrative

What happens in the story at this step.

## playerHint

What the player sees as the objective.

## stake

What this step means to the person who wants it and what it costs them if it does not happen, in their own truth.

## wantedByRoleId

The role whose want this step serves; they speak the stake to the player.

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
