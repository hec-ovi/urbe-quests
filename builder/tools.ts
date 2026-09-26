/**
 * Agent tools with narrative fields first and descriptions loaded from
 * Markdown, rendered for the step kinds the questline may use.
 */

import { CUE_LIST } from '../flow/cues.js';
import { STEP_KINDS, type StepKind } from '../flow/schema.js';
import { ROOM_KINDS, SCENE_PURPOSES, SCENE_ROLES, SCENE_ZONES } from '../handoff/SceneStagings.js';
import type { SceneryCapabilities } from '../handoff/schema.js';
import type { AgentTool } from '../ports/llm.js';
import { promptLoader } from '../prompts.js';
import { mechanicVars, TARGET_FIELDS } from './mechanics.js';

const prompt = promptLoader(new URL('./prompts/', import.meta.url));

const predicate = {
  type: 'object',
  description: prompt('tools/predicate.md').trim(),
  properties: {
    kind: { enum: ['flagSet', 'flagNotSet', 'stepDone', 'roleAlive', 'roleOnDuty'] },
    flag: { type: 'string' },
    stepId: { type: 'string' },
    roleId: { type: 'string' },
  },
  required: ['kind'],
};

const effect = {
  type: 'object',
  description: prompt('tools/effect.md').trim(),
  properties: {
    kind: { enum: ['setFlag', 'clearFlag', 'simFlag'] },
    flag: { type: 'string' },
    roleId: { type: 'string' },
    op: {
      type: 'object',
      properties: { kind: { enum: ['resign', 'promote', 'die', 'custom'] }, toParcelId: { type: 'string' }, tag: { type: 'string' } },
      required: ['kind'],
    },
  },
  required: ['kind'],
};

const place = {
  type: 'object',
  description: prompt('tools/place.md').trim(),
  properties: {
    parcelId: { type: 'string' }, districtId: { type: 'string' }, stationId: { type: 'string' }, stopId: { type: 'string' },
  },
};

const id = { type: 'string' };
const ids = { type: 'array', items: id };

/**
 * Every target field a kind can name; a tool set offers the ones its kinds use.
 * They are declared in the one order every kind's target line names them
 * (a place after the ids it is the place of, the completion flag last), so a
 * model writing the target along the schema meets each field where its line
 * puts it and never passes one it still needs.
 */
const TARGET_PROPERTIES: Record<string, object> = {
  roleId: id,
  roleIds: { ...ids, minItems: 2, maxItems: 2 },
  atParcelId: id,
  role: id,
  itemId: id,
  fromRoleId: id,
  districtId: id,
  sceneId: id,
  evidenceId: id,
  evidenceItemId: id,
  subjectRoleIds: ids,
  releaseTargetId: id,
  accessPointId: id,
  credentialItemId: id,
  targetId: id,
  place,
  routeId: id,
  journeyId: id,
  mode: { enum: ['follow-player', 'lead-player', 'ride-hail', 'public-transit', 'vehicle', 'animal', 'aircraft'] },
  from: place,
  to: place,
  passengerRoleIds: ids,
  cargoItemIds: ids,
  completionFlag: id,
};

/** A tool section whose `- <id>:` lines keep only the ids offered. */
const offered = (file: string, keep: readonly string[], vars: Record<string, string | number> = {}): string =>
  prompt(file, vars).split('\n').filter((line) => {
    const named = /^- ([\w-]+):/.exec(line)?.[1];
    return named === undefined || keep.includes(named);
  }).join('\n').trim();

/** The target schema for these kinds: their enum, their fields, and the description lines that name them. */
function target(kinds: readonly StepKind[]): object {
  const fields = new Set(kinds.flatMap((kind) => [...TARGET_FIELDS[kind].needs, ...(TARGET_FIELDS[kind].may ?? [])]));
  const authored = kinds.some((kind) => TARGET_FIELDS[kind].needs.includes('completionFlag'));
  return {
    type: 'object',
    description: [offered('tools/add_step.md#target', kinds), ...(authored ? ['', prompt('tools/add_step.md#authored-ids')] : [])].join('\n'),
    properties: {
      kind: { enum: [...kinds] },
      ...Object.fromEntries(Object.entries(TARGET_PROPERTIES).filter(([name]) => fields.has(name))),
    },
    required: ['kind'],
  };
}

/**
 * The stage_scene tool for the scenery a host declares: its place kinds, poses,
 * prop kinds and limits are the whole vocabulary the agent is offered.
 */
export function stageSceneTool(scenery: SceneryCapabilities): AgentTool {
  const text = (section: string) => prompt(`tools/stage_scene.md#${section}`).trim();
  const assets = scenery.propKinds.includes('mission-asset');
  return {
    name: 'stage_scene',
    description: text('description'),
    inputSchema: {
      type: 'object',
      properties: {
        description: { type: 'string', description: text('narrative') },
        sceneId: { type: 'string', description: text('sceneId') },
        purpose: { enum: [...SCENE_PURPOSES], description: text('purpose') },
        stagedBy: { type: 'string', description: text('stagedBy') },
        stagedWhen: { enum: ['active', 'done'], description: text('stagedWhen') },
        place: {
          type: 'object',
          description: offered('tools/stage_scene.md#place', scenery.placeKinds),
          properties: {
            kind: { enum: [...scenery.placeKinds] },
            atStepId: id,
            roomKinds: { type: 'array', items: { enum: [...ROOM_KINDS] }, description: text('roomKinds') },
          },
          required: ['kind', 'atStepId'],
        },
        actors: {
          type: 'array',
          maxItems: scenery.limits.actors,
          description: offered('tools/stage_scene.md#actors', scenery.poses, { actors: scenery.limits.actors }),
          items: {
            type: 'object',
            properties: {
              actorId: id,
              role: { enum: [...SCENE_ROLES] },
              pose: { enum: [...scenery.poses] },
              gender: { enum: ['male', 'female'] },
              roleId: id,
              zone: { enum: [...SCENE_ZONES] },
              nearActorId: id,
            },
            required: ['actorId', 'role', 'pose'],
          },
        },
        props: {
          type: 'array',
          maxItems: scenery.limits.props,
          description: offered('tools/stage_scene.md#props', scenery.propKinds, { props: scenery.limits.props }),
          items: {
            type: 'object',
            properties: { propId: id, kind: { enum: [...scenery.propKinds] }, ...(assets ? { itemId: id } : {}), nearActorId: id, nearPropId: id },
            required: ['propId', 'kind'],
          },
        },
        evidence: {
          type: 'array',
          description: text('evidence'),
          items: { type: 'object', properties: { evidenceId: id, elementId: id }, required: ['evidenceId', 'elementId'] },
        },
        clearedBy: { type: 'string', description: text('clearedBy') },
        lasting: { type: 'boolean', description: text('lasting') },
      },
      required: ['description', 'sceneId', 'purpose', 'stagedBy', 'stagedWhen', 'place', 'actors', 'props'],
    },
  };
}

/** The builder's tools for a questline that may use these step kinds, and stage scenes when the host declares scenery. */
export function builderTools(kinds: readonly StepKind[] = STEP_KINDS, scenery?: SceneryCapabilities): AgentTool[] {
  const vars = mechanicVars(kinds);
  return [
    {
      name: 'create_questline',
      description: prompt('tools/create_questline.md#description').trim(),
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          premise: { type: 'string', description: prompt('tools/create_questline.md#premise').trim() },
          id: { type: 'string', description: prompt('tools/create_questline.md#id').trim() },
        },
        required: ['title', 'premise', 'id'],
      },
    },
    {
      name: 'add_role',
      description: prompt('tools/add_role.md#description').trim(),
      inputSchema: {
        type: 'object',
        properties: {
          persona: { type: 'string', description: prompt('tools/add_role.md#persona').trim() },
          roleId: { type: 'string' },
          npcType: { type: 'string', description: prompt('tools/add_role.md#npcType').trim() },
          characterName: {
            type: 'object',
            description: prompt('tools/add_role.md#characterName').trim(),
            properties: { given: { type: 'string' }, family: { type: 'string' } },
            required: ['given', 'family'],
          },
          reservedName: {
            type: 'object',
            description: prompt('tools/add_role.md#reservedName').trim(),
            properties: { given: { type: 'string' }, family: { type: 'string' } },
            required: ['given', 'family'],
          },
        },
        required: ['persona', 'roleId', 'npcType'],
      },
    },
    {
      name: 'add_item',
      description: prompt('tools/add_item.md#description', vars).trim(),
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          description: { type: 'string', description: prompt('tools/add_item.md#meaning').trim() },
          itemId: { type: 'string' },
          kind: { enum: ['device', 'weapon', 'document', 'key', 'substance', 'valuable', 'information'] },
          atParcelId: { type: 'string', description: prompt('tools/add_item.md#atParcelId').trim() },
        },
        required: ['name', 'description', 'itemId', 'kind'],
      },
    },
    {
      name: 'add_fact',
      description: prompt('tools/add_fact.md#description').trim(),
      inputSchema: {
        type: 'object',
        properties: {
          text: { type: 'string', description: prompt('tools/add_fact.md#text').trim() },
          factId: { type: 'string' },
          roleId: { type: 'string' },
          gateFlag: { type: 'string' },
        },
        required: ['text', 'factId', 'roleId'],
      },
    },
    {
      name: 'add_act',
      description: prompt('tools/add_act.md').trim(),
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          summary: { type: 'string' },
          actId: { type: 'string' },
        },
        required: ['title', 'summary', 'actId'],
      },
    },
    {
      name: 'add_ending',
      description: prompt('tools/add_ending.md#description').trim(),
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          epilogue: { type: 'string', description: prompt('tools/add_ending.md#epilogue').trim() },
          endingId: { type: 'string' },
        },
        required: ['title', 'epilogue', 'endingId'],
      },
    },
    {
      name: 'add_step',
      description: prompt('tools/add_step.md#description').trim(),
      inputSchema: {
        type: 'object',
        properties: {
          narrative: {
            type: 'object',
            properties: {
              description: { type: 'string', description: prompt('tools/add_step.md#narrative').trim() },
              playerHint: { type: 'string', description: prompt('tools/add_step.md#playerHint').trim() },
              stake: {
                type: 'string',
                description: prompt('tools/add_step.md#stake').trim(),
              },
            },
            required: ['description', 'playerHint', 'stake'],
          },
          wantedByRoleId: { type: 'string', description: prompt('tools/add_step.md#wantedByRoleId').trim() },
          dialogue: {
            type: 'object',
            description: prompt('tools/add_step.md#dialogue', { cues: CUE_LIST }).trim(),
            additionalProperties: false,
            required: ['opening', 'choices'],
            properties: {
              opening: { type: 'string', minLength: 1 },
              choices: {
                type: 'array', minItems: 1,
                items: {
                  type: 'object', additionalProperties: false,
                  required: ['id', 'text', 'reply', 'completesStep'],
                  properties: {
                    id: { type: 'string', minLength: 1 },
                    text: { type: 'string', minLength: 1 },
                    reply: { type: 'string', minLength: 1 },
                    completesStep: { type: 'boolean' },
                  },
                },
              },
            },
          },
          stepId: { type: 'string' },
          actId: { type: 'string' },
          target: target(kinds),
          gives: { type: 'array', items: { type: 'string' }, description: prompt('tools/add_step.md#gives').trim() },
          needs: { type: 'array', items: { type: 'string' }, description: prompt('tools/add_step.md#needs').trim() },
          conditions: { type: 'array', items: predicate, description: prompt('tools/add_step.md#conditions').trim() },
          effects: { type: 'array', items: effect },
          next: {
            type: 'array',
            description: prompt('tools/add_step.md#next').trim(),
            items: {
              type: 'object',
              properties: {
                toStepId: { type: 'string' },
                when: { type: 'array', items: predicate },
              },
              required: ['toStepId', 'when'],
            },
          },
          branching: { enum: ['parallel', 'exclusive'], description: prompt('tools/add_step.md#branching').trim() },
          endingId: { type: 'string' },
          entry: { type: 'boolean', description: prompt('tools/add_step.md#entry').trim() },
        },
        required: ['narrative', 'stepId', 'actId', 'target', 'next'],
      },
    },
    ...(scenery !== undefined ? [stageSceneTool(scenery)] : []),
    {
      name: 'finish_questline',
      description: prompt('tools/finish_questline.md').trim(),
      inputSchema: { type: 'object', properties: {} },
    },
  ];
}

/** Every step kind playable. */
export const BUILDER_TOOLS: AgentTool[] = builderTools();
