## description

Add a step. Write the narrative and the stake first, then the mechanics. Every step names the role who wants it. Steps connect through next edges; a step with no edges is terminal and needs an endingId. Mark starting steps with entry: true. Calling it again with a stepId already added replaces that step.

## narrative

The scene shown before speech and in a completion notice: one sentence, at most 24 words and 180 characters, or empty. Describe the present situation without deciding for the player.

## playerHint

One imperative objective, about 8 words, at most 10 words and 90 characters. Name the action, person/object and actual venue or building kind. Name an hour ("during the slow hour", "after dark", "before noon", "at 21:00") only when the step really is open then: the city turns those words into a gate the runtime checks, and the character is cast from whoever holds that post at that hour.

## stake

One concrete reason this matters now, at most one sentence, 24 words and 180 characters.

## wantedByRoleId

The role whose want this step serves; they speak the stake to the player.

## dialogue

For talk targets, author the conversation the player actually reads (opening and each reply: at most 3 sentences, 45 words, 300 characters; each choice: at most 2 sentences, 12 words, 100 characters, one line): opening in the named character's voice, then choices with unique id, the player's spoken text, the NPC's reply, and completesStep. Include a question with completesStep false and an explicit commitment with completesStep true. The commitment reply explains the next lead or the ending's consequences. Do not copy the objective or retrospective narrative into the opening. An opening that starts a questline, or where the player meets this character for the first time, works cold, because the player knows only the prologue and the objective: a greeting or an acknowledgement, who the character is to the player, why the player is here, then the matter, in a few spoken sentences. A later opening picks up from the last meeting. All completing choices on a step have that step's outcome; represent different outcomes with separate graph steps, and name the consequences in their choices. Opening, typing free chat, or closing the conversation never commits a choice. The NPC's lines are voiced: the opening and a reply may carry an inline cue where the sound belongs, one of {{cues}} and no other bracketed word, and only where the moment calls for it; the player's text carries none. No dialogue on other mechanic targets.

## target

The typed objective: kind plus the fields that kind takes. Every place (place, from, to) holds exactly one parcelId, districtId, stationId or stopId from the world catalog.
- goto: place.
- observe: districtId.
- talk: roleId; optional atParcelId, the parcel where the talk happens.
- listen: roleIds, exactly two different roles; atParcelId.
- pickup: itemId, a physical item that has an atParcelId.
- deliver: itemId (physical), place.
- steal: itemId (physical), fromRoleId.
- assassinate: roleId.
- work: atParcelId, role (the job the player takes there).
- investigation: sceneId, evidenceId, evidenceItemId (an information item this step gives), subjectRoleIds (the roles the clue implicates; an empty list when none), place, completionFlag.
- rescue: roleId, releaseTargetId, place, completionFlag.
- escort: roleId, routeId, mode (follow-player: the character follows the player; lead-player: the character walks the player there, so to is a building, station or stop), from and to (two different places), completionFlag.
- access: accessPointId, credentialItemId (a key, information or device item this step needs), place, completionFlag.
- hacking: targetId, place, completionFlag.
- sabotage: targetId, place, completionFlag.
- transportation: journeyId, mode (ride-hail, public-transit, vehicle, animal or aircraft), from and to (two different places), passengerRoleIds (roles travelling with the player; an empty list when the player travels alone), cargoItemIds (physical items this step needs; an empty list when none), completionFlag.

## authored-ids

Ids a target names that are not a role, item or place (sceneId, routeId, targetId and the like) are short ids you author for this questline; the host's completion event repeats them exactly. Each completionFlag must be set by a setFlag in this step's effects.

## gives

Item ids the player receives when the step completes (handed over, or information told).

## needs

Item ids the player must hold to act on the step.

## conditions

Extra gates; usually empty.

## next

Outgoing edges. Each goes to a step from the plan (toStepId) and activates when every predicate in its when passes; an empty when always passes. The flow runs one way: no edge points to the step itself or back to a step that leads here, and every step must be reachable from an entry step. A step with edges names no endingId; with no edges the step is terminal and names its endingId.

## branching

parallel (the default): every passing edge activates. exclusive: only the first passing edge activates, so an edge with an empty when must come last; use it where the story diverges for good.

## entry

true for steps active when the questline starts.
