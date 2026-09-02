/**
 * Contract-surface tests for quests/dialog: layer order and sharing, closed
 * knowledge with flag gating, tiered memory, death, persistence.
 */

import { describe, expect, it } from 'vitest';
import type { LLMPort } from '../../ports/llm.js';
import { loadFixtureWorld, StubSimulation } from '../../world/index.js';
import type { QuestlineDefinition } from '../../flow/schema.js';
import { QuestlineRuntime } from '../../flow/QuestlineRuntime.js';
import { DialogContextService } from '../DialogContextService.js';

const TUE_10 = 1 * 1440 + 600;

const DEF: QuestlineDefinition = {
  id: 'q_rumor',
  title: 'The Rumor Mill',
  premise: 'A barista trades in rumors; one of them is dangerous.',
  roles: [
    { roleId: 'informer', npcType: 'cafe_barista', persona: 'Collects rumors like tips.' },
    { roleId: 'buyer', npcType: 'corpo_exec', persona: 'Pays for silence.', reservedName: { given: 'Vela', family: 'Marsh' } },
  ],
  items: [],
  facts: [
    { factId: 'f_open', roleId: 'informer', text: 'The Arcade cameras have been dark for a week.' },
    { factId: 'f_secret', roleId: 'informer', text: 'Helix pays someone at Precinct 9 in clinic credit.', gateFlag: 'trusted' },
    { factId: 'f_buyer', roleId: 'buyer', text: 'I bought the precinct list twice already.' },
  ],
  acts: [{ actId: 'a1', title: 'Coffee', summary: 'Earn trust.' }],
  steps: [
    {
      stepId: 's_talk',
      actId: 'a1',
      narrative: {
        description: 'Small talk first.',
        playerHint: 'Talk to the barista at the Static Cafe.',
        stake: 'She needs someone to carry the precinct rumor out before it carries her.',
      },
      wantedByRoleId: 'informer',
      target: { kind: 'talk', roleId: 'informer', atParcelId: 'p4' },
      gives: [],
      needs: [],
      conditions: [],
      effects: [{ kind: 'setFlag', flag: 'trusted' }],
      next: [],
      branching: 'parallel',
      endingId: 'e_done',
    },
  ],
  endings: [{ endingId: 'e_done', title: 'In Confidence', epilogue: 'The rumor changes hands.' }],
  flags: ['trusted'],
  entryStepIds: ['s_talk'],
};

function setup(memory?: { tailSize: number; foldSize: number }) {
  const { world, types } = loadFixtureWorld('neon-bay');
  const sim = new StubSimulation({ seed: 'dialog-test', world, types });
  const informer = sim.getNPCVendor({ type: 'cafe_barista', timeMin: TUE_10 });
  const buyer = sim.reserveNPC({ name: { given: 'Vela', family: 'Marsh' }, type: 'corpo_exec', jobParcelId: 'p1' });
  const llmCalls: string[] = [];
  const llm: LLMPort = {
    complete: async ({ prompt }) => {
      llmCalls.push(prompt);
      return 'They talked about the dark cameras; the barista stayed wary.';
    },
  };
  const service = new DialogContextService({ world, types, sim, llm, ...(memory ? { memory } : {}) });
  const runtime = new QuestlineRuntime(DEF, { informer: informer.npcId, buyer: buyer.npcId }, sim);
  service.attachQuestline(runtime);
  return { sim, service, runtime, informerId: informer.npcId, buyerId: buyer.npcId, llmCalls };
}

describe('DialogContextService', () => {
  it('replaces a questline attached again under the same id instead of stacking it', () => {
    const { service, runtime, informerId, sim } = setup();
    const again = QuestlineRuntime.restore(runtime.def, runtime.cast, sim, runtime.serialize());
    service.attachQuestline(again);
    const quest = service.contextFor(informerId, TUE_10).segments.find((s) => s.id === 'quest');
    const wants = quest?.text.split('\n').filter((line) => line.startsWith('- ')) ?? [];
    expect(wants.length).toBe(new Set(wants).size);
  });

  it('layers context in cache order with shared world and type segments and the closed knowledge scope', () => {
    const { service, informerId, buyerId } = setup();
    const context = service.contextFor(informerId, TUE_10);

    expect(context.segments.map((s) => s.id)).toEqual(['world', 'type', 'npc', 'quest', 'turns']);
    expect(context.segments.filter((s) => s.shared).map((s) => s.id)).toEqual(['world', 'type']);

    const [world, type, npc, quest, turns] = context.segments;
    expect(world!.text).toContain('deflect in character');
    expect(world!.text).toContain('Crown Spire');
    expect(type!.text).toContain('neon-lit cafe');
    expect(npc!.text).toMatch(/You are .+ .+\./);
    expect(npc!.text).toContain('You work at Static Cafe in Kanaal Market');
    expect(npc!.text).toContain('Collects rumors like tips.');
    expect(quest!.text).toContain('The Arcade cameras have been dark');
    expect(turns!.text).toContain('It is Tuesday 10:00');

    const all = context.segments.map((s) => s.text).join('\n');
    expect(all).not.toContain('Helix pays someone at Precinct 9');
    expect(all).not.toContain('I bought the precinct list');

    expect(service.contextFor(buyerId, TUE_10).segments[0]!.text).toBe(world!.text);
  });

  it('carries the giver\'s active want mid-quest and the epilogue once the questline ends, only for the cast', () => {
    const { service, runtime, informerId, buyerId } = setup();
    const quest = (npcId: string) => service.contextFor(npcId, TUE_10).segments.find((s) => s.id === 'quest')?.text ?? '';
    expect(quest(informerId)).toContain('What you want from the player right now');
    expect(quest(informerId)).toContain('carry the precinct rumor out');
    expect(quest(buyerId)).not.toContain('carry the precinct rumor out');

    runtime.advance({ kind: 'talkedTo', npcId: informerId }, TUE_10);
    expect(quest(informerId)).not.toContain('What you want from the player');
    expect(quest(informerId)).toContain('How it ended, as you lived it:\n- The rumor changes hands.');
    expect(quest(buyerId)).toContain('The rumor changes hands.');
  });

  it('reveals a gated fact only after the quest flag unlocks it', () => {
    const { service, runtime, informerId } = setup();
    runtime.advance({ kind: 'talkedTo', npcId: informerId }, TUE_10);
    const text = service
      .contextFor(informerId, TUE_10)
      .segments.map((s) => s.text)
      .join('\n');
    expect(text).toContain('Helix pays someone at Precinct 9');
  });

  it('keeps a verbatim tail and folds overflow into a digest through the LLM', async () => {
    const { service, informerId, llmCalls } = setup({ tailSize: 4, foldSize: 2 });
    for (let i = 1; i <= 5; i++) {
      await service.recordTurn(informerId, { speaker: i % 2 === 1 ? 'player' : 'npc', text: `line ${i}`, atMin: TUE_10 + i });
    }
    expect(llmCalls).toHaveLength(1);
    expect(llmCalls[0]).toContain('line 1');

    const context = service.contextFor(informerId, TUE_10);
    expect(context.segments.map((s) => s.id)).toContain('memory');
    const memory = context.segments.find((s) => s.id === 'memory')!;
    expect(memory.text).toContain('the barista stayed wary');
    const turns = context.segments.find((s) => s.id === 'turns')!;
    expect(turns.text).not.toContain('line 1');
    expect(turns.text).toContain('Player: line 5');
  });

  it('refuses context for a dead NPC with E_WRONG_STATE', () => {
    const { sim, service, informerId } = setup();
    sim.applyFlag(informerId, { kind: 'die' });
    expect(() => service.contextFor(informerId, TUE_10)).toThrowError(expect.objectContaining({ code: 'E_WRONG_STATE' }));
  });

  it('round-trips memory through serialize and restore', async () => {
    const first = setup();
    await first.service.recordTurn(first.informerId, { speaker: 'player', text: 'remember me', atMin: TUE_10 });
    const saved = first.service.serializeMemory();

    const second = setup();
    second.service.restoreMemory(saved);
    const turns = second.service.contextFor(second.informerId, TUE_10).segments.find((s) => s.id === 'turns')!;
    expect(turns.text).toContain('remember me');
  });
});
