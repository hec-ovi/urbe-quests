/** Builds per-person context from Simulation, quest facts and recorded conversation. */

import { QuestError } from '../errors.js';
import { stripCues } from '../flow/cues.js';
import { promptLoader } from '../prompts.js';
import type { QuestlineRuntime } from '../flow/QuestlineRuntime.js';
import type { QuestRole, QuestStep, QuestStepDialogue } from '../flow/schema.js';
import type { LLMPort } from '../ports/llm.js';
import type { NPCType, NPCTypeSet } from '../world/types/named-world.js';
import type { NPCInstance, RoutineEntry, SimulationPort } from '../world/types/simulation.js';
import { BackgroundRenderer } from './BackgroundRenderer.js';
import { lifeHistory } from './LifeHistory.js';
import { dispositionOf } from '../world/disposition.js';
import { MemoryStore, type MemoryStoreOptions } from './MemoryStore.js';
import { listed, ordinal, PlaceWords, withArticle } from './places.js';
import type { DialogPeople } from './people.js';
import type {
  ContextOptions,
  DialogAddress,
  DialogAddresses,
  ContextSegment,
  DialogContext,
  DialogEvent,
  DialogExchange,
  DialogBuilding,
  DialogCall,
  DialogCarry,
  DialogDealing,
  DialogGuide,
  DialogHere,
  DialogLine,
  DialogLook,
  DialogTask,
  DialogTurn,
  DialogHeard,
  DialogOverheard,
  DialogWay,
  DialogWorld,
  MemorySnapshot,
} from './schema.js';
import { clock, dayName, spoken } from './time.js';

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
      { id: 'npc', text: this.renderNpc(npc, characterName, timeMin, options.look), shared: false },
    ];
    const address = options.addresses && this.renderAddresses(options.addresses);
    if (address) segments.push({ id: 'address', text: address, shared: false });
    const quest = this.renderQuestKnowledge(npcId);
    if (quest.length > 0) segments.push({ id: 'quest', text: quest, shared: false });
    const memory = this.memoryStore.snapshot(npcId);
    if (memory.digest.length > 0) {
      segments.push({ id: 'memory', text: prompt('context.md#memory', { notes: bullets(memory.digest.map(plainWords)) }), shared: false });
    }
    // The talk so far only grows, so it goes ahead of what changes every turn and the prompt cache keeps it.
    const turns = [...memory.turns, ...said(options.prior ?? [], timeMin)];
    if (turns.length > 0) {
      segments.push({
        id: 'conversation',
        text: prompt('context.md#conversation', { turns: turns.map((turn) => `${turn.speaker === 'player' ? 'Them' : 'You'}: ${turn.text}`).join('\n') }),
        shared: false,
      });
    }
    if (options.overheard?.length) segments.push({ id: 'overheard', text: this.renderOverheard(options.overheard), shared: false });
    if (options.guide) segments.push({ id: 'place', text: this.renderPlace(npc, options.guide), shared: false });
    if (options.events?.length) segments.push({ id: 'events', text: this.renderEvents(options.events, timeMin), shared: false });
    if (options.people) segments.push({ id: 'people', text: this.renderPeople(options.people), shared: false });
    segments.push({ id: 'turns', text: this.renderNow(npc, timeMin, options.here, options.task, options.call, options.addresses, options.carry), shared: false });
    return { npcId, ...(characterName ? { characterName: { ...characterName } } : {}), segments };
  }

  /**
   * Remembers one completed exchange after the prior lines shown before it,
   * the NPC's lines without their cues: all turns are stored before this returns.
   * The returned promise settles when any fold the exchange started has
   * written its note, so a host replies first and awaits or catches it later.
   */
  recordExchange(npcId: string, exchange: DialogExchange): Promise<void> {
    return this.memoryStore.record(npcId, said([
      ...(exchange.prior ?? []),
      { speaker: 'player', text: exchange.line },
      { speaker: 'npc', text: exchange.reply },
    ], exchange.atMin));
  }

  /**
   * Remembers what this person overheard of the player talking to somebody
   * else, being there when it was said: one short note in their memory, marked
   * as other people's words with who spoke, written again with the newest
   * lines while the same talk goes on. It persists with the rest of their
   * memory, so they know of the player's business only what they heard.
   */
  recordOverheard(npcId: string, heard: DialogHeard): void {
    const who = heard.role ? `${heard.name}, the ${words(heard.role)}` : heard.name;
    const header = prompt('context.md#overheard-note', { who }).trim();
    const lines = heard.lines
      .map((line) => ({ who: line.speaker === 'player' ? 'The stranger' : heard.name, text: stripCues(line.text) }))
      .filter((line) => line.text.length > 0);
    this.memoryStore.overhear(npcId, header, lines, heard.atMin);
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
        // A world's own setting says what the city is; a bare theme word is only its character.
        this.world.meta.setting
          ? prompt('context.md#setting', { setting: this.world.meta.setting.trim() })
          : prompt('context.md#theme', { theme: this.world.meta.naming.theme }),
      ].join('\n');
    }
    return this.worldSegment;
  }

  private renderType(type: string): string {
    let segment = this.typeSegments.get(type);
    if (segment === undefined) {
      segment = plainWords(this.typeOf(type).boilerplate);
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

  private renderNpc(npc: NPCInstance, characterName: QuestRole['characterName'], timeMin: number, look: DialogLook | undefined): string {
    // Only the dialog projection uses the story name. Identity, routines,
    // relations, saved conversation and simulation state retain this npcId.
    const category = this.typeOf(npc.type).category;
    const parts = [this.background.render(characterName ? { ...npc, name: characterName } : npc, { timeMin, category, ...(look ? { look } : {}) })];
    // Their life so far, told once and kept in their memory, so it never changes.
    parts.push(this.memoryStore.life(npc.npcId, () => lifeHistory(npc, {
      district: this.places.districtOf(npc.home.parcelId),
      ...(npc.job ? { workplace: this.places.short({ kind: 'parcel', id: npc.job.parcelId }) } : {}),
      category,
      disposition: dispositionOf(npc, category),
    })));
    if (characterName) parts.push(prompt('context.md#character', characterName));
    for (const runtime of this.questlines) {
      for (const role of runtime.def.roles) {
        if (runtime.cast[role.roleId] === npc.npcId) parts.push(prompt('context.md#persona', { persona: plainWords(role.persona) }));
      }
    }
    return parts.join('\n');
  }

  /**
   * Scope is code-decided: for anyone the stories cast, who the player is;
   * facts whose gate is open, active steps this NPC wants (through the cast
   * mapping), the authored talk this NPC is on with the player, and the
   * epilogue of an ending this NPC was part of. The model never chooses what enters.
   */
  private renderQuestKnowledge(npcId: string): string {
    const known: string[] = [];
    const wants: string[] = [];
    const talks: string[] = [];
    const endings: string[] = [];
    let cast = false;
    for (const runtime of this.questlines) {
      for (const fact of runtime.def.facts) {
        if (runtime.cast[fact.roleId] !== npcId) continue;
        if (fact.gateFlag !== undefined && !runtime.flags().has(fact.gateFlag)) continue;
        known.push(fact.text);
      }
      for (const step of runtime.activeSteps()) {
        if (step.wantedByRoleId !== undefined && runtime.cast[step.wantedByRoleId] === npcId) {
          wants.push(`${step.narrative.description} ${step.narrative.stake}`);
        }
        const dialogue = talkWith(step, runtime.cast, npcId);
        if (dialogue) talks.push(renderTalk(dialogue));
      }
      if (!Object.values(runtime.cast).includes(npcId)) continue;
      cast = true;
      const ending = runtime.ending();
      if (ending !== undefined) endings.push(ending.epilogue);
    }
    // The player is one person across the set, as the main story's prologue tells it.
    const player = cast ? this.questlines.find((runtime) => runtime.def.prologue !== undefined)?.def.prologue : undefined;
    const blocks: string[] = [];
    if (player) blocks.push(prompt('context.md#player', { player }));
    if (known.length > 0) blocks.push(prompt('context.md#known', { facts: bullets(known) }));
    if (wants.length > 0) blocks.push(prompt('context.md#wants', { wants: bullets(wants) }));
    blocks.push(...talks);
    if (endings.length > 0) blocks.push(prompt('context.md#endings', { endings: bullets(endings) }));
    return blocks.join('\n');
  }

  /** The place the NPC led the player to, and what this NPC's own life ties it to. */
  private renderPlace(npc: NPCInstance, guide: DialogGuide): string {
    if (guide.kind === 'person' || guide.kind === 'spot') {
      const lines = [prompt(`context.md#place-${guide.kind}`, { name: guide.name ?? (guide.kind === 'person' ? 'the person they asked for' : 'the place they asked for') })];
      if (guide.notes !== undefined && guide.notes.length > 0) lines.push(prompt('context.md#place-notes', { notes: bullets(guide.notes) }));
      return lines.join('\n');
    }
    const place = guide.kind === 'street'
      ? this.places.street(guide.placeId) ?? guide.name ?? 'a street'
      : this.places.named({ kind: guide.kind, id: guide.placeId }, guide.name);
    const lines = [prompt('context.md#place', { place })];
    const at = (place: { kind: string; id: string } | undefined) => place?.kind === guide.kind && place.id === guide.placeId;
    if (at(npc.job && { kind: 'parcel', id: npc.job.parcelId }) || at(npc.transitJob?.place)) lines.push(prompt('context.md#place-work'));
    if (at({ kind: 'parcel', id: npc.home.parcelId })) {
      const apartment = npc.home.apartment;
      lines.push(apartment?.number === undefined
        ? prompt('context.md#place-home')
        : prompt('context.md#place-apartment', { number: apartment.number, floor: ordinal(apartment.floor) }));
    }
    if (npc.routine.some((e) => (e.activity === 'leisure' || e.activity === 'shopping') && at(e.place))) lines.push(prompt('context.md#place-haunt'));
    if (guide.notes !== undefined && guide.notes.length > 0) lines.push(prompt('context.md#place-notes', { notes: bullets(guide.notes) }));
    lines.push(prompt('context.md#place-talk'));
    return lines.join('\n');
  }

  /**
   * The people this NPC knows, each with who they are to it, their work and
   * hours and where they are now; then the names the player asked about that
   * it does not know. Nobody else's whereabouts, hours or ties are its to say.
   */
  private renderPeople(people: DialogPeople): string {
    const lines = people.known.map((person) => {
      const name = `${person.name.given} ${person.name.family}`;
      const who = person.relation === 'household' ? prompt('context.md#person-kin', { name, kin: person.kin ?? 'family' })
        : prompt(`context.md#person-${person.relation}`, { name });
      // Someone in sight is where they are, whatever their hours: their role says who they are, their hours would only mislead.
      const here = person.now.kind === 'here';
      const work = !person.job ? ''
        : here ? prompt('context.md#person-role', { name, role: person.job.role.replace(/_/g, ' '), place: this.places.short(person.job.place) })
          : prompt('context.md#person-work', {
            name,
            role: person.job.role.replace(/_/g, ' '),
            place: this.places.short(person.job.place),
            days: person.job.days.length === 7 ? 'every day' : listed(person.job.days.map(dayName)),
            from: spoken(person.job.startMin),
            to: spoken(person.job.endMin),
          });
      const now = person.now.kind === 'place'
        ? prompt('context.md#person-at', { name, place: this.places.short(person.now.place) })
        : prompt(`context.md#person-${person.now.kind}`, { name });
      const asked = person.asked ? prompt(here ? 'context.md#person-asked-here' : 'context.md#person-asked', { name }) : '';
      return [who, now, work, asked].filter(Boolean).join(' ');
    });
    const blocks = [prompt('context.md#people', { people: lines.length > 0 ? bullets(lines) : prompt('context.md#people-none') })];
    for (const word of people.unknown) blocks.push(prompt('context.md#people-unknown', { word }));
    return blocks.join('\n');
  }

  /** What happened around the NPC, each with where and how long ago, as the host saw it. */
  private renderEvents(events: DialogEvent[], timeMin: number): string {
    const lines = events.map((event) => {
      const where = {
        place: this.places.place({ kind: 'parcel', id: event.parcelId }),
        distance: event.metres < 15 ? prompt('context.md#distance-here') : prompt('context.md#distance', { metres: Math.round(event.metres / 10) * 10 }),
        span: span(timeMin - event.atMin),
      };
      if (event.kind === 'scene') return prompt('context.md#event-scene', { ...where, notes: event.notes.join(' ') });
      if (event.self) return prompt('context.md#event-struck-you', where);
      const struck = prompt(event.hard ? 'context.md#event-run-down' : 'context.md#event-struck', where);
      return event.down ? `${struck} ${prompt('context.md#event-down')}` : struck;
    });
    return prompt('context.md#events', { events: bullets(lines) });
  }

  /**
   * Where the person lives and works by address, the doors they carry cards
   * for, and whether they caught the player lifting one; undefined when the
   * host knows none of it.
   */
  private renderAddresses(addresses: DialogAddresses): string | undefined {
    const lines: string[] = [];
    if (addresses.home) lines.push(prompt('context.md#address-home', { address: this.address(addresses.home) }));
    if (addresses.work) lines.push(prompt('context.md#address-work', { address: this.address(addresses.work) }));
    const blocks = lines.length > 0 ? [prompt('context.md#address', { addresses: bullets(lines) })] : [];
    const cards = (addresses.access ?? []).map((card) => {
      const where = this.places.short({ kind: 'parcel', id: card.parcelId });
      const tie = card.tie === 'home' ? ' (your home)' : card.tie === 'work' ? ' (your work)' : '';
      return `${card.opens} at ${where}${tie}`;
    });
    if (cards.length > 0) blocks.push(prompt('context.md#address-access', { cards: listed(cards) }));
    const caught = addresses.caught ?? 0;
    if (caught > 0) blocks.push(prompt('context.md#address-caught', { times: caught === 1 ? 'once' : caught === 2 ? 'twice' : `${caught} times` }));
    return blocks.length > 0 ? blocks.join('\n') : undefined;
  }

  /** "apartment 1407, floor 14, an apartment block on Third Street, in Kanaal Market": a place by its address, the narrowest part first. */
  private address(address: DialogAddress): string {
    const building = this.places.addressed({ kind: 'parcel', id: address.parcelId });
    const unit = address.unit ?? (address.room ? `the ${words(address.room)}` : undefined);
    return [unit, address.floor === undefined ? undefined : storey(address.floor), building].filter((part) => part !== undefined).join(', ');
  }

  /** The player's talks with other people this person heard, each marked with who said what, none of it this person's own words. */
  private renderOverheard(overheard: DialogOverheard[]): string {
    const exchanges = overheard.map((entry) => {
      const who = entry.role ? `${entry.name}, the ${words(entry.role)}` : entry.name;
      return prompt('context.md#overheard-exchange', { who, name: entry.name, player: entry.player, reply: entry.reply });
    });
    return prompt('context.md#overheard', { exchanges: exchanges.join('\n') });
  }

  /** "your home: about 350 metres to the north-east, 5 minutes on foot, then the lift up". */
  private way(way: DialogWay): string {
    const what = way.what === 'home' ? 'your home' : way.what === 'work' ? 'your work' : way.name ?? 'that place';
    const told = way.what === 'quest' ? `${what}, where their business takes them` : what;
    if (way.metres < 20) return prompt('context.md#way-here', { place: told, lift: way.lift ? `, the lift ${way.lift}` : '' }).trim();
    const minutes = way.minutes <= 1 ? 'a minute' : `${way.minutes} minutes`;
    return prompt('context.md#way', { place: told, metres: way.metres, point: way.point, minutes, lift: way.lift ? `, then the lift ${way.lift}` : '' }).trim();
  }

  /** Where inside a building the person stands: "on floor 14, in apartment 1407, in the living room". */
  private insideWords(inside: DialogAddress): string {
    const parts = [
      ...(inside.floor === undefined ? [] : [inside.floor === 0 ? 'on the ground floor' : `on ${storey(inside.floor)}`]),
      ...(inside.unit ? [`in ${inside.unit}`] : []),
      ...(inside.room ? [`in the ${words(inside.room)}`] : []),
    ];
    return parts.join(', ');
  }

  private renderNow(npc: NPCInstance, timeMin: number, here: DialogHere | undefined, task?: DialogTask, call?: DialogCall, addresses?: DialogAddresses, carry?: DialogCarry): string {
    const inside = addresses?.here;
    const behavior = this.sim.behaviorAt(npc.npcId, timeMin);
    const day = dayName(Math.floor(timeMin / 1440) % 7);
    const lines = [prompt('context.md#now', { day, time: clock(timeMin % 1440), activity: prompt(`context.md#activity-${behavior.activity}`) })];
    if (call) lines.push(prompt('context.md#call'));
    if (task) lines.push(prompt(`context.md#task-${task.kind}${task.place === undefined ? '' : '-to'}`, { place: task.place ?? '' }));
    const around = here && this.places.surroundings(here);
    if (around) {
      lines.push(prompt('context.md#here', { where: around.where }));
      if (around.at) lines.push(prompt('context.md#here-at', { at: around.at }));
      if (inside) lines.push(prompt('context.md#here-address', { address: this.insideWords(inside) }));
      if (here.building && here.parcelId !== undefined) lines.push(...this.renderBuilding(here.building, here.floor));
      if (around.around.length > 0) lines.push(prompt('context.md#around', { places: bullets(around.around) }));
    } else if (inside) lines.push(prompt('context.md#here-address', { address: this.insideWords(inside) }));
    if (here?.light) lines.push(prompt('context.md#light', { light: here.light }));
    const heading = this.heading(npc, timeMin);
    if (heading) lines.push(heading);
    // The place a story points to is known only to a person the story casts: anyone else knows of it only what they overheard.
    const cast = this.questlines.some((runtime) => Object.values(runtime.cast).includes(npc.npcId));
    const ways = (addresses?.ways ?? []).filter((way) => way.what !== 'quest' || cast).map((way) => this.way(way));
    if (ways.length > 0) lines.push(prompt('context.md#ways', { ways: bullets(ways) }));
    if (carry) lines.push(...renderCarry(carry, timeMin));
    return lines.join('\n');
  }

  /**
   * The building the person stands in: the room they are in, what each floor
   * holds (floors alike told together), the lifts and stairs between them and
   * who the host sees inside now, each with their floor and room.
   */
  private renderBuilding(building: DialogBuilding, floor: number | undefined): string[] {
    const lines: string[] = [];
    if (building.room) lines.push(prompt('context.md#building-room', { room: words(building.room) }));
    const groups: Array<{ from: number; to: number; rooms: string[]; apartments: string[] }> = [];
    for (const entry of [...building.floors].sort((a, b) => a.index - b.index)) {
      const last = groups.at(-1);
      const alike = last && last.to === entry.index - 1 && last.rooms.join('|') === entry.rooms.join('|') && (last.apartments.length > 0) === ((entry.apartments?.length ?? 0) > 0);
      if (alike) {
        last.to = entry.index;
        last.apartments.push(...(entry.apartments ?? []));
      } else groups.push({ from: entry.index, to: entry.index, rooms: entry.rooms, apartments: [...(entry.apartments ?? [])] });
    }
    const told = groups.map((group) => {
      const where = group.from === group.to ? `${floorWords(group.from)}` : `${floorWords(group.from)} to ${floorWords(group.to)}`;
      const holds = [
        ...group.rooms.map(words),
        ...(group.apartments.length === 0 ? [] : [group.apartments.length === 1 ? `apartment ${group.apartments[0]}` : `apartments ${group.apartments[0]} to ${group.apartments.at(-1)}`]),
      ];
      return `${where}: ${holds.length > 0 ? holds.join(', ') : 'nothing you know of'}`;
    });
    if (told.length > 0) lines.push(prompt('context.md#building-floors', { count: building.floors.length, floors: told.join('; ') }));
    const ways = [
      ...(building.lifts > 0 ? [building.lifts === 1 ? 'a lift' : `${building.lifts} lifts`] : []),
      ...(building.stairs > 0 ? [building.stairs === 1 ? 'a staircase' : `${building.stairs} staircases`] : []),
    ];
    if (ways.length > 0 && building.floors.length > 1) lines.push(prompt('context.md#building-ways', { ways: listed(ways) }));
    const people = (building.people ?? []).map((person) => {
      const who = person.name === undefined ? withArticle(words(person.role)) : `${person.name}, ${words(person.role)}`;
      const where = floor !== undefined && person.floor === floor ? 'on this floor' : `on the ${floorWords(person.floor)}`;
      return `${who}, ${where}${person.room ? ` in the ${words(person.room)}` : ''}`;
    });
    if (people.length > 0) lines.push(prompt('context.md#building-people', { people: bullets(people) }));
    return lines;
  }

  /**
   * Where the person's day takes them next, read from their routine at this
   * minute: the end of the walk they are on, else the next place it has them
   * at and when. Nothing when the routine keeps them where they are.
   */
  private heading(npc: NPCInstance, timeMin: number): string | undefined {
    const day = Math.floor(timeMin / 1440) % 7;
    const minute = timeMin % 1440;
    const index = npc.routine.findIndex((e) => e.days.includes(day) && minute >= e.startMin && minute < e.endMin);
    if (index < 0) return undefined;
    const entry = npc.routine[index]!;
    const words = (place: RoutineEntry['place']) => place.kind === 'parcel' && place.id === npc.home.parcelId
      ? 'your home'
      : place.kind === 'parcel' || place.kind === 'stop' ? this.places.short({ kind: place.kind, id: place.id }) : undefined;
    if (entry.walk) {
      const place = words(entry.walk.to);
      return place && prompt('context.md#heading-walk', { place });
    }
    // The next stay somewhere else, and when it starts: the walks and rides there are the way to it.
    for (let step = 1; step < npc.routine.length; step++) {
      const next = npc.routine[(index + step) % npc.routine.length]!;
      if (next.walk || next.activity === 'commuting' || next.activity === 'transit_wait') continue;
      if (next.place.kind === entry.place.kind && next.place.id === entry.place.id) continue;
      const place = words(next.place);
      return place && prompt('context.md#heading-next', { place, time: clock(next.startMin) });
    }
    return undefined;
  }

  private typeOf(type: string): NPCType {
    const found = this.types.types.find((t) => t.type === type);
    if (!found) throw new QuestError('E_UNKNOWN_ID', `unknown npc type ${type}`);
    return found;
  }
}

const bullets = (lines: string[]): string => lines.map((line) => `- ${line}`).join('\n');

/**
 * What the person has on them, as all they have: their credits and each
 * thing they carry, a thing the player gave them with when; how their
 * household stands for money; what passed between them and the player; and
 * a sum they asked for and were not paid.
 */
function renderCarry(carry: DialogCarry, timeMin: number): string[] {
  const credits = Math.max(0, Math.floor(carry.credits));
  const items = [
    credits > 0 ? prompt('context.md#carry-credits', { amount: credits }) : prompt('context.md#carry-credits-none'),
    ...carry.items.map((item) => {
      if (item.from !== 'stranger') return item.name;
      return item.atMin === undefined
        ? prompt('context.md#carry-from-earlier', { name: item.name })
        : prompt('context.md#carry-from', { name: item.name, span: span(timeMin - item.atMin) });
    }),
  ];
  const lines = [prompt('context.md#carry', { items: bullets(items) }), prompt(`context.md#carry-means-${carry.means}`)];
  const dealings = (carry.dealings ?? []).map((dealing) => prompt('context.md#deal', { deal: dealt(dealing), span: span(timeMin - dealing.atMin) }));
  if (dealings.length > 0) lines.push(prompt('context.md#carry-dealings', { dealings: dealings.join('; ') }));
  if (carry.asked !== undefined && carry.asked > 0) lines.push(prompt('context.md#carry-asked', { amount: carry.asked }));
  return lines;
}

/** One dealing from the person's side: "they gave you 10 credits", "you caught them lifting a pen from your pockets". */
function dealt(dealing: DialogDealing): string {
  const what = dealing.amount !== undefined && dealing.amount > 0
    ? prompt('context.md#deal-credits', { amount: dealing.amount })
    : dealing.name ?? prompt('context.md#deal-something');
  return prompt(`context.md#deal-${dealing.what}`, { what });
}

/** A room kind or role as people say it: underscores are spaces. */
const words = (kind: string): string => kind.replace(/_/g, ' ');

/**
 * Text written outside the talk (memory notes from before, a world's type
 * boilerplate, an authored persona) as the person reads it: what calls the
 * person in front of them, or the person themselves, by the words of the
 * machinery behind them says it in plain words instead, which are all that
 * reach the talk.
 */
export function plainWords(note: string): string {
  return note
    .replace(/,?\s*grounded by the simulation\b/gi, '')
    .replace(/\b([Tt])he simulation\b/g, (_, t: string) => `${t}heir own life`)
    .replace(/\b[Ss]imulation\b/g, 'life')
    .replace(/\b([Tt])he game\b/g, (_, t: string) => `${t}he city`)
    .replace(/\b[Tt]he NPC\b/g, (match) => (match[0] === 'T' ? 'You' : 'you'))
    .replace(/\bNPCs\b/g, 'people')
    .replace(/\bNPC\b/g, 'person')
    .replace(/\b([Tt])he player's\b/g, (_, t: string) => `${t}he stranger's`)
    .replace(/\b([Tt])he player\b/g, (_, t: string) => `${t}he stranger`)
    .replace(/\b[Pp]layers\b/g, 'strangers')
    .replace(/\b[Pp]layer\b/g, 'stranger');
}

/** "the ground floor", "the third floor". */
const floorWords = (index: number): string => `${ordinal(index)} floor`;

/** A floor as an address says it: "ground floor", "floor 14", "basement 2". */
const storey = (floor: number): string => (floor === 0 ? 'ground floor' : floor < 0 ? `basement ${-floor}` : `floor ${floor}`);

/** How long `minutes` is, in the words context.md gives it: a moment, minutes, an hour, hours, a day, days. */
function span(minutes: number): string {
  if (minutes < 2) return prompt('context.md#span-moment');
  if (minutes < 60) return prompt('context.md#span-minutes', { minutes: Math.round(minutes) });
  if (minutes < 90) return prompt('context.md#span-hour');
  if (minutes < 1440) return prompt('context.md#span-hours', { hours: Math.round(minutes / 60) });
  if (minutes < 2160) return prompt('context.md#span-day');
  return prompt('context.md#span-days', { days: Math.round(minutes / 1440) });
}

/** Lines as memory keeps them: each at the minute it was said, else at `atMin`, the NPC's without their cues. */
const said = (lines: DialogLine[], atMin: number): DialogTurn[] =>
  lines.map((line) => ({ speaker: line.speaker, text: line.speaker === 'npc' ? stripCues(line.text) : line.text, atMin: line.atMin ?? atMin }));

/** The authored dialogue of a step that is a talk with this NPC, if any. */
function talkWith(step: QuestStep, cast: Record<string, string>, npcId: string): QuestStepDialogue | undefined {
  return step.target.kind === 'talk' && cast[step.target.roleId] === npcId ? step.dialogue : undefined;
}

/** The NPC's own authored words on the talk: its opening, its answers to the questions, and the answers that settle it. */
function renderTalk(dialogue: QuestStepDialogue): string {
  const lines = [prompt('context.md#talk', { opening: stripCues(dialogue.opening) })];
  for (const choice of dialogue.choices) {
    if (!choice.completesStep) lines.push(prompt('context.md#talk-answer', { question: choice.text, reply: stripCues(choice.reply) }));
  }
  const settling = dialogue.choices.filter((choice) => choice.completesStep).map((choice) => `"${choice.text}"`);
  lines.push(prompt('context.md#talk-settle', { answers: settling.join(' or ') }));
  return lines.join('\n');
}
