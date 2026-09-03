import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { QuestlineDefinition } from '../../flow/schema.js';
import { QuestlineSetValidator, type QuestlineSet } from '../../flow/QuestlineSet.js';

interface SampleQuestlineFile {
  definition: QuestlineDefinition;
  cast: Record<string, string>;
}

/** Reads one completed sample directory and emits the engine payload, main first. */
export function questlineSetFromSample(sampleDir: string): QuestlineSet {
  const files = readdirSync(sampleDir);
  const side = files.filter((file) => /^side-.+\.questline\.json$/.test(file)).sort();
  const ordered = ['main.questline.json', ...side];
  const definitions = ordered.map((file) => {
    const path = join(sampleDir, file);
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as SampleQuestlineFile;
    if (parsed === null || typeof parsed !== 'object' || parsed.definition === undefined) {
      throw new Error(`${basename(path)} has no definition`);
    }
    return parsed.definition;
  });
  new QuestlineSetValidator().validate(definitions);
  return definitions;
}

export function writeQuestlineSet(sampleDir: string, outputPath = join(sampleDir, 'questlines.json')): QuestlineSet {
  const definitions = questlineSetFromSample(sampleDir);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, JSON.stringify(definitions, null, 2) + '\n');
  return definitions;
}
