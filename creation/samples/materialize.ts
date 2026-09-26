import { writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { TranslationResult } from '../../builder/schema.js';
import { StoryVenues } from '../../builder/StoryVenues.js';
import { QuestError } from '../../errors.js';
import { QuestlineSetValidator } from '../../flow/QuestlineSet.js';
import type { QuestlineDefinition } from '../../flow/schema.js';
import { StubSimulation, type NamedWorld, type NormalizedWorldContext, type NPCTypeSet } from '../../world/index.js';
import { QuestlineCreation } from '../QuestlineCreation.js';
import { EngineHandoff } from '../../handoff/EngineHandoff.js';
import { HandoffInputBoundary } from '../../handoff/HandoffInputBoundary.js';
import { stagedScenery } from '../../handoff/SceneStagings.js';
import { loadWorld, parseArgs, readJson, readParcels } from './CliInputs.js';
import { readHandoffInput, writeEngineHandoff, type HandoffManifest } from './EngineHandoffWriter.js';
import { recordedPorts, type Recording } from './RecordedPorts.js';
import { pickupAssetRequests } from './PickupAssetRequests.js';
import { checkSceneTemplates, sceneryHandoff, withTemplates } from './SceneTemplates.js';

export interface MaterializeInput extends NormalizedWorldContext {
  recording: Recording;
  /** Labels for questlines.meta.json: the recording and type set this bundle came from. */
  recordingName: string;
  typesName: string;
  /** The city profile; with it the simulation seed, so the same profile casts the same people. */
  profile: string;
  /** Where the questlines file goes; the other bundle files land beside it. */
  outputPath: string;
  /** Explicit bindings, scenes and host capabilities, checked at the handoff boundary. */
  handoff?: unknown;
  /** The buildings the story may use; omitted, the whole city is open. */
  parcels?: readonly string[];
  log?: (line: string) => void;
}

export interface MaterializeResult {
  world: NamedWorld;
  types: NPCTypeSet;
  questlines: QuestlineDefinition[];
  /** Side quests left out because the open parcels cannot hold them or their scenes cannot stand, with the reason. */
  blocked: { questlineId: string; reason: string }[];
  outputPath: string;
  manifest: HandoffManifest;
}

const USAGE =
  'usage: materialize.ts <recording.json> <profile> <atlas-or-named-world.json> <npc-types.json> <questlines.json output> [<handoff-input.json>] [--parcels=<ids|@file>]';

/** The simulation a profile's questlines are cast against, live or replayed. */
export const profileSimulation = (profile: string, context: NormalizedWorldContext): StubSimulation =>
  new StubSimulation({ seed: `materialize:${profile}`, ...context });

/**
 * Replays a recording against a concrete city and writes its bundle 1.2 and
 * questlines.meta.json. The scenes the questlines stage, built or written as
 * templates, ship for a host that declares scenery.
 */
export async function materializeRecording(input: MaterializeInput): Promise<MaterializeResult> {
  const { recording, world, types, parcels, profile } = input;
  const log = input.log ?? ((line: string) => console.error(line));
  const outputPath = resolve(input.outputPath);
  const handoff = new HandoffInputBoundary().parse(input.handoff ?? {});
  const sceneTemplates = checkSceneTemplates(recording.sceneTemplates ?? {});
  const result = await new QuestlineCreation().run({
    prompt: recording.prompt,
    world,
    types,
    sim: profileSimulation(profile, { world, types }),
    ports: recordedPorts(recording, world),
    parcels,
    mechanics: recording.mechanics,
    scenery: recording.scenery,
    warn: log,
  });
  // A place the open city cannot hold, or a scene its buildings cannot stand, makes a questline unplayable here:
  // the main line stops the run, a side quest is left out by name.
  const venues = new StoryVenues(world, types, parcels);
  const stagesScenes = handoff.hostCapabilities?.scenery !== undefined;
  const stagingsOf = ({ definition, scenes }: TranslationResult) => withTemplates(definition.id, scenes, sceneTemplates[definition.id]);
  const unplayable = (quest: TranslationResult): string | undefined => {
    const out = venues.outside(quest.definition);
    if (out.length > 0) return `no open parcel of the right kind for ${out.map((entry) => `${entry.at} (${entry.parcelId})`).join(', ')}`;
    if (!stagesScenes) return undefined;
    try {
      stagedScenery(quest.definition, stagingsOf(quest));
      return undefined;
    } catch (error) {
      if (error instanceof QuestError) return `its scenes cannot stand where its steps land: ${error.message}`;
      throw error;
    }
  };
  const mainReason = unplayable(result.main);
  if (mainReason !== undefined) throw new Error(`the main questline cannot be played in this city: ${mainReason}`);
  const blocked: MaterializeResult['blocked'] = [];
  const kept = [result.main];
  for (const side of result.side) {
    const reason = unplayable(side);
    if (reason === undefined) {
      kept.push(side);
      continue;
    }
    blocked.push({ questlineId: side.definition.id, reason });
    log(`side quest ${side.definition.id} blocked: ${reason}`);
  }
  const questlines = kept.map((quest) => quest.definition);
  new QuestlineSetValidator().validate(questlines);
  const unknown = Object.keys(sceneTemplates).filter((questId) => !questlines.some((definition) => definition.id === questId));
  if (unknown.length > 0) log(`scene templates for questlines not in the bundle: ${unknown.join(', ')}`);
  const stagings = new Map(kept.map((quest) => [quest.definition.id, stagingsOf(quest)]));
  const staged = sceneryHandoff(questlines, handoff, stagings, recording.missionItemTemplates, log);
  const bundle = new EngineHandoff().assemble(questlines, pickupAssetRequests(questlines, staged, recording.missionItemTemplates));
  const manifest = writeEngineHandoff(outputPath, bundle);
  const meta = {
    contractVersion: '1.0.0',
    profile,
    worldSeed: world.meta.seed,
    recording: input.recordingName,
    npcTypes: input.typesName,
    mainQuestlineId: result.main.definition.id,
    sideQuestlineIds: questlines.slice(1).map((definition) => definition.id),
    ...(parcels !== undefined ? { parcels } : {}),
    blocked,
  };
  writeFileSync(resolve(dirname(outputPath), 'questlines.meta.json'), JSON.stringify(meta, null, 2) + '\n');
  log(`materialized ${questlines.length} questlines for ${profile} at ${outputPath}`);
  return { world, types, questlines, blocked, outputPath, manifest };
}

/** The CLI: `materialize.ts <recording> <profile> <world> <types> <questlines output> [<handoff input>] [--parcels=<ids|@file>]`. */
export async function materialize(args: readonly string[]): Promise<MaterializeResult> {
  const { positional, options } = parseArgs(args, ['parcels']);
  const [recordingPath, profile, worldPath, typesPath, outputPath, handoffPath] = positional;
  if (recordingPath === undefined || profile === undefined || worldPath === undefined || typesPath === undefined || outputPath === undefined) {
    throw new Error(USAGE);
  }
  return materializeRecording({
    ...loadWorld(worldPath, typesPath),
    recording: readJson<Recording>(recordingPath),
    recordingName: basename(recordingPath),
    typesName: basename(typesPath),
    profile,
    outputPath,
    handoff: readHandoffInput(handoffPath),
    parcels: readParcels(options.get('parcels')),
  });
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await materialize(process.argv.slice(2));
}
