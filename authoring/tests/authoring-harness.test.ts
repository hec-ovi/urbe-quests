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
  Mechanic,
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
    const result = await new GameplayStage().adapt(adaptationRequest, { selectMechanics, adapt });

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

  it.each(['investigation', 'rescue', 'escort', 'access', 'hacking', 'sabotage', 'transportation'] as const)(
    'accepts the schema-valid %s mechanic through the isolated selector and adaptation stages',
    async (mechanic) => {
      const noDecisionStory = clone(story);
      noDecisionStory.decisions = [];
      const output = singleMechanicAdaptation(mechanic);
      const mechanics = targetMechanics(output);
      const selectMechanics = vi.fn(async (_request: MechanicSelectionAgentRequest): Promise<unknown> => ({ mechanics }));
      const adapt = vi.fn(async (_request: GameplayAgentRequest): Promise<unknown> => output);
      const result = await new GameplayStage().adapt(
        { story: noDecisionStory, ...context, requestedMechanics: mechanics },
        { selectMechanics, adapt },
      );

      expect(result.definition.steps.some((candidate) => candidate.target.kind === mechanic)).toBe(true);
      expect(selectMechanics.mock.calls[0]?.[0].availableSkills.skills.map((skill) => skill.name).sort()).toEqual([...mechanics].sort());
      expect(adapt.mock.calls[0]?.[0].skills.skills.map((skill) => skill.name)).toEqual(['gameplay-adaptation', ...mechanics]);
    },
  );

  it('rejects missing interaction identity at the schema boundary and unknown authored targets in deterministic audits', async () => {
    const noDecisionStory = clone(story);
    noDecisionStory.decisions = [];

    const missingIdentity = singleMechanicAdaptation('transportation') as unknown as {
      definition: { steps: { target: Record<string, unknown> }[] };
    };
    delete missingIdentity.definition.steps[0]!.target['journeyId'];
    await expect(
      new GameplayStage().adapt(
        { story: noDecisionStory, ...context, requestedMechanics: ['transportation'] },
        singleMechanicPort('transportation', missingIdentity),
      ),
    ).rejects.toMatchObject({ code: 'E_AUTHORING_OUTPUT' });

    const unknownPlace = singleMechanicAdaptation('hacking');
    const hack = unknownPlace.definition.steps[0]!.target;
    if (hack.kind !== 'hacking') throw new Error('fixture target changed');
    hack.place = { parcelId: 'p_missing' };
    await expect(
      new GameplayStage().adapt(
        { story: noDecisionStory, ...context, requestedMechanics: ['hacking'] },
        singleMechanicPort('hacking', unknownPlace),
      ),
    ).rejects.toMatchObject({ code: 'E_WORLD_TARGET', details: [expect.stringContaining('p_missing')] });

    const unknownCast = singleMechanicAdaptation('rescue');
    const rescue = unknownCast.definition.steps[0]!.target;
    if (rescue.kind !== 'rescue') throw new Error('fixture target changed');
    rescue.roleId = 'r_invented';
    await expect(
      new GameplayStage().adapt(
        { story: noDecisionStory, ...context, requestedMechanics: ['rescue'] },
        singleMechanicPort('rescue', unknownCast),
      ),
    ).rejects.toMatchObject({ code: 'E_INVALID_FLOW', details: [expect.stringContaining('r_invented')] });
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

  it('does not accept extra endings detached from the authored outcomes', async () => {
    const detached = clone(adaptation);
    detached.definition.endings.push({
      endingId: 'e_detached',
      title: 'Detached',
      epilogue: 'This route was never in the story.',
    });
    detached.definition.steps.push({
      ...clone(detached.definition.steps.find((step) => step.stepId === 's_protect')!),
      stepId: 's_detached',
      endingId: 'e_detached',
    });
    detached.definition.steps.find((step) => step.stepId === 's_recover')!.next.push({
      toStepId: 's_detached',
      when: [],
    });
    detached.mechanicChoices.push({
      ...clone(detached.mechanicChoices.find((choice) => choice.stepId === 's_protect')!),
      stepId: 's_detached',
    });
    detached.mechanicChoices.find((choice) => choice.stepId === 's_recover')!.transitions.push({
      toStepId: 's_detached',
      narrativeCause: 'An unauthored branch appears.',
      consequence: 'The branch reaches an ending with no story outcome.',
    });
    detached.endingRoutes.push({
      endingId: 'e_detached',
      terminalStepIds: ['s_detached'],
      storyOutcomeIds: [],
      cause: 'No authored cause.',
      consequence: 'No authored consequence.',
    });

    await expect(new GameplayStage().adapt(adaptationRequest, fixtureGameplayPort(detached))).rejects.toMatchObject({
      code: 'E_CAUSE_EFFECT',
      details: [expect.stringContaining('has no story outcome')],
    });
  });
});

function fixtureGameplayPort(output: AdaptationOutput): GameplayAgentPort {
  return {
    selectMechanics: async () => ({ mechanics: ['talk', 'pickup', 'deliver'] }),
    adapt: async () => output,
  };
}

function singleMechanicPort(mechanic: Mechanic, output: unknown): GameplayAgentPort {
  const mechanics = targetMechanics(output as AdaptationOutput);
  if (!mechanics.includes(mechanic)) throw new Error(`fixture does not use ${mechanic}`);
  return {
    selectMechanics: async () => ({ mechanics }),
    adapt: async () => output,
  };
}

function targetMechanics(output: AdaptationOutput): Mechanic[] {
  return [...new Set(output.definition.steps.map((candidate) => candidate.target.kind))];
}

function singleMechanicAdaptation(mechanic: Mechanic): AdaptationOutput {
  const targetByMechanic: Record<Exclude<Mechanic, 'goto' | 'observe' | 'talk' | 'listen' | 'pickup' | 'deliver' | 'steal' | 'assassinate' | 'work'>, AdaptationOutput['definition']['steps'][number]['target']> = {
    investigation: {
      kind: 'investigation', sceneId: 'scene_manifest', evidenceId: 'seal_impression', evidenceItemId: 'evidence',
      subjectRoleIds: ['r_mara'], place: { parcelId: 'p_cafe' }, completionFlag: 'interaction_done',
    },
    rescue: {
      kind: 'rescue', roleId: 'r_mara', releaseTargetId: 'service_lift_release',
      place: { parcelId: 'p_cafe' }, completionFlag: 'interaction_done',
    },
    escort: {
      kind: 'escort', roleId: 'r_mara', routeId: 'cafe_archive_walk', mode: 'follow-player',
      from: { parcelId: 'p_cafe' }, to: { parcelId: 'p_archive' }, completionFlag: 'interaction_done',
    },
    access: {
      kind: 'access', accessPointId: 'archive_side_door', credentialItemId: 'credential',
      place: { parcelId: 'p_archive' }, completionFlag: 'interaction_done',
    },
    hacking: {
      kind: 'hacking', targetId: 'archive_index_terminal', place: { parcelId: 'p_archive' }, completionFlag: 'interaction_done',
    },
    sabotage: {
      kind: 'sabotage', targetId: 'manifest_purge_queue', place: { parcelId: 'p_archive' }, completionFlag: 'interaction_done',
    },
    transportation: {
      kind: 'transportation', journeyId: 'cafe_archive_ride', mode: 'ride-hail',
      from: { parcelId: 'p_cafe' }, to: { parcelId: 'p_archive' }, passengerRoleIds: ['r_mara'], cargoItemIds: [],
      completionFlag: 'interaction_done',
    },
  };
  if (!(mechanic in targetByMechanic)) throw new Error(`test helper only builds expanded mechanics, got ${mechanic}`);

  const target = targetByMechanic[mechanic as keyof typeof targetByMechanic];
  const access = mechanic === 'access';
  const investigate = mechanic === 'investigation';
  const items: AdaptationOutput['definition']['items'] = investigate
    ? [{ itemId: 'evidence', name: 'Seal impression', description: 'The fixed clue that proves whose manifest was altered.', kind: 'information' }]
    : access
      ? [{ itemId: 'credential', name: 'Archive code', description: 'The exact code Mara provides for the side door.', kind: 'information' }]
      : [];
  const actionStep: AdaptationOutput['definition']['steps'][number] = {
    stepId: 's_action',
    actId: 'a_action',
    narrative: {
      description: `The player completes the authored ${mechanic} interaction.`,
      playerHint: `Complete the named ${mechanic} target.`,
      stake: 'Mara can act on the manifest only after this exact interaction succeeds.',
    },
    wantedByRoleId: 'r_mara',
    target,
    gives: investigate ? ['evidence'] : [],
    needs: access ? ['credential'] : [],
    conditions: [],
    effects: [{ kind: 'setFlag', flag: 'interaction_done' }],
    next: [],
    branching: 'parallel',
    endingId: 'e_done',
  };
  const prepStep: AdaptationOutput['definition']['steps'][number] = {
    stepId: 's_credential',
    actId: 'a_action',
    narrative: {
      description: 'Mara provides the exact archive code.',
      playerHint: 'Talk to Mara at Low Tide Cafe.',
      stake: 'The side door remains closed without the code she memorized.',
    },
    wantedByRoleId: 'r_mara',
    target: { kind: 'talk', roleId: 'r_mara', atParcelId: 'p_cafe' },
    gives: ['credential'],
    needs: [],
    conditions: [],
    effects: [],
    next: [{ toStepId: 's_action', when: [] }],
    branching: 'parallel',
  };
  const steps = access ? [prepStep, actionStep] : [actionStep];
  const allBeatIds = Object.values(story.movements).flat().map((beat) => beat.beatId);
  const mechanicChoices: AdaptationOutput['mechanicChoices'] = steps.map((candidate, index) => ({
    stepId: candidate.stepId,
    mechanic: candidate.target.kind,
    storyBeatIds: access && index === 0 ? [allBeatIds[0]!] : access ? allBeatIds.slice(1) : allBeatIds,
    narrativeReason: `The exact ${candidate.target.kind} interaction enacts the assigned story beat.`,
    cause: 'The prior authored state makes this action available.',
    effect: 'The action records its consequence without inferring a target or identity.',
    transitions: candidate.next.map((edge) => ({
      toStepId: edge.toStepId,
      narrativeCause: 'The prerequisite is now carried in deterministic state.',
      consequence: 'The next exact interaction becomes active.',
    })),
  }));

  return {
    definition: {
      id: `q_${mechanic}`,
      title: `Authored ${mechanic}`,
      premise: `A contract example for the ${mechanic} mechanic.`,
      roles: [{ roleId: 'r_mara', npcType: 'quest_vendor', persona: 'Mara knows the manifest and names each interaction precisely.' }],
      items,
      facts: [],
      acts: [{ actId: 'a_action', title: 'Exact action', summary: 'Complete one authored interaction.' }],
      steps,
      endings: [{ endingId: 'e_done', title: 'Recorded consequence', epilogue: 'The exact interaction changes Mara\'s next choice.' }],
      flags: ['interaction_done'],
      entryStepIds: [access ? 's_credential' : 's_action'],
    },
    mechanicChoices,
    endingRoutes: [{
      endingId: 'e_done',
      terminalStepIds: ['s_action'],
      storyOutcomeIds: [],
      cause: 'The named interaction completed against its authored target.',
      consequence: 'The completion flag and ending persist.',
    }],
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
