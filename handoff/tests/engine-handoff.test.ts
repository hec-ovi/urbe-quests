/**
 * Contract-surface tests for quests/handoff: bundle v1.2 projection, the
 * stable engine files, staged scenes and their investigations, and every
 * E_HANDOFF family.
 */

import { describe, expect, it } from 'vitest';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import adaptationFixture from '../../authoring/fixtures/adaptation.json' with { type: 'json' };
import { HANDOFF_FILES, writeEngineHandoff } from '../../creation/samples/EngineHandoffWriter.js';
import type { QuestlineDefinition } from '../../flow/schema.js';
import questlineSchema from '../../flow/schema/questline.schema.json' with { type: 'json' };
import { EngineHandoff } from '../EngineHandoff.js';
import { SCENERY_VOCABULARY, questItemAssetId, scopedScenes, stagedScenery, type SceneStaging } from '../SceneStagings.js';
import type { HandoffInput, InvestigationSceneRequest, MissionAssetCreateRequest } from '../schema.js';
import fixedHandoffFixture from '../fixtures/engine-public-transit.input.json' with { type: 'json' };
import fixedQuestFixture from '../fixtures/fixed-mechanics.questline.json' with { type: 'json' };
import assetRequestSchema from '../schema/mission-asset-request.schema.json' with { type: 'json' };
import assetRequestsSchema from '../schema/mission-asset-requests.schema.json' with { type: 'json' };
import bindingsSchema from '../schema/mission-item-bindings.schema.json' with { type: 'json' };
import capabilitiesSchema from '../schema/host-capabilities.schema.json' with { type: 'json' };
import mechanicBindingsSchema from '../schema/mechanic-target-bindings.schema.json' with { type: 'json' };
import objectivesSchema from '../schema/objectives.schema.json' with { type: 'json' };
import bundleSchema from '../schema/quest-bundle.schema.json' with { type: 'json' };
import handoffInputSchema from '../schema/handoff-input.schema.json' with { type: 'json' };
import investigationSliceSchema from '../schema/investigation-binding-slice.schema.json' with { type: 'json' };
import scenerySliceSchema from '../schema/scenery-binding-slice.schema.json' with { type: 'json' };

const fixtureQuestlines = [adaptationFixture.definition] as QuestlineDefinition[];
const fixedHandoffInput = fixedHandoffFixture as HandoffInput;
const fixedQuest = fixedQuestFixture as QuestlineDefinition;

/** One validator carrying every published handoff schema plus the flow questline it references. */
function validators(): Ajv2020 {
  const ajv = new Ajv2020({ strict: true });
  for (const schema of [
    questlineSchema, assetRequestSchema, assetRequestsSchema, bindingsSchema, capabilitiesSchema,
    mechanicBindingsSchema, investigationSliceSchema, scenerySliceSchema,
  ]) {
    ajv.addSchema(schema);
  }
  return ajv;
}

const outDir = (prefix: string) => join(mkdtempSync(join(tmpdir(), prefix)), 'questlines.json');
const readFile = (path: string, file: string) => JSON.parse(readFileSync(join(path, file), 'utf8'));

/** One investigation step with its information evidence and one physical document item. */
function investigationQuest(): QuestlineDefinition {
  return {
    id: 'q_archive_scene',
    title: 'Archive scene',
    premise: 'A scored wall proves which terminal started the archive fire.',
    roles: [{ roleId: 'witness', npcType: 'cafe_barista', persona: 'Remembers every alarm.' }],
    items: [
      { itemId: 'burn_origin', name: 'Burn origin', description: 'The direction of the first arc.', kind: 'information' },
      { itemId: 'paper_log', name: 'Paper log', description: 'The only physical access log.', kind: 'document', atParcelId: 'p4' },
    ],
    facts: [],
    acts: [{ actId: 'a_scene', title: 'Scene', summary: 'Read the fixed trace.' }],
    steps: [{
      stepId: 's_wall', actId: 'a_scene', wantedByRoleId: 'witness',
      narrative: { description: 'The wall carries the first arc.', playerHint: 'Inspect the scored wall.', stake: 'The witness takes the blame otherwise.' },
      target: { kind: 'investigation', sceneId: 'scene_archive', evidenceId: 'wall_score', evidenceItemId: 'burn_origin', subjectRoleIds: ['witness'], place: { parcelId: 'p4', name: 'Static Cafe' }, completionFlag: 'wall_read' },
      gives: ['burn_origin'], needs: [], conditions: [], effects: [{ kind: 'setFlag', flag: 'wall_read' }],
      next: [], branching: 'parallel', endingId: 'e_origin',
    }],
    endings: [{ endingId: 'e_origin', title: 'Origin', epilogue: 'The trace fixes the fire at one terminal.' }],
    flags: ['wall_read'],
    entryStepIds: ['s_wall'],
  };
}

const scene = (): InvestigationSceneRequest => ({
  contractVersion: '1.1', sceneId: 'scene_archive', questId: 'q_archive_scene', seed: 41,
  incident: { family: 'electrical-fire', summary: 'A deliberate arc marked the archive wall.' },
  questBindings: [{ stepId: 's_wall', evidenceId: 'wall_score', place: { parcelId: 'p4' }, completionAction: 'inspect' }],
  location: { kind: 'interior', placeId: 'p4' },
  bodies: [], props: [], decals: [],
  evidence: [{
    evidenceId: 'wall_score', factId: 'burn_origin', label: 'Wall score', description: 'The arc direction is fixed in the wall.',
    portable: false, requiresInspection: true, prerequisiteEvidenceIds: [], consequences: [],
  }],
});

const assetRequest = (): MissionAssetCreateRequest => ({
  contractVersion: '1.0', assetId: 'quest.archive.paper-log', family: 'document', seed: 41,
  purpose: 'Physical archive access log carried by the player',
  dimensions: { width: 0.22, height: 0.015, depth: 0.3 },
  materials: [{ slot: 'surface', key: 'cyberpunk/fabric/mid', variantId: 'paper' }],
  requiredInteractions: ['inspect', 'read', 'take'],
  clearance: { approachDepth: 0.8, sideMargin: 0.2, overhead: 0.1 },
});

const pickupHandoff = (): HandoffInput => ({
  missionAssetRequests: [assetRequest()],
  missionItemBindings: [{ questId: 'q_last_manifest', itemId: 'i_manifest', assetId: assetRequest().assetId }],
});

/** A killing at the dock office and the one clue its body shows. */
function sceneQuest(): QuestlineDefinition {
  const narrative = (description: string) => ({ description, playerHint: description, stake: 'The clerk hangs for it otherwise.' });
  return {
    id: 'q_dock_killing',
    title: 'Dock killing',
    premise: 'A foreman dies in the dock office, and the wound says who held the knife.',
    roles: [
      { roleId: 'foreman', npcType: 'dock_foreman', persona: 'Counts every crate twice.' },
      { roleId: 'clerk', npcType: 'cafe_barista', persona: 'Saw the knife and said nothing.' },
    ],
    items: [
      { itemId: 'wound', name: 'The wound', description: 'One cut, from the left.', kind: 'information' },
      { itemId: 'knife', name: 'Filleting knife', description: "The clerk's knife, wiped clean.", kind: 'weapon' },
    ],
    facts: [],
    acts: [{ actId: 'a_dock', title: 'Dock', summary: 'A death and its reading.' }],
    steps: [
      {
        stepId: 's_kill', actId: 'a_dock', narrative: narrative('The foreman stops counting.'),
        target: { kind: 'assassinate', roleId: 'foreman' },
        gives: [], needs: [], conditions: [], effects: [], next: [{ toStepId: 's_look', when: [] }], branching: 'parallel',
      },
      {
        stepId: 's_look', actId: 'a_dock', narrative: narrative('Read the wound in the dock office.'),
        target: { kind: 'investigation', sceneId: 'sc_office', evidenceId: 'ev_wound', evidenceItemId: 'wound', subjectRoleIds: ['clerk'], place: { parcelId: 'p4', name: 'Dock office' }, completionFlag: 'wound_read' },
        gives: ['wound'], needs: [], conditions: [], effects: [{ kind: 'setFlag', flag: 'wound_read' }], next: [], branching: 'parallel', endingId: 'e_read',
      },
    ],
    endings: [{ endingId: 'e_read', title: 'Read', epilogue: 'The wound names the hand.' }],
    flags: ['wound_read'],
    entryStepIds: ['s_kill'],
  };
}

/** The office as the killing leaves it: the body with the clue, blood, the knife and a guard at the door. */
const officeStaging = (): SceneStaging => ({
  sceneId: 'sc_office',
  purpose: 'crime-scene',
  description: 'The foreman lies by his desk in his own blood, the clerk\'s knife beside him, a guard at the door.',
  stagedBy: 's_kill',
  stagedWhen: 'done',
  place: { kind: 'room', atStepId: 's_look', roomKinds: ['office_private'] },
  actors: [
    { actorId: 'body', role: 'victim', pose: 'death-a', roleId: 'foreman' },
    { actorId: 'guard', role: 'officer', pose: 'standing-guard', gender: 'female', zone: 'entry-side' },
  ],
  props: [
    { propId: 'blood', kind: 'blood-pool', nearActorId: 'body' },
    { propId: 'knife', kind: 'mission-asset', itemId: 'knife', nearActorId: 'body' },
  ],
  evidence: [{ evidenceId: 'ev_wound', elementId: 'body' }],
  lasting: true,
});

const knifeRequest = (assetId: string): MissionAssetCreateRequest => ({
  contractVersion: '1.0', assetId, purpose: 'Filleting knife', family: 'tool', seed: 7,
  dimensions: { width: 0.3, height: 0.12, depth: 0.05 },
  materials: [{ slot: 'surface', key: 'cyberpunk/metal/mid', variantId: 'paint' }],
  requiredInteractions: ['inspect', 'take'],
  clearance: { approachDepth: 0.8, sideMargin: 0.2, overhead: 0.1 },
});

/** The office killing as a build ships it, and its handoff input for a host staging every kind Engine can declare. */
function sceneBundle(quest: QuestlineDefinition = sceneQuest()) {
  const shipped = scopedScenes(quest, [officeStaging()]);
  const staged = stagedScenery(shipped.definition, shipped.stagings);
  return {
    quest: shipped.definition,
    input: {
      hostCapabilities: { transportationModes: [], scenery: structuredClone(SCENERY_VOCABULARY) },
      scenery: staged.scenery,
      investigations: staged.investigations,
      missionAssetRequests: staged.assets.map((asset) => knifeRequest(asset.assetId)),
    } satisfies HandoffInput,
  };
}

describe('EngineHandoff', () => {
  it('projects every authored target in stable order and writes the stable engine files', () => {
    const bundle = new EngineHandoff().assemble(fixtureQuestlines, pickupHandoff());
    expect(bundle.objectives).toEqual(fixtureQuestlines.flatMap((questline) => questline.steps.map((step) => ({
      questId: questline.id, stepId: step.stepId, action: step.target,
    }))));
    expect(bundle.investigations).toEqual([]);
    expect(bundle.mechanicTargetBindings).toEqual([]);
    expect(bundle.missionAssetRequests).toEqual(pickupHandoff().missionAssetRequests);
    expect(bundle.hostCapabilities).toEqual({ transportationModes: [] });

    const ajv = validators();
    const objectives = ajv.compile(objectivesSchema);
    expect(objectives(bundle.objectives), JSON.stringify(objectives.errors)).toBe(true);

    const outputPath = outDir('quest-handoff-');
    const manifest = writeEngineHandoff(outputPath, bundle);
    const dir = join(outputPath, '..');
    const validateBundle = new Ajv2020({ strict: true }).compile(bundleSchema);
    expect(validateBundle(manifest), JSON.stringify(validateBundle.errors)).toBe(true);
    for (const file of ['investigations', 'mechanicTargetBindings', 'scenery'] as const) {
      expect(readFile(dir, HANDOFF_FILES[file])).toEqual([]);
    }
    expect(readFile(dir, HANDOFF_FILES.missionAssetRequests)).toEqual(bundle.missionAssetRequests);
    expect(readFile(dir, HANDOFF_FILES.missionItemBindings)).toEqual(bundle.missionItemBindings);
    expect(readFile(dir, HANDOFF_FILES.hostCapabilities)).toEqual({ transportationModes: [] });
    expect(readFile(dir, HANDOFF_FILES.objectives)).toHaveLength(manifest.counts.objectives);
    expect(readFile(dir, HANDOFF_FILES.manifest)).toEqual(manifest);
  });

  it('accepts complete investigation and mission-item handoffs with schema-valid public files', () => {
    const request = assetRequest();
    const bundle = new EngineHandoff().assemble([investigationQuest()], {
      investigations: [scene()],
      missionAssetRequests: [request],
      missionItemBindings: [{ questId: 'q_archive_scene', itemId: 'paper_log', assetId: request.assetId }],
    });
    expect(bundle.investigations[0]?.questBindings[0]?.stepId).toBe('s_wall');

    const ajv = validators();
    const requests = ajv.getSchema(assetRequestsSchema.$id)!;
    const items = ajv.getSchema(bindingsSchema.$id)!;
    expect(requests(bundle.missionAssetRequests), JSON.stringify(requests.errors)).toBe(true);
    expect(items(bundle.missionItemBindings), JSON.stringify(items.errors)).toBe(true);
    const input = ajv.compile(handoffInputSchema);
    expect(input({
      investigations: bundle.investigations,
      hostCapabilities: bundle.hostCapabilities,
      mechanicTargetBindings: bundle.mechanicTargetBindings,
      missionAssetRequests: bundle.missionAssetRequests,
      missionItemBindings: bundle.missionItemBindings,
    }), JSON.stringify(input.errors)).toBe(true);
  });

  it('rejects a pickup without a bound portable asset and a take anchor', () => {
    const handoff = new EngineHandoff();
    expect(() => handoff.assemble(fixtureQuestlines)).toThrowError(/pickup .* has no mission asset binding/);
    const missingTake = pickupHandoff();
    missingTake.missionAssetRequests![0]!.requiredInteractions = ['inspect', 'read'];
    expect(() => handoff.assemble(fixtureQuestlines, missingTake)).toThrowError(/portable mission asset with a take interaction anchor/);
    const fixed = pickupHandoff();
    fixed.missionAssetRequests![0] = {
      ...assetRequest(), family: 'table', dimensions: { width: 1, height: 0.8, depth: 0.6 },
      materials: [{ slot: 'surface', key: 'cyberpunk/wood/mid', variantId: '1' }], requiredInteractions: ['inspect'],
    };
    expect(() => handoff.assemble(fixtureQuestlines, fixed)).toThrowError(/portable mission asset with a take interaction anchor/);
    // The creator's material rule: a table has no fabric top.
    fixed.missionAssetRequests![0].materials = assetRequest().materials;
    expect(() => handoff.assemble(fixtureQuestlines, fixed)).toThrowError(/cannot use fabric material on its surface/);
  });

  it('writes exact fixed mechanic anchors and negotiated transportation capabilities', () => {
    const outputPath = outDir('quest-mechanics-handoff-');
    const manifest = writeEngineHandoff(outputPath, new EngineHandoff().assemble([fixedQuest], fixedHandoffInput));
    const dir = join(outputPath, '..');

    const input = validators().compile(handoffInputSchema);
    expect(input(fixedHandoffInput), JSON.stringify(input.errors)).toBe(true);
    expect(readFile(dir, HANDOFF_FILES.mechanicTargetBindings)).toEqual(fixedHandoffInput.mechanicTargetBindings);
    expect(readFile(dir, HANDOFF_FILES.hostCapabilities)).toEqual({ transportationModes: ['public-transit'] });
    expect(manifest.contractVersion).toBe('1.2');
    expect(manifest.counts.mechanicTargetBindings).toBe(4);
  });

  it('fails closed on missing or inconsistent investigation bindings', () => {
    const handoff = new EngineHandoff();
    expect(() => handoff.assemble([investigationQuest()])).toThrowError(expect.objectContaining({ code: 'E_HANDOFF' }));

    const wrongEvidence = scene();
    wrongEvidence.questBindings[0]!.evidenceId = 'invented';
    expect(() => handoff.assemble([investigationQuest()], { investigations: [wrongEvidence] })).toThrowError(/no quest binding/);

    const wrongFact = scene();
    wrongFact.evidence[0]!.factId = 'invented';
    expect(() => handoff.assemble([investigationQuest()], { investigations: [wrongFact] })).toThrowError(/must grant item burn_origin/);
  });

  it('fails closed on incompatible assets, item bindings, mechanic anchors and undeclared transport modes', () => {
    const handoff = new EngineHandoff();
    expect(() => handoff.assemble(fixtureQuestlines, { missionAssetRequests: [{ dimensions: null }] }))
      .toThrowError(expect.objectContaining({ code: 'E_HANDOFF' }));
    const incompatible = assetRequest();
    incompatible.requiredInteractions = ['hack'];
    expect(() => handoff.assemble(fixtureQuestlines, { missionAssetRequests: [incompatible] })).toThrowError(/incompatible interactions/);
    // Engine's document clip is 8% of the height and 1 mm at least, so a 1 cm document cannot be built.
    const thin = assetRequest();
    thin.dimensions.height = 0.01;
    expect(() => handoff.assemble(fixtureQuestlines, { missionAssetRequests: [thin] })).toThrowError(/dimensions do not fit document/);

    const request = assetRequest();
    const withScene = (missionItemBindings: { questId: string; itemId: string; assetId: string }[]) =>
      handoff.assemble([investigationQuest()], { investigations: [scene()], missionAssetRequests: [request], missionItemBindings });
    expect(() => withScene([{ questId: 'q_archive_scene', itemId: 'burn_origin', assetId: request.assetId }])).toThrowError(/information item/);
    expect(() => withScene([{ questId: 'q_archive_scene', itemId: 'paper_log', assetId: 'missing.asset' }])).toThrowError(/unknown asset/);

    const missing = structuredClone(fixedHandoffInput);
    missing.mechanicTargetBindings = missing.mechanicTargetBindings?.slice(1);
    expect(() => handoff.assemble([fixedQuest], missing)).toThrowError(/has no mission asset binding/);

    const rescueBinding = (input: HandoffInput) => {
      const binding = input.mechanicTargetBindings?.find((candidate) => 'releaseTargetId' in candidate);
      if (binding === undefined || !('releaseTargetId' in binding)) throw new Error('fixture rescue binding changed');
      return binding;
    };
    const wrongTarget = structuredClone(fixedHandoffInput);
    rescueBinding(wrongTarget).releaseTargetId = 'invented_release';
    expect(() => handoff.assemble([fixedQuest], wrongTarget)).toThrowError(/does not match its authored releaseTargetId/);

    const missingAnchor = structuredClone(fixedHandoffInput);
    rescueBinding(missingAnchor).interactionId = 'open';
    expect(() => handoff.assemble([fixedQuest], missingAnchor)).toThrowError(/has no open interaction anchor/);

    const portableTarget = structuredClone(fixedHandoffInput);
    const releaseRequest = portableTarget.missionAssetRequests?.find((candidate) => candidate.assetId === 'quest.fixed.release-console');
    if (releaseRequest === undefined) throw new Error('fixture release asset changed');
    releaseRequest.family = 'data-drive';
    releaseRequest.dimensions = { width: 0.09, height: 0.025, depth: 0.04 };
    releaseRequest.materials = releaseRequest.materials.filter((material) => material.slot === 'surface');
    expect(() => handoff.assemble([fixedQuest], portableTarget)).toThrowError(/requires a fixed mission asset/);

    const unsupported = structuredClone(fixedQuest);
    const transport = unsupported.steps.find((candidate) => candidate.target.kind === 'transportation');
    if (transport === undefined || transport.target.kind !== 'transportation') throw new Error('fixture transport step changed');
    transport.target.mode = 'ride-hail';
    expect(() => handoff.assemble([unsupported], fixedHandoffInput)).toThrowError(/host does not support transportation mode ride-hail/);
  });

  it('stages a scene where its step happens and the investigation over it, in schema-valid bundle 1.2 files', () => {
    const { quest, input } = sceneBundle();
    const bundle = new EngineHandoff().assemble([quest], input);
    const [spec] = bundle.scenery;
    // Scene and investigation ship under one id scoped to the questline, and the investigation step names it.
    expect(bundle.objectives[1]!.action).toMatchObject({ kind: 'investigation', sceneId: 'q_dock_killing.sc_office' });
    expect(spec).toMatchObject({
      contractVersion: '1.0', sceneId: 'q_dock_killing.sc_office', questId: 'q_dock_killing', purpose: 'crime-scene',
      place: { kind: 'room', parcelId: 'p4', floor: 0, roomKinds: ['office_private'] },
      // A quest character stands only dead: the killing step, and the simulation's word for it.
      activeWhen: { all: [{ kind: 'stepDone', stepId: 's_kill' }, { kind: 'roleDead', roleId: 'foreman' }] },
      retireWhen: { kind: 'never' },
      investigationSceneId: 'q_dock_killing.sc_office',
    });
    expect(spec!.actors.map((actor) => actor.identity)).toEqual([
      { kind: 'cast', roleId: 'foreman' },
      { kind: 'anonymous', gender: 'female', appearanceSeed: expect.any(Number) },
    ]);
    expect(spec!.actors[1]!.placement).toEqual({ zone: 'entry-side' });
    expect(spec!.props).toEqual([
      { propId: 'blood', kind: 'blood-pool', nearActorId: 'body' },
      // The knife in its own asset, the one a pickup of it would name.
      { propId: 'knife', kind: 'mission-asset', assetId: questItemAssetId('q_dock_killing', 'knife'), nearActorId: 'body' },
    ]);
    expect(bundle.investigations).toEqual([{
      contractVersion: '1.2', sceneId: 'q_dock_killing.sc_office', questId: 'q_dock_killing',
      incident: { family: 'crime-scene', summary: officeStaging().description },
      questBindings: [{ stepId: 's_look', evidenceId: 'ev_wound', place: { parcelId: 'p4' }, completionAction: 'inspect' }],
      scenery: { sceneId: 'q_dock_killing.sc_office' },
      evidenceVisuals: [{ evidenceId: 'ev_wound', entityId: 'body' }],
      evidence: [{
        evidenceId: 'ev_wound', factId: 'wound', label: 'The wound', description: 'One cut, from the left.',
        portable: false, requiresInspection: true, prerequisiteEvidenceIds: [], consequences: [],
      }],
    }]);
    // Seeds and asset ids come from the questline, scene, element and item ids alone.
    expect(sceneBundle().input).toEqual(input);

    const outputPath = outDir('quest-scenery-handoff-');
    const manifest = writeEngineHandoff(outputPath, bundle);
    const validateBundle = new Ajv2020({ strict: true }).compile(bundleSchema);
    expect(validateBundle(manifest), JSON.stringify(validateBundle.errors)).toBe(true);
    expect(manifest.counts).toMatchObject({ scenery: 1, investigations: 1 });
    expect(readFile(join(outputPath, '..'), HANDOFF_FILES.scenery)).toEqual(bundle.scenery);
    const handoffInput = validators().compile(handoffInputSchema);
    expect(handoffInput({ scenery: bundle.scenery, investigations: bundle.investigations, hostCapabilities: bundle.hostCapabilities }), JSON.stringify(handoffInput.errors)).toBe(true);
  });

  it('refuses a scene the questline cannot stand, the host does not declare or its investigation does not link', () => {
    const refuses = (change: (quest: QuestlineDefinition, input: ReturnType<typeof sceneBundle>['input']) => void, message: RegExp) => {
      const { quest, input } = sceneBundle();
      change(quest, input);
      expect(() => new EngineHandoff().assemble([quest], input)).toThrowError(message);
    };
    refuses((_, input) => delete (input.hostCapabilities as { scenery?: unknown }).scenery, /needs the host scenery capability/);
    refuses((_, input) => { input.hostCapabilities.scenery.poses = ['death-a']; }, /does not declare: pose standing-guard/);
    refuses((_, input) => { input.hostCapabilities.scenery.limits.actors = 1; }, /does not declare: 2 actors/);
    refuses((quest) => { quest.steps[0]!.target = { kind: 'talk', roleId: 'foreman' }; }, /no step of quest q_dock_killing kills that role/);
    refuses((_, input) => { input.scenery[0]!.activeWhen = { any: [{ kind: 'stepDone', stepId: 's_kill' }, { kind: 'questStarted' }] }; }, /could stand before foreman dies/);
    refuses((_, input) => { input.scenery[0]!.retireWhen = { kind: 'flagSet', flag: 'tape_down' }; }, /lacks: flag tape_down/);
    refuses((_, input) => { input.scenery[0]!.place.parcelId = 'p9'; }, /stands at p9, a building quest q_dock_killing never names/);
    refuses((_, input) => { input.missionAssetRequests = []; }, /names mission asset quest-item\.\w+, which the bundle does not request/);
    refuses((_, input) => { delete input.scenery[0]!.investigationSceneId; }, /links scene q_dock_killing\.sc_office, which names no investigation back/);
    refuses((_, input) => { (input.investigations[0] as { evidenceVisuals: unknown[] }).evidenceVisuals = [{ evidenceId: 'ev_wound', entityId: 'nobody' }]; }, /shows evidence on what scene .* lacks: nobody/);
    refuses((_, input) => {
      (input.investigations[0] as { scenery: { sceneId: string } }).scenery.sceneId = 'elsewhere';
      delete input.scenery[0]!.investigationSceneId;
    }, /investigation q_dock_killing\.sc_office links unknown scene elsewhere/);
    refuses((_, input) => { input.investigations = []; }, /names investigation q_dock_killing\.sc_office, which does not link it/);
  });

  it('ships two questlines built apart that stage the same sceneId, each under its own id', () => {
    const first = sceneBundle();
    const second = sceneBundle({ ...sceneQuest(), id: 'q_dock_again' });
    const bundle = new EngineHandoff().assemble([first.quest, second.quest], {
      ...first.input,
      scenery: [...first.input.scenery, ...second.input.scenery],
      investigations: [...first.input.investigations, ...second.input.investigations],
      missionAssetRequests: [...first.input.missionAssetRequests, ...second.input.missionAssetRequests],
    });
    expect(bundle.scenery.map((spec) => spec.sceneId)).toEqual(['q_dock_killing.sc_office', 'q_dock_again.sc_office']);
    expect(bundle.investigations.map((request) => request.sceneId)).toEqual(['q_dock_killing.sc_office', 'q_dock_again.sc_office']);
    expect(second.quest.steps[1]!.target).toMatchObject({ sceneId: 'q_dock_again.sc_office' });

    // Scoping renames only what the questline stages, and leaves the authored questline alone.
    const unstaged = scopedScenes(sceneQuest(), [{ ...officeStaging(), sceneId: 'sc_other', evidence: [] }]);
    expect(unstaged.definition.steps[1]!.target).toMatchObject({ sceneId: 'sc_office' });
    expect(unstaged.stagings.map((staging) => staging.sceneId)).toEqual(['q_dock_killing.sc_other']);
    expect(sceneQuest().steps[1]!.target).toMatchObject({ sceneId: 'sc_office' });
  });

  it('compiles only stagings that name what the questline has, in its own buildings', () => {
    const compile = (change: (staging: SceneStaging) => void) => {
      const staging = officeStaging();
      change(staging);
      return () => stagedScenery(sceneQuest(), [staging]);
    };
    expect(compile((staging) => { staging.place.atStepId = 's_kill'; })).toThrowError(/place.atStepId s_kill \(assassinate\) happens in no building/);
    expect(compile((staging) => { staging.props[1]!.itemId = 'wound'; })).toThrowError(/shows wound, which is no physical item/);
    expect(compile((staging) => { staging.evidence!.push({ evidenceId: 'ev_hair', elementId: 'blood' }); })).toThrowError(/shows clue ev_hair, which no investigation step/);
    expect(compile((staging) => { staging.evidence = []; })).toThrowError(/shows its clue ev_wound on nothing in scene sc_office/);
    expect(compile((staging) => { staging.actors[1] = { ...staging.actors[1]!, roleId: 'clerk' }; })).toThrowError(/a roleId .* or a gender .*, exactly one/);
    expect(compile((staging) => { staging.actors[0] = { ...staging.actors[0]!, pose: 'grieving' }; })).toThrowError(/stands in a scene only dead/);
    expect(compile((staging) => { staging.actors[0]!.nearActorId = 'guard'; })).toThrowError(/near guard, which is no actor listed before it/);
    expect(compile((staging) => { staging.clearedBy = 's_look'; })).toThrowError(/cleared by a step or lasting, not both/);
    expect(compile((staging) => { staging.stagedBy = 's_gone'; })).toThrowError(/names step s_gone, which the questline lacks/);
    // A clue is found only while its scene stands.
    expect(compile((staging) => { staging.stagedBy = 's_look'; })).toThrowError(/would stand only after its clue step s_look is done/);
    expect(compile((staging) => { staging.stagedBy = 's_look'; staging.stagedWhen = 'active'; })()).toMatchObject({ investigations: [{ sceneId: 'sc_office' }] });
    // ...and clears no sooner than its clue is found.
    expect(compile((staging) => { staging.stagedWhen = 'active'; staging.clearedBy = 's_kill'; delete staging.lasting; }))
      .toThrowError(/clears once step s_kill is done, before its clue step s_look can be/);
    expect(compile((staging) => { staging.clearedBy = 's_kill'; delete staging.lasting; })).toThrowError(/would appear and clear as step s_kill is done, so it never stands/);

    // Left alone, a scene stands from its step's opening until the questline ends; clearedBy retires it after a step.
    const open = stagedScenery(sceneQuest(), [{
      ...officeStaging(), sceneId: 'sc_dock', stagedWhen: 'active', lasting: undefined, clearedBy: 's_look', actors: [officeStaging().actors[1]!], props: [], evidence: [],
    }]);
    expect(open.investigations).toEqual([]);
    expect(open.scenery[0]).not.toHaveProperty('investigationSceneId');
    expect(open.scenery[0]).toMatchObject({
      activeWhen: { any: [{ kind: 'stepActive', stepId: 's_kill' }, { kind: 'stepDone', stepId: 's_kill' }] },
      retireWhen: { kind: 'stepDone', stepId: 's_look' },
    });
  });

  it('stands a scene with clues at its clue step, wherever casting moves it, and shows no item a pickup already stands', () => {
    const narrative = { description: 'The clerk waits.', playerHint: 'Meet the clerk.', stake: 'Nobody else saw.' };
    const meet: QuestlineDefinition['steps'][number] = {
      stepId: 's_meet', actId: 'a_dock', narrative, target: { kind: 'talk', roleId: 'clerk', atParcelId: 'p4' },
      gives: [], needs: [], conditions: [], effects: [], next: [], branching: 'parallel',
    };
    const withMeet = { ...sceneQuest(), steps: [...sceneQuest().steps, meet] };
    // Same building before casting, but the scene would follow the talk step and leave its clue behind.
    expect(() => stagedScenery(withMeet, [{ ...officeStaging(), place: { kind: 'room', atStepId: 's_meet' } }]))
      .toThrowError(/scene sc_office shows the clue of investigation step s_look, so it stands where that step happens: set place.atStepId to s_look/);

    // Casting moves the clue step to where its people work: the scene and its investigation move with it.
    const moved = sceneQuest();
    moved.steps[1]!.target = { ...moved.steps[1]!.target, place: { parcelId: 'p9', name: 'Night office' } } as QuestlineDefinition['steps'][number]['target'];
    const staged = stagedScenery(moved, [officeStaging()]);
    expect(staged.scenery[0]!.place.parcelId).toBe('p9');
    expect(staged.investigations[0]!.questBindings[0]!.place).toEqual({ parcelId: 'p9' });

    // Two clue steps of one scene that casting pulls into two buildings cannot share it.
    const second = { ...moved.steps[1]!, stepId: 's_look_again', target: { ...sceneQuest().steps[1]!.target, evidenceId: 'ev_knife' } } as QuestlineDefinition['steps'][number];
    const split = { ...moved, steps: [...moved.steps, second] };
    expect(() => stagedScenery(split, [{ ...officeStaging(), evidence: [...officeStaging().evidence!, { evidenceId: 'ev_knife', elementId: 'knife' }] }]))
      .toThrowError(/investigation step s_look_again is not in the building scene sc_office stands in \(p9, where step s_look happens\)/);

    const take: QuestlineDefinition['steps'][number] = { ...meet, stepId: 's_take', target: { kind: 'pickup', itemId: 'knife' } };
    expect(() => stagedScenery({ ...sceneQuest(), steps: [...sceneQuest().steps, take] }, [officeStaging()]))
      .toThrowError(/prop knife shows knife, which pickup step s_take already stands in the city for the player to take/);
  });
});
