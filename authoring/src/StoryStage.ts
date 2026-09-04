import { Boundary } from './Boundary.js';
import { SkillResolver } from './SkillResolver.js';
import { StoryAudit } from './StoryAudit.js';
import { WorldAudit } from './WorldAudit.js';
import { WorldContextNormalizer } from '../../world/WorldContextNormalizer.js';
import type { StoryAgentPort, StoryAgentRequest, StoryOutput, StoryRequest } from './schema.js';

export class StoryStage {
  constructor(
    private readonly resolver = new SkillResolver(),
    private readonly boundary = new Boundary(),
    private readonly audit = new StoryAudit(),
    private readonly worldAudit = new WorldAudit(),
    private readonly worldContext = new WorldContextNormalizer(),
  ) {}

  async write(input: StoryRequest, agent: StoryAgentPort): Promise<StoryOutput> {
    const request = this.boundary.input<StoryRequest>('story-request', this.worldContext.normalize(input));
    this.worldAudit.validateContext(request);
    const skills = this.resolver.resolve({ names: ['story-writing'] });
    const agentRequest = this.boundary.output<StoryAgentRequest>('story-agent-request', {
      stage: 'story',
      skills,
      input: request,
      outputSchema: this.boundary.schemaBundle('story-output', ['values']),
    });
    const story = this.boundary.output<StoryOutput>('story-output', await agent.write(agentRequest));
    this.audit.validate(story, request);
    this.worldAudit.validateStory(story, request);
    return story;
  }
}
