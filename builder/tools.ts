/** Agent tools with narrative fields first and descriptions loaded from Markdown. */

import { promptLoader } from '../prompts.js';

import type { AgentTool } from '../ports/llm.js';

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
    op: { type: 'object' },
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

const stepKinds = [
  'goto',
  'observe',
  'talk',
  'listen',
  'pickup',
  'deliver',
  'steal',
  'assassinate',
  'work',
  'investigation',
  'rescue',
  'escort',
  'access',
  'hacking',
  'sabotage',
  'transportation',
] as const;

export const BUILDER_TOOLS: AgentTool[] = [
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
    description: prompt('tools/add_item.md#description').trim(),
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
          description: prompt('tools/add_step.md#dialogue').trim(),
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
        target: {
          type: 'object',
          description: prompt('tools/add_step.md#target').trim(),
          properties: {
            kind: { enum: stepKinds },
            place,
            districtId: { type: 'string' },
            roleId: { type: 'string' },
            atParcelId: { type: 'string' },
            roleIds: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 2 },
            itemId: { type: 'string' },
            fromRoleId: { type: 'string' },
            role: { type: 'string' },
            sceneId: { type: 'string' },
            evidenceId: { type: 'string' },
            evidenceItemId: { type: 'string' },
            subjectRoleIds: { type: 'array', items: { type: 'string' } },
            completionFlag: { type: 'string' },
            releaseTargetId: { type: 'string' },
            routeId: { type: 'string' },
            mode: {
              enum: ['follow-player', 'lead-player', 'ride-hail', 'public-transit', 'vehicle', 'animal', 'aircraft'],
            },
            from: place,
            to: place,
            accessPointId: { type: 'string' },
            credentialItemId: { type: 'string' },
            targetId: { type: 'string' },
            journeyId: { type: 'string' },
            passengerRoleIds: { type: 'array', items: { type: 'string' } },
            cargoItemIds: { type: 'array', items: { type: 'string' } },
          },
          required: ['kind'],
        },
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
  {
    name: 'finish_questline',
    description: prompt('tools/finish_questline.md').trim(),
    inputSchema: { type: 'object', properties: {} },
  },
];
