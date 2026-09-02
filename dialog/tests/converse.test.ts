/** Contract-surface test for Converse: the reply is asked from the layers and the line alone. */

import { describe, expect, it } from 'vitest';
import type { LLMPort } from '../../ports/llm.js';
import { Converse } from '../Converse.js';
import type { DialogContext } from '../schema.js';

const context: DialogContext = {
  npcId: 'npc-1',
  segments: [
    { id: 'world', text: 'WORLD LAYER', shared: true },
    { id: 'type', text: 'TYPE LAYER', shared: true },
    { id: 'npc', text: 'NPC LAYER', shared: false },
    { id: 'turns', text: 'TURNS LAYER', shared: false },
  ],
};

describe('Converse', () => {
  it('sends the layers in order as the system prompt and the player line as the turn', async () => {
    const seen: { system: string; prompt: string }[] = [];
    const llm: LLMPort = {
      async complete(request) {
        seen.push(request);
        return '  Not tonight, friend.\n';
      },
    };

    const reply = await new Converse(llm).reply({ context, name: 'Mara Voss', line: 'Where is the lift?' });

    expect(reply).toBe('Not tonight, friend.');
    expect(seen).toHaveLength(1);
    expect(seen[0]?.system).toBe('WORLD LAYER\n\nTYPE LAYER\n\nNPC LAYER\n\nTURNS LAYER');
    expect(seen[0]?.prompt).toContain('"Where is the lift?"');
    expect(seen[0]?.prompt).toContain('Answer as Mara Voss');
  });
});
