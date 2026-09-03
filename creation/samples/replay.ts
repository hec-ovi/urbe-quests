/**
 * Rebuilds a sample from a recorded run: the model's text and tool calls come
 * from a JSON file, everything else is the real workflow (parsing, the
 * manifest bound, the tools, validation, casting). No model, no network.
 *
 *   npm run replay -- creation/samples/urbe-small/recording.json urbe-small \
 *     ../engine/out/named/city-urbe-small.named.json ../engine/out/small/npc-types.json
 *
 * Args: <recording json> <sample name> [<named world json> <npc types json>];
 * without the two paths, world.json and npc-types.json beside the recording
 * are used when present; otherwise the neon-bay fixture is the world.
 */

import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { loadFixtureWorld, StubSimulation, type NamedWorld, type NPCTypeSet } from '../../world/index.js';
import { QuestlineCreation } from '../QuestlineCreation.js';
import { recordedPorts, type Recording } from './RecordedPorts.js';
import { SampleWriter, type Log } from './SampleWriter.js';

async function main(): Promise<void> {
  const [recordingPath, name, worldPath, typesPath] = process.argv.slice(2);
  if (recordingPath === undefined || name === undefined) {
    throw new Error('usage: replay.ts <recording json> <sample name> [<named world json> <npc types json>]');
  }
  if ((worldPath === undefined) !== (typesPath === undefined)) {
    throw new Error('world and NPC type paths must be provided together');
  }
  const recording = JSON.parse(readFileSync(recordingPath, 'utf8')) as Recording;
  const sampleDir = dirname(resolve(recordingPath));
  const snapshotWorld = join(sampleDir, 'world.json');
  const snapshotTypes = join(sampleDir, 'npc-types.json');
  const resolvedWorld = worldPath ?? (existsSync(snapshotWorld) && existsSync(snapshotTypes) ? snapshotWorld : undefined);
  const resolvedTypes = typesPath ?? (resolvedWorld === snapshotWorld ? snapshotTypes : undefined);
  const { world, types } = resolvedWorld !== undefined && resolvedTypes !== undefined
    ? {
        world: JSON.parse(readFileSync(resolvedWorld, 'utf8')) as NamedWorld,
        types: JSON.parse(readFileSync(resolvedTypes, 'utf8')) as NPCTypeSet,
      }
    : loadFixtureWorld('neon-bay');
  const sim = new StubSimulation({ seed: `sample-${name}`, world, types });
  const log: Log = (line) => console.error(line);
  const writer = new SampleWriter(name);

  log(`replaying ${recordingPath} against ${resolvedWorld ?? 'neon-bay'} (${world.parcels.length} parcels, ${types.types.length} types)`);
  const result = await new QuestlineCreation().run({
    prompt: recording.prompt,
    world,
    types,
    sim,
    warn: log,
    progress: (event) => writer.onProgress(event, log),
    ports: recordedPorts(recording, world),
  });

  writer.writeQuestlines(result);

  // No timestamp: a rebuild of a committed sample should leave no diff.
  writer.write(
    'meta.json',
    JSON.stringify({ prompt: recording.prompt, model: recording.model, world: resolvedWorld !== undefined ? basename(resolvedWorld) : 'neon-bay', source: 'recording' }, null, 2) + '\n',
  );
  log(`done: ${result.script.script.characters.length} characters, ${result.side.length} of ${result.situations.situations.length} side quests, written to ${writer.path}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
