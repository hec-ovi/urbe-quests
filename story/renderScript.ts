/** Renders script parts back to prose for the stages that read the story. */

import { MOVEMENTS, type ScriptCharacter, type StoryScript } from './schema.js';

export function renderCards(characters: ScriptCharacter[]): string {
  return characters
    .map((c) => [`${c.name}`, `Role: ${c.role}`, `Background: ${c.background}`, `Want: ${c.want}`, `Voice: ${c.voice}`].join('\n'))
    .join('\n\n');
}

export function renderMovements(script: StoryScript): string {
  return MOVEMENTS.map((name) => {
    const heading = name.charAt(0).toUpperCase() + name.slice(1);
    const passages = script.movements[name].map((p) => `${p.heading}\n${p.text}`).join('\n\n');
    return `${heading}\n\n${passages}`;
  }).join('\n\n');
}

export function renderScript(script: StoryScript): string {
  return [script.title, script.logline, 'Characters', renderCards(script.characters), renderMovements(script)].join('\n\n');
}
