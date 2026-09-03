import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AuthoringError } from '../src/AuthoringError.js';
import { Boundary } from '../src/Boundary.js';
import { SkillResolver } from '../src/SkillResolver.js';
import { MECHANICS } from '../src/schema.js';
import flowSchema from '../../flow/schema/questline.schema.json' with { type: 'json' };

describe('authoring skill resolver contract', () => {
  it('lists a cheap index before resolving full skill bodies', () => {
    const resolver = new SkillResolver();
    const index = resolver.index();

    expect(index.skills).toHaveLength(18);
    expect(index.skills.every((skill) => !('content' in skill) && !('path' in skill))).toBe(true);
    expect(index.skills.filter((skill) => skill.kind === 'mechanic').map((skill) => skill.mechanic).sort()).toEqual(
      [...MECHANICS].sort(),
    );

    const resolved = resolver.resolve({ names: ['gameplay-adaptation', 'pickup'] });
    expect(resolved.skills.map((skill) => skill.name)).toEqual(['gameplay-adaptation', 'pickup']);
    expect(resolved.skills[0]?.content).toContain('Load every selected mechanic skill in full.');
    expect(resolved.skills[1]?.path).toBe('skills/pickup/SKILL.md');
  });

  it('advertises exactly the mechanics declared by the current flow contract', () => {
    const schemaMechanics = (flowSchema.$defs.target.oneOf as { properties: { kind: { const: string } } }[])
      .map((target) => target.properties.kind.const);
    expect([...MECHANICS].sort()).toEqual(schemaMechanics.sort());
  });

  it('keeps every mechanic skill complete and the human resolver synchronized with frontmatter', () => {
    const resolver = new SkillResolver();
    const index = resolver.index();
    const mechanics = index.skills.filter((skill) => skill.kind === 'mechanic');
    const resolved = resolver.resolve({ names: mechanics.map((skill) => skill.name) });
    const humanResolver = readFileSync(fileURLToPath(new URL('../skills/RESOLVER.md', import.meta.url)), 'utf8');

    for (const skill of resolved.skills) {
      expect(skill.content).toContain('- Target:');
      expect(skill.content).toContain('- Completion event:');
      expect(skill.content).toContain('- Preconditions:');
      expect(skill.content).toContain('- State change:');
      expect(skill.content).toContain('- Failure:');
      expect(humanResolver).toContain(`skills/${skill.name}/SKILL.md`);
      for (const trigger of skill.triggers) expect(humanResolver).toContain(`"${trigger}"`);
    }
  });

  it('routes by authoritative frontmatter triggers and orders the most specific match first', () => {
    const resolver = new SkillResolver();
    const route = resolver.route({ message: 'Please adapt story to gameplay, investigate a scene, then call a ride-hail.' });
    expect(route.matches.map((skill) => skill.name)).toEqual(['gameplay-adaptation', 'investigation', 'transportation']);
  });

  it('fails closed for unknown names and malformed skill frontmatter', () => {
    const resolver = new SkillResolver();
    expect(() => resolver.resolve({ names: ['negotiation'] })).toThrowError(
      expect.objectContaining({ code: 'E_UNKNOWN_SKILL' }),
    );

    const root = mkdtempSync(join(tmpdir(), 'urbe-authoring-skills-'));
    mkdirSync(join(root, 'broken'));
    writeFileSync(join(root, 'broken', 'SKILL.md'), '# missing frontmatter\n');
    expect(() => new SkillResolver(root).index()).toThrowError(AuthoringError);
    expect(() => new SkillResolver(root).index()).toThrowError(expect.objectContaining({ code: 'E_SKILL_CONTRACT' }));

    const mismatchRoot = mkdtempSync(join(tmpdir(), 'urbe-authoring-skills-'));
    mkdirSync(join(mismatchRoot, 'pickup'));
    writeFileSync(join(mismatchRoot, 'pickup', 'SKILL.md'), validSkill.replace('name: pickup', 'name: collect'));
    expect(() => new SkillResolver(mismatchRoot).index()).toThrowError(
      expect.objectContaining({ code: 'E_SKILL_CONTRACT' }),
    );

    const unsupportedRoot = mkdtempSync(join(tmpdir(), 'urbe-authoring-skills-'));
    mkdirSync(join(unsupportedRoot, 'negotiation'));
    writeFileSync(
      join(unsupportedRoot, 'negotiation', 'SKILL.md'),
      validSkill.replace('name: pickup', 'name: negotiation').replace('mechanic: pickup', 'mechanic: negotiation'),
    );
    expect(() => new SkillResolver(unsupportedRoot).index()).toThrowError(
      expect.objectContaining({ code: 'E_SKILL_CONTRACT' }),
    );

    expect(() => new SkillResolver('/path/that/does/not/exist').index()).toThrowError(
      expect.objectContaining({ code: 'E_SKILL_CONTRACT' }),
    );

    const mismatchMechanicRoot = mkdtempSync(join(tmpdir(), 'urbe-authoring-skills-'));
    mkdirSync(join(mismatchMechanicRoot, 'pickup'));
    writeFileSync(join(mismatchMechanicRoot, 'pickup', 'SKILL.md'), validSkill.replace('mechanic: pickup', 'mechanic: talk'));
    expect(() => new SkillResolver(mismatchMechanicRoot).index()).toThrowError(
      expect.objectContaining({ code: 'E_SKILL_CONTRACT' }),
    );
  });

  it('schema-validates resolver queries before touching the catalog', () => {
    const resolver = new SkillResolver('/path/that/must/not/be/read');
    expect(() => resolver.route({ message: '' })).toThrowError(expect.objectContaining({ code: 'E_AUTHORING_INPUT' }));
    expect(() => resolver.resolve({ names: [] })).toThrowError(expect.objectContaining({ code: 'E_AUTHORING_INPUT' }));
  });

  it('serializes errors through the declared closed envelope', () => {
    const boundary = new Boundary();
    const error = new AuthoringError('E_UNKNOWN_SKILL', 'unknown authoring skill negotiation', ['negotiation']);
    expect(boundary.output('authoring-error', error.toJSON())).toEqual({
      code: 'E_UNKNOWN_SKILL',
      message: 'unknown authoring skill negotiation',
      details: ['negotiation'],
    });
  });
});

const validSkill = `---
name: pickup
description: "Collect a physical item."
triggers:
  - "pick up an item"
kind: mechanic
mechanic: pickup
---

# Pickup
`;
