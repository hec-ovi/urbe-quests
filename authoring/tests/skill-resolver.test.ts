import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AuthoringHarness, SkillResolver } from '../index.js';

describe('authoring skill resolver contract', () => {
  it('discovers a lightweight index, routes text and loads only selected bodies', () => {
    const api = new AuthoringHarness();
    const index = api.skillIndex();
    expect(index.skills.every(skill => !('content' in skill))).toBe(true);
    expect(api.route('adapt story to gameplay, then pick up an item').matches.map(skill => skill.name))
      .toEqual(['gameplay-adaptation', 'pickup']);
    const resolved = api.resolveSkills(['gameplay-adaptation', 'pickup']);
    expect(resolved.skills.map(skill => skill.name)).toEqual(['gameplay-adaptation', 'pickup']);
    expect(resolved.skills.every(skill => skill.content.includes('# ') && skill.path.endsWith('SKILL.md'))).toBe(true);
  });

  it('reports an unknown skill through its serializable public error', () => {
    try {
      new AuthoringHarness().resolveSkills(['negotiation']);
      expect.fail('unknown skill accepted');
    } catch (error) {
      expect(error).toMatchObject({ code: 'E_UNKNOWN_SKILL' });
      expect((error as { toJSON(): unknown }).toJSON()).toMatchObject({
        code: 'E_UNKNOWN_SKILL', message: expect.any(String), details: [],
      });
    }
  });

  it('rejects an invalid catalog supplied to the public resolver', () => {
    const root = mkdtempSync(join(tmpdir(), 'quests-skills-'));
    try {
      mkdirSync(join(root, 'broken'));
      writeFileSync(join(root, 'broken', 'SKILL.md'), '# missing frontmatter\n');
      expect(() => new SkillResolver(root).index()).toThrowError(expect.objectContaining({ code: 'E_SKILL_CONTRACT' }));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects malformed resolver queries before loading skills', () => {
    const api = new AuthoringHarness();
    expect(() => api.route('')).toThrowError(expect.objectContaining({ code: 'E_AUTHORING_INPUT' }));
    expect(() => api.resolveSkills([])).toThrowError(expect.objectContaining({ code: 'E_AUTHORING_INPUT' }));
  });
});
