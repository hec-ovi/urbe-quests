/**
 * Produces a committed sample: runs QuestlineCreation against an
 * OpenAI-compatible chat endpoint and writes every stage's output under
 * creation/samples/<name>/ the moment it lands, so a run that stops late
 * keeps what it made. Progress goes to stderr with elapsed seconds.
 *
 *   npm run sample -- "create a dark cynical sci fi cyberpunk story" cyberpunk
 *
 * Args: "<creation prompt>" <sample name> [<named world json> <npc types json>];
 * without the two paths the neon-bay fixture is the world.
 * Env: LLM_BASE_URL (default http://localhost:8080/v1), LLM_API_KEY (bearer token
 * for a hosted server), LLM_MODEL (default: the first model the server lists).
 * No output caps are sent; each build's round budget comes from its plan.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { LLMPort } from '../../ports/llm.js';
import { loadFixtureWorld, StubSimulation, type NamedWorld, type NPCTypeSet } from '../../world/index.js';
import { QuestlineCreation } from '../QuestlineCreation.js';
import type { CreationProgress } from '../schema.js';
import { BASE_URL, OpenAICompatibleClient } from './OpenAICompatibleClient.js';

type Log = (line: string) => void;

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

class SampleWriter {
  private readonly dir: URL;

  constructor(name: string) {
    this.dir = new URL(`./${name}/`, import.meta.url);
    mkdirSync(this.dir, { recursive: true });
  }

  get path(): string {
    return this.dir.pathname;
  }

  write(file: string, text: string): void {
    writeFileSync(new URL(file, this.dir), text);
  }

  /** Every stage lands on disk as it completes. */
  onProgress(event: CreationProgress, log: Log): void {
    switch (event.kind) {
      case 'script':
        this.write('script.md', event.result.raw);
        return;
      case 'situations':
        this.write('situations.md', event.result.raw);
        return;
      case 'build': {
        const b = event.build;
        log(`build ${event.questline} round ${b.round}/${b.maxRounds}: ${b.note} (${b.committed}/${b.planned} planned pieces)`);
        return;
      }
      case 'questline': {
        const label = event.questline === 'main' ? 'main' : `side-${event.questline}`;
        const { definition, cast } = event.result;
        this.write(`${label}.plan.md`, event.result.plan);
        this.write(`${label}.questline.json`, JSON.stringify({ definition, cast }, null, 2) + '\n');
        log(`questline ${event.questline} "${definition.title}": ${definition.steps.length} steps, ${definition.roles.length} roles, ${definition.items.length} items, ${definition.endings.length} endings`);
        return;
      }
    }
  }
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

  writer.write('meta.json', JSON.stringify({ prompt, model: client.model, world: worldPath ?? 'neon-bay', ranAt: new Date().toISOString() }, null, 2) + '\n');
  log(`done: ${result.script.script.characters.length} characters, ${result.side.length} of ${result.situations.situations.length} side quests, written to ${writer.path}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
