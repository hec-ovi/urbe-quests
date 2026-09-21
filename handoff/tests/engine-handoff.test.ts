/**
 * Contract-surface tests for quests/handoff: bundle v1.1 projection, the
 * stable engine files, and every E_HANDOFF family.
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

const fixtureQuestlines = [adaptationFixture.definition] as QuestlineDefinition[];
const fixedHandoffInput = fixedHandoffFixture as HandoffInput;
const fixedQuest = fixedQuestFixture as QuestlineDefinition;

/** One validator carrying every published handoff schema plus the flow questline it references. */
function validators(): Ajv2020 {
  const ajv = new Ajv2020({ strict: true });
  for (const schema of [
    questlineSchema, assetRequestSchema, assetRequestsSchema, bindingsSchema, capabilitiesSchema,
    mechanicBindingsSchema, investigationSliceSchema,
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
  dimensions: { width: 0.22, height: 0.01, depth: 0.3 },
  materials: [{ slot: 'surface', key: 'cyberpunk/fabric/mid', variantId: 'paper' }],
  requiredInteractions: ['inspect', 'read', 'take'],
  clearance: { approachDepth: 0.8, sideMargin: 0.2, overhead: 0.1 },
});

const pickupHandoff = (): HandoffInput => ({
  missionAssetRequests: [assetRequest()],
  missionItemBindings: [{ questId: 'q_last_manifest', itemId: 'i_manifest', assetId: assetRequest().assetId }],
});

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
    for (const file of ['investigations', 'mechanicTargetBindings'] as const) {
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
      requiredInteractions: ['inspect'],
    };
    expect(() => handoff.assemble(fixtureQuestlines, fixed)).toThrowError(/portable mission asset with a take interaction anchor/);
  });

  it('writes exact fixed mechanic anchors and negotiated transportation capabilities', () => {
    const outputPath = outDir('quest-mechanics-handoff-');
    const manifest = writeEngineHandoff(outputPath, new EngineHandoff().assemble([fixedQuest], fixedHandoffInput));
    const dir = join(outputPath, '..');

    const input = validators().compile(handoffInputSchema);
    expect(input(fixedHandoffInput), JSON.stringify(input.errors)).toBe(true);
    expect(readFile(dir, HANDOFF_FILES.mechanicTargetBindings)).toEqual(fixedHandoffInput.mechanicTargetBindings);
    expect(readFile(dir, HANDOFF_FILES.hostCapabilities)).toEqual({ transportationModes: ['public-transit'] });
    expect(manifest.contractVersion).toBe('1.1');
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
});
