/** Builds per-person context from Simulation, quest facts and recorded conversation. */

import { QuestError } from '../errors.js';
import { stripCues } from '../flow/cues.js';
import { promptLoader } from '../prompts.js';
import type { QuestlineRuntime } from '../flow/QuestlineRuntime.js';
import type { QuestRole } from '../flow/schema.js';
import type { LLMPort } from '../ports/llm.js';
import type { NPCType, NPCTypeSet } from '../world/types/named-world.js';
import type { NPCInstance, SimulationPort } from '../world/types/simulation.js';
import { BackgroundRenderer } from './BackgroundRenderer.js';
import { MemoryStore, type MemoryStoreOptions } from './MemoryStore.js';
import { PlaceWords } from './places.js';
import type {
  ContextOptions,
  ContextSegment,
  DialogContext,
  DialogExchange,
  DialogGuide,
  DialogTurn,
  DialogWorld,
  MemorySnapshot,
} from './schema.js';
import { clock, dayName } from './time.js';

export interface DialogContextServiceInput {
  world: DialogWorld;
  types: NPCTypeSet;
  sim: SimulationPort;
  llm: LLMPort;
  memory?: MemoryStoreOptions;
}

const prompt = promptLoader(new URL('./prompts/', import.meta.url));
const SYSTEM_PROMPT = prompt('dialog-system.md');

export class DialogContextService {
  private readonly world: DialogWorld;
  private readonly types: NPCTypeSet;
  private readonly sim: SimulationPort;
  private readonly memoryStore: MemoryStore;
  private readonly places: PlaceWords;
  private readonly background: BackgroundRenderer;
  private readonly questlines: QuestlineRuntime[] = [];
  /** Memoized shared layers: the cache for common instances. */
  private worldSegment: string | undefined;
  private readonly typeSegments = new Map<string, string>();

  constructor(input: DialogContextServiceInput) {
    this.world = input.world;
    this.types = input.types;
    this.sim = input.sim;
    this.memoryStore = new MemoryStore(input.llm, input.memory);
    this.places = new PlaceWords(input.world);
    this.background = new BackgroundRenderer(this.places);
  }

  /** Questlines contribute personas, flag-gated knowledge, active wants and ending reactions for their cast. Attaching a questline of the same id again replaces the earlier runtime. */
  attachQuestline(runtime: QuestlineRuntime): void {
    const index = this.questlines.findIndex((q) => q.def.id === runtime.def.id);
    if (index >= 0) this.questlines[index] = runtime;
    else this.questlines.push(runtime);
  }

  contextFor(npcId: string, timeMin: number, options: ContextOptions = {}): DialogContext {
    const npc = this.sim.getNPC(npcId);
    if (npc.flags.dead) throw new QuestError('E_WRONG_STATE', `npc ${npcId} is dead`);
    const characterName = this.characterName(npcId);

    const segments: ContextSegment[] = [
      { id: 'world', text: this.renderWorld(), shared: true },
      { id: 'type', text: this.renderType(npc.type), shared: true },
      { id: 'npc', text: this.renderNpc(npc, characterName), shared: false },
    ];
    const quest = this.renderQuestKnowledge(npcId);
    if (quest.length > 0) segments.push({ id: 'quest', text: quest, shared: false });
    const memory = this.memoryStore.snapshot(npcId);
    if (memory.digest.length > 0) {
      segments.push({ id: 'memory', text: prompt('context.md#memory', { notes: bullets(memory.digest) }), shared: false });
    }
    if (options.guide) segments.push({ id: 'place', text: this.renderPlace(npc, options.guide), shared: false });
    segments.push({ id: 'turns', text: this.renderNow(npcId, timeMin, memory.turns), shared: false });
    return { npcId, ...(characterName ? { characterName: { ...characterName } } : {}), segments };
  }

  /**
   * Remembers one completed exchange, the reply without its cues: both turns
   * are stored before this returns. The returned promise settles when any fold the exchange started
   * has written its note, so a host replies first and awaits or catches it later.
   */
  recordExchange(npcId: string, exchange: DialogExchange): Promise<void> {
    return this.memoryStore.record(npcId, [
      { speaker: 'player', text: exchange.line, atMin: exchange.atMin },
      { speaker: 'npc', text: stripCues(exchange.reply), atMin: exchange.atMin },
    ]);
  }

  serializeMemory(): Record<string, MemorySnapshot> {
    return this.memoryStore.serialize();
  }

  restoreMemory(data: Record<string, MemorySnapshot>): void {
    this.memoryStore.restore(data);
  }

  private renderWorld(): string {
    if (this.worldSegment === undefined) {
      const districts = this.places.namedDistricts();
      this.worldSegment = [
        prompt('context.md#world', { system: SYSTEM_PROMPT }),
        ...(districts.length > 0 ? [prompt('context.md#districts', { districts: districts.join(', ') })] : []),
        prompt('context.md#theme', { theme: this.world.meta.naming.theme }),
      ].join('\n');
    }
    return this.worldSegment;
  }

  private renderType(type: string): string {
    let segment = this.typeSegments.get(type);
    if (segment === undefined) {
      segment = this.typeOf(type).boilerplate;
      this.typeSegments.set(type, segment);
    }
    return segment;
  }

  private characterName(npcId: string): QuestRole['characterName'] {
    for (const runtime of this.questlines) {
      const role = runtime.def.roles.find((role) => runtime.cast[role.roleId] === npcId && role.characterName !== undefined);
      if (role?.characterName) return role.characterName;
    }
    return undefined;
  }

  private renderNpc(npc: NPCInstance, characterName: QuestRole['characterName']): string {
    // Only the dialog projection uses the story name. Identity, routines,
    // relations, saved conversation and simulation state retain this npcId.
    const parts = [this.background.render(characterName ? { ...npc, name: characterName } : npc)];
    if (characterName) parts.push(prompt('context.md#character', characterName));
    for (const runtime of this.questlines) {
      for (const role of runtime.def.roles) {
        if (runtime.cast[role.roleId] === npc.npcId) parts.push(prompt('context.md#persona', { persona: role.persona }));
      }
    }
    return parts.join('\n');
  }

  /**
   * Scope is code-decided: facts whose gate is open, active steps this NPC
   * wants (through the cast mapping), and the epilogue of an ending this NPC
   * was part of. The model never chooses what enters.
   */
  private renderQuestKnowledge(npcId: string): string {
    const known: string[] = [];
    const wants: string[] = [];
    const endings: string[] = [];
    for (const runtime of this.questlines) {
      for (const fact of runtime.def.facts) {
        if (runtime.cast[fact.roleId] !== npcId) continue;
        if (fact.gateFlag !== undefined && !runtime.flags().has(fact.gateFlag)) continue;
        known.push(fact.text);
      }
      for (const step of runtime.activeSteps()) {
        if (step.wantedByRoleId === undefined || runtime.cast[step.wantedByRoleId] !== npcId) continue;
        wants.push(`${step.narrative.description} ${step.narrative.stake}`);
      }
      const ending = runtime.ending();
      if (ending !== undefined && Object.values(runtime.cast).includes(npcId)) endings.push(ending.epilogue);
    }
    const blocks: string[] = [];
    if (known.length > 0) blocks.push(prompt('context.md#known', { facts: bullets(known) }));
    if (wants.length > 0) blocks.push(prompt('context.md#wants', { wants: bullets(wants) }));
    if (endings.length > 0) blocks.push(prompt('context.md#endings', { endings: bullets(endings) }));
    return blocks.join('\n');
  }

  /** The place the NPC led the player to, and what this NPC's own life ties it to. */
  private renderPlace(npc: NPCInstance, guide: DialogGuide): string {
    const lines = [prompt('context.md#place', { place: this.places.named({ kind: guide.kind, id: guide.placeId }, guide.name) })];
    const at = (place: { kind: string; id: string } | undefined) => place?.kind === guide.kind && place.id === guide.placeId;
    if (at(npc.job && { kind: 'parcel', id: npc.job.parcelId }) || at(npc.transitJob?.place)) lines.push(prompt('context.md#place-work'));
    if (at({ kind: 'parcel', id: npc.home.parcelId })) lines.push(prompt('context.md#place-home'));
    if (npc.routine.some((e) => (e.activity === 'leisure' || e.activity === 'shopping') && at(e.place))) lines.push(prompt('context.md#place-haunt'));
    if (guide.notes !== undefined && guide.notes.length > 0) lines.push(prompt('context.md#place-notes', { notes: bullets(guide.notes) }));
    lines.push(prompt('context.md#place-talk'));
    return lines.join('\n');
  }

  private renderNow(npcId: string, timeMin: number, turns: DialogTurn[]): string {
    const behavior = this.sim.behaviorAt(npcId, timeMin);
    const day = dayName(Math.floor(timeMin / 1440) % 7);
    const lines = [prompt('context.md#now', { day, time: clock(timeMin % 1440), activity: prompt(`context.md#activity-${behavior.activity}`) })];
    if (turns.length > 0) {
      lines.push(prompt('context.md#conversation', {
        turns: turns.map(turn => `${turn.speaker === 'player' ? 'Player' : 'You'}: ${turn.text}`).join('\n'),
      }));
    }
    return lines.join('\n');
  }

  private typeOf(type: string): NPCType {
    const found = this.types.types.find((t) => t.type === type);
    if (!found) throw new QuestError('E_UNKNOWN_ID', `unknown npc type ${type}`);
    return found;
  }
}

const bullets = (lines: string[]): string => lines.map((line) => `- ${line}`).join('\n');
