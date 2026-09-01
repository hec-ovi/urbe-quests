/** Contract-surface tests for the situations pass: parse with minimum count, repair round, E_LLM. */

import { describe, expect, it } from 'vitest';
import type { LLMPort } from '../../ports/llm.js';
import { loadFixtureWorld } from '../../world/index.js';
import { loadFixtureStory } from '../fixtures.js';
import { parseScript } from '../parseScript.js';
import { DEFAULT_SCRIPT_MINIMUMS } from '../ScriptPass.js';
import { SituationsPass } from '../SituationsPass.js';

const FIXTURE = loadFixtureStory('cyberpunk');
const SCRIPT = parseScript(FIXTURE.script, 'cyberpunk', DEFAULT_SCRIPT_MINIMUMS);
const BROKEN = FIXTURE.situations.replace('### Resolution\nThe bus stops', '### Coda\nThe bus stops');

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
  return { script: SCRIPT, world, types, llm };
}

describe('SituationsPass', () => {
  it('writes situations from the rendered script, each a four-part arc with its characters', async () => {
    const { llm, calls } = fakeLLM([FIXTURE.situations]);
    const { situations, raw } = await new SituationsPass().run(input(llm));

    expect(calls).toHaveLength(1);
    expect(calls[0]!.system).toContain('at least 3');
    expect(calls[0]!.prompt).toContain('Rain on the Static Cafe');
    expect(calls[0]!.prompt).toContain('Voice: Dry, short');

    expect(situations.map((s) => s.situationId)).toEqual(['sit_1', 'sit_2', 'sit_3']);
    expect(situations[0]).toMatchObject({ title: 'The Last Fare' });
    expect(situations[0]!.characters).toEqual([
      { name: 'Petra Lind', description: 'from the script' },
      { name: 'Sergeant Dev Okoro', description: 'from the script' },
      { name: 'Rue', description: 'the night bus driver on the Rustfields line, a bus driver who talks like the route map, stop by stop' },
    ]);
    expect(situations[2]!.resolution).toContain('Bao does not sign.');
    expect(raw).toBe(FIXTURE.situations);
  });

  it('repairs a situation with a missing part once, naming it', async () => {
    const { llm, calls } = fakeLLM([BROKEN, FIXTURE.situations]);
    const { situations } = await new SituationsPass().run(input(llm));
    expect(calls).toHaveLength(2);
    expect(calls[1]!.prompt).toContain('- situation "The Last Fare": "### resolution" missing or empty');
    expect(situations).toHaveLength(3);
  });

  it('throws E_LLM when repair also fails', async () => {
    const { llm } = fakeLLM(['nothing', 'nothing again']);
    await expect(new SituationsPass().run(input(llm))).rejects.toThrowError(
      expect.objectContaining({ code: 'E_LLM', detail: expect.objectContaining({ stage: 'situations' }) }),
    );
  });
});
