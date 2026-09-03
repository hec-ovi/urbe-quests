import { Boundary } from './Boundary.js';
import { AuthoringError } from './AuthoringError.js';
import { CauseEffectAudit } from './CauseEffectAudit.js';
import { QuestGraphAudit } from './QuestGraphAudit.js';
import { SkillResolver } from './SkillResolver.js';
import { StoryAudit } from './StoryAudit.js';
import { WorldAudit } from './WorldAudit.js';
import {
  MECHANICS,
  type AdaptationOutput,
  type AdaptationRequest,
  type GameplayAgentPort,
  type GameplayAgentRequest,
  type Mechanic,
  type MechanicSelection,
  type MechanicSelectionAgentRequest,
  type SkillIndex,
} from './schema.js';

const SUPPORTED = new Set<string>(MECHANICS);

export class GameplayStage {
  constructor(
    private readonly resolver = new SkillResolver(),
    private readonly boundary = new Boundary(),
    private readonly storyAudit = new StoryAudit(),
    private readonly worldAudit = new WorldAudit(),
    private readonly causeEffectAudit = new CauseEffectAudit(),
    private readonly graphAudit = new QuestGraphAudit(),
  ) {}

  async adapt(input: AdaptationRequest, agent: GameplayAgentPort): Promise<AdaptationOutput> {
    const request = this.boundary.input<AdaptationRequest>('adaptation-request', input);
    this.storyAudit.validate(request.story);
    const allowed = this.allowedMechanics(request.requestedMechanics);
    const core = this.resolver.resolve({ names: ['gameplay-adaptation'] });
    const availableSkills: SkillIndex = {
      skills: this.resolver.index().skills.filter(
        (skill) => skill.kind === 'mechanic' && skill.mechanic !== undefined && allowed.has(skill.mechanic),
      ),
    };
    const selectionRequest = this.boundary.output<MechanicSelectionAgentRequest>('mechanic-selection-agent-request', {
      stage: 'mechanic-selection',
      skills: core,
      input: request,
      availableSkills,
      outputSchema: this.boundary.schemaBundle('mechanic-selection', ['values']),
    });
    const selection = this.boundary.output<MechanicSelection>(
      'mechanic-selection',
      await agent.selectMechanics(selectionRequest),
    );
    const mechanics = this.validateSelection(selection, allowed);
    const skills = this.resolver.resolve({ names: ['gameplay-adaptation', ...mechanics] });
    const gameplayRequest = this.boundary.output<GameplayAgentRequest>('gameplay-agent-request', {
      stage: 'gameplay-adaptation',
      skills,
      input: request,
      selection: { mechanics },
      outputSchema: this.boundary.schemaBundle('adaptation-output', [
        'values',
        'https://urbe.local/quests/flow/schema/questline.schema.json',
      ]),
    });
    const output = this.boundary.output<AdaptationOutput>('adaptation-output', await agent.adapt(gameplayRequest));

    this.graphAudit.validate(output.definition);
    this.worldAudit.validate(output.definition, request);
    this.causeEffectAudit.validate(output, request.story, mechanics);
    return output;
  }

  private allowedMechanics(requested: string[] | undefined): Set<Mechanic> {
    const names = requested ?? [...MECHANICS];
    const unsupported = names.filter((name) => !SUPPORTED.has(name));
    if (unsupported.length > 0) {
      throw new AuthoringError('E_UNSUPPORTED_MECHANIC', 'requested mechanics are not supported by the quest runtime', unsupported);
    }
    return new Set(names as Mechanic[]);
  }

  private validateSelection(selection: MechanicSelection, allowed: Set<Mechanic>): Mechanic[] {
    const unsupported = selection.mechanics.filter((name) => !SUPPORTED.has(name));
    const disallowed = selection.mechanics.filter((name) => SUPPORTED.has(name) && !allowed.has(name as Mechanic));
    if (unsupported.length > 0 || disallowed.length > 0) {
      throw new AuthoringError('E_MECHANIC_SELECTION', 'agent selected unavailable mechanic skills', [
        ...unsupported.map((name) => `unsupported: ${name}`),
        ...disallowed.map((name) => `outside caller allowlist: ${name}`),
      ]);
    }
    return selection.mechanics as Mechanic[];
  }
}
