import { describe, expect, it, vi } from 'vitest';
import adaptationFixture from '../fixtures/adaptation.json' with { type: 'json' };
import storyFixture from '../fixtures/story.json' with { type: 'json' };
import worldFixture from '../fixtures/world-context.json' with { type: 'json' };
import { AuthoringHarness } from '../src/AuthoringHarness.js';
import { GameplayStage } from '../src/GameplayStage.js';
import { StoryStage } from '../src/StoryStage.js';
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
const adaptationRequest: AdaptationRequest = {
  story,
  ...context,
  requestedMechanics: ['talk', 'pickup', 'deliver'],
};

describe('two-stage authoring harness', () => {
  it('keeps resolver, story, and gameplay as independently callable surfaces behind one thin facade', () => {
    const harness = new AuthoringHarness();
    expect(harness.skillIndex().skills).toHaveLength(18);
    expect(harness.route('build a playable questline').matches.map((skill) => skill.name)).toEqual(['gameplay-adaptation']);
    expect(harness.resolveSkills(['observe']).skills[0]?.mechanic).toBe('observe');
  });

  it('projects authoritative Naming output through the closed story boundary', async () => {
    const input = clone(storyRequest) as StoryRequest & {
      world: StoryRequest['world'] & { stats?: object };
    };
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
  });

  it('keeps malformed or incompletely named worlds inside the closed input error', async () => {
    const write = vi.fn(async (): Promise<unknown> => clone(story));
    const malformed = clone(storyRequest) as unknown as StoryRequest;
    (malformed as unknown as { types: { namePool: null } }).types.namePool = null;
    await expect(new AuthoringHarness().writeStory(malformed, { write })).rejects.toMatchObject({
      code: 'E_AUTHORING_INPUT',
    });

    const missingName = clone(storyRequest);
    delete (missingName.world.districts[0] as Partial<(typeof missingName.world.districts)[number]>).name;
    await expect(new AuthoringHarness().writeStory(missingName, { write })).rejects.toMatchObject({
      code: 'E_AUTHORING_INPUT',
    });
    expect(write).not.toHaveBeenCalled();
  });

  it('runs story writing as its own schema-constrained skill stage', async () => {
    const write = vi.fn(async (_request: StoryAgentRequest): Promise<unknown> => clone(story));
    const result = await new StoryStage().write(storyRequest, { write });

    expect(result).toEqual(story);
    expect(write).toHaveBeenCalledOnce();
    const request = write.mock.calls[0]?.[0];
    expect(request?.stage).toBe('story');
    expect(request?.skills.skills.map((skill) => skill.name)).toEqual(['story-writing']);
    expect(request?.outputSchema.rootId).toBe('urn:urbe:quests:authoring:story-output');
    expect(request?.outputSchema.documents.map((schema) => (schema as { $id: string }).$id)).toEqual([
      'urn:urbe:quests:authoring:story-output',
      'urn:urbe:quests:authoring:values',
    ]);
  });

  it('rejects malformed or causally inconsistent story output at the boundary', async () => {
    const malformed: StoryAgentPort = { write: async () => ({ storyId: 'unfinished' }) };
    await expect(new StoryStage().write(storyRequest, malformed)).rejects.toMatchObject({ code: 'E_AUTHORING_OUTPUT' });

    const unknownCharacter = clone(story);
    unknownCharacter.movements.conflict[0]!.characterIds = ['unknown'];
    const inconsistent: StoryAgentPort = { write: async () => unknownCharacter };
    await expect(new StoryStage().write(storyRequest, inconsistent)).rejects.toMatchObject({
      code: 'E_CAUSE_EFFECT',
      details: expect.arrayContaining([expect.stringContaining('unknown character')]),
    });

    const unknownSpeaker = clone(story);
    unknownSpeaker.movements.presentation[0]!.dialogue[0]!.speakerCharacterId = 'unknown';
    await expect(new StoryStage().write(storyRequest, { write: async () => unknownSpeaker })).rejects.toMatchObject({
      code: 'E_CAUSE_EFFECT',
      details: expect.arrayContaining([expect.stringContaining('dialogue to unknown character')]),
    });
  });

  it('rejects invalid world context before writing and unknown story places after writing', async () => {
    const write = vi.fn(async (): Promise<unknown> => clone(story));
    const brokenContext = clone(storyRequest);
    brokenContext.world.parcels[0]!.districtId = 'd_missing';
    await expect(new StoryStage().write(brokenContext, { write })).rejects.toMatchObject({
      code: 'E_WORLD_TARGET',
      details: [expect.stringContaining('d_missing')],
    });
    expect(write).not.toHaveBeenCalled();

    const unknownPlace = clone(story);
    unknownPlace.movements.development[0]!.scene.placeName = 'Imaginary Station';
    await expect(new StoryStage().write(storyRequest, { write: async () => unknownPlace })).rejects.toMatchObject({
      code: 'E_WORLD_TARGET',
      details: [expect.stringContaining('Imaginary Station')],
    });
  });

  it('selects mechanics from the cheap index, then loads only the selected fat skills', async () => {
    const selectMechanics = vi.fn(
      async (_request: MechanicSelectionAgentRequest): Promise<unknown> => ({ mechanics: ['talk', 'pickup', 'deliver'] }),
    );
    const adapt = vi.fn(async (_request: GameplayAgentRequest): Promise<unknown> => clone(adaptation));
    const result = await new AuthoringHarness().adaptGameplay(adaptationRequest, { selectMechanics, adapt });

    expect(result).toEqual(adaptation);
    const selectionRequest = selectMechanics.mock.calls[0]?.[0];
    expect(selectionRequest?.skills.skills.map((skill) => skill.name)).toEqual(['gameplay-adaptation']);
    expect(selectionRequest?.availableSkills.skills.map((skill) => skill.name)).toEqual(['deliver', 'pickup', 'talk']);
    expect(selectionRequest?.availableSkills.skills.every((skill) => !('content' in skill))).toBe(true);

    const gameplayRequest = adapt.mock.calls[0]?.[0];
    expect(gameplayRequest?.skills.skills.map((skill) => skill.name)).toEqual([
      'gameplay-adaptation',
      'talk',
      'pickup',
      'deliver',
    ]);
    expect(gameplayRequest?.skills.skills.every((skill) => skill.content.includes('# '))).toBe(true);
    expect(gameplayRequest?.outputSchema.rootId).toBe('urn:urbe:quests:authoring:adaptation-output');
  });

  it('rejects unsupported caller mechanics before invoking either gameplay adapter', async () => {
    const port = inertGameplayPort();
    await expect(
      new GameplayStage().adapt({ ...adaptationRequest, requestedMechanics: ['talk', 'negotiation'] }, port),
    ).rejects.toMatchObject({ code: 'E_UNSUPPORTED_MECHANIC', details: ['negotiation'] });
    expect(port.selectMechanics).not.toHaveBeenCalled();
    expect(port.adapt).not.toHaveBeenCalled();
  });

  it('rejects an unsupported or caller-disallowed mechanic selected by the agent', async () => {
    const adapt = vi.fn();
    const unsupported: GameplayAgentPort = { selectMechanics: async () => ({ mechanics: ['negotiation'] }), adapt };
    await expect(new GameplayStage().adapt(adaptationRequest, unsupported)).rejects.toMatchObject({
      code: 'E_MECHANIC_SELECTION',
      details: ['unsupported: negotiation'],
    });
    expect(adapt).not.toHaveBeenCalled();

    const disallowed: GameplayAgentPort = { selectMechanics: async () => ({ mechanics: ['observe'] }), adapt };
    await expect(new GameplayStage().adapt(adaptationRequest, disallowed)).rejects.toMatchObject({
      code: 'E_MECHANIC_SELECTION',
      details: ['outside caller allowlist: observe'],
    });
  });

  it('fails closed when a quest target names a place or NPC type outside the world', async () => {
    const unknownParcel = clone(adaptation);
    const publish = unknownParcel.definition.steps.find((step) => step.stepId === 's_publish')!;
    if (publish.target.kind !== 'deliver') throw new Error('fixture target changed');
    publish.target.place = { parcelId: 'p_missing' };
    await expect(new GameplayStage().adapt(adaptationRequest, fixtureGameplayPort(unknownParcel))).rejects.toMatchObject({
      code: 'E_WORLD_TARGET',
      details: [expect.stringContaining('p_missing')],
    });

    const unknownType = clone(adaptation);
    unknownType.definition.roles[0]!.npcType = 'invented_role';
    await expect(new GameplayStage().adapt(adaptationRequest, fixtureGameplayPort(unknownType))).rejects.toMatchObject({
      code: 'E_WORLD_TARGET',
      details: [expect.stringContaining('invented_role')],
    });
  });

  it('accepts named stations and stops and rejects unknown transit identities', async () => {
    const stationTarget = clone(adaptation);
    const publish = stationTarget.definition.steps.find((step) => step.stepId === 's_publish')!;
    if (publish.target.kind !== 'deliver') throw new Error('fixture target changed');
    publish.target.place = { stationId: 'station_harbor' };
    await expect(new GameplayStage().adapt(adaptationRequest, fixtureGameplayPort(stationTarget))).resolves.toEqual(stationTarget);

    const unknownStop = clone(stationTarget);
    const changed = unknownStop.definition.steps.find((step) => step.stepId === 's_publish')!;
    if (changed.target.kind !== 'deliver') throw new Error('fixture target changed');
    changed.target.place = { stopId: 'stop_missing' };
    await expect(new GameplayStage().adapt(adaptationRequest, fixtureGameplayPort(unknownStop))).rejects.toMatchObject({
      code: 'E_WORLD_TARGET',
      details: [expect.stringContaining('stop_missing')],
    });
  });

  it('rejects graph-invalid output before accepting the adaptation', async () => {
    const invalid = clone(adaptation);
    invalid.definition.steps[1]!.stepId = 's_request';
    await expect(new GameplayStage().adapt(adaptationRequest, fixtureGameplayPort(invalid))).rejects.toMatchObject({
      code: 'E_INVALID_FLOW',
      details: expect.arrayContaining([expect.stringContaining('duplicate step id')]),
    });
  });

  it('requires exact mechanic, transition, beat, and ending cause-effect traces', async () => {
    const mismatch = clone(adaptation);
    mismatch.mechanicChoices.find((choice) => choice.stepId === 's_recover')!.mechanic = 'talk';
    mismatch.mechanicChoices.find((choice) => choice.stepId === 's_request')!.transitions = [];
    mismatch.mechanicChoices.find((choice) => choice.stepId === 's_publish')!.storyBeatIds = ['unknown_beat'];
    mismatch.endingRoutes.find((route) => route.endingId === 'e_publish')!.storyOutcomeIds = ['o_protect'];

    await expect(new GameplayStage().adapt(adaptationRequest, fixtureGameplayPort(mismatch))).rejects.toMatchObject({
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

function fixtureGameplayPort(output: AdaptationOutput): GameplayAgentPort {
  return {
    selectMechanics: async () => ({ mechanics: ['talk', 'pickup', 'deliver'] }),
    adapt: async () => output,
  };
}

function inertGameplayPort() {
  const selectMechanics = vi.fn(async (_request: MechanicSelectionAgentRequest): Promise<unknown> => ({ mechanics: [] }));
  const adapt = vi.fn(async (_request: GameplayAgentRequest): Promise<unknown> => ({}));
  return { selectMechanics, adapt };
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
