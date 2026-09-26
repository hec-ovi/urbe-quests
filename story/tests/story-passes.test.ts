/** Contract-surface tests for the two story passes: parse with minimums, one repair round, E_LLM. */

import { describe, expect, it } from 'vitest';
import type { LLMPort } from '../../ports/llm.js';
import { loadFixtureWorld } from '../../world/index.js';
import { loadFixtureStory } from '../fixtures.js';
import { parseScript } from '../parseScript.js';
import { DEFAULT_SCRIPT_MINIMUMS, ScriptPass } from '../ScriptPass.js';
import { SituationsPass } from '../SituationsPass.js';

const FIXTURE = loadFixtureStory('cyberpunk');
const PROMPT = 'create a dark cynical sci fi cyberpunk story';
const SCRIPT = parseScript(FIXTURE.script, 'cyberpunk', DEFAULT_SCRIPT_MINIMUMS);
/** The script fixture with only its first three character cards. */
const THIN = FIXTURE.script.replace(/### Sergeant Dev Okoro[\s\S]*?(?=## Presentation)/, '');
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

const world = () => loadFixtureWorld('neon-bay');
const scriptInput = (llm: LLMPort) => ({ ...world(), llm, prompt: PROMPT });
const situationsInput = (llm: LLMPort) => ({ ...world(), llm, script: SCRIPT });

describe('ScriptPass', () => {
  it('writes the whole script in one text-only call: cards, four movements of passages, raw kept', async () => {
    const { llm, calls } = fakeLLM([FIXTURE.script]);
    const { script, raw } = await new ScriptPass().run(scriptInput(llm));

    expect(calls).toHaveLength(1);
    expect(calls[0]!.system).toContain('At least 5 named characters and at least 2 passages');
    expect(calls[0]!.prompt).toContain(PROMPT);
    expect(calls[0]!.prompt).toContain('Crown Spire');
    expect(calls[0]!.prompt).not.toMatch(/parcelId|districtId|"p\d+"/);

    expect(script.prompt).toBe(PROMPT);
    expect(script.title).toBe('The Water Bill');
    expect(script.logline).toContain('the water keeps rising');
    expect(script.characters).toHaveLength(6);
    expect(script.characters[0]).toMatchObject({ name: 'Mara Vex', role: 'a barista at the Static Cafe in Kanaal Market' });
    expect(script.characters[0]!.voice).toContain("Coffee's free if you're paying with bad news.");
    expect(script.movements.presentation[0]).toMatchObject({ heading: 'Rain on the Static Cafe' });
    expect(Object.values(script.movements).map((m) => m.length)).toEqual([2, 2, 2, 2]);
    expect(raw).toBe(FIXTURE.script);
  });

  it('repairs a script below the minimums once, then throws E_LLM with the raw text', async () => {
    const repaired = fakeLLM([THIN, FIXTURE.script]);
    const { script } = await new ScriptPass().run({ ...scriptInput(repaired.llm), minimums: { characters: 5 } });
    expect(repaired.calls).toHaveLength(2);
    expect(repaired.calls[1]!.prompt).toContain('- 3 character cards under "## Characters", at least 5 needed');
    expect(repaired.calls[1]!.prompt).toContain('Rain on the Static Cafe');
    expect(script.characters).toHaveLength(6);

    const hopeless = fakeLLM(['no headings', 'still none']);
    await expect(new ScriptPass().run(scriptInput(hopeless.llm))).rejects.toThrowError(
      expect.objectContaining({ code: 'E_LLM', detail: expect.objectContaining({ stage: 'script', raw: 'still none' }) }),
    );
  });

  it('asks again for a title copied from the format rather than written', async () => {
    const { llm, calls } = fakeLLM([FIXTURE.script.replace('# The Water Bill', '# Title'), FIXTURE.script]);
    const { script } = await new ScriptPass().run(scriptInput(llm));
    expect(calls[0]!.system).toContain("# <the story's title>");
    expect(calls[1]!.prompt).toContain('- the title line reads "Title", copied from the format; write the story\'s own title');
    expect(script.title).toBe('The Water Bill');
  });
});

describe('SituationsPass', () => {
  it('writes situations from the rendered script, each a four-part arc with its characters', async () => {
    const { llm, calls } = fakeLLM([FIXTURE.situations]);
    const { situations, raw } = await new SituationsPass().run(situationsInput(llm));

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

  it('repairs a situation with a missing part once, then throws E_LLM', async () => {
    const repaired = fakeLLM([BROKEN, FIXTURE.situations]);
    const { situations } = await new SituationsPass().run(situationsInput(repaired.llm));
    expect(repaired.calls).toHaveLength(2);
    expect(repaired.calls[1]!.prompt).toContain('- situation "The Last Fare": "### resolution" missing or empty');
    expect(situations).toHaveLength(3);

    const hopeless = fakeLLM(['nothing', 'nothing again']);
    await expect(new SituationsPass().run(situationsInput(hopeless.llm))).rejects.toThrowError(
      expect.objectContaining({ code: 'E_LLM', detail: expect.objectContaining({ stage: 'situations' }) }),
    );
  });

  it('asks again for a situation titled from the format, like another one or like the script, since a questline is known by its title', async () => {
    const [first, second, third] = [...FIXTURE.situations.matchAll(/^## (.+)$/gm)].map((heading) => heading[1]!);
    const clashing = FIXTURE.situations.replace(`## ${second}\n`, `## ${first!.toUpperCase()}\n`).replace(`## ${third}\n`, `## ${SCRIPT.title}\n`);
    const { llm, calls } = fakeLLM([clashing, FIXTURE.situations]);
    const { situations } = await new SituationsPass().run(situationsInput(llm));
    expect(calls[1]!.prompt).toContain(`- situation "${first!.toUpperCase()}": the title is already taken; give it its own`);
    expect(calls[1]!.prompt).toContain(`- situation "${SCRIPT.title}": the title is already taken; give it its own`);
    expect(new Set(situations.map((situation) => situation.title)).size).toBe(3);

    const copied = fakeLLM([FIXTURE.situations.replace(`## ${first}\n`, "## <the situation's title>\n"), FIXTURE.situations]);
    await new SituationsPass().run(situationsInput(copied.llm));
    expect(copied.calls[0]!.system).toContain("## <the situation's title>");
    expect(copied.calls[1]!.prompt).toContain(`- situation "<the situation's title>": the title is copied from the format; write the situation's own`);
  });
});
