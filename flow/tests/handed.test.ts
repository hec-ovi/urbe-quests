/**
 * Handing a quest item to a person: a deliver step it is for completes,
 * through the place it names or the person who wants it; a talk with the
 * person who needs it counts it as brought, for that person alone; an item no
 * step still to come uses leaves the story; anything else stays in hand. What
 * was handed is kept in the saved state only once there is something to keep.
 */

import { describe, expect, it } from 'vitest';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { loadFixtureWorld, StubSimulation } from '../../world/index.js';
import type { QuestlineDefinition, QuestStep, ResolvedCast } from '../schema.js';
import { QuestlineRuntime } from '../QuestlineRuntime.js';
import stateSchema from '../schema/questline-state.schema.json' with { type: 'json' };
import eventSchema from '../schema/player-event.schema.json' with { type: 'json' };

const TUE_10 = 1 * 1440 + 600;

const step = (input: Partial<QuestStep> & Pick<QuestStep, 'stepId' | 'target'>): QuestStep => ({
  actId: 'a1', narrative: { description: 'A beat.', playerHint: 'Do it.', stake: 'Nobody else will.' },
  gives: [], needs: [], conditions: [], effects: [], next: [], branching: 'parallel', ...input,
});

/**
 * A drink for two people who each talk only to someone who brings one, a chip
 * the barista wants carried to the tower, and a note posted at the precinct.
 * The coin the drink comes with is never asked for again.
 */
function definition(): QuestlineDefinition {
  return {
    id: 'q_gift',
    title: 'The Gift',
    premise: 'Two people talk only to someone who brings them a drink.',
    roles: [
      { roleId: 'barista', npcType: 'cafe_barista', persona: 'Nervy, owes money.' },
      { roleId: 'exec', npcType: 'corpo_exec', persona: 'Collects favours.' },
    ],
    items: [
      { itemId: 'DRINK_WHISKY', name: 'amber whisky', description: 'A glass for whoever asks.', kind: 'substance', atParcelId: 'p7' },
      { itemId: 'COIN', name: 'a brass coin', description: 'Change from the drink.', kind: 'valuable' },
      { itemId: 'CHIP', name: 'Scorched data chip', description: 'Her only leverage.', kind: 'device', atParcelId: 'p7' },
      { itemId: 'NOTE', name: 'A folded note', description: 'For the precinct desk.', kind: 'document', atParcelId: 'p7' },
    ],
    facts: [],
    acts: [{ actId: 'a1', title: 'Errands', summary: 'Carry things.' }],
    steps: [
      step({ stepId: 's_whisky', target: { kind: 'pickup', itemId: 'DRINK_WHISKY' }, gives: ['COIN'], next: [{ toStepId: 's_chip', when: [] }] }),
      step({ stepId: 's_chip', target: { kind: 'pickup', itemId: 'CHIP' }, next: [{ toStepId: 's_note', when: [] }] }),
      step({ stepId: 's_note', target: { kind: 'pickup', itemId: 'NOTE' }, next: [{ toStepId: 's_exec', when: [] }, { toStepId: 's_barista', when: [] }] }),
      step({ stepId: 's_exec', target: { kind: 'talk', roleId: 'exec' }, needs: ['DRINK_WHISKY'], next: [{ toStepId: 's_hand', when: [] }] }),
      step({ stepId: 's_barista', target: { kind: 'talk', roleId: 'barista', atParcelId: 'p4' }, needs: ['DRINK_WHISKY'], next: [{ toStepId: 's_hand', when: [] }] }),
      step({
        stepId: 's_hand', wantedByRoleId: 'barista',
        target: { kind: 'deliver', itemId: 'CHIP', place: { parcelId: 'p1', name: 'Helix Dynamics Tower' } },
        next: [{ toStepId: 's_post', when: [] }],
      }),
      step({ stepId: 's_post', target: { kind: 'deliver', itemId: 'NOTE', place: { parcelId: 'p8', name: 'Precinct 9' } }, endingId: 'e_done' }),
    ],
    endings: [{ endingId: 'e_done', title: 'Posted', epilogue: 'The note lies on the desk.' }],
    flags: [],
    entryStepIds: ['s_whisky'],
  };
}

function setup(def = definition()) {
  const { world, types } = loadFixtureWorld('neon-bay');
  const sim = new StubSimulation({ seed: 'handed-test', world, types });
  const barista = sim.getNPCVendor({ type: 'cafe_barista', timeMin: TUE_10 });
  const exec = sim.reserveNPC({ name: { given: 'Vela', family: 'Marsh' }, type: 'corpo_exec', jobParcelId: 'p1' });
  const cast: ResolvedCast = { barista: barista.npcId, exec: exec.npcId };
  return { def, sim, cast, baristaId: barista.npcId, execId: exec.npcId, runtime: new QuestlineRuntime(def, cast, sim) };
}

/** Picks up the drink (and its coin), the chip and the note. */
function pickedUp(runtime: QuestlineRuntime): QuestlineRuntime {
  for (const itemId of ['DRINK_WHISKY', 'CHIP', 'NOTE']) runtime.advance({ kind: 'pickedUp', itemId }, TUE_10);
  return runtime;
}

describe('handing a quest item to a person', () => {
  it('counts a drink handed to the person whose talk needs it as brought, for that person\'s talk alone', () => {
    const { runtime, execId, baristaId } = setup();
    pickedUp(runtime);
    expect(runtime.handable('DRINK_WHISKY', execId)).toBe('theirs');
    expect(runtime.hand('DRINK_WHISKY', execId, undefined, TUE_10)).toEqual({ completedStepIds: [], activatedStepIds: [], how: 'theirs' });
    expect([...runtime.inventory()].sort()).toEqual(['CHIP', 'COIN', 'NOTE']);
    expect(runtime.handedItems().get('DRINK_WHISKY')).toBe(execId);
    expect(runtime.stepAvailability('s_exec', TUE_10)).toEqual({ available: true });
    expect(runtime.stepAvailability('s_barista', TUE_10)).toEqual({ available: false, reason: 'missing_item' });
    // Handed, it is no longer the player's to hand again.
    expect(runtime.handable('DRINK_WHISKY', baristaId)).toBeUndefined();
    expect(runtime.advance({ kind: 'talkedTo', npcId: execId }, TUE_10).completedStepIds).toEqual(['s_exec']);
  });

  it('keeps an item a step still to come needs, delivers or uses, and lets it go once none does', () => {
    const { runtime, execId, baristaId } = setup();
    runtime.advance({ kind: 'pickedUp', itemId: 'DRINK_WHISKY' }, TUE_10);
    // Two talks later on need the drink; the coin it came with nothing ever asks for.
    expect(runtime.handable('DRINK_WHISKY', execId)).toBeUndefined();
    expect(runtime.handable('COIN', execId)).toBe('free');
    runtime.advance({ kind: 'pickedUp', itemId: 'CHIP' }, TUE_10);
    runtime.advance({ kind: 'pickedUp', itemId: 'NOTE' }, TUE_10);
    expect(runtime.handable('NOTE', baristaId)).toBeUndefined();
    runtime.advance({ kind: 'talkedTo', npcId: execId }, TUE_10);
    // The barista's talk still needs the drink.
    expect(runtime.handable('DRINK_WHISKY', execId)).toBeUndefined();
    runtime.advance({ kind: 'talkedTo', npcId: baristaId }, TUE_10);
    expect(runtime.handable('DRINK_WHISKY', execId)).toBe('free');
    expect(runtime.hand('DRINK_WHISKY', execId, undefined, TUE_10).how).toBe('free');
    expect(runtime.inventory().has('DRINK_WHISKY')).toBe(false);
    // Something never held goes nowhere.
    expect(runtime.handable('DRINK_WHISKY', execId)).toBeUndefined();
    expect(() => runtime.hand('DRINK_WHISKY', execId, undefined, TUE_10)).toThrowError(expect.objectContaining({ code: 'E_UNAVAILABLE' }));
  });

  it('completes the deliver step an item is for, handed where the step points or to the person who wants it', () => {
    const atPlace = setup();
    pickedUp(atPlace.runtime);
    atPlace.runtime.advance({ kind: 'talkedTo', npcId: atPlace.execId }, TUE_10);
    // The chip's deliver is now active: the exec standing at the tower takes it there; anywhere else they have no use for it.
    expect(atPlace.runtime.handable('CHIP', atPlace.execId)).toBeUndefined();
    expect(atPlace.runtime.handable('CHIP', atPlace.execId, { parcelId: 'p1' })).toBe('deliver');
    expect(atPlace.runtime.hand('CHIP', atPlace.execId, { parcelId: 'p1' }, TUE_10)).toEqual({
      completedStepIds: ['s_hand'], activatedStepIds: ['s_post'], how: 'deliver',
    });
    expect(atPlace.runtime.inventory().has('CHIP')).toBe(false);
    expect(atPlace.runtime.handedItems().size).toBe(0);

    const toWanter = setup();
    pickedUp(toWanter.runtime);
    toWanter.runtime.advance({ kind: 'talkedTo', npcId: toWanter.execId }, TUE_10);
    expect(toWanter.runtime.handable('CHIP', toWanter.baristaId)).toBe('deliver');
    // The handedTo event does the same as hand().
    expect(toWanter.runtime.advance({ kind: 'handedTo', itemId: 'CHIP', npcId: toWanter.baristaId }, TUE_10)).toEqual({
      completedStepIds: ['s_hand'], activatedStepIds: ['s_post'], how: 'deliver',
    });
  });

  it('refuses a deliver its gates refuse at that minute', () => {
    const def = definition();
    def.steps.find((entry) => entry.stepId === 's_hand')!.window = { label: 'evening', days: [1], startMin: 1080, endMin: 1320 };
    const { runtime, execId, baristaId } = setup(def);
    pickedUp(runtime);
    runtime.advance({ kind: 'talkedTo', npcId: execId }, TUE_10);
    expect(runtime.handable('CHIP', baristaId)).toBe('deliver');
    expect(runtime.handable('CHIP', baristaId, undefined, TUE_10)).toBeUndefined();
    expect(() => runtime.hand('CHIP', baristaId, undefined, TUE_10)).toThrowError(expect.objectContaining({ code: 'E_UNAVAILABLE' }));
    expect(runtime.inventory().has('CHIP')).toBe(true);
  });

  it('saves what was handed sorted by item, only once something was, and restores it', () => {
    const { def, sim, cast, runtime, execId, baristaId } = setup();
    pickedUp(runtime);
    const before = runtime.serialize();
    expect('handed' in before).toBe(false);
    expect(QuestlineRuntime.restore(def, cast, sim, before).serialize()).toEqual(before);

    runtime.hand('DRINK_WHISKY', execId, undefined, TUE_10);
    runtime.hand('COIN', baristaId, undefined, TUE_10);
    const saved = runtime.serialize();
    expect(saved.handed).toEqual([{ itemId: 'COIN', npcId: baristaId }, { itemId: 'DRINK_WHISKY', npcId: execId }]);
    expect(new Ajv2020({ strict: true }).compile(stateSchema)(saved)).toBe(true);
    const restored = QuestlineRuntime.restore(def, cast, sim, structuredClone(saved));
    expect(restored.serialize()).toEqual(saved);
    expect([...restored.inventory()].sort()).toEqual(['CHIP', 'NOTE']);
    expect(restored.stepAvailability('s_exec', TUE_10)).toEqual({ available: true });
  });

  it('refuses a saved hand-over of an unknown item, the same item twice, an item never held, or a malformed entry', () => {
    const { def, sim, cast, runtime, execId } = setup();
    pickedUp(runtime);
    const state = runtime.serialize();
    const restore = (handed: unknown) => QuestlineRuntime.restore(def, cast, sim, { ...state, handed });
    expect(() => restore([{ itemId: 'GHOST', npcId: execId }])).toThrowError(/handed unknown item GHOST/);
    expect(() => restore([{ itemId: 'COIN', npcId: execId }, { itemId: 'COIN', npcId: 'someone' }])).toThrowError(/handed COIN twice/);
    expect(() => restore([{ itemId: 'COIN', npcId: '' }])).toThrowError(/npcId must be a nonempty string/);
    expect(() => restore([{ itemId: 'COIN', npcId: execId, extra: 1 }])).toThrowError(/handed entries are/);
    expect(() => restore('COIN')).toThrowError(/handed must be an array/);
    const early = new QuestlineRuntime(def, cast, sim);
    expect(() => QuestlineRuntime.restore(def, cast, sim, { ...early.serialize(), handed: [{ itemId: 'CHIP', npcId: execId }] }))
      .toThrowError(/never left with the player/);
  });

  it('describes the event and the saved key in their schemas', () => {
    const event = new Ajv2020({ strict: true }).compile(eventSchema);
    expect(event({ kind: 'handedTo', itemId: 'DRINK_WHISKY', npcId: 'a1' })).toBe(true);
    expect(event({ kind: 'handedTo', itemId: 'DRINK_WHISKY', npcId: 'a1', parcelId: 'p1699' })).toBe(true);
    expect(event({ kind: 'handedTo', itemId: 'DRINK_WHISKY', npcId: 'a1', parcelId: 'p1', stopId: 's1' })).toBe(false);
    expect(event({ kind: 'handedTo', itemId: 'DRINK_WHISKY' })).toBe(false);
    const state = new Ajv2020({ strict: true }).compile(stateSchema);
    expect(state({ activeStepIds: [], completedStepIds: [], flags: [], handed: [{ itemId: 'X', npcId: 'a1', extra: true }] })).toBe(false);
  });
});
