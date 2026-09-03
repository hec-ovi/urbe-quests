export const MECHANICS = [
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
export type Mechanic = (typeof MECHANICS)[number];

export type Tier = 'poor' | 'mid' | 'rich' | 'high_rich';
export type ParcelType =
  | 'residential'
  | 'hotel'
  | 'offices'
  | 'corpo'
  | 'hospital'
  | 'clinic'
  | 'police'
  | 'military'
  | 'factory'
  | 'commerce'
  | 'mall'
  | 'restaurant'
  | 'coffee_shop';

export interface WorldContext {
  world: {
    meta: { seed: string | number; naming: { theme: string; model?: string; namedAt: string } };
    districts: { id: string; kind: 'downtown' | 'commercial' | 'residential' | 'industrial' | 'mixed'; tier: Tier; name: string }[];
    parcels: { id: string; districtId: string; type: ParcelType; tier: Tier; name?: string }[];
    transit?: {
      busStops: TransitEntity[];
      busRoutes: TransitEntity[];
      trainStations: TransitEntity[];
      trainLines: TransitEntity[];
      subwayStations: TransitEntity[];
      subwayLines: TransitEntity[];
    };
  };
  types: {
    meta: { theme: string; worldSeed: string | number; createdAt: string; model?: string };
    types: {
      type: string;
      label: string;
      category: 'resident' | 'worker' | 'vendor' | 'authority' | 'transit' | 'street';
      boilerplate: string;
      examples?: string[];
      grounding: { districts?: string[]; parcelTypes?: ParcelType[]; tiers?: Tier[] };
      weight: number;
    }[];
    namePool: { given: string[]; family: string[] };
  };
}

export interface TransitEntity {
  id: string;
  districtId?: string;
  name?: string;
}

export type PlaceTarget =
  | { parcelId: string }
  | { districtId: string }
  | { stationId: string }
  | { stopId: string };
export type StepTarget =
  | { kind: 'goto'; place: PlaceTarget }
  | { kind: 'observe'; districtId: string }
  | { kind: 'talk'; roleId: string; atParcelId?: string }
  | { kind: 'listen'; roleIds: [string, string]; atParcelId: string }
  | { kind: 'pickup'; itemId: string }
  | { kind: 'deliver'; itemId: string; place: PlaceTarget }
  | { kind: 'steal'; itemId: string; fromRoleId: string }
  | { kind: 'assassinate'; roleId: string }
  | { kind: 'work'; atParcelId: string; role: string }
  | {
      kind: 'investigation';
      sceneId: string;
      evidenceId: string;
      evidenceItemId: string;
      subjectRoleIds: string[];
      place: PlaceTarget;
      completionFlag: string;
    }
  | { kind: 'rescue'; roleId: string; releaseTargetId: string; place: PlaceTarget; completionFlag: string }
  | {
      kind: 'escort';
      roleId: string;
      routeId: string;
      mode: 'follow-player' | 'lead-player';
      from: PlaceTarget;
      to: PlaceTarget;
      completionFlag: string;
    }
  | { kind: 'access'; accessPointId: string; credentialItemId: string; place: PlaceTarget; completionFlag: string }
  | { kind: 'hacking'; targetId: string; place: PlaceTarget; completionFlag: string }
  | { kind: 'sabotage'; targetId: string; place: PlaceTarget; completionFlag: string }
  | {
      kind: 'transportation';
      journeyId: string;
      mode: 'ride-hail' | 'public-transit' | 'vehicle' | 'animal' | 'aircraft';
      from: PlaceTarget;
      to: PlaceTarget;
      passengerRoleIds: string[];
      cargoItemIds: string[];
      completionFlag: string;
    };
export type Predicate =
  | { kind: 'flagSet'; flag: string }
  | { kind: 'flagNotSet'; flag: string }
  | { kind: 'stepDone'; stepId: string }
  | { kind: 'roleAlive'; roleId: string }
  | { kind: 'roleOnDuty'; roleId: string };
export type FlagOp =
  | { kind: 'resign' }
  | { kind: 'promote'; toParcelId?: string }
  | { kind: 'die' }
  | { kind: 'custom'; tag: string };
export type Effect =
  | { kind: 'setFlag'; flag: string }
  | { kind: 'clearFlag'; flag: string }
  | { kind: 'simFlag'; roleId: string; op: FlagOp };
export interface QuestStep {
  stepId: string;
  actId: string;
  narrative: { description: string; playerHint: string; stake: string };
  wantedByRoleId?: string;
  target: StepTarget;
  gives: string[];
  needs: string[];
  conditions: Predicate[];
  effects: Effect[];
  next: { toStepId: string; when: Predicate[] }[];
  branching: 'parallel' | 'exclusive';
  endingId?: string;
}
export interface QuestlineDefinition {
  id: string;
  title: string;
  premise: string;
  roles: { roleId: string; npcType: string; persona: string; reservedName?: { given: string; family: string } }[];
  items: { itemId: string; name: string; description: string; kind: 'device' | 'weapon' | 'document' | 'key' | 'substance' | 'valuable' | 'information'; atParcelId?: string }[];
  facts: { factId: string; roleId: string; text: string; gateFlag?: string }[];
  acts: { actId: string; title: string; summary: string }[];
  steps: QuestStep[];
  endings: { endingId: string; title: string; epilogue: string }[];
  flags: string[];
  entryStepIds: string[];
}

export interface SkillSummary {
  name: string;
  description: string;
  triggers: string[];
  kind: 'stage' | 'mechanic';
  mechanic?: Mechanic;
}

export interface ResolvedSkill extends SkillSummary {
  path: string;
  content: string;
}

export interface SkillIndex {
  skills: SkillSummary[];
}

export interface SkillRouteResult {
  matches: SkillSummary[];
}

export interface ResolvedSkills {
  skills: ResolvedSkill[];
}

export interface StoryRequest extends WorldContext {
  prompt: string;
  requirements?: string[];
}

export interface StoryCharacter {
  characterId: string;
  name: string;
  role: string;
  background: string;
  want: string;
  voice: string;
}

export interface StoryBeat {
  beatId: string;
  heading: string;
  scene: {
    placeName: string;
    time: string;
    description: string;
  };
  action: string;
  dialogue: { speakerCharacterId: string; line: string }[];
  consequence: string;
  characterIds: string[];
}

export interface StoryDecision {
  decisionId: string;
  setup: string;
  options: { outcomeId: string; choice: string; consequence: string }[];
}

export interface StoryOutput {
  storyId: string;
  prompt: string;
  title: string;
  logline: string;
  setting: {
    summary: string;
    placeNames: string[];
  };
  characters: StoryCharacter[];
  movements: {
    presentation: StoryBeat[];
    development: StoryBeat[];
    conflict: StoryBeat[];
    ending: StoryBeat[];
  };
  decisions: StoryDecision[];
}

export interface AdaptationRequest extends WorldContext {
  story: StoryOutput;
  requestedMechanics?: string[];
}

export interface MechanicSelection {
  mechanics: string[];
}

export interface MechanicChoice {
  stepId: string;
  mechanic: Mechanic;
  storyBeatIds: string[];
  narrativeReason: string;
  cause: string;
  effect: string;
  transitions: { toStepId: string; narrativeCause: string; consequence: string }[];
}

export interface EndingRoute {
  endingId: string;
  terminalStepIds: string[];
  storyOutcomeIds: string[];
  cause: string;
  consequence: string;
}

export interface AdaptationOutput {
  definition: QuestlineDefinition;
  mechanicChoices: MechanicChoice[];
  endingRoutes: EndingRoute[];
}

export interface SchemaBundle {
  rootId: string;
  documents: object[];
}

export interface StoryAgentRequest {
  stage: 'story';
  skills: ResolvedSkills;
  input: StoryRequest;
  outputSchema: SchemaBundle;
}

export interface MechanicSelectionAgentRequest {
  stage: 'mechanic-selection';
  skills: ResolvedSkills;
  input: AdaptationRequest;
  availableSkills: SkillIndex;
  outputSchema: SchemaBundle;
}

export interface GameplayAgentRequest {
  stage: 'gameplay-adaptation';
  skills: ResolvedSkills;
  input: AdaptationRequest;
  selection: MechanicSelection;
  outputSchema: SchemaBundle;
}

export interface StoryAgentPort {
  write(request: StoryAgentRequest): Promise<unknown>;
}

export interface GameplayAgentPort {
  selectMechanics(request: MechanicSelectionAgentRequest): Promise<unknown>;
  adapt(request: GameplayAgentRequest): Promise<unknown>;
}
