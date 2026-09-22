/** Builds per-person context from Simulation, quest facts and recorded conversation. */

import { QuestError } from '../errors.js';
import { promptLoader } from '../prompts.js';
import type { QuestlineRuntime } from '../flow/QuestlineRuntime.js';
import type { QuestRole } from '../flow/schema.js';
import type { LLMPort } from '../ports/llm.js';
import type { NamedWorld, NPCType, NPCTypeSet } from '../world/types/named-world.js';
import type { SimulationPort } from '../world/types/simulation.js';
import { BackgroundRenderer } from './BackgroundRenderer.js';
import { MemoryStore, type MemoryStoreOptions } from './MemoryStore.js';
import type { ContextSegment, DialogContext, DialogTurn, MemorySnapshot } from './schema.js';
import { clock, dayName } from './time.js';

export interface DialogContextServiceInput {
  world: NamedWorld;
  types: NPCTypeSet;
  sim: SimulationPort;
  llm: LLMPort;
  memory?: MemoryStoreOptions;
}

const prompt = promptLoader(new URL('./prompts/', import.meta.url));
const SYSTEM_PROMPT = prompt('dialog-system.md');

export class DialogContextService {
  private readonly world: NamedWorld;
  private readonly types: NPCTypeSet;
  private readonly sim: SimulationPort;
  private readonly memoryStore: MemoryStore;
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
    this.background = new BackgroundRenderer(input.world);
  }

  /** Questlines contribute personas, flag-gated knowledge, active wants and ending reactions for their cast. Attaching a questline of the same id again replaces the earlier runtime. */
  attachQuestline(runtime: QuestlineRuntime): void {
    const index = this.questlines.findIndex((q) => q.def.id === runtime.def.id);
    if (index >= 0) this.questlines[index] = runtime;
    else this.questlines.push(runtime);
  }

  contextFor(npcId: string, timeMin: number): DialogContext {
    const npc = this.sim.getNPC(npcId);
    if (npc.flags.dead) throw new QuestError('E_WRONG_STATE', `npc ${npcId} is dead`);
    const characterName = this.characterName(npcId);

    const segments: ContextSegment[] = [
      { id: 'world', text: this.renderWorld(), shared: true },
      { id: 'type', text: this.renderType(npc.type), shared: true },
      { id: 'npc', text: this.renderNpc(npcId, characterName), shared: false },
    ];
    const quest = this.renderQuestKnowledge(npcId);
    if (quest.length > 0) segments.push({ id: 'quest', text: quest, shared: false });
    const memory = this.memoryStore.snapshot(npcId);
    if (memory.digest.length > 0) {
      segments.push({ id: 'memory', text: prompt('context.md#memory', { notes: memory.digest.map((n) => `- ${n}`).join('\n') }), shared: false });
    }
    segments.push({ id: 'turns', text: this.renderNow(npcId, timeMin, memory.turns), shared: false });
    return { npcId, ...(characterName ? { characterName: { ...characterName } } : {}), segments };
  }

  async recordTurn(npcId: string, turn: DialogTurn): Promise<void> {
    await this.memoryStore.record(npcId, turn);
  }

  serializeMemory(): Record<string, MemorySnapshot> {
    return this.memoryStore.serialize();
  }

  restoreMemory(data: Record<string, MemorySnapshot>): void {
    this.memoryStore.restore(data);
  }

  private renderWorld(): string {
    if (this.worldSegment === undefined) {
      const districts = this.world.districts.map((d) => d.name).join(', ');
      this.worldSegment = prompt('context.md#world', { system: SYSTEM_PROMPT, districts, theme: this.world.meta.naming.theme });
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

  private renderNpc(npcId: string, characterName: QuestRole['characterName']): string {
    const npc = this.sim.getNPC(npcId);
    // Only the dialog projection uses the story name. Identity, routines,
    // relations, saved conversation and simulation state retain this npcId.
    const parts = [this.background.render(characterName ? { ...npc, name: characterName } : npc)];
    if (characterName) parts.push(prompt('context.md#character', characterName));
    for (const runtime of this.questlines) {
      for (const role of runtime.def.roles) {
        if (runtime.cast[role.roleId] === npcId) parts.push(prompt('context.md#persona', { persona: role.persona }));
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
        known.push(`- ${fact.text}`);
      }
      for (const step of runtime.activeSteps()) {
        if (step.wantedByRoleId === undefined || runtime.cast[step.wantedByRoleId] !== npcId) continue;
        wants.push(`- ${step.narrative.description} ${step.narrative.stake}`);
      }
      const ending = runtime.ending();
      if (ending !== undefined && Object.values(runtime.cast).includes(npcId)) endings.push(`- ${ending.epilogue}`);
    }
    const blocks: string[] = [];
    if (known.length > 0) blocks.push(prompt('context.md#known', { facts: known.join('\n') }));
    if (wants.length > 0) blocks.push(prompt('context.md#wants', { wants: wants.join('\n') }));
    if (endings.length > 0) blocks.push(prompt('context.md#endings', { endings: endings.join('\n') }));
    return blocks.join('\n');
  }

  private renderNow(npcId: string, timeMin: number, turns: DialogTurn[]): string {
    const behavior = this.sim.behaviorAt(npcId, timeMin);
    const day = dayName(Math.floor(timeMin / 1440) % 7);
    const lines = [prompt('context.md#now', { day, time: clock(timeMin % 1440), activity: behavior.activity.replace('_', ' ') })];
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
