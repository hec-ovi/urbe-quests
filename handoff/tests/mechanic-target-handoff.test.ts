import { describe, expect, it } from 'vitest';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HANDOFF_FILES, writeEngineHandoff } from '../../creation/samples/EngineHandoffWriter.js';
import type { QuestlineDefinition } from '../../flow/schema.js';
import fixedHandoffFixture from '../fixtures/engine-public-transit.input.json' with { type: 'json' };
import fixedQuestFixture from '../fixtures/fixed-mechanics.questline.json' with { type: 'json' };
import { EngineHandoff } from '../EngineHandoff.js';
import type { HandoffInput } from '../schema.js';
import assetRequestSchema from '../schema/mission-asset-request.schema.json' with { type: 'json' };
import assetRequestsSchema from '../schema/mission-asset-requests.schema.json' with { type: 'json' };
import capabilitiesSchema from '../schema/host-capabilities.schema.json' with { type: 'json' };
import handoffInputSchema from '../schema/handoff-input.schema.json' with { type: 'json' };
import investigationSliceSchema from '../schema/investigation-binding-slice.schema.json' with { type: 'json' };
import mechanicBindingsSchema from '../schema/mechanic-target-bindings.schema.json' with { type: 'json' };
import itemBindingsSchema from '../schema/mission-item-bindings.schema.json' with { type: 'json' };

const fixedHandoffInput = fixedHandoffFixture as HandoffInput;
const fixedQuest = fixedQuestFixture as QuestlineDefinition;

describe('fixed mechanic engine handoff', () => {
  it('writes exact asset anchors and negotiated transportation capabilities through the public bundle writer', () => {
    const bundle = new EngineHandoff().assemble([fixedQuest], fixedHandoffInput);
    const outputDir = mkdtempSync(join(tmpdir(), 'quest-mechanics-handoff-'));
    const manifest = writeEngineHandoff(join(outputDir, 'questlines.json'), bundle);

    const ajv = new Ajv2020({ strict: true });
    ajv.addSchema(assetRequestSchema);
    ajv.addSchema(assetRequestsSchema);
    ajv.addSchema(capabilitiesSchema);
    ajv.addSchema(investigationSliceSchema);
    ajv.addSchema(mechanicBindingsSchema);
    ajv.addSchema(itemBindingsSchema);
    const validateInput = ajv.compile(handoffInputSchema);
    expect(validateInput(fixedHandoffInput), JSON.stringify(validateInput.errors)).toBe(true);
    expect(JSON.parse(readFileSync(join(outputDir, HANDOFF_FILES.mechanicTargetBindings), 'utf8'))).toEqual(fixedHandoffInput.mechanicTargetBindings);
    expect(JSON.parse(readFileSync(join(outputDir, HANDOFF_FILES.hostCapabilities), 'utf8'))).toEqual({ transportationModes: ['public-transit'] });
    expect(manifest.contractVersion).toBe('1.1');
    expect(manifest.counts.mechanicTargetBindings).toBe(4);
  });

  it('fails closed when a fixed mechanic lacks an exact usable asset anchor', () => {
    const handoff = new EngineHandoff();
    const missing = structuredClone(fixedHandoffInput);
    missing.mechanicTargetBindings = missing.mechanicTargetBindings?.slice(1);
    expect(() => handoff.assemble([fixedQuest], missing)).toThrowError(/has no mission asset binding/);

    const wrongTarget = structuredClone(fixedHandoffInput);
    const rescue = wrongTarget.mechanicTargetBindings?.find((binding) => 'releaseTargetId' in binding);
    if (rescue === undefined || !('releaseTargetId' in rescue)) throw new Error('fixture rescue binding changed');
    rescue.releaseTargetId = 'invented_release';
    expect(() => handoff.assemble([fixedQuest], wrongTarget)).toThrowError(/does not match its authored releaseTargetId/);

    const missingAnchor = structuredClone(fixedHandoffInput);
    const rescueAnchor = missingAnchor.mechanicTargetBindings?.find((binding) => 'releaseTargetId' in binding);
    if (rescueAnchor === undefined || !('releaseTargetId' in rescueAnchor)) throw new Error('fixture rescue binding changed');
    rescueAnchor.interactionId = 'open';
    expect(() => handoff.assemble([fixedQuest], missingAnchor)).toThrowError(/has no open interaction anchor/);

    const portableTarget = structuredClone(fixedHandoffInput);
    const releaseRequest = portableTarget.missionAssetRequests?.find((request) => request.assetId === 'quest.fixed.release-console');
    if (releaseRequest === undefined) throw new Error('fixture release asset changed');
    releaseRequest.family = 'data-drive';
    releaseRequest.dimensions = { width: 0.09, height: 0.025, depth: 0.04 };
    releaseRequest.materials = releaseRequest.materials.filter((material) => material.slot === 'surface');
    expect(() => handoff.assemble([fixedQuest], portableTarget)).toThrowError(/requires a fixed mission asset/);
  });

  it('fails closed when the host does not declare an authored transportation mode', () => {
    const unsupported = structuredClone(fixedQuest);
    const transport = unsupported.steps.find((step) => step.target.kind === 'transportation');
    if (transport === undefined || transport.target.kind !== 'transportation') throw new Error('fixture transport step changed');
    transport.target.mode = 'ride-hail';
    expect(() => new EngineHandoff().assemble([unsupported], fixedHandoffInput))
      .toThrowError(/host does not support transportation mode ride-hail/);
  });
});
