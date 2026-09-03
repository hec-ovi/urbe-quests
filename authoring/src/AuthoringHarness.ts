import { Boundary } from './Boundary.js';
import { GameplayStage } from './GameplayStage.js';
import { SkillResolver } from './SkillResolver.js';
import { StoryStage } from './StoryStage.js';
import type {
  AdaptationOutput,
  AdaptationRequest,
  GameplayAgentPort,
  ResolvedSkills,
  SkillIndex,
  SkillRouteResult,
  StoryAgentPort,
  StoryOutput,
  StoryRequest,
} from './schema.js';

/** Thin facade over skill routing and the two independently callable authoring stages. */
export class AuthoringHarness {
  readonly resolver: SkillResolver;
  readonly story: StoryStage;
  readonly gameplay: GameplayStage;

  constructor(resolver = new SkillResolver(), boundary = new Boundary()) {
    this.resolver = resolver;
    this.story = new StoryStage(resolver, boundary);
    this.gameplay = new GameplayStage(resolver, boundary);
  }

  skillIndex(): SkillIndex {
    return this.resolver.index();
  }

  route(message: string): SkillRouteResult {
    return this.resolver.route({ message });
  }

  resolveSkills(names: string[]): ResolvedSkills {
    return this.resolver.resolve({ names });
  }

  writeStory(input: StoryRequest, agent: StoryAgentPort): Promise<StoryOutput> {
    return this.story.write(input, agent);
  }

  adaptGameplay(input: AdaptationRequest, agent: GameplayAgentPort): Promise<AdaptationOutput> {
    return this.gameplay.adapt(input, agent);
  }
}
