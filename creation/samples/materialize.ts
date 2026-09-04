import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
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

export interface MaterializeResult {
  world: NamedWorld;
  types: NPCTypeSet;
  questlines: QuestlineDefinition[];
  outputPath: string;
}

export async function materialize(args: readonly string[]): Promise<MaterializeResult> {
  const [recordingArg, profile, worldArg, typesArg, outputArg, handoffArg] = args;
  if ([recordingArg, profile, worldArg, typesArg, outputArg].some((arg) => arg === undefined)) {
    throw new Error('usage: materialize.ts <recording.json> <profile> <atlas-or-named-world.json> <npc-types.json> <questlines.json output> [<handoff-input.json>]');
  }

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
    warn: (warning) => console.error(warning),
  });
  const questlines = [result.main.definition, ...result.side.map((side) => side.definition)];
  new QuestlineSetValidator().validate(questlines);
  const bundle = new EngineHandoff().assemble(questlines, readHandoffInput(handoffArg));
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
        sideQuestlineIds: result.side.map((side) => side.definition.id),
      },
      null,
      2,
    ) + '\n',
  );
  console.error(`materialized ${questlines.length} questlines for ${profile} at ${outputPath}`);
  return { world, types, questlines, outputPath };
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await materialize(process.argv.slice(2));
}
