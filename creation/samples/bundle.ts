import { resolve } from 'node:path';
import { questlineSetFromSample } from './QuestlineSetWriter.js';
import { EngineHandoff } from '../../handoff/EngineHandoff.js';
import { readHandoffInput, writeEngineHandoff } from './EngineHandoffWriter.js';

const [sampleDirArg, outputPathArg, handoffArg] = process.argv.slice(2);
if (sampleDirArg === undefined) {
  throw new Error('usage: bundle.ts <sample directory> [<questlines.json output>] [<handoff-input.json>]');
}

const sampleDir = resolve(sampleDirArg);
const outputPath = outputPathArg === undefined ? resolve(sampleDir, 'questlines.json') : resolve(outputPathArg);
const definitions = questlineSetFromSample(sampleDir);
const bundle = new EngineHandoff().assemble(definitions, readHandoffInput(handoffArg));
const manifest = writeEngineHandoff(outputPath, bundle);
console.error(`wrote ${manifest.counts.questlines} questlines and ${manifest.counts.investigations} investigations to ${sampleDir}`);
