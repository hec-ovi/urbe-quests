import { Ajv2020 } from 'ajv/dist/2020.js';
import { QuestError } from '../errors.js';
import type { HandoffInput } from './schema.js';
import inputSchema from './schema/handoff-input.schema.json' with { type: 'json' };
import assets from './schema/mission-asset-requests.schema.json' with { type: 'json' };
import asset from './schema/mission-asset-request.schema.json' with { type: 'json' };
import items from './schema/mission-item-bindings.schema.json' with { type: 'json' };
import mechanics from './schema/mechanic-target-bindings.schema.json' with { type: 'json' };
import capabilities from './schema/host-capabilities.schema.json' with { type: 'json' };
import investigations from './schema/investigation-binding-slice.schema.json' with { type: 'json' };
import scenery from './schema/scenery-binding-slice.schema.json' with { type: 'json' };

const validate = new Ajv2020({ allErrors: true, strict: true,
  schemas: [assets, asset, items, mechanics, capabilities, investigations, scenery],
}).compile<HandoffInput>(inputSchema);

export class HandoffInputBoundary {
  parse(input: unknown): HandoffInput {
    if (!validate(input)) {
      throw new QuestError('E_HANDOFF', 'handoff input does not match its schema',
        validate.errors?.map(error => `${error.instancePath || '/'} ${error.message}`));
    }
    return input;
  }
}
