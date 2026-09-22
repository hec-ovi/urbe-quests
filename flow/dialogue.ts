import type { QuestlineDefinition, QuestStep, QuestStepDialogue } from './schema.js';

/** Legacy definitions remain playable offline. Authored dialogue always takes precedence. */
export function stepDialogue(def: QuestlineDefinition, step: QuestStep): QuestStepDialogue {
  if (step.dialogue !== undefined) return step.dialogue;
  const ending = def.endings.find((entry) => entry.endingId === step.endingId);
  const items = step.gives.map((id) => def.items.find((item) => item.itemId === id)?.name).filter(Boolean);
  const next = step.next.map((edge) => def.steps.find((entry) => entry.stepId === edge.toStepId)?.narrative.playerHint)
    .filter(Boolean).join(' ');
  return {
    opening: `You came about ${def.title}. Tell me what you need.`,
    choices: [
      { id: 'ask_details', text: 'What do I need to know?', reply: step.narrative.stake, completesStep: false },
      {
        id: 'resolve',
        text: ending !== undefined ? `I'm ready: ${ending.title}.` : step.narrative.playerHint,
        reply: ending !== undefined
          ? ending.epilogue
          : `${items.length > 0 ? `Here, take ${items.join(' and ')}. ` : 'All right. '}${next || 'That settles it.'}`,
        completesStep: true,
      },
    ],
  };
}
