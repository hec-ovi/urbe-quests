import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { materialize } from '../samples/materialize.js';

const sampleDir = fileURLToPath(new URL('../samples/urbe-small/', import.meta.url));
const recordingPath = join(sampleDir, 'recording.json');
const namedWorldPath = join(sampleDir, 'world.json');
const typesPath = join(sampleDir, 'npc-types.json');

describe('materialize entry', () => {
  it('preserves Naming output and marks only a raw Atlas fallback', async () => {
    const outputDir = mkdtempSync(join(tmpdir(), 'quests-materialize-'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const namedSource = JSON.parse(readFileSync(namedWorldPath, 'utf8')) as {
        meta: { naming: { theme: string; model: string; namedAt: string } };
        districts: Array<{ name?: string }>;
      };
      const typeSource = JSON.parse(readFileSync(typesPath, 'utf8')) as {
        meta: { theme: string };
        namePool: { givenByGender: { male: string[]; female: string[]; neutral: string[] } };
      };
      const named = await materialize([
        recordingPath,
        'named',
        namedWorldPath,
        typesPath,
        join(outputDir, 'named', 'questlines.json'),
      ]);

      expect(named.world.meta.naming).toEqual(namedSource.meta.naming);
      expect(named.types.namePool.givenByGender).toEqual(typeSource.namePool.givenByGender);
      expect(named.questlines).toHaveLength(4);

      const atlasSource = structuredClone(namedSource) as {
        meta: { naming?: unknown };
        districts: Array<{ name?: string }>;
      };
      delete atlasSource.meta.naming;
      delete atlasSource.districts[0]!.name;
      const atlasPath = join(outputDir, 'atlas.json');
      writeFileSync(atlasPath, JSON.stringify(atlasSource));
      const fallback = await materialize([
        recordingPath,
        'atlas',
        atlasPath,
        typesPath,
        join(outputDir, 'atlas', 'questlines.json'),
      ]);

      expect(fallback.world.meta.naming).toEqual({
        theme: typeSource.meta.theme,
        namedAt: 'derived-from-atlas',
      });
      expect(fallback.world.districts[0]!.name).toBe('commercial d0');
      expect(fallback.questlines).toHaveLength(4);
      expect(readFileSync(join(dirname(fallback.outputPath), 'questlines.meta.json'), 'utf8')).toContain('"profile": "atlas"');
    } finally {
      log.mockRestore();
      rmSync(outputDir, { recursive: true, force: true });
    }
  });
});
