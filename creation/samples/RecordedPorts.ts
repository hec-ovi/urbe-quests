/**
 * Stage ports backed by a recorded run: the model's text and tool calls come
 * from a JSON file instead of a server, so a sample can be rebuilt, checked
 * and changed with no model present. Every other part of the workflow is the
 * real one: parsing, the manifest bound, the tools, validation, casting.
 */

import type { AgentPort, AgentReply, AgentToolCall, LLMPort } from '../../ports/llm.js';
import type { NamedWorld, ParcelType, Tier } from '../../world/types/named-world.js';
import type { StagePorts } from '../schema.js';

export interface RecordingBindings {
  parcels?: Record<string, { parcelTypes: ParcelType[]; tiers?: Tier[]; ordinal?: number }>;
  districts?: Record<string, { kinds: NamedWorld['districts'][number]['kind'][]; tiers?: Tier[]; ordinal?: number }>;
  /** Fallback NPC type per role when replaying without a naming-generated type set. */
  roleTypes?: Record<string, string>;
  /** Roles whose fixed story names yield to the target city's generated identities. */
  unreservedRoles?: string[];
}

export interface Recording {
  /** The creation prompt this run answered. */
  prompt: string;
  /** What wrote the text, for the sample's meta.json. */
  model: string;
  script: string;
  situations: string;
  /** Plan text, manifest included, per assignment title. */
  plans: Record<string, string>;
  /** Build rounds per assignment title; each round is the tool calls that answer one turn. */
  builds: Record<string, AgentToolCall[][]>;
  /** Semantic place aliases that make recorded tool calls portable between city sizes. */
  bindings?: RecordingBindings;
}

/** Assignments are rendered title first; that line says which questline a call belongs to. */
const titleOf = (prompt: string): string => /^Title: (.+)$/m.exec(prompt)?.[1] ?? 'untitled';

const text = (answer: string): LLMPort => ({ complete: async () => answer });

class RecordedAgent implements AgentPort {
  private readonly used = new Map<string, number>();

  constructor(
    private readonly builds: Recording['builds'],
    private readonly rewrite: (calls: AgentToolCall[]) => AgentToolCall[],
  ) {}

  async step(request: { prompt: string }): Promise<AgentReply> {
    const title = titleOf(request.prompt);
    const rounds = this.builds[title] ?? [];
    const next = this.used.get(title) ?? 0;
    this.used.set(title, next + 1);
    const calls = rounds[next];
    if (calls === undefined) return { kind: 'done', text: `the recording has no round ${next + 1} for ${title}` };
    return { kind: 'calls', calls: this.rewrite(calls) };
  }
}

function placeBindings(bindings: RecordingBindings | undefined, world: NamedWorld): Map<string, string> {
  const resolved = new Map<string, string>();
  for (const [alias, selector] of Object.entries(bindings?.parcels ?? {})) {
    const candidates = selector.parcelTypes.flatMap((type) =>
      world.parcels.filter((parcel) => parcel.type === type && (selector.tiers === undefined || selector.tiers.includes(parcel.tier))),
    );
    const value = candidates[selector.ordinal ?? 0];
    if (value === undefined) throw new Error(`recording binding ${alias}: no matching parcel`);
    resolved.set(alias, value.id);
  }
  for (const [alias, selector] of Object.entries(bindings?.districts ?? {})) {
    const candidates = selector.kinds.flatMap((kind) =>
      world.districts.filter((district) => district.kind === kind && (selector.tiers === undefined || selector.tiers.includes(district.tier))),
    );
    const value = candidates[selector.ordinal ?? 0];
    if (value === undefined) throw new Error(`recording binding ${alias}: no matching district`);
    resolved.set(alias, value.id);
  }
  return resolved;
}

function rewriteCalls(
  calls: AgentToolCall[],
  places: Map<string, string>,
  roleTypes: Record<string, string>,
  unreservedRoles: Set<string>,
): AgentToolCall[] {
  const rewrite = (value: unknown, key?: string): unknown => {
    if (typeof value === 'string' && key !== undefined && ['parcelId', 'atParcelId', 'toParcelId', 'districtId'].includes(key)) {
      return places.get(value) ?? value;
    }
    if (Array.isArray(value)) return value.map((entry) => rewrite(entry));
    if (value !== null && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [childKey, rewrite(child, childKey)]));
    }
    return value;
  };
  return calls.map((call) => {
    const input = rewrite(call.input) as Record<string, unknown>;
    if (call.tool === 'add_role' && typeof input.roleId === 'string' && roleTypes[input.roleId] !== undefined) {
      input.npcType = roleTypes[input.roleId];
    }
    if (call.tool === 'add_role' && typeof input.roleId === 'string' && unreservedRoles.has(input.roleId)) {
      delete input.reservedName;
    }
    return { ...call, input };
  });
}

export function recordedPorts(recording: Recording, world?: NamedWorld): StagePorts {
  const places = world === undefined ? new Map<string, string>() : placeBindings(recording.bindings, world);
  return {
    script: text(recording.script),
    situations: text(recording.situations),
    plan: {
      complete: async (request) => recording.plans[titleOf(request.prompt)] ?? '',
    },
    build: new RecordedAgent(recording.builds, (calls) =>
      rewriteCalls(calls, places, recording.bindings?.roleTypes ?? {}, new Set(recording.bindings?.unreservedRoles ?? []))),
  };
}
