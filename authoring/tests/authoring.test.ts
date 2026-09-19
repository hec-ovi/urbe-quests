/**
 * Contract-surface tests for quests/authoring: the skill resolver, the story
 * stage, the gameplay stage, and every closed error in the envelope.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import adaptationFixture from '../fixtures/adaptation.json' with { type: 'json' };
import storyFixture from '../fixtures/story.json' with { type: 'json' };
import worldFixture from '../fixtures/world-context.json' with { type: 'json' };
import { AuthoringHarness, SkillResolver } from '../index.js';
import type {
  AdaptationOutput,
  AdaptationRequest,
  GameplayAgentPort,
  GameplayAgentRequest,
  MechanicSelectionAgentRequest,
  StoryAgentPort,
  StoryAgentRequest,
  StoryOutput,
  StoryRequest,
  WorldContext,
} from '../src/schema.js';

const context = worldFixture as WorldContext;
const story = storyFixture as StoryOutput;
const adaptation = adaptationFixture as AdaptationOutput;
const storyRequest: StoryRequest = { prompt: story.prompt, ...context };
const adaptationRequest: AdaptationRequest = { story, ...context, requestedMechanics: ['talk', 'pickup', 'deliver'] };

const clone = <T>(value: T): T => structuredClone(value);
const storyPort = (output: unknown): StoryAgentPort => ({ write: async () => output });
const gameplayPort = (output: AdaptationOutput): GameplayAgentPort => ({
  selectMechanics: async () => ({ mechanics: ['talk', 'pickup', 'deliver'] }),
  adapt: async () => output,
});

describe('skill resolver', () => {
  it('discovers a lightweight index, routes text and loads only selected bodies', () => {
    const api = new AuthoringHarness();
    const index = api.skillIndex();
    expect(index.skills).toHaveLength(18);
    expect(index.skills.every((skill) => !('content' in skill))).toBe(true);
    expect(api.route('adapt story to gameplay, then pick up an item').matches.map((skill) => skill.name))
      .toEqual(['gameplay-adaptation', 'pickup']);
    const resolved = api.resolveSkills(['gameplay-adaptation', 'pickup']);
    expect(resolved.skills.map((skill) => skill.name)).toEqual(['gameplay-adaptation', 'pickup']);
    expect(resolved.skills.every((skill) => skill.content.includes('# ') && skill.path.endsWith('SKILL.md'))).toBe(true);
  });

  it('rejects malformed queries, an unknown skill and an invalid catalog through its public errors', () => {
    const api = new AuthoringHarness();
    expect(() => api.route('')).toThrowError(expect.objectContaining({ code: 'E_AUTHORING_INPUT' }));
    expect(() => api.resolveSkills([])).toThrowError(expect.objectContaining({ code: 'E_AUTHORING_INPUT' }));
    try {
      api.resolveSkills(['negotiation']);
      expect.fail('unknown skill accepted');
    } catch (error) {
      expect(error).toMatchObject({ code: 'E_UNKNOWN_SKILL' });
      expect((error as { toJSON(): unknown }).toJSON()).toMatchObject({
        code: 'E_UNKNOWN_SKILL', message: expect.any(String), details: [],
      });
    }

    const root = mkdtempSync(join(tmpdir(), 'quests-skills-'));
    try {
      mkdirSync(join(root, 'broken'));
      writeFileSync(join(root, 'broken', 'SKILL.md'), '# missing frontmatter\n');
      expect(() => new SkillResolver(root).index()).toThrowError(expect.objectContaining({ code: 'E_SKILL_CONTRACT' }));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('story stage', () => {
  it('projects authoritative Naming output into its own schema-constrained skill request', async () => {
    const input = clone(storyRequest) as StoryRequest & { world: StoryRequest['world'] & { stats?: object } };
    Object.assign(input.world.meta, { version: '0.1.0', bounds: { min: [0, 0], max: [1, 1] } });
    Object.assign(input.world.districts[0]!, { center: [0, 0], boundary: [[0, 0]], maxFloors: 4 });
    input.world.stats = { population: 10 };
    const write = vi.fn(async (request: StoryAgentRequest): Promise<unknown> => {
      expect(request.input.world.meta.naming).toEqual(context.world.meta.naming);
      expect(request.input.types.namePool.givenByGender).toEqual(context.types.namePool.givenByGender);
      expect(Object.keys(request.input.world.transit ?? {}).sort()).toEqual(['busStops', 'trainStations']);
      expect(request.input.world.meta).not.toHaveProperty('version');
      expect(request.input.world.districts[0]).not.toHaveProperty('center');
      expect(request.input.world).not.toHaveProperty('stats');
      return clone(story);
    });

    await expect(new AuthoringHarness().writeStory(input, { write })).resolves.toEqual(story);
    expect(write).toHaveBeenCalledOnce();
    expect(input.world).toHaveProperty('stats');

    const request = write.mock.calls[0]?.[0];
    expect(request?.stage).toBe('story');
    expect(request?.skills.skills.map((skill) => skill.name)).toEqual(['story-writing']);
    expect(request?.outputSchema.rootId).toBe('urn:urbe:quests:authoring:story-output');
    expect(request?.outputSchema.documents.map((schema) => (schema as { $id: string }).$id)).toEqual([
      'urn:urbe:quests:authoring:story-output',
      'urn:urbe:quests:authoring:values',
    ]);
  });

  it('keeps a malformed or incompletely named world inside the closed input error', async () => {
    const write = vi.fn(async (): Promise<unknown> => clone(story));
    const malformed = clone(storyRequest);
    (malformed as unknown as { types: { namePool: null } }).types.namePool = null;
    await expect(new AuthoringHarness().writeStory(malformed, { write })).rejects.toMatchObject({ code: 'E_AUTHORING_INPUT' });

    const missingName = clone(storyRequest);
    delete (missingName.world.districts[0] as Partial<(typeof missingName.world.districts)[number]>).name;
    await expect(new AuthoringHarness().writeStory(missingName, { write })).rejects.toMatchObject({ code: 'E_AUTHORING_INPUT' });
    expect(write).not.toHaveBeenCalled();
  });

  it('rejects a broken world before writing, and malformed, inconsistent or unplaced story output after it', async () => {
    const harness = new AuthoringHarness();
    const write = vi.fn(async (): Promise<unknown> => clone(story));
    const brokenContext = clone(storyRequest);
    brokenContext.world.parcels[0]!.districtId = 'd_missing';
    await expect(harness.writeStory(brokenContext, { write })).rejects.toMatchObject({
      code: 'E_WORLD_TARGET',
      details: [expect.stringContaining('d_missing')],
    });
    expect(write).not.toHaveBeenCalled();

    await expect(harness.writeStory(storyRequest, storyPort({ storyId: 'unfinished' })))
      .rejects.toMatchObject({ code: 'E_AUTHORING_OUTPUT' });

    const unknownCharacter = clone(story);
    unknownCharacter.movements.conflict[0]!.characterIds = ['unknown'];
    await expect(harness.writeStory(storyRequest, storyPort(unknownCharacter))).rejects.toMatchObject({
      code: 'E_CAUSE_EFFECT',
      details: expect.arrayContaining([expect.stringContaining('unknown character')]),
    });

    const unknownPlace = clone(story);
    unknownPlace.movements.development[0]!.scene.placeName = 'Imaginary Station';
    await expect(harness.writeStory(storyRequest, storyPort(unknownPlace))).rejects.toMatchObject({
      code: 'E_WORLD_TARGET',
      details: [expect.stringContaining('Imaginary Station')],
    });
  });
});

describe('gameplay stage', () => {
  it('selects mechanics from the cheap index, then loads only the selected fat skills', async () => {
    const selectMechanics = vi.fn(async (_request: MechanicSelectionAgentRequest): Promise<unknown> => ({ mechanics: ['talk', 'pickup', 'deliver'] }));
    const adapt = vi.fn(async (_request: GameplayAgentRequest): Promise<unknown> => clone(adaptation));
    expect(await new AuthoringHarness().adaptGameplay(adaptationRequest, { selectMechanics, adapt })).toEqual(adaptation);

    const selectionRequest = selectMechanics.mock.calls[0]?.[0];
    expect(selectionRequest?.skills.skills.map((skill) => skill.name)).toEqual(['gameplay-adaptation']);
    expect(selectionRequest?.availableSkills.skills.map((skill) => skill.name)).toEqual(['deliver', 'pickup', 'talk']);
    expect(selectionRequest?.availableSkills.skills.every((skill) => !('content' in skill))).toBe(true);

    const gameplayRequest = adapt.mock.calls[0]?.[0];
    expect(gameplayRequest?.skills.skills.map((skill) => skill.name)).toEqual(['gameplay-adaptation', 'talk', 'pickup', 'deliver']);
    expect(gameplayRequest?.skills.skills.every((skill) => skill.content.includes('# '))).toBe(true);
    expect(gameplayRequest?.outputSchema.rootId).toBe('urn:urbe:quests:authoring:adaptation-output');
  });

  it('rejects an unsupported caller mechanic, and an unsupported or disallowed agent selection', async () => {
    const harness = new AuthoringHarness();
    const adapt = vi.fn();
    const inert = { selectMechanics: vi.fn(async (): Promise<unknown> => ({ mechanics: [] })), adapt };
    await expect(harness.adaptGameplay({ ...adaptationRequest, requestedMechanics: ['talk', 'negotiation'] }, inert))
      .rejects.toMatchObject({ code: 'E_UNSUPPORTED_MECHANIC', details: ['negotiation'] });
    expect(inert.selectMechanics).not.toHaveBeenCalled();

    await expect(harness.adaptGameplay(adaptationRequest, { selectMechanics: async () => ({ mechanics: ['negotiation'] }), adapt }))
      .rejects.toMatchObject({ code: 'E_MECHANIC_SELECTION', details: ['unsupported: negotiation'] });
    await expect(harness.adaptGameplay(adaptationRequest, { selectMechanics: async () => ({ mechanics: ['observe'] }), adapt }))
      .rejects.toMatchObject({ code: 'E_MECHANIC_SELECTION', details: ['outside caller allowlist: observe'] });
    expect(adapt).not.toHaveBeenCalled();
  });

  it('names every place from the world and fails closed on places or NPC types outside it', async () => {
    const harness = new AuthoringHarness();
    const deliverStep = (output: AdaptationOutput) => {
      const publish = output.definition.steps.find((step) => step.stepId === 's_publish')!;
      if (publish.target.kind !== 'deliver') throw new Error('fixture target changed');
      return publish.target;
    };

    const station = clone(adaptation);
    deliverStep(station).place = { stationId: 'station_harbor' } as never;
    const adapted = await harness.adaptGameplay(adaptationRequest, gameplayPort(station));
    expect(deliverStep(adapted).place).toEqual({ stationId: 'station_harbor', name: 'Harbor Station' });

    for (const [output, absent] of [
      [(() => { const o = clone(adaptation); deliverStep(o).place = { parcelId: 'p_missing' } as never; return o; })(), 'p_missing'],
      [(() => { const o = clone(adaptation); deliverStep(o).place = { stopId: 'stop_missing' } as never; return o; })(), 'stop_missing'],
      [(() => { const o = clone(adaptation); o.definition.roles[0]!.npcType = 'invented_role'; return o; })(), 'invented_role'],
    ] as const) {
      await expect(harness.adaptGameplay(adaptationRequest, gameplayPort(output))).rejects.toMatchObject({
        code: 'E_WORLD_TARGET',
        details: [expect.stringContaining(absent)],
      });
    }
  });

  it('rejects a graph-invalid definition and inexact mechanic, transition, beat or ending traces', async () => {
    const harness = new AuthoringHarness();
    const invalid = clone(adaptation);
    invalid.definition.steps[1]!.stepId = 's_request';
    await expect(harness.adaptGameplay(adaptationRequest, gameplayPort(invalid))).rejects.toMatchObject({
      code: 'E_INVALID_FLOW',
      details: expect.arrayContaining([expect.stringContaining('duplicate step id')]),
    });

    const mismatch = clone(adaptation);
    mismatch.mechanicChoices.find((choice) => choice.stepId === 's_recover')!.mechanic = 'talk';
    mismatch.mechanicChoices.find((choice) => choice.stepId === 's_request')!.transitions = [];
    mismatch.mechanicChoices.find((choice) => choice.stepId === 's_publish')!.storyBeatIds = ['unknown_beat'];
    mismatch.endingRoutes.find((route) => route.endingId === 'e_publish')!.storyOutcomeIds = ['o_protect'];

    await expect(harness.adaptGameplay(adaptationRequest, gameplayPort(mismatch))).rejects.toMatchObject({
      code: 'E_CAUSE_EFFECT',
      details: expect.arrayContaining([
        expect.stringContaining('records talk but targets pickup'),
        expect.stringContaining('transition trace'),
        expect.stringContaining('unknown story beat'),
        expect.stringContaining('maps to more than one ending'),
      ]),
    });
  });
});
