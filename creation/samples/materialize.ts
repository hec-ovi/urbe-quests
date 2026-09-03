import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { QuestlineSetValidator } from '../../flow/QuestlineSet.js';
import { namedWorldFromAtlas, StubSimulation, type AtlasQuestWorld, type NPCTypeSet } from '../../world/index.js';
import { QuestlineCreation } from '../QuestlineCreation.js';
import { EngineHandoff } from '../../handoff/EngineHandoff.js';
import { readHandoffInput, writeEngineHandoff } from './EngineHandoffWriter.js';
import { recordedPorts, type Recording } from './RecordedPorts.js';

const [recordingArg, profile, atlasWorldArg, typesArg, outputArg, handoffArg] = process.argv.slice(2);
if ([recordingArg, profile, atlasWorldArg, typesArg, outputArg].some((arg) => arg === undefined)) {
  throw new Error('usage: materialize.ts <recording.json> <profile> <atlas-or-named-world.json> <npc-types.json> <questlines.json output> [<handoff-input.json>]');
}

const recordingPath = resolve(recordingArg!);
const worldPath = resolve(atlasWorldArg!);
const typesPath = resolve(typesArg!);
const outputPath = resolve(outputArg!);
const recording = JSON.parse(readFileSync(recordingPath, 'utf8')) as Recording;
const atlasWorld = JSON.parse(readFileSync(worldPath, 'utf8')) as AtlasQuestWorld;
const types = JSON.parse(readFileSync(typesPath, 'utf8')) as NPCTypeSet;
const world = namedWorldFromAtlas(atlasWorld, 'rain-soaked cyberpunk city under corporate rationing');
const sim = new StubSimulation({ seed: `materialize:${profile}`, world, types });

const result = await new QuestlineCreation().run({
  prompt: recording.prompt,
  world,
  types,
  sim,
  ports: recordedPorts(recording, world),
  warn: (warning) => console.error(warning),
});
const definitions = [result.main.definition, ...result.side.map((side) => side.definition)];
new QuestlineSetValidator().validate(definitions);
const bundle = new EngineHandoff().assemble(definitions, readHandoffInput(handoffArg));
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
console.error(`materialized ${definitions.length} questlines for ${profile} at ${outputPath}`);
