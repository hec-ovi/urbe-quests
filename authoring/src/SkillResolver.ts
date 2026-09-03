import { readdirSync, readFileSync, type Dirent } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Boundary } from './Boundary.js';
import { AuthoringError } from './AuthoringError.js';
import { MECHANICS, type Mechanic, type ResolvedSkill, type ResolvedSkills, type SkillIndex, type SkillRouteResult, type SkillSummary } from './schema.js';

const DEFAULT_ROOT = fileURLToPath(new URL('../skills/', import.meta.url));

/** GBrain-style frontmatter resolver: cheap index first, full skill bodies only by explicit name. */
export class SkillResolver {
  private readonly root: string;
  private readonly boundary: Boundary;

  constructor(root = DEFAULT_ROOT, boundary = new Boundary()) {
    this.root = root;
    this.boundary = boundary;
  }

  index(input: Record<string, never> = {}): SkillIndex {
    this.boundary.input('skill-index-query', input);
    const skills = this.discover().map(({ path: _path, content: _content, ...summary }) => summary);
    return this.boundary.output('skill-index', { skills });
  }

  route(input: { message: string }): SkillRouteResult {
    this.boundary.input('skill-route-query', input);
    const message = input.message.toLocaleLowerCase('en');
    const matches = this.index().skills
      .map((skill) => ({ skill, length: longestTrigger(skill, message) }))
      .filter((candidate) => candidate.length > 0)
      .sort((left, right) => right.length - left.length || left.skill.name.localeCompare(right.skill.name))
      .map(({ skill }) => skill);
    return this.boundary.output('skill-route-result', { matches });
  }

  resolve(input: { names: string[] }): ResolvedSkills {
    this.boundary.input('skill-resolve-query', input);
    const byName = new Map(this.discover().map((skill) => [skill.name, skill]));
    const skills = input.names.map((name) => {
      const skill = byName.get(name);
      if (!skill) throw new AuthoringError('E_UNKNOWN_SKILL', `unknown authoring skill ${name}`);
      return skill;
    });
    return this.boundary.output('resolved-skills', { skills });
  }

  private discover(): ResolvedSkill[] {
    const found: ResolvedSkill[] = [];
    const names = new Set<string>();
    const triggers = new Map<string, string>();
    const entries = this.entries();
    for (const entry of entries.filter((item) => item.isDirectory())) {
      const path = join(this.root, entry.name, 'SKILL.md');
      let content: string;
      try {
        content = readFileSync(path, 'utf8');
      } catch {
        continue;
      }
      const summary = parseFrontmatter(content, path);
      if (summary.name !== entry.name) {
        throw new AuthoringError('E_SKILL_CONTRACT', `${path} name ${summary.name} does not match its folder ${entry.name}`);
      }
      if (summary.kind === 'mechanic' && summary.mechanic !== entry.name) {
        throw new AuthoringError('E_SKILL_CONTRACT', `${path} mechanic ${summary.mechanic} does not match its skill ${entry.name}`);
      }
      if (names.has(summary.name)) throw new AuthoringError('E_SKILL_CONTRACT', `duplicate authoring skill ${summary.name}`);
      names.add(summary.name);
      for (const trigger of summary.triggers) {
        const normalized = trigger.toLocaleLowerCase('en');
        const owner = triggers.get(normalized);
        if (owner) throw new AuthoringError('E_SKILL_CONTRACT', `trigger ${trigger} is shared by ${owner} and ${summary.name}`);
        triggers.set(normalized, summary.name);
      }
      found.push({ ...summary, path: `skills/${entry.name}/SKILL.md`, content });
    }
    if (found.length === 0) throw new AuthoringError('E_SKILL_CONTRACT', `authoring skill root has no skills: ${this.root}`);
    return found.sort((left, right) => left.name.localeCompare(right.name));
  }

  private entries(): Dirent[] {
    try {
      return readdirSync(this.root, { withFileTypes: true });
    } catch {
      throw new AuthoringError('E_SKILL_CONTRACT', `authoring skill root is unavailable: ${this.root}`);
    }
  }
}

function longestTrigger(skill: SkillSummary, message: string): number {
  return skill.triggers.reduce((longest, trigger) => {
    const normalized = trigger.toLocaleLowerCase('en');
    return message.includes(normalized) ? Math.max(longest, normalized.length) : longest;
  }, 0);
}

function parseFrontmatter(content: string, path: string): SkillSummary {
  const match = content.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match?.[1]) throw new AuthoringError('E_SKILL_CONTRACT', `${path} has no YAML frontmatter`);
  const lines = match[1].split('\n');
  const scalar = (key: string): string | undefined => {
    const line = lines.find((candidate) => candidate.startsWith(`${key}:`));
    if (!line) return undefined;
    return unquote(line.slice(key.length + 1).trim());
  };
  const triggers: string[] = [];
  const at = lines.findIndex((line) => line.trim() === 'triggers:');
  if (at >= 0) {
    for (const line of lines.slice(at + 1)) {
      const item = line.match(/^\s+-\s+(.+)$/);
      if (!item?.[1]) break;
      triggers.push(unquote(item[1].trim()));
    }
  }
  const name = scalar('name');
  const description = scalar('description');
  const kind = scalar('kind');
  const mechanic = scalar('mechanic');
  const supportedKinds = new Set(['stage', 'mechanic']);
  const validName = Boolean(name && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name));
  const duplicateTriggers = new Set(triggers).size !== triggers.length;
  const mechanicContract = kind === 'mechanic' ? Boolean(mechanic && MECHANICS.includes(mechanic as Mechanic)) : !mechanic;
  if (!name || !validName || !description || !supportedKinds.has(kind ?? '') || triggers.length === 0 || duplicateTriggers || !mechanicContract) {
    throw new AuthoringError('E_SKILL_CONTRACT', `${path} has invalid name, description, kind, or triggers`);
  }
  return {
    name,
    description,
    triggers,
    kind: kind as 'stage' | 'mechanic',
    ...(mechanic ? { mechanic: mechanic as Mechanic } : {}),
  };
}

function unquote(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}
