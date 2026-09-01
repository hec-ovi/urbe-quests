/** Turns story outputs into translation assignments: the whole script for the main line, one situation per side quest. */

import type { QuestAssignment } from '../builder/schema.js';
import { renderCards, renderMovements } from '../story/renderScript.js';
import type { Situation, StoryScript } from '../story/schema.js';

export class Assignments {
  constructor(private readonly script: StoryScript) {}

  main(): QuestAssignment {
    return {
      title: this.script.title,
      synopsis: this.script.logline,
      characters: renderCards(this.script.characters),
      arc: renderMovements(this.script),
    };
  }

  /** Borrowed characters bring their full script card; new ones bring the situation's line about them. */
  situation(situation: Situation): QuestAssignment {
    const cards = situation.characters.map((c) => {
      const fromScript = this.script.characters.find((s) => s.name.toLowerCase() === c.name.toLowerCase());
      return fromScript !== undefined ? renderCards([fromScript]) : `${c.name}\nRole: ${c.description}`;
    });
    return {
      title: situation.title,
      synopsis: `${this.script.logline}\n\nThis situation happens in that city while the main story unfolds, and orbits it without resolving it.`,
      characters: cards.join('\n\n'),
      arc: [
        `Presentation\n${situation.presentation}`,
        `Development\n${situation.development}`,
        `Conflict\n${situation.conflict}`,
        `Resolution\n${situation.resolution}`,
      ].join('\n\n'),
    };
  }
}
