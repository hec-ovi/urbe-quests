/**
 * Stage ports served by an external author: an agent that writes each
 * stage's completion as a file where a model would answer. A completion on
 * disk goes through the same parser, repair reasons, tools and validation a
 * live answer does. A missing one gets its exact request written under
 * `requests/` and waits, and so does one the stage refused, with the reasons
 * a model's repair round would read. Once every branch of the run waits or is
 * done, `stalled` resolves with what the author owes, so the run stops there;
 * the next run replays the files already written and goes on.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { AgentReply, AgentToolCall, AgentPort, LLMPort } from '../../ports/llm.js';
import type { StagePorts } from '../schema.js';
import { titleOf } from './RecordedPorts.js';

/** What the external author is recorded as, unless the run names it. */
export const EXTERNAL_MODEL = 'claude-opus-5-5';

/** A file the author owes before the run can go on. Paths are relative to the author directory. */
export interface AuthorNeed {
  stage: 'script' | 'situations' | 'plan' | 'build';
  /** The assignment title, for a plan or a build. */
  title?: string;
  /** The build round the file answers, from 1. */
  round?: number;
  /** The file to write. */
  file: string;
  /** The files holding the exact request: the request, then for a build its tools and the results of the round before. */
  request: string[];
  /** Why the file as written was refused; it is written again whole. */
  problems?: string[];
}

const REQUESTS = 'requests';
const json = (value: unknown) => JSON.stringify(value, null, 2) + '\n';
const roundFile = (round: number) => `round-${String(round).padStart(2, '0')}`;

/** A title as a file name: letters and digits, runs of anything else one dash. */
const slugOf = (title: string): string =>
  title.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '') || 'untitled';

export class ExternalAuthor {
  readonly dir: string;
  readonly ports: StagePorts;
  /** Resolves with what the author owes once every branch of the run waits on it or is done. */
  readonly stalled: Promise<AuthorNeed[]>;
  private readonly needs: AuthorNeed[] = [];
  private readonly titles = new Map<string, string>();
  /** Port calls so far: a run is still moving while this changes. */
  private calls = 0;
  private settle!: (needs: AuthorNeed[]) => void;

  constructor(dir: string) {
    this.dir = resolve(dir);
    mkdirSync(this.dir, { recursive: true });
    this.stalled = new Promise((settle) => (this.settle = settle));
    this.ports = {
      script: this.text('script'),
      situations: this.text('situations'),
      plan: this.text('plan'),
      build: { step: (request) => this.step(request) },
    };
  }

  private text(stage: 'script' | 'situations' | 'plan'): LLMPort {
    return {
      complete: async ({ system, prompt, problems }) => {
        this.calls += 1;
        const title = stage === 'plan' ? titleOf(prompt) : undefined;
        const base = title === undefined ? stage : `plans/${this.slug(title)}`;
        const need: AuthorNeed = { stage, ...(title !== undefined ? { title } : {}), file: `${base}.md`, request: [`${REQUESTS}/${base}.md`] };
        // A repair round: the file on disk did not parse, for the reasons a model would be given.
        if (problems !== undefined) return this.wait({ ...need, problems: [...problems] });
        this.write(need.request[0]!, requestText(need, system, prompt));
        return this.read(need.file) ?? this.wait(need);
      },
    };
  }

  /** One build round: the transcript so far is the rounds this run served and the results each met. */
  private async step({ system, prompt, tools, transcript }: Parameters<AgentPort['step']>[0]): Promise<AgentReply> {
    this.calls += 1;
    const title = titleOf(prompt);
    const base = `builds/${this.slug(title)}`;
    const round = transcript.filter((turn) => turn.role === 'assistant').length + 1;
    const request = [`${REQUESTS}/${base}/request.md`, `${REQUESTS}/${base}/tools.json`];
    const need: AuthorNeed = { stage: 'build', title, round, file: `${base}/${roundFile(round)}.json`, request };
    if (round === 1) {
      this.write(request[0]!, requestText(need, system, prompt));
      this.write(request[1]!, json(tools));
    }
    const last = transcript.at(-1);
    if (last?.role === 'tool') {
      request.push(`${REQUESTS}/${base}/${roundFile(round - 1)}.results.json`);
      this.write(request[2]!, json(last.results));
    }
    const text = this.read(need.file);
    if (text === undefined) return this.wait(need);
    const { calls, problems } = readCalls(text);
    return problems.length > 0 ? this.wait({ ...need, problems }) : { kind: 'calls', calls };
  }

  /** Owes the file, and holds this branch of the run until the next run; the run stops once nothing else moves. */
  private wait(need: AuthorNeed): Promise<never> {
    this.needs.push(need);
    this.watch(this.calls);
    return new Promise<never>(() => undefined);
  }

  private watch(seen: number): void {
    setImmediate(() => (this.calls === seen ? this.settle([...this.needs].sort((a, b) => a.file.localeCompare(b.file))) : this.watch(this.calls)));
  }

  /** One file per title: two titles sharing a file name would answer each other's stages. */
  private slug(title: string): string {
    const slug = slugOf(title);
    const owner = this.titles.get(slug) ?? title;
    if (owner !== title) throw new Error(`titles "${owner}" and "${title}" share the author file name ${slug}; give one its own title`);
    this.titles.set(slug, title);
    return slug;
  }

  private read(file: string): string | undefined {
    const path = join(this.dir, file);
    return existsSync(path) ? readFileSync(path, 'utf8') : undefined;
  }

  private write(file: string, text: string): void {
    const path = join(this.dir, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  }
}

/** The request as the model would see it, under the stage, title and file that answer it. */
function requestText(need: AuthorNeed, system: string, prompt: string): string {
  const head = [
    `Stage: ${need.stage}`,
    ...(need.title !== undefined ? [`Title: ${need.title}`] : []),
    `Answer: ${need.file.replace(/round-\d+/, 'round-NN')}`,
    ...(need.stage === 'build' ? [`Tools: ${need.request[1]}`] : []),
  ];
  return `${head.join('\n')}\n\n======== SYSTEM ========\n\n${system.trim()}\n\n======== PROMPT ========\n\n${prompt.trim()}\n`;
}

/** A round file: a non-empty JSON array of `{ tool, input? }`, input an object. */
function readCalls(text: string): { calls: AgentToolCall[]; problems: string[] } {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    return { calls: [], problems: [`not JSON: ${(error as Error).message}`] };
  }
  if (!Array.isArray(value) || value.length === 0) return { calls: [], problems: ['a round is a non-empty JSON array of tool calls'] };
  const problems = value.flatMap((call: unknown, i) => {
    const { tool, input } = (call ?? {}) as { tool?: unknown; input?: unknown };
    const object = input === undefined || (input !== null && typeof input === 'object' && !Array.isArray(input));
    return typeof tool === 'string' && object ? [] : [`call ${i + 1} is not { "tool": "<name>", "input": { ... } }`];
  });
  return { calls: problems.length > 0 ? [] : (value as AgentToolCall[]), problems };
}
