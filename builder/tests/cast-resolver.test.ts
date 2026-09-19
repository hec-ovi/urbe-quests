/**
 * Contract-surface tests for cast resolution: a published step and its cast
 * name the same place, and a questline the city cannot staff comes back
 * blocked with its reason instead of being dropped.
 */

import { describe, expect, it } from 'vitest';
import { loadFixtureWorld, StubSimulation } from '../../world/index.js';
import type { QuestlineDefinition, QuestRole, QuestStep, StepTarget } from '../../flow/schema.js';
import { CastResolver } from '../CastResolver.js';
import { StoryVenues } from '../StoryVenues.js';

/** Tuesday 10:00, inside the day post. */
const TUE_10 = 1 * 1440 + 600;

const role = (roleId: string, npcType: string): QuestRole => ({ roleId, npcType, persona: 'Runs the floor upstairs.' });

const step = (stepId: string, target: StepTarget, wantedByRoleId?: string): QuestStep => ({
  stepId,
  actId: 'a1',
  narrative: { description: 'The floor boss wants a word.', playerHint: 'Talk to the executive.', stake: 'She loses the floor.' },
  ...(wantedByRoleId !== undefined ? { wantedByRoleId } : {}),
  target,
  gives: [],
  needs: [],
  conditions: [],
  effects: [],
  next: [],
  branching: 'parallel',
});

const questline = (roles: QuestRole[], steps: QuestStep[]): QuestlineDefinition => ({
  id: 'q_tower',
  title: 'The Tower Floor',
  premise: 'An executive needs a word off the record.',
  roles,
  items: [],
  facts: [],
  acts: [{ actId: 'a1', title: 'The Word', summary: 'Meet her.' }],
  steps,
  endings: [{ endingId: 'e1', title: 'Said', epilogue: 'The word is out.' }],
  flags: [],
  entryStepIds: [steps[0]!.stepId],
});

function resolver() {
  const { world, types } = loadFixtureWorld('neon-bay');
  const sim = new StubSimulation({ seed: 'cast-test', world, types });
  return { sim, cast: new CastResolver(sim, new StoryVenues(world, types)) };
}

describe('CastResolver', () => {
  it('publishes every step at the parcel its cast works at, names included', () => {
    const { sim, cast } = resolver();
    // The story pins the executive to Spire Residences: people live there, nobody is hired there.
    const authored = questline(
      [role('exec', 'corpo_exec')],
      [
        step('s_go', { kind: 'goto', place: { parcelId: 'p13', name: 'Spire Residences' } }, 'exec'),
        step('s_talk', { kind: 'talk', roleId: 'exec', atParcelId: 'p13' }),
      ],
    );

    const result = cast.cast(authored, TUE_10);

    expect(result.blocked).toBeUndefined();
    const workplace = sim.getNPC(result.cast['exec']!).job?.parcelId;
    expect(workplace).toBe('p1');
    expect(result.definition.steps[1]!.target).toEqual({ kind: 'talk', roleId: 'exec', atParcelId: workplace });
    expect(result.definition.steps[0]!.target).toEqual({
      kind: 'goto',
      place: { parcelId: workplace, name: 'Helix Dynamics Tower' },
    });
  });

  it('publishes a questline it cannot staff with the reason, instead of dropping it', () => {
    const { cast } = resolver();
    // Nobody is hired to be a resident, and no Sump resident exists to play the part.
    const authored = questline(
      [role('exec', 'corpo_exec'), role('neighbour', 'sump_resident')],
      [step('s_talk', { kind: 'talk', roleId: 'neighbour' })],
    );

    const result = cast.cast(authored, TUE_10);

    expect(result.blocked).toMatchObject({ roleId: 'neighbour', npcType: 'sump_resident' });
    expect(result.blocked?.reason).toContain('cannot be cast');
    expect(result.definition.id).toBe('q_tower');
  });
});
