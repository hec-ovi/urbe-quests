/** Contract-surface tests for the script pass: parse with minimums, repair round, E_LLM. */

import { describe, expect, it } from 'vitest';
import type { LLMPort } from '../../ports/llm.js';
import { loadFixtureWorld } from '../../world/index.js';
import { loadFixtureStory } from '../fixtures.js';
import { ScriptPass } from '../ScriptPass.js';

const SCRIPT = loadFixtureStory('cyberpunk').script;
/** The fixture with only its first three character cards. */
const THIN = SCRIPT.replace(/### Sergeant Dev Okoro[\s\S]*?(?=## Presentation)/, '');

function fakeLLM(responses: string[]) {
  const calls: { system: string; prompt: string }[] = [];
  const queue = [...responses];
  const llm: LLMPort = {
    complete: async (request) => {
      calls.push(request);
      return queue.shift() ?? '';
    },
  };
  return { llm, calls };
}

function input(llm: LLMPort) {
  const { world, types } = loadFixtureWorld('neon-bay');
  return { world, types, llm, prompt: 'create a dark cynical sci fi cyberpunk story' };
}

describe('ScriptPass', () => {
  it('writes the whole script in one text-only call: cards, four movements of passages, raw kept', async () => {
    const { llm, calls } = fakeLLM([SCRIPT]);
    const { script, raw } = await new ScriptPass().run(input(llm));

    expect(calls).toHaveLength(1);
    expect(calls[0]!.system).toContain('At least 5 named characters and at least 2 passages');
    expect(calls[0]!.prompt).toContain('create a dark cynical sci fi cyberpunk story');
    expect(calls[0]!.prompt).toContain('Crown Spire');
    expect(calls[0]!.prompt).not.toMatch(/parcelId|districtId|"p\d+"/);

    expect(script.prompt).toBe('create a dark cynical sci fi cyberpunk story');
    expect(script.title).toBe('The Water Bill');
    expect(script.logline).toContain('the water keeps rising');
    expect(script.characters).toHaveLength(6);
    expect(script.characters[0]).toMatchObject({ name: 'Mara Vex', role: 'a barista at the Static Cafe in Kanaal Market' });
    expect(script.characters[0]!.voice).toContain("Coffee's free if you're paying with bad news.");
    expect(script.movements.presentation[0]).toMatchObject({ heading: 'Rain on the Static Cafe' });
    expect(script.movements.presentation[0]!.text).toContain('Tomas');
    expect(Object.values(script.movements).map((m) => m.length)).toEqual([2, 2, 2, 2]);
    expect(raw).toBe(SCRIPT);
  });

  it('repairs a script below the minimums once, naming the shortfall and keeping the text', async () => {
    const { llm, calls } = fakeLLM([THIN, SCRIPT]);
    const { script } = await new ScriptPass().run({ ...input(llm), minimums: { characters: 5 } });
    expect(calls).toHaveLength(2);
    expect(calls[1]!.prompt).toContain('- 3 character cards under "## Characters", at least 5 needed');
    expect(calls[1]!.prompt).toContain('Rain on the Static Cafe');
    expect(script.characters).toHaveLength(6);
  });

  it('throws E_LLM with the raw text and problems when repair also fails', async () => {
    const { llm } = fakeLLM(['no headings', 'still none']);
    await expect(new ScriptPass().run(input(llm))).rejects.toThrowError(
      expect.objectContaining({ code: 'E_LLM', detail: expect.objectContaining({ stage: 'script', raw: 'still none' }) }),
    );
  });
});
