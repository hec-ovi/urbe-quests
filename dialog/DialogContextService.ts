/**
 * Assembles an NPC's dialog context as cache-ordered layers: shared world
 * rules, shared type boilerplate, the instance's deterministic background plus
 * personas, flag-gated quest knowledge, memory digest, then the volatile now
 * line and recent turns. A fact outside these layers is simply not in the
 * prompt, so it cannot leak; deflection is the character genuinely not knowing.
 */

import { readFileSync } from 'node:fs';
import { QuestError } from '../errors.js';
import type { QuestlineRuntime } from '../flow/QuestlineRuntime.js';
import type { LLMPort } from '../ports/llm.js';
import type { NamedWorld, NPCType, NPCTypeSet } from '../world/types/named-world.js';
import type { SimulationPort } from '../world/types/simulation.js';
import { BackgroundRenderer } from './BackgroundRenderer.js';
import { MemoryStore, type MemoryStoreOptions } from './MemoryStore.js';
import type { ContextSegment, DialogContext, DialogTurn, MemorySnapshot } from './schema.js';

export interface DialogContextServiceInput {
  world: NamedWorld;
  types: NPCTypeSet;
  sim: SimulationPort;
  llm: LLMPort;
  memory?: MemoryStoreOptions;
}

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const SYSTEM_PROMPT = readFileSync(new URL('./prompts/dialog-system.md', import.meta.url), 'utf8');

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

  /** Questlines contribute personas and flag-gated knowledge for their cast. */
  attachQuestline(runtime: QuestlineRuntime): void {
    this.questlines.push(runtime);
  }

  contextFor(npcId: string, timeMin: number): DialogContext {
    const npc = this.sim.getNPC(npcId);
    if (npc.flags.dead) throw new QuestError('E_WRONG_STATE', `npc ${npcId} is dead`);

    const segments: ContextSegment[] = [
      { id: 'world', text: this.renderWorld(), shared: true },
      { id: 'type', text: this.renderType(npc.type), shared: true },
      { id: 'npc', text: this.renderNpc(npcId), shared: false },
    ];
    const quest = this.renderQuestKnowledge(npcId);
    if (quest.length > 0) segments.push({ id: 'quest', text: quest, shared: false });
    const memory = this.memoryStore.snapshot(npcId);
    if (memory.digest.length > 0) {
      segments.push({ id: 'memory', text: `You remember:\n${memory.digest.map((n) => `- ${n}`).join('\n')}`, shared: false });
    }
    segments.push({ id: 'turns', text: this.renderNow(npcId, timeMin, memory.turns), shared: false });
    return { npcId, segments };
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
      this.worldSegment = `${SYSTEM_PROMPT}\nThe city and its districts: ${districts}.\nIts character: ${this.world.meta.naming.theme}`;
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

  private renderNpc(npcId: string): string {
    const parts = [this.background.render(this.sim.getNPC(npcId))];
    for (const runtime of this.questlines) {
      for (const role of runtime.def.roles) {
        if (runtime.cast[role.roleId] === npcId) parts.push(`Who you are underneath: ${role.persona}`);
      }
    }
    return parts.join('\n');
  }

  private renderQuestKnowledge(npcId: string): string {
    const known: string[] = [];
    for (const runtime of this.questlines) {
      for (const fact of runtime.def.facts) {
        if (runtime.cast[fact.roleId] !== npcId) continue;
        if (fact.gateFlag !== undefined && !runtime.flags().has(fact.gateFlag)) continue;
        known.push(`- ${fact.text}`);
      }
    }
    return known.length > 0 ? `Things you know and may speak about when it fits:\n${known.join('\n')}` : '';
  }

  private renderNow(npcId: string, timeMin: number, turns: DialogTurn[]): string {
    const behavior = this.sim.behaviorAt(npcId, timeMin);
    const day = DAY_NAMES[Math.floor(timeMin / 1440) % 7];
    const minute = timeMin % 1440;
    const clock = `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
    const lines = [`It is ${day} ${clock}; right now you are ${behavior.activity.replace('_', ' ')}.`];
    if (turns.length > 0) {
      lines.push('The conversation so far:');
      for (const turn of turns) lines.push(`${turn.speaker === 'player' ? 'Player' : 'You'}: ${turn.text}`);
    }
    return lines.join('\n');
  }

  private typeOf(type: string): NPCType {
    const found = this.types.types.find((t) => t.type === type);
    if (!found) throw new QuestError('E_UNKNOWN_ID', `unknown npc type ${type}`);
    return found;
  }
}
