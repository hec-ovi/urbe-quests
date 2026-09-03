import { describe, expect, it } from 'vitest';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import questlinesFixture from '../../creation/samples/games/small/questlines.json' with { type: 'json' };
import { HANDOFF_FILES, writeEngineHandoff } from '../../creation/samples/EngineHandoffWriter.js';
import type { QuestlineDefinition } from '../../flow/schema.js';
import questlineSchema from '../../flow/schema/questline.schema.json' with { type: 'json' };
import { EngineHandoff } from '../EngineHandoff.js';
import type { InvestigationSceneRequest, MissionAssetCreateRequest } from '../schema.js';
import assetRequestSchema from '../schema/mission-asset-request.schema.json' with { type: 'json' };
import assetRequestsSchema from '../schema/mission-asset-requests.schema.json' with { type: 'json' };
import bindingsSchema from '../schema/mission-item-bindings.schema.json' with { type: 'json' };
import capabilitiesSchema from '../schema/host-capabilities.schema.json' with { type: 'json' };
import mechanicBindingsSchema from '../schema/mechanic-target-bindings.schema.json' with { type: 'json' };
import objectivesSchema from '../schema/objectives.schema.json' with { type: 'json' };
import bundleSchema from '../schema/quest-bundle.schema.json' with { type: 'json' };
import handoffInputSchema from '../schema/handoff-input.schema.json' with { type: 'json' };
import investigationSliceSchema from '../schema/investigation-binding-slice.schema.json' with { type: 'json' };

const fixtureQuestlines = questlinesFixture as QuestlineDefinition[];

function investigationQuest(): QuestlineDefinition {
  return {
    id: 'q_archive_scene',
    title: 'Archive scene',
    premise: 'A scored wall proves which terminal started the archive fire.',
    roles: [{ roleId: 'witness', npcType: 'cafe_barista', persona: 'Remembers every alarm.' }],
    items: [
      { itemId: 'burn_origin', name: 'Burn origin', description: 'The direction of the first electrical arc.', kind: 'information' },
      { itemId: 'paper_log', name: 'Paper log', description: 'The witness kept the only physical access log.', kind: 'document', atParcelId: 'p4' },
    ],
    facts: [],
    acts: [{ actId: 'a_scene', title: 'Scene', summary: 'Read the fixed trace.' }],
    steps: [{
      stepId: 's_wall',
      actId: 'a_scene',
      narrative: { description: 'The wall carries the first arc.', playerHint: 'Inspect the scored wall.', stake: 'The witness takes the blame if the origin is lost.' },
      wantedByRoleId: 'witness',
      target: {
        kind: 'investigation', sceneId: 'scene_archive', evidenceId: 'wall_score', evidenceItemId: 'burn_origin',
        subjectRoleIds: ['witness'], place: { parcelId: 'p4' }, completionFlag: 'wall_read',
      },
      gives: ['burn_origin'], needs: [], conditions: [], effects: [{ kind: 'setFlag', flag: 'wall_read' }],
      next: [], branching: 'parallel', endingId: 'e_origin',
    }],
    endings: [{ endingId: 'e_origin', title: 'Origin', epilogue: 'The physical trace fixes the fire at one terminal.' }],
    flags: ['wall_read'],
    entryStepIds: ['s_wall'],
  };
}

function scene(): InvestigationSceneRequest {
  return {
    contractVersion: '1.1',
    sceneId: 'scene_archive',
    questId: 'q_archive_scene',
    seed: 41,
    incident: { family: 'electrical-fire', summary: 'A deliberate arc marked the archive wall.' },
    questBindings: [{ stepId: 's_wall', evidenceId: 'wall_score', place: { parcelId: 'p4' }, completionAction: 'inspect' }],
    location: { kind: 'interior', placeId: 'p4' },
    bodies: [],
    props: [],
    decals: [],
    evidence: [{
      evidenceId: 'wall_score', factId: 'burn_origin', label: 'Wall score', description: 'The arc direction is fixed in the wall.',
      portable: false, requiresInspection: true, prerequisiteEvidenceIds: [], consequences: [],
    }],
  };
}

function assetRequest(): MissionAssetCreateRequest {
  return {
    contractVersion: '1.0',
    assetId: 'quest.archive.paper-log',
    purpose: 'Physical archive access log carried by the player',
    family: 'document',
    dimensions: { width: 0.22, height: 0.01, depth: 0.3 },
    materials: [{ slot: 'surface', key: 'cyberpunk/fabric/mid', variantId: 'paper' }],
    requiredInteractions: ['inspect', 'read', 'take'],
    clearance: { approachDepth: 0.8, sideMargin: 0.2, overhead: 0.1 },
    seed: 41,
  };
}

describe('EngineHandoff', () => {
  it('projects every authored target unchanged in stable quest and step order', () => {
    const bundle = new EngineHandoff().assemble(fixtureQuestlines);
    const expected = fixtureQuestlines.flatMap((questline) => questline.steps.map((step) => ({
      questId: questline.id, stepId: step.stepId, action: step.target,
    })));
    expect(bundle.objectives).toEqual(expected);
    expect(bundle.investigations).toEqual([]);
    expect(bundle.mechanicTargetBindings).toEqual([]);
    expect(bundle.missionAssetRequests).toEqual([]);
    expect(bundle.hostCapabilities).toEqual({ transportationModes: [] });

    const ajv = new Ajv2020({ strict: true });
    ajv.addSchema(questlineSchema);
    const validate = ajv.compile(objectivesSchema);
    expect(validate(bundle.objectives), JSON.stringify(validate.errors)).toBe(true);
  });

  it('accepts complete investigation and mission-item handoffs with schema-valid public files', () => {
    const request = assetRequest();
    const bundle = new EngineHandoff().assemble([investigationQuest()], {
      investigations: [scene()],
      missionAssetRequests: [request],
      missionItemBindings: [{ questId: 'q_archive_scene', itemId: 'paper_log', assetId: request.assetId }],
    });
    expect(bundle.investigations[0]?.questBindings[0]?.stepId).toBe('s_wall');

    const ajv = new Ajv2020({ strict: true });
    ajv.addSchema(assetRequestSchema);
    ajv.addSchema(assetRequestsSchema);
    ajv.addSchema(bindingsSchema);
    ajv.addSchema(capabilitiesSchema);
    ajv.addSchema(mechanicBindingsSchema);
    ajv.addSchema(investigationSliceSchema);
    const validateRequests = ajv.getSchema(assetRequestsSchema.$id)!;
    const validateBindings = ajv.getSchema(bindingsSchema.$id)!;
    expect(validateRequests(bundle.missionAssetRequests), JSON.stringify(validateRequests.errors)).toBe(true);
    expect(validateBindings(bundle.missionItemBindings), JSON.stringify(validateBindings.errors)).toBe(true);
    const validateInput = ajv.compile(handoffInputSchema);
    expect(validateInput({
      investigations: bundle.investigations,
      hostCapabilities: bundle.hostCapabilities,
      mechanicTargetBindings: bundle.mechanicTargetBindings,
      missionAssetRequests: bundle.missionAssetRequests,
      missionItemBindings: bundle.missionItemBindings,
    }), JSON.stringify(validateInput.errors)).toBe(true);
  });

  it('writes every stable engine filename and a validated manifest, including empty catalogs', () => {
    const outputDir = mkdtempSync(join(tmpdir(), 'quest-handoff-'));
    const outputPath = join(outputDir, 'questlines.json');
    const manifest = writeEngineHandoff(outputPath, new EngineHandoff().assemble(fixtureQuestlines));
    const validate = new Ajv2020({ strict: true }).compile(bundleSchema);
    expect(validate(manifest), JSON.stringify(validate.errors)).toBe(true);
    expect(JSON.parse(readFileSync(join(outputDir, HANDOFF_FILES.investigations), 'utf8'))).toEqual([]);
    expect(JSON.parse(readFileSync(join(outputDir, HANDOFF_FILES.mechanicTargetBindings), 'utf8'))).toEqual([]);
    expect(JSON.parse(readFileSync(join(outputDir, HANDOFF_FILES.missionAssetRequests), 'utf8'))).toEqual([]);
    expect(JSON.parse(readFileSync(join(outputDir, HANDOFF_FILES.missionItemBindings), 'utf8'))).toEqual([]);
    expect(JSON.parse(readFileSync(join(outputDir, HANDOFF_FILES.hostCapabilities), 'utf8'))).toEqual({ transportationModes: [] });
    expect(JSON.parse(readFileSync(join(outputDir, HANDOFF_FILES.objectives), 'utf8'))).toHaveLength(manifest.counts.objectives);
    expect(JSON.parse(readFileSync(join(outputDir, HANDOFF_FILES.manifest), 'utf8'))).toEqual(manifest);
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

  it('fails closed on incompatible asset requests and invalid item bindings', () => {
    const handoff = new EngineHandoff();
    const incompatible = assetRequest();
    incompatible.requiredInteractions = ['hack'];
    expect(() => handoff.assemble(fixtureQuestlines, { missionAssetRequests: [incompatible] })).toThrowError(/incompatible interactions/);

    const request = assetRequest();
    expect(() => handoff.assemble([investigationQuest()], {
      investigations: [scene()],
      missionAssetRequests: [request],
      missionItemBindings: [{ questId: 'q_archive_scene', itemId: 'burn_origin', assetId: request.assetId }],
    })).toThrowError(/information item/);
    expect(() => handoff.assemble([investigationQuest()], {
      investigations: [scene()],
      missionAssetRequests: [request],
      missionItemBindings: [{ questId: 'q_archive_scene', itemId: 'paper_log', assetId: 'missing.asset' }],
    })).toThrowError(/unknown asset/);
  });

});
