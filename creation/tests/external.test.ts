/**
 * Contract-surface tests for external authoring: `npm run author --external`
 * serves every stage from an author directory instead of a model, stops at
 * the files it owes with their exact requests, refuses what a stage cannot
 * use with the reasons a model's repair round reads, and ends in the same
 * recording and bundle a live run makes. The shipped urbe-small author
 * directory, The Short Measure, stands in for the agent writing it.
 */

import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentToolCall } from '../../ports/llm.js';
import { SCENERY_VOCABULARY } from '../../handoff/SceneStagings.js';
import { StubSimulation, WorldContextNormalizer, type NamedWorld, type NPCTypeSet } from '../../world/index.js';
import { QuestlineCreation } from '../QuestlineCreation.js';
import { author, type AuthorResult } from '../samples/author.js';
import type { HandoffManifest } from '../samples/EngineHandoffWriter.js';
import { ExternalAuthor } from '../samples/ExternalAuthor.js';
import { materialize } from '../samples/materialize.js';
import { OpenAICompatibleClient } from '../samples/OpenAICompatibleClient.js';
import { recordedPorts, type Recording } from '../samples/RecordedPorts.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const sampleDir = fileURLToPath(new URL('../samples/urbe-small/', import.meta.url));
const AUTHORED = join(sampleDir, 'author');
const worldPath = join(sampleDir, 'world.json');
const typesPath = join(sampleDir, 'npc-types.json');
/** The host capabilities Engine declares: public transit and the scenery it stages. */
const handoffPath = join(sampleDir, 'handoff-input.json');
const read = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;
const text = (path: string): string => readFileSync(path, 'utf8');
const PROMPT = 'A short rain-soaked noir: a clinic courier learns the water ration she runs for a corporation is being skimmed, and has to decide who hears about it first.';
/** What Engine plays and opens for a small city. */
const MECHANICS = ['goto', 'observe', 'talk', 'listen', 'pickup', 'deliver', 'steal', 'work', 'investigation', 'escort'];
const OPEN = ['p0', 'p1', 'p4', 'p6', 'p7', 'p10', 'p11', 'p32', 'p40'];
const TITLES = { 'the-short-measure': 'The Short Measure', 'the-tuesday-barrel': 'The Tuesday Barrel', tolerance: 'Tolerance', 'rust-bucket-credit': 'Rust Bucket Credit' };

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

/** A scratch run of the sample: an author directory and an output directory. */
function scratch() {
  const dir = mkdtempSync(join(tmpdir(), 'quests-external-'));
  dirs.push(dir);
  const authorDir = join(dir, 'author');
  const out = join(dir, 'out');
  const args = [
    '--world', worldPath, '--types', typesPath, '--out', out, '--external', authorDir, '--handoff', handoffPath,
    '--mechanics', MECHANICS.join(','), `--parcels=${OPEN.join(',')}`, '--profile', 'small', '--prompt', PROMPT,
  ];
  return {
    authorDir,
    out,
    run: (...extra: string[]) => author([...args, ...extra], { log: () => undefined }),
    /** The shipped author files, or the ones named. */
    supply: (...files: string[]) =>
      files.length === 0
        ? cpSync(AUTHORED, authorDir, { recursive: true, filter: (source) => !source.includes('requests') })
        : files.forEach((file) => cpSync(join(AUTHORED, file), join(authorDir, file), { recursive: true })),
    write: (file: string, value: string) => writeFileSync(join(authorDir, file), value),
  };
}

const needs = (result: AuthorResult) => (result.status === 'needs' ? result.needs : []);

describe('external author', () => {
  it('gives the sample public transit and every scenery kind the stage_scene tool knows', () => {
    expect(read(handoffPath)).toEqual({ hostCapabilities: { transportationModes: ['public-transit'], scenery: SCENERY_VOCABULARY } });
  });

  it('stops at the files it owes with their exact requests, goes on from what the author adds and ends in a bundle', async () => {
    const connect = vi.spyOn(OpenAICompatibleClient, 'connect');
    const run = scratch();

    // Nothing written yet: the script is owed, with the request a model would read.
    const first = await run.run();
    expect(first).toMatchObject({ status: 'needs', needs: [{ stage: 'script', file: 'script.md', request: ['requests/script.md'] }] });
    const request = text(join(run.authorDir, 'requests', 'script.md'));
    expect(request).toMatch(/^Stage: script\nAnswer: script\.md\n\n======== SYSTEM ========\n\nYou are a screenwriter\./);
    expect(request).toContain('The city can show what a scene leaves behind');
    expect(request).toContain(`======== PROMPT ========\n\nCreation prompt:\n${PROMPT}`);
    expect(read(join(run.out, 'meta.json'))).toMatchObject({ model: 'claude-opus-5-5', scenery: true, needs: needs(first) });
    expect(existsSync(join(run.out, 'recording.json'))).toBe(false);
    expect(existsSync(join(run.out, 'bundle'))).toBe(false);

    // The script in: the main plan and the situations are owed together.
    run.supply('script.md');
    expect(needs(await run.run())).toEqual([
      { stage: 'plan', title: 'The Short Measure', file: 'plans/the-short-measure.md', request: ['requests/plans/the-short-measure.md'] },
      { stage: 'situations', file: 'situations.md', request: ['requests/situations.md'] },
    ]);

    // Plans in: every build owes its first round, with its request and tools.
    run.supply('situations.md', 'plans');
    const rounds = needs(await run.run());
    expect(rounds.map((need) => need.file)).toEqual(Object.keys(TITLES).sort().map((slug) => `builds/${slug}/round-01.json`));
    expect(rounds[0]).toEqual({
      stage: 'build', title: 'Rust Bucket Credit', round: 1, file: 'builds/rust-bucket-credit/round-01.json',
      request: ['requests/builds/rust-bucket-credit/request.md', 'requests/builds/rust-bucket-credit/tools.json'],
    });
    const build = text(join(run.authorDir, 'requests', 'builds', 'the-short-measure', 'request.md'));
    expect(build).toMatch(/^Stage: build\nTitle: The Short Measure\nAnswer: builds\/the-short-measure\/round-NN\.json\nTools: requests\/builds\/the-short-measure\/tools\.json\n/);
    expect(build).toContain('# Step catalog');
    expect(build).toContain('Title: The Short Measure');
    const tools = read<{ name: string }[]>(join(run.authorDir, 'requests', 'builds', 'the-short-measure', 'tools.json')).map((tool) => tool.name);
    expect(tools).toEqual(expect.arrayContaining(['create_questline', 'add_step', 'stage_scene', 'finish_questline']));

    // Every round in: the run completes, never asks a model server, and records what the author wrote.
    run.supply();
    const done = await run.run();
    if (done.status !== 'done') throw new Error(`still owes ${needs(done).map((need) => need.file).join(', ')}`);
    expect(connect).not.toHaveBeenCalled();
    const recording = read<Recording>(join(run.out, 'recording.json'));
    expect(recording).toMatchObject({ prompt: PROMPT, model: 'claude-opus-5-5', mechanics: MECHANICS, scenery: SCENERY_VOCABULARY });
    expect(recording.script).toBe(text(join(AUTHORED, 'script.md')));
    expect(recording.situations).toBe(text(join(AUTHORED, 'situations.md')));
    for (const [slug, title] of Object.entries(TITLES)) {
      expect(recording.plans[title]).toBe(text(join(AUTHORED, 'plans', `${slug}.md`)));
      expect(recording.builds[title]).toEqual([read<AgentToolCall[]>(join(AUTHORED, 'builds', slug, 'round-01.json'))]);
    }
    expect(done.creation.main.definition.steps.map((step) => step.target.kind)).toEqual(['talk', 'pickup', 'deliver']);
    expect(done.creation.side.map((side) => side.scenes.map((scene) => scene.sceneId))).toEqual([['q_tuesday_barrel.sc1_cup'], [], []]);

    // Bundle 1.2 with the staged scene, byte-identical to a later materialize of the recording.
    const bundleDir = join(run.out, 'bundle');
    const manifest = read<HandoffManifest & { contractVersion: string }>(join(bundleDir, 'quest-bundle.json'));
    expect(manifest.contractVersion).toBe('1.2');
    expect(manifest.counts).toMatchObject({ questlines: 4, scenery: 1, missionItemBindings: 1 });
    expect(done.bundle.blocked).toEqual([]);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const again = join(run.out, 'again', 'questlines.json');
    await materialize([join(run.out, 'recording.json'), 'small', worldPath, typesPath, again, handoffPath, `--parcels=${OPEN.join(',')}`]);
    for (const file of readdirSync(bundleDir)) expect(text(join(run.out, 'again', file)), file).toBe(text(join(bundleDir, file)));

    // The recording replays without the author directory to the same questlines.
    const { world, types } = new WorldContextNormalizer().normalize({ world: read<NamedWorld>(worldPath), types: read<NPCTypeSet>(typesPath) });
    const replayed = await new QuestlineCreation().run({
      prompt: recording.prompt, world, types, sim: new StubSimulation({ seed: 'external-replay', world, types }),
      mechanics: recording.mechanics, scenery: recording.scenery, parcels: OPEN, ports: recordedPorts(recording, world),
    });
    expect([replayed.main, ...replayed.side].map((quest) => quest.definition.id)).toEqual(['q_short_measure', 'q_tuesday_barrel', 'q_tolerance', 'q_rust_bucket_credit']);
  });

  it('refuses what a stage cannot use with the reasons a model repair round reads, and runs a build round by round', async () => {
    const run = scratch();
    run.supply();

    run.write('script.md', 'FADE IN on nothing usable.');
    expect(needs(await run.run())).toEqual([{
      stage: 'script', file: 'script.md', request: ['requests/script.md'],
      problems: expect.arrayContaining(['no "# <the story\'s title>" line', '"## Logline" missing or empty']),
    }]);
    run.supply('script.md');

    // A side plan without its manifest stops only that side quest; the rest of the run finishes around it.
    run.write('plans/tolerance.md', 'A plan that forgot its manifest.');
    expect(needs(await run.run())).toEqual([{
      stage: 'plan', title: 'Tolerance', file: 'plans/tolerance.md', request: ['requests/plans/tolerance.md'],
      problems: ['no "## Manifest" section at the end of the plan'],
    }]);
    run.supply('plans/tolerance.md');

    const round = (n: number) => `builds/the-short-measure/round-0${n}.json`;
    run.write(round(1), '[{ "tool": "add_role", ');
    expect(needs(await run.run())).toEqual([expect.objectContaining({ stage: 'build', round: 1, file: round(1), problems: [expect.stringMatching(/^not JSON: /)] })]);
    run.write(round(1), JSON.stringify([{ tool: 'finish_questline', input: [] }]));
    expect(needs(await run.run())[0]!.problems).toEqual(['call 1 is not { "tool": "<name>", "input": { ... } }']);

    // A refused call comes back as a tool result, and the next round answers it.
    const authored = read<AgentToolCall[]>(join(AUTHORED, round(1)));
    const orrin = { tool: 'add_role', input: { roleId: 'r_orrin', npcType: 'quest_corporate', persona: 'Tired charm, round numbers.' } };
    run.write(round(1), JSON.stringify([...authored.slice(0, -1), orrin]));
    const second = needs(await run.run());
    expect(second).toEqual([{
      stage: 'build', title: 'The Short Measure', round: 2, file: round(2),
      request: ['requests/builds/the-short-measure/request.md', 'requests/builds/the-short-measure/tools.json', 'requests/builds/the-short-measure/round-01.results.json'],
    }]);
    const results = read<{ tool: string; result: string }[]>(join(run.authorDir, 'requests', round(1).replace('.json', '.results.json')));
    expect(results).toHaveLength(authored.length);
    expect(results.at(-1)).toEqual({ tool: 'add_role', result: expect.stringMatching(/^error: role r_orrin is not in the plan; /) });
    expect(results[0]!.result).toMatch(/^questline q_short_measure created; /);

    run.write(round(2), JSON.stringify([{ tool: 'finish_questline' }]));
    const done = await run.run('--model', 'claude-opus-test');
    expect(done.status).toBe('done');
    const recording = read<Recording>(join(run.out, 'recording.json'));
    expect(recording.model).toBe('claude-opus-test');
    expect(recording.builds['The Short Measure']).toEqual([[...authored.slice(0, -1), orrin], [{ tool: 'finish_questline' }]]);

    // A later run into the same --out that owes a file keeps nothing of the finished one: no recording, questlines or bundle.
    const finished = readdirSync(run.out);
    expect(finished).toEqual(expect.arrayContaining(['recording.json', 'questlines.json', 'side-sit_2.plan.md', 'side-sit_2.questline.json', 'bundle']));
    writeFileSync(join(run.authorDir, 'requests', 'stale.md'), 'from an earlier run');
    run.write('plans/tolerance.md', 'A plan that forgot its manifest.');
    expect(needs(await run.run()).map((need) => need.file)).toEqual(['plans/tolerance.md']);
    expect(readdirSync(run.out).filter((file) => !['bundle', 'meta.json'].includes(file)).sort()).toEqual(
      finished.filter((file) => /^(script|situations|main\.|side-sit_[13]\.)/.test(file)).sort(),
    );
    expect(readdirSync(join(run.out, 'bundle'))).toEqual([]);
    expect(read(join(run.out, 'meta.json'))).not.toHaveProperty('bundle');
    expect(existsSync(join(run.authorDir, 'requests', 'stale.md'))).toBe(false);
  });

  it('takes one named author, names an external one only, and keeps one file per title', async () => {
    const run = scratch();
    const bare = ['--world', worldPath, '--types', typesPath, '--out', run.out];
    const oneAuthor = /^name one author: --external <author-dir>, an agent writing each stage as a file, or --live, the model server$/;
    await expect(author(bare)).rejects.toThrowError(oneAuthor);
    await expect(author([...bare, '--model', 'claude-opus-5-5'])).rejects.toThrowError(oneAuthor);
    await expect(run.run('--live')).rejects.toThrowError(oneAuthor);
    await expect(author([...bare, '--live=yes'])).rejects.toThrowError(/^--live takes no value$/);
    await expect(author([...bare, '--live', '--model', 'claude-opus-5-5'])).rejects.toThrowError(/^--model names an external author/);
    await expect(run.run('--external=')).rejects.toThrowError(/^--external needs a value$/);
    await expect(author([...bare, '--external', run.out])).rejects.toThrowError(/^--external and --out name one directory/);
    expect(existsSync(run.out)).toBe(false);

    const external = new ExternalAuthor(run.authorDir);
    mkdirSync(join(run.authorDir, 'plans'));
    writeFileSync(join(run.authorDir, 'plans', 'rust-salt.md'), 'the plan');
    await expect(external.ports.plan.complete({ system: 'plan', prompt: 'Title: Rust, Salt' })).resolves.toBe('the plan');
    await expect(external.ports.plan.complete({ system: 'plan', prompt: 'Title: Rust & Salt' })).rejects.toThrowError(
      'titles "Rust, Salt" and "Rust & Salt" share the author file name rust-salt; give one its own title',
    );
    void external.ports.plan.complete({ system: 'plan', prompt: 'Title: Déjà Vu' });
    // A request names the file that answers it exactly, whatever the title holds.
    void external.ports.plan.complete({ system: 'plan', prompt: 'Title: Round 2' });
    void external.ports.build.step({ system: 'build', prompt: 'Title: Round 2', tools: [], transcript: [] });
    expect(await external.stalled).toEqual([
      { stage: 'build', title: 'Round 2', round: 1, file: 'builds/round-2/round-01.json', request: ['requests/builds/round-2/request.md', 'requests/builds/round-2/tools.json'] },
      { stage: 'plan', title: 'Déjà Vu', file: 'plans/deja-vu.md', request: ['requests/plans/deja-vu.md'] },
      { stage: 'plan', title: 'Round 2', file: 'plans/round-2.md', request: ['requests/plans/round-2.md'] },
    ]);
    const header = (file: string) => text(join(run.authorDir, 'requests', file)).split('\n\n')[0];
    expect(header('plans/round-2.md')).toBe('Stage: plan\nTitle: Round 2\nAnswer: plans/round-2.md');
    expect(header('builds/round-2/request.md')).toBe('Stage: build\nTitle: Round 2\nAnswer: builds/round-2/round-NN.json\nTools: requests/builds/round-2/tools.json');
  });

  it('exits 2 while the author owes files and 1 without an author', () => {
    const run = scratch();
    const cli = (...args: string[]) =>
      spawnSync(process.execPath, ['--import', 'tsx', 'creation/samples/author.ts', '--world', worldPath, '--types', typesPath, '--out', run.out, ...args], { cwd: root, encoding: 'utf8' });
    const owes = cli('--external', run.authorDir);
    expect(owes.status, owes.stderr).toBe(2);
    expect(owes.stderr).toContain('needs script.md (request requests/script.md)');
    const unnamed = cli();
    expect(unnamed.status).toBe(1);
    expect(unnamed.stderr).toContain('name one author');
  });
});
