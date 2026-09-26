/** Replays recorded text and tool calls through creation into an output directory, with no model present. */

import { existsSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { loadFixtureWorld, StubSimulation } from '../../world/index.js';
import { QuestlineCreation } from '../QuestlineCreation.js';
import { loadWorld, readJson } from './CliInputs.js';
import { recordedPorts, type Recording } from './RecordedPorts.js';
import { SampleWriter, type Log } from './SampleWriter.js';

async function main(): Promise<void> {
  const [recordingPath, outDir, worldArg, typesArg] = process.argv.slice(2);
  if (recordingPath === undefined || outDir === undefined || (worldArg === undefined) !== (typesArg === undefined)) {
    throw new Error('usage: replay.ts <recording json> <output dir> [<world json> <npc types json>]');
  }
  const recording = readJson<Recording>(recordingPath);
  // Without inputs, the world the recording was made against when it sits beside it, else the neon-bay fixture.
  const beside = [join(dirname(resolve(recordingPath)), 'world.json'), join(dirname(resolve(recordingPath)), 'npc-types.json')];
  const [worldPath, typesPath] = worldArg !== undefined ? [worldArg, typesArg!] : beside.every((path) => existsSync(path)) ? beside : [];
  const { world, types } = worldPath !== undefined ? loadWorld(worldPath, typesPath!) : loadFixtureWorld('neon-bay');
  const log: Log = (line) => console.error(line);
  const writer = new SampleWriter(outDir);

  log(`replaying ${recordingPath} against ${worldPath ?? 'neon-bay'} (${world.parcels.length} parcels, ${types.types.length} types)`);
  const result = await new QuestlineCreation().run({
    prompt: recording.prompt,
    world,
    types,
    sim: new StubSimulation({ seed: `replay:${basename(recordingPath)}`, world, types }),
    mechanics: recording.mechanics,
    warn: log,
    progress: (event) => writer.onProgress(event, log),
    ports: recordedPorts(recording, world),
  });

  writer.writeQuestlines(result);
  // No timestamp: a rebuild of a committed sample should leave no diff.
  writer.write(
    'meta.json',
    JSON.stringify({ prompt: recording.prompt, model: recording.model, world: worldPath !== undefined ? basename(worldPath) : 'neon-bay', source: 'recording' }, null, 2) + '\n',
  );
  log(`done: ${result.script.script.characters.length} characters, ${result.side.length} of ${result.situations.situations.length} side quests, written to ${writer.path}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
