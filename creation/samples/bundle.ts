import { resolve } from 'node:path';
import { writeQuestlineSet } from './QuestlineSetWriter.js';

const [sampleDirArg, outputPathArg] = process.argv.slice(2);
if (sampleDirArg === undefined) {
  throw new Error('usage: bundle.ts <sample directory> [<questlines.json output>]');
}

const sampleDir = resolve(sampleDirArg);
const outputPath = outputPathArg === undefined ? resolve(sampleDir, 'questlines.json') : resolve(outputPathArg);
const definitions = writeQuestlineSet(sampleDir, outputPath);
console.error(`wrote ${definitions.length} questlines, main first, to ${outputPath}`);
