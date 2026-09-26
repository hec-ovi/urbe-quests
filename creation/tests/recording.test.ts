/**
 * Contract-surface tests for keeping a live run: recordingPorts captures what
 * the model said so a replay reaches the same questlines and bundle, and the
 * author CLI writes stages, recording, meta and the materialized bundle from
 * one run. The recorded urbe-small run stands in for the live model.
 */

import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { QuestlineDefinition } from '../../flow/schema.js';
import { EngineHandoff } from '../../handoff/EngineHandoff.js';
import { StubSimulation, WorldContextNormalizer, type NamedWorld, type NPCTypeSet } from '../../world/index.js';
import { QuestlineCreation } from '../QuestlineCreation.js';
import { author, type AuthorClient } from '../samples/author.js';
import type { HandoffManifest } from '../samples/EngineHandoffWriter.js';
import { materialize } from '../samples/materialize.js';
import { pickupAssetRequests } from '../samples/PickupAssetRequests.js';
import { recordedPorts, type Recording } from '../samples/RecordedPorts.js';
import { recordingPorts } from '../samples/RecordingPorts.js';
import type { CreationResult, StagePorts } from '../schema.js';

const sampleDir = fileURLToPath(new URL('../samples/urbe-small/', import.meta.url));
const worldPath = join(sampleDir, 'world.json');
const typesPath = join(sampleDir, 'npc-types.json');
const read = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;
const RECORDING = read<Recording>(join(sampleDir, 'recording.json'));
const { world, types } = new WorldContextNormalizer().normalize({ world: read<NamedWorld>(worldPath), types: read<NPCTypeSet>(typesPath) });
const HOST_MECHANICS = ['goto', 'observe', 'talk', 'listen', 'pickup', 'deliver', 'steal', 'work'];
/** What the assembler opened in the materialize tests: every recorded questline fits. */
const OPEN = ['p0', 'p1', 'p4', 'p6', 'p7', 'p10', 'p11', 'p32', 'p40'];

/** The recorded run as a live model: its script and one plan need a repair round, and the main build first answers in words. */
function liveModel(): StagePorts {
  const recorded = recordedPorts(RECORDING, world);
  const seen = new Set<string>();
  const first = (key: string) => !seen.has(key) && Boolean(seen.add(key));
  return {
    script: { complete: async (request) => (first('script') ? 'FADE IN on nothing usable.' : recorded.script.complete(request)) },
    situations: recorded.situations,
    plan: {
      complete: async (request) =>
        request.prompt.includes('Title: Last Call at Oxide Filter') && first('plan') ? 'A plan that forgot its manifest.' : recorded.plan.complete(request),
    },
    build: {
      step: async (request) =>
        request.prompt.includes('Title: The Weir Line') && first('words') ? { kind: 'done', text: 'Here is how I would build it.' } : recorded.build.step(request),
    },
  };
}

/** One client for every stage, told apart by the system prompt each stage sends. */
const client = (ports: StagePorts): AuthorClient => ({
  model: 'fixture-model',
  complete: (request) =>
    (request.system.includes('# Step catalog') ? ports.plan
      : request.system.startsWith('You are a screenwriter working from a finished story') ? ports.situations
        : ports.script).complete(request),
  step: (request) => ports.build.step(request),
});

const create = (ports: StagePorts) =>
  new QuestlineCreation().run({ prompt: RECORDING.prompt, world, types, sim: new StubSimulation({ seed: 'recording-test', world, types }), ports });

const bundleOf = (result: CreationResult, recording: Recording): string => {
  const questlines = [result.main.definition, ...result.side.map((side) => side.definition)];
  return JSON.stringify(new EngineHandoff().assemble(questlines, pickupAssetRequests(questlines, {}, recording.missionItemTemplates)));
};

const dirs: string[] = [];
const scratch = () => {
  const dir = mkdtempSync(join(tmpdir(), 'quests-author-'));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('recordingPorts', () => {
  it('keeps the answers that parsed and the rounds that called tools, so replay reaches the same questlines and bundle', async () => {
    const capture = recordingPorts(liveModel(), { prompt: RECORDING.prompt, model: 'fixture-model', missionItemTemplates: RECORDING.missionItemTemplates });
    const live = await create(capture.ports);
    const recording = capture.recording();

    expect(recording).toMatchObject({ prompt: RECORDING.prompt, model: 'fixture-model', script: RECORDING.script, situations: RECORDING.situations });
    expect(recording.plans).toEqual(RECORDING.plans);
    expect(Object.fromEntries(Object.entries(recording.builds).map(([title, rounds]) => [title, rounds.length])))
      .toEqual(Object.fromEntries(Object.keys(RECORDING.builds).map((title) => [title, 1])));
    expect(recording).not.toHaveProperty('mechanics');

    const replayed = await create(recordedPorts(recording, world));
    expect(bundleOf(replayed, recording)).toBe(bundleOf(live, recording));
  });
});

describe('author CLI', () => {
  const required = (out: string) => ['--world', worldPath, '--types', typesPath, '--out', out];

  it('writes stages, recording and meta to --out and the bundle a later materialize of that recording writes', async () => {
    const dir = scratch();
    const out = join(dir, 'story');
    writeFileSync(join(dir, 'brief.txt'), `${RECORDING.prompt}\n`);
    const lines: string[] = [];
    // What the recording held on disk when the first build round was asked for: a run stopped then keeps it.
    const model = liveModel();
    let early: Recording | undefined;
    const build = model.build;
    model.build = { step: (request) => ((early ??= read<Recording>(join(out, 'recording.json'))), build.step(request)) };
    const { bundle } = await author(
      [...required(out), `--prompt=@${join(dir, 'brief.txt')}`, `--parcels=${OPEN.join(',')}`, '--mechanics', HOST_MECHANICS.join(','), '--profile', 'small'],
      { client: client(model), log: (line) => lines.push(line) },
    );
    expect(early).toMatchObject({ script: RECORDING.script, builds: {} });

    for (const file of ['script.md', 'situations.md', 'main.plan.md', 'main.questline.json', 'questlines.json', 'recording.json', 'meta.json']) {
      expect(existsSync(join(out, file)), file).toBe(true);
    }
    const recording = read<Recording>(join(out, 'recording.json'));
    expect(recording).toMatchObject({ prompt: RECORDING.prompt, model: 'fixture-model', mechanics: HOST_MECHANICS });
    expect(Object.keys(recording.missionItemTemplates!).sort()).toEqual(['device', 'document', 'key', 'substance', 'valuable', 'weapon']);
    expect(lines).toContainEqual(expect.stringMatching(/^script "The Weir Line": \d+ characters$/));
    expect(lines).toContainEqual(expect.stringMatching(/^plan "Last Call at Oxide Filter": \d+ chars in \d+s$/));
    expect(lines).toContainEqual(expect.stringMatching(/^build main round 1\/\d+: words instead of tools, nudged/));

    // Bundle 1.1 beside the questlines, each count the length of its file, every pickup bound to a template asset.
    const bundleDir = join(out, 'bundle');
    expect(bundle.outputPath).toBe(join(bundleDir, 'questlines.json'));
    const manifest = read<HandoffManifest>(join(bundleDir, 'quest-bundle.json'));
    for (const [name, count] of Object.entries(manifest.counts)) {
      expect(read<unknown[]>(join(bundleDir, manifest.files[name as keyof HandoffManifest['files']])), name).toHaveLength(count);
    }
    const questlines = read<QuestlineDefinition[]>(join(bundleDir, 'questlines.json'));
    expect(questlines).toHaveLength(4);
    const pickups = questlines.flatMap((quest) => quest.steps.flatMap((step) => (step.target.kind === 'pickup' ? [`${quest.id}/${step.target.itemId}`] : [])));
    const bound = read<{ questId: string; itemId: string }[]>(join(bundleDir, 'mission-item-bindings.json')).map((binding) => `${binding.questId}/${binding.itemId}`);
    expect(bound).toEqual(pickups);
    expect(read(join(bundleDir, 'questlines.meta.json'))).toMatchObject({ profile: 'small', recording: 'recording.json', npcTypes: 'npc-types.json', parcels: OPEN, blocked: [] });

    const meta = read<{ seconds: Record<string, number>; bundle: Record<string, unknown> }>(join(out, 'meta.json'));
    expect(meta).toMatchObject({ prompt: RECORDING.prompt, model: 'fixture-model', world: 'world.json', profile: 'small', mechanics: HOST_MECHANICS, parcels: OPEN.length });
    expect(meta.bundle).toMatchObject({ path: bundle.outputPath, questlines: 4 });
    expect(Object.keys(meta.seconds)).toEqual(expect.arrayContaining(['script', 'situations', 'main', 'side sit_1', 'materialize']));

    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const again = join(dir, 'again', 'questlines.json');
    await materialize([join(out, 'recording.json'), 'small', worldPath, typesPath, again, `--parcels=${OPEN.join(',')}`]);
    for (const file of readdirSync(bundleDir)) {
      expect(readFileSync(join(dir, 'again', file), 'utf8'), file).toBe(readFileSync(join(bundleDir, file), 'utf8'));
    }
  });

  it('names the stage a run stopped at and keeps what the model said; bad arguments stop it before any model call', async () => {
    const out = join(scratch(), 'failed');
    const unusable = client({ ...liveModel(), script: { complete: async () => 'FADE IN on nothing usable.' } });
    await expect(author(required(out), { client: unusable, log: () => undefined })).rejects.toThrowError(
      /^author failed at script: E_LLM script output unusable after repair/,
    );
    expect(read(join(out, 'meta.json'))).toMatchObject({ failed: { stage: 'script' } });
    expect(read<Recording>(join(out, 'recording.json')).script).toBe('FADE IN on nothing usable.');
    expect(existsSync(join(out, 'bundle'))).toBe(false);

    const untouched = client(liveModel());
    const complete = vi.spyOn(untouched, 'complete');
    await expect(author(['--world', worldPath], { client: untouched })).rejects.toThrowError(/^usage: author.ts/);
    await expect(author([...required(out), '--mechanics', 'goto,fly'], { client: untouched })).rejects.toThrowError(/unknown step kind fly/);
    await expect(author([...required(out), '--colour', 'grey'], { client: untouched })).rejects.toThrowError(/unknown option --colour/);
    expect(complete).not.toHaveBeenCalled();
  });
});
