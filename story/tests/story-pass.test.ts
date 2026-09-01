/** Contract-surface tests for quests/story: parse, repair round, E_LLM. */

import { describe, expect, it } from 'vitest';
import type { LLMPort } from '../../ports/llm.js';
import { loadFixtureWorld } from '../../world/index.js';
import { StoryPass } from '../StoryPass.js';

const GOOD = `## Introduction
The Sump floods again and Crown Spire pretends not to notice.

## Development
A chip of boardroom audio starts changing hands in Kanaal Market.

## Conflict
Helix Dynamics sends collectors; Precinct 9 picks a side.

## Resolution
The city keeps the truth or sells it; either way the water rises.

## Side Quests

### The Kettle Debt
A barista owes the wrong lender and wants one favor run quietly.

### Doc Sanna's List
The Sump's medic needs supplies that only fall off corpo trucks.

### The Last Fare
A fab worker saw something from the night bus and cannot unsee it.
`;

function fakeLLM(responses: string[]): { llm: LLMPort; calls: { system: string; prompt: string }[] } {
  const calls: { system: string; prompt: string }[] = [];
  const queue = [...responses];
  return {
    calls,
    llm: {
      complete: async (request) => {
        calls.push(request);
        return queue.shift() ?? '';
      },
    },
  };
}

function fixtureInput(llm: LLMPort) {
  const { world, types } = loadFixtureWorld('neon-bay');
  return { world, types, llm };
}

describe('StoryPass', () => {
  it('produces a four-movement mainline and side premises from one backbone call, exposing raw text', async () => {
    const { llm, calls } = fakeLLM([GOOD]);
    const result = await new StoryPass().run(fixtureInput(llm));
    expect(calls).toHaveLength(1);
    expect(calls[0]!.prompt).toContain('Crown Spire');
    expect(calls[0]!.prompt).not.toMatch(/parcelId|districtId|"p\d+"/);
    expect(result.document.theme).toContain('cyberpunk');
    expect(result.document.mainline.conflict).toContain('Helix');
    expect(result.document.sidePremises).toHaveLength(3);
    expect(result.document.sidePremises[0]).toEqual({
      premiseId: 'sp_1',
      title: 'The Kettle Debt',
      premise: 'A barista owes the wrong lender and wants one favor run quietly.',
    });
    expect(result.raw).toBe(GOOD);
  });

  it('repairs a malformed answer once, keeping the story text in the repair prompt', async () => {
    const { llm, calls } = fakeLLM(['a story with no headings at all', GOOD]);
    const result = await new StoryPass().run(fixtureInput(llm));
    expect(calls).toHaveLength(2);
    expect(calls[1]!.prompt).toContain('a story with no headings at all');
    expect(result.document.sidePremises).toHaveLength(3);
  });

  it('throws E_LLM with the raw text when repair also fails', async () => {
    const { llm } = fakeLLM(['garbage', 'still garbage']);
    await expect(new StoryPass().run(fixtureInput(llm))).rejects.toThrowError(
      expect.objectContaining({ code: 'E_LLM' }),
    );
  });
});
