/** Runs live story creation and writes artifacts as stages complete. */

import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import type { LLMPort } from '../../ports/llm.js';
import { loadFixtureWorld, StubSimulation, type NamedWorld, type NPCTypeSet } from '../../world/index.js';
import { QuestlineCreation } from '../QuestlineCreation.js';
import { BASE_URL, OpenAICompatibleClient } from './OpenAICompatibleClient.js';
import { SampleWriter, type Log } from './SampleWriter.js';

/** One line per text-stage call, so a long run shows where it is. */
function loggedText(stage: string, port: LLMPort, log: Log): LLMPort {
  return {
    complete: async (request) => {
      const started = Date.now();
      const text = await port.complete(request);
      log(`${stage}: ${text.length} chars in ${Math.round((Date.now() - started) / 1000)}s`);
      return text;
    },
  };
}

async function main(): Promise<void> {
  const [prompt, name, worldPath, typesPath] = process.argv.slice(2);
  if (prompt === undefined || name === undefined) {
    throw new Error('usage: run-local.ts "<creation prompt>" <sample name> [<named world json> <npc types json>]');
  }
  const client = await OpenAICompatibleClient.connect();
  const { world, types } =
    worldPath !== undefined && typesPath !== undefined
      ? { world: JSON.parse(readFileSync(worldPath, 'utf8')) as NamedWorld, types: JSON.parse(readFileSync(typesPath, 'utf8')) as NPCTypeSet }
      : loadFixtureWorld('neon-bay');
  const sim = new StubSimulation({ seed: `sample-${name}`, world, types });
  const started = Date.now();
  const log: Log = (line) => console.error(`[${Math.round((Date.now() - started) / 1000)}s] ${line}`);
  const writer = new SampleWriter(name);

  log(`model ${client.model} at ${BASE_URL}, world ${worldPath ?? 'neon-bay'} (${world.parcels.length} parcels, ${types.types.length} types)`);
  const result = await new QuestlineCreation().run({
    prompt,
    world,
    types,
    sim,
    warn: log,
    progress: (event) => writer.onProgress(event, log),
    ports: {
      script: loggedText('script', client, log),
      situations: loggedText('situations', client, log),
      plan: loggedText('plan', client, log),
      build: client,
    },
  });

  writer.writeQuestlines(result);

  writer.write('meta.json', JSON.stringify({ prompt, model: client.model, world: worldPath !== undefined ? basename(worldPath) : 'neon-bay', ranAt: new Date().toISOString() }, null, 2) + '\n');
  log(`done: ${result.script.script.characters.length} characters, ${result.side.length} of ${result.situations.situations.length} side quests, written to ${writer.path}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
