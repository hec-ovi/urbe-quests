import { AuthoringError } from './AuthoringError.js';
import type { StoryOutput, StoryRequest } from './schema.js';

export class StoryAudit {
  validate(story: StoryOutput, request?: StoryRequest): void {
    const problems: string[] = [];
    if (request && story.prompt !== request.prompt) problems.push('story prompt does not match the authoring request');

    const characterIds = unique(story.characters.map((character) => character.characterId), 'character', problems);
    const beats = Object.values(story.movements).flat();
    unique(beats.map((beat) => beat.beatId), 'story beat', problems);
    unique(story.decisions.map((decision) => decision.decisionId), 'decision', problems);
    unique(story.decisions.flatMap((decision) => decision.options.map((option) => option.outcomeId)), 'outcome', problems);

    let dialogueLines = 0;
    for (const beat of beats) {
      for (const characterId of beat.characterIds) {
        if (!characterIds.has(characterId)) problems.push(`story beat ${beat.beatId} names unknown character ${characterId}`);
      }
      for (const line of beat.dialogue) {
        dialogueLines += 1;
        if (!characterIds.has(line.speakerCharacterId)) {
          problems.push(`story beat ${beat.beatId} gives dialogue to unknown character ${line.speakerCharacterId}`);
        }
        if (!beat.characterIds.includes(line.speakerCharacterId)) {
          problems.push(`story beat ${beat.beatId} dialogue speaker ${line.speakerCharacterId} is absent from the scene`);
        }
      }
    }
    if (dialogueLines === 0) problems.push('story has no scripted dialogue');

    if (problems.length > 0) throw new AuthoringError('E_CAUSE_EFFECT', 'story identity audit failed', problems);
  }
}

function unique(ids: string[], subject: string, problems: string[]): Set<string> {
  const found = new Set<string>();
  for (const id of ids) {
    if (found.has(id)) problems.push(`duplicate ${subject} id ${id}`);
    found.add(id);
  }
  return found;
}
