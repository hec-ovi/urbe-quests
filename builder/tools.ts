/**
 * Agent-facing tool definitions for questline drafting. Narrative properties
 * come before structural ones in every schema on purpose: the model commits
 * to story before structure.
 */

import type { AgentTool } from '../ports/llm.js';

const predicate = {
  type: 'object',
  description: 'Pure condition. kinds: flagSet, flagNotSet, stepDone, roleAlive, roleOnDuty',
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
  description: 'Applied when the step completes. kinds: setFlag, clearFlag, simFlag (op: resign, promote, die, custom)',
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
  description: 'Either a parcelId or a districtId from the world catalog',
  properties: { parcelId: { type: 'string' }, districtId: { type: 'string' } },
};

export const BUILDER_TOOLS: AgentTool[] = [
  {
    name: 'create_questline',
    description: 'Start the questline. Write the premise first: what this story is about and why it matters.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        premise: { type: 'string', description: 'The story of this questline in prose, written before any structure.' },
        id: { type: 'string', description: 'Short machine id, e.g. q_kettle_debt' },
      },
      required: ['title', 'premise', 'id'],
    },
  },
  {
    name: 'add_role',
    description:
      'Add a character role. Bind it to an NPC type from the catalog, never to an id or a location; the simulation decides who, where and when. Write the persona as story: personality, needs, drives.',
    inputSchema: {
      type: 'object',
      properties: {
        persona: { type: 'string', description: 'Personality, needs and story on top of the mathematical background.' },
        roleId: { type: 'string' },
        npcType: { type: 'string', description: 'Type string from the NPC type catalog.' },
        reservedName: {
          type: 'object',
          description: 'Only for a pre-instanced story NPC with a fixed identity.',
          properties: { given: { type: 'string' }, family: { type: 'string' } },
          required: ['given', 'family'],
        },
      },
      required: ['persona', 'roleId', 'npcType'],
    },
  },
  {
    name: 'add_item',
    description: 'Add a quest item.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        description: { type: 'string' },
        itemId: { type: 'string' },
        atParcelId: { type: 'string', description: 'Where the item starts, when it starts placed.' },
      },
      required: ['name', 'description', 'itemId'],
    },
  },
  {
    name: 'add_fact',
    description:
      'Add a piece of quest knowledge one role can talk about. With gateFlag, the NPC does not know or reveal it until that flag is set; without, the NPC can always share it.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'The knowledge, in the NPC\'s own voice.' },
        factId: { type: 'string' },
        roleId: { type: 'string' },
        gateFlag: { type: 'string' },
      },
      required: ['text', 'factId', 'roleId'],
    },
  },
  {
    name: 'add_act',
    description: 'Add an act: a movement of the questline.',
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
    description: 'Add one way the questline can end.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        epilogue: { type: 'string', description: 'How the story closes when this ending is reached.' },
        endingId: { type: 'string' },
      },
      required: ['title', 'epilogue', 'endingId'],
    },
  },
  {
    name: 'add_step',
    description:
      'Add a step. Write the narrative first, then the mechanics. Steps connect through next edges; a step with no edges is terminal and needs an endingId. Mark starting steps with entry: true.',
    inputSchema: {
      type: 'object',
      properties: {
        narrative: {
          type: 'object',
          properties: {
            description: { type: 'string', description: 'What happens in the story at this step.' },
            playerHint: { type: 'string', description: 'What the player sees as the objective.' },
          },
          required: ['description', 'playerHint'],
        },
        stepId: { type: 'string' },
        actId: { type: 'string' },
        target: {
          type: 'object',
          description:
            'The typed objective. kinds: goto {place}, observe {districtId}, talk {roleId, atParcelId?}, listen {roleIds: [two], atParcelId}, pickup {itemId}, deliver {itemId, place}, steal {itemId, fromRoleId}, assassinate {roleId}, work {atParcelId, role}',
          properties: {
            kind: {
              enum: ['goto', 'observe', 'talk', 'listen', 'pickup', 'deliver', 'steal', 'assassinate', 'work'],
            },
            place,
            districtId: { type: 'string' },
            roleId: { type: 'string' },
            atParcelId: { type: 'string' },
            roleIds: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 2 },
            itemId: { type: 'string' },
            fromRoleId: { type: 'string' },
            role: { type: 'string' },
          },
          required: ['kind'],
        },
        conditions: { type: 'array', items: predicate, description: 'Extra gates; usually empty.' },
        effects: { type: 'array', items: effect },
        next: {
          type: 'array',
          description: 'Outgoing edges. Empty means terminal (set endingId).',
          items: {
            type: 'object',
            properties: {
              toStepId: { type: 'string' },
              when: { type: 'array', items: predicate },
            },
            required: ['toStepId', 'when'],
          },
        },
        branching: { enum: ['parallel', 'exclusive'], description: 'exclusive: only the first passing edge activates.' },
        endingId: { type: 'string' },
        entry: { type: 'boolean', description: 'true for steps active when the questline starts.' },
      },
      required: ['narrative', 'stepId', 'actId', 'target', 'next'],
    },
  },
  {
    name: 'finish_questline',
    description: 'Validate and close the questline. Fix any reported problem and call again.',
    inputSchema: { type: 'object', properties: {} },
  },
];
