import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { StoryVenues } from '../../builder/StoryVenues.js';
import { QuestlineSetValidator } from '../../flow/QuestlineSet.js';
import type { QuestlineDefinition } from '../../flow/schema.js';
import {
  StubSimulation,
  WorldContextNormalizer,
  type AtlasQuestWorld,
  type NamedWorld,
  type NPCTypeSet,
} from '../../world/index.js';
import { QuestlineCreation } from '../QuestlineCreation.js';
import { EngineHandoff } from '../../handoff/EngineHandoff.js';
import { readHandoffInput, writeEngineHandoff } from './EngineHandoffWriter.js';
import { recordedPorts, type Recording } from './RecordedPorts.js';
import { pickupAssetRequests } from './PickupAssetRequests.js';

export interface MaterializeResult {
  world: NamedWorld;
  types: NPCTypeSet;
  questlines: QuestlineDefinition[];
  /** Side quests left out because the open parcels cannot hold them, with the place that could not move. */
  blocked: { questlineId: string; reason: string }[];
  outputPath: string;
}

/**
 * `--parcels=p0,p3,p12` or `--parcels=@open-parcels.json` (a JSON array, a
 * `{ "parcels": [...] }` object, or ids separated by commas or whitespace):
 * the buildings the story may use. Omitted, the whole city is open.
 */
function readParcels(value: string | undefined): readonly string[] | undefined {
  if (value === undefined) return undefined;
  const text = value.startsWith('@') ? readFileSync(resolve(value.slice(1)), 'utf8') : value;
  const parsed = value.startsWith('@') ? tryJson(text) : undefined;
  const ids = parsed ?? text.split(/[\s,]+/);
  return ids.map((id) => String(id).trim()).filter((id) => id.length > 0);
}

function tryJson(text: string): string[] | undefined {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (Array.isArray(parsed)) return parsed as string[];
    const carried = (parsed as { parcels?: unknown } | null)?.parcels;
    return Array.isArray(carried) ? (carried as string[]) : undefined;
  } catch {
    return undefined;
  }
}

/** Flags out, positional arguments in the order the usage line names them. */
function split(args: readonly string[]): { positional: string[]; parcels?: string } {
  const positional: string[] = [];
  let parcels: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '--parcels') parcels = args[++i];
    else if (arg.startsWith('--parcels=')) parcels = arg.slice('--parcels='.length);
    else positional.push(arg);
  }
  return parcels === undefined ? { positional } : { positional, parcels };
}

export async function materialize(args: readonly string[]): Promise<MaterializeResult> {
  const { positional, parcels: parcelsArg } = split(args);
  const [recordingArg, profile, worldArg, typesArg, outputArg, handoffArg] = positional;
  if ([recordingArg, profile, worldArg, typesArg, outputArg].some((arg) => arg === undefined)) {
    throw new Error('usage: materialize.ts <recording.json> <profile> <atlas-or-named-world.json> <npc-types.json> <questlines.json output> [<handoff-input.json>] [--parcels=<ids|@file>]');
  }
  const parcels = readParcels(parcelsArg);

  const recordingPath = resolve(recordingArg!);
  const worldPath = resolve(worldArg!);
  const typesPath = resolve(typesArg!);
  const outputPath = resolve(outputArg!);
  const recording = JSON.parse(readFileSync(recordingPath, 'utf8')) as Recording;
  const sourceWorld = JSON.parse(readFileSync(worldPath, 'utf8')) as NamedWorld | AtlasQuestWorld;
  const sourceTypes = JSON.parse(readFileSync(typesPath, 'utf8')) as NPCTypeSet;
  const { world, types } = new WorldContextNormalizer().normalize({ world: sourceWorld, types: sourceTypes });
  const sim = new StubSimulation({ seed: `materialize:${profile}`, world, types });

  const result = await new QuestlineCreation().run({
    prompt: recording.prompt,
    world,
    types,
    sim,
    ports: recordedPorts(recording, world),
    ...(parcels !== undefined ? { parcels } : {}),
    warn: (warning) => console.error(warning),
  });
  // A place the open city cannot hold makes a questline unplayable: the main line stops the run, a side quest is left out by name.
  const venues = new StoryVenues(world, types, parcels);
  const stranded = (definition: QuestlineDefinition): string | undefined => {
    const out = venues.outside(definition);
    return out.length === 0
      ? undefined
      : `no open parcel of the right kind for ${out.map((entry) => `${entry.at} (${entry.parcelId})`).join(', ')}`;
  };
  const mainReason = stranded(result.main.definition);
  if (mainReason !== undefined) {
    throw new Error(`the main questline cannot be placed in the open parcels: ${mainReason}`);
  }
  const blocked: { questlineId: string; reason: string }[] = [];
  const questlines = [result.main.definition];
  for (const side of result.side) {
    const reason = stranded(side.definition);
    if (reason === undefined) {
      questlines.push(side.definition);
      continue;
    }
    blocked.push({ questlineId: side.definition.id, reason });
    console.error(`side quest ${side.definition.id} blocked: ${reason}`);
  }
  new QuestlineSetValidator().validate(questlines);
  const bundle = new EngineHandoff().assemble(questlines,
    pickupAssetRequests(questlines, readHandoffInput(handoffArg), recording.missionItemTemplates));
  writeEngineHandoff(outputPath, bundle);
  writeFileSync(
    resolve(dirname(outputPath), 'questlines.meta.json'),
    JSON.stringify(
      {
        contractVersion: '1.0.0',
        profile,
        worldSeed: world.meta.seed,
        recording: basename(recordingPath),
        npcTypes: basename(typesPath),
        mainQuestlineId: result.main.definition.id,
        sideQuestlineIds: questlines.slice(1).map((definition) => definition.id),
        ...(parcels !== undefined ? { parcels } : {}),
        blocked,
      },
      null,
      2,
    ) + '\n',
  );
  console.error(`materialized ${questlines.length} questlines for ${profile} at ${outputPath}`);
  return { world, types, questlines, blocked, outputPath };
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await materialize(process.argv.slice(2));
}
