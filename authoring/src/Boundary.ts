import { Ajv2020, type ValidateFunction } from 'ajv/dist/2020.js';
import flowDefinition from '../../flow/schema/questline.schema.json' with { type: 'json' };
import adaptationOutput from '../schema/adaptation-output.schema.json' with { type: 'json' };
import adaptationRequest from '../schema/adaptation-request.schema.json' with { type: 'json' };
import authoringError from '../schema/authoring-error.schema.json' with { type: 'json' };
import gameplayAgentRequest from '../schema/gameplay-agent-request.schema.json' with { type: 'json' };
import mechanicSelectionAgentRequest from '../schema/mechanic-selection-agent-request.schema.json' with { type: 'json' };
import mechanicSelection from '../schema/mechanic-selection.schema.json' with { type: 'json' };
import resolvedSkills from '../schema/resolved-skills.schema.json' with { type: 'json' };
import skillIndexQuery from '../schema/skill-index-query.schema.json' with { type: 'json' };
import skillIndex from '../schema/skill-index.schema.json' with { type: 'json' };
import skillResolveQuery from '../schema/skill-resolve-query.schema.json' with { type: 'json' };
import skillRouteQuery from '../schema/skill-route-query.schema.json' with { type: 'json' };
import skillRouteResult from '../schema/skill-route-result.schema.json' with { type: 'json' };
import storyAgentRequest from '../schema/story-agent-request.schema.json' with { type: 'json' };
import storyOutput from '../schema/story-output.schema.json' with { type: 'json' };
import storyRequest from '../schema/story-request.schema.json' with { type: 'json' };
import values from '../schema/values.schema.json' with { type: 'json' };
import worldContext from '../schema/world-context.schema.json' with { type: 'json' };
import { AuthoringError, type AuthoringErrorCode } from './AuthoringError.js';

const BASE_SCHEMAS = [
  values,
  authoringError,
  skillIndexQuery,
  skillIndex,
  skillResolveQuery,
  resolvedSkills,
  skillRouteQuery,
  skillRouteResult,
  worldContext,
  storyRequest,
  storyOutput,
  adaptationRequest,
  mechanicSelection,
  adaptationOutput,
  storyAgentRequest,
  mechanicSelectionAgentRequest,
  gameplayAgentRequest,
  flowDefinition,
];

export class Boundary {
  private readonly ajv = new Ajv2020({ allErrors: true, strict: true });

  constructor(extraSchemas: object[] = []) {
    for (const schema of [...BASE_SCHEMAS, ...extraSchemas]) this.ajv.addSchema(schema);
  }

  schema(name: string): object {
    const validate = this.validator(name, 'E_AUTHORING_OUTPUT');
    return validate.schema as object;
  }

  schemaBundle(rootName: string, dependencyNames: string[] = []): { rootId: string; documents: object[] } {
    const documents = [rootName, ...dependencyNames].map((name) => this.schema(name));
    const rootId = (documents[0] as { $id?: unknown }).$id;
    if (typeof rootId !== 'string') throw new AuthoringError('E_AUTHORING_OUTPUT', `${rootName} has no schema id`);
    return { rootId, documents };
  }

  input<T>(name: string, value: unknown): T {
    return this.assert<T>(name, value, 'E_AUTHORING_INPUT');
  }

  output<T>(name: string, value: unknown): T {
    return this.assert<T>(name, value, 'E_AUTHORING_OUTPUT');
  }

  private assert<T>(name: string, value: unknown, code: AuthoringErrorCode): T {
    const validate = this.validator(name, code);
    if (validate(value)) return value as T;
    const details = (validate.errors ?? []).map((error) => `${error.instancePath || '/'} ${error.message}`);
    throw new AuthoringError(code, `${name} does not match its schema`, details);
  }

  private validator(name: string, code: AuthoringErrorCode): ValidateFunction {
    const id = name.includes(':') ? name : `urn:urbe:quests:authoring:${name}`;
    const validate = this.ajv.getSchema(id);
    if (!validate) throw new AuthoringError(code, `unknown authoring schema ${name}`);
    return validate;
  }
}
