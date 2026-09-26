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
import type { QuestlineDefinition, StepKind } from '../../flow/schema.js';
import { EngineHandoff } from '../../handoff/EngineHandoff.js';
import { SCENERY_VOCABULARY } from '../../handoff/SceneStagings.js';
import { StubSimulation, WorldContextNormalizer, type NamedWorld, type NPCTypeSet } from '../../world/index.js';
import { QuestlineCreation } from '../QuestlineCreation.js';
import { author, type AuthorClient } from '../samples/author.js';
import type { HandoffManifest } from '../samples/EngineHandoffWriter.js';
import { materialize } from '../samples/materialize.js';
import { OpenAICompatibleClient } from '../samples/OpenAICompatibleClient.js';
import { pickupAssetRequests } from '../samples/PickupAssetRequests.js';
import { recordedPorts, titleOf, type Recording } from '../samples/RecordedPorts.js';
import { recordingPorts } from '../samples/RecordingPorts.js';
import type { CreationInput, CreationProgress, CreationResult, StagePorts } from '../schema.js';

const sampleDir = fileURLToPath(new URL('../samples/urbe-small/', import.meta.url));
const worldPath = join(sampleDir, 'world.json');
const typesPath = join(sampleDir, 'npc-types.json');
const read = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;
const RECORDING = read<Recording>(join(sampleDir, 'recording.json'));
const { world, types } = new WorldContextNormalizer().normalize({ world: read<NamedWorld>(worldPath), types: read<NPCTypeSet>(typesPath) });
const HOST_MECHANICS: StepKind[] = ['goto', 'observe', 'talk', 'listen', 'pickup', 'deliver', 'steal', 'work'];
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

const create = (ports: StagePorts, extra: Partial<CreationInput> = {}) =>
  new QuestlineCreation().run({ prompt: RECORDING.prompt, world, types, sim: new StubSimulation({ seed: 'recording-test', world, types }), ports, ...extra });

/** The refused tool results each build round of one questline met. */
const refusalsOf = (events: CreationProgress[], questline: string): string[] =>
  events.flatMap((event) => (event.kind === 'build' && event.questline === questline ? event.build.refusals : []));

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

  it('keeps the allowlist, so a step refused as unplayable live is refused the same way on replay', async () => {
    // The main build first tries a hacking step the host cannot play, then sends the recorded round.
    const model = liveModel();
    const recorded = recordedPorts(RECORDING, world).build;
    const firstStep = RECORDING.builds['The Weir Line']![0]!.find((call) => call.tool === 'add_step')!;
    const hacking = { tool: 'add_step', input: { ...(firstStep.input as object), target: { kind: 'hacking', targetId: 'weir_panel', place: { districtId: 'd0' }, completionFlag: 'panel_open' } } };
    let tried = false;
    model.build = {
      step: async (request) =>
        titleOf(request.prompt) === 'The Weir Line' && !tried && (tried = true) ? { kind: 'calls', calls: [hacking] } : recorded.step(request),
    };
    const capture = recordingPorts(model, { prompt: RECORDING.prompt, model: 'fixture-model', mechanics: HOST_MECHANICS, missionItemTemplates: RECORDING.missionItemTemplates });
    const liveEvents: CreationProgress[] = [];
    const live = await create(capture.ports, { mechanics: HOST_MECHANICS, progress: (event) => liveEvents.push(event) });

    // What a host writes and reads back: the list travels with the recording.
    const recording = JSON.parse(JSON.stringify(capture.recording())) as Recording;
    expect(recording.mechanics).toEqual(HOST_MECHANICS);
    expect(recording.builds['The Weir Line']).toHaveLength(2);
    const refused = refusalsOf(liveEvents, 'main');
    expect(refused).toEqual([expect.stringMatching(/^error: step kind hacking is not playable here; use one of goto, observe, talk/)]);

    const replayEvents: CreationProgress[] = [];
    const replayed = await create(recordedPorts(recording, world), { mechanics: recording.mechanics, progress: (event) => replayEvents.push(event) });
    expect(refusalsOf(replayEvents, 'main')).toEqual(refused);
    expect(bundleOf(replayed, recording)).toBe(bundleOf(live, recording));

    // Without the list the same recorded call meets another answer.
    const unlimited: CreationProgress[] = [];
    await create(recordedPorts(recording, world), { progress: (event) => unlimited.push(event) });
    expect(refusalsOf(unlimited, 'main')).not.toEqual(refused);
  });
});

describe('recorded scenery', () => {
  it('keeps the host scenery, so a scene staged live stands the same on replay and a host without it is refused the tool', async () => {
    // The Exchange Rate's build stages the sample's collapse before it finishes, as a live model given the tool would.
    const [collapse] = RECORDING.sceneTemplates!['q_exchange_rate']!;
    const model = liveModel();
    const recorded = recordedPorts(RECORDING, world).build;
    model.build = {
      step: async (request) => {
        const reply = await recorded.step(request);
        if (titleOf(request.prompt) !== 'The Exchange Rate' || reply.kind !== 'calls') return reply;
        return { kind: 'calls', calls: [...reply.calls.slice(0, -1), { tool: 'stage_scene', input: collapse }, reply.calls.at(-1)!] };
      },
    };
    const scripts: string[] = [];
    const script = model.script;
    model.script = { complete: (request) => (scripts.push(request.system), script.complete(request)) };
    const capture = recordingPorts(model, { prompt: RECORDING.prompt, model: 'fixture-model', scenery: SCENERY_VOCABULARY, missionItemTemplates: RECORDING.missionItemTemplates });
    const live = await create(capture.ports, { scenery: SCENERY_VOCABULARY });

    expect(scripts[0]).toContain('The city can show what a scene leaves behind where it happened');
    const exchange = (result: CreationResult) => result.side.find((side) => side.definition.id === 'q_exchange_rate')!;
    const shipped = [{ ...collapse!, sceneId: 'q_exchange_rate.sc3_collapse' }];
    expect(exchange(live).scenes).toEqual(shipped);
    const recording = JSON.parse(JSON.stringify(capture.recording())) as Recording;
    expect(recording.scenery).toEqual(SCENERY_VOCABULARY);

    const replayed = await create(recordedPorts(recording, world), { scenery: recording.scenery });
    expect(exchange(replayed).scenes).toEqual(shipped);

    const events: CreationProgress[] = [];
    const bare = await create(recordedPorts(recording, world), { progress: (event) => events.push(event) });
    expect(exchange(bare).scenes).toEqual([]);
    expect(events.flatMap((event) => (event.kind === 'build' ? event.build.refusals : []))).toContain('error: unknown tool stage_scene');
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
    let early: { title: string; recording: Recording } | undefined;
    const build = model.build;
    model.build = { step: (request) => ((early ??= { title: titleOf(request.prompt), recording: read<Recording>(join(out, 'recording.json')) }), build.step(request)) };
    const result = await author(
      [...required(out), `--prompt=@${join(dir, 'brief.txt')}`, `--parcels=${OPEN.join(',')}`, '--mechanics', HOST_MECHANICS.join(','), '--profile', 'small'],
      { client: client(model), log: (line) => lines.push(line) },
    );
    if (result.status !== 'done') throw new Error('a live run finishes or fails');
    const { bundle } = result;
    expect(early!.recording.script).toBe(RECORDING.script);
    expect(early!.recording.plans[early!.title]).toBe(RECORDING.plans[early!.title]);
    expect(early!.recording.builds).toEqual({});

    const stages = ['script.md', 'situations.md', 'main.plan.md', 'main.questline.json', 'questlines.json', 'recording.json', 'meta.json'];
    for (const file of [...stages, ...['sit_1', 'sit_2', 'sit_3'].flatMap((id) => [`side-${id}.plan.md`, `side-${id}.questline.json`])]) {
      expect(existsSync(join(out, file)), file).toBe(true);
    }
    const recording = read<Recording>(join(out, 'recording.json'));
    expect(recording).toMatchObject({ prompt: RECORDING.prompt, model: 'fixture-model', mechanics: HOST_MECHANICS });
    expect(Object.keys(recording.missionItemTemplates!).sort()).toEqual(['device', 'document', 'key', 'substance', 'valuable', 'weapon']);
    expect(lines).toContainEqual(expect.stringMatching(/^script "The Weir Line": \d+ characters$/));
    expect(lines).toContainEqual(expect.stringMatching(/^plan "Last Call at Oxide Filter": \d+ chars in \d+s$/));
    expect(lines).toContainEqual(expect.stringMatching(/^plan main: \d+ roles, \d+ items, \d+ acts, \d+ endings, \d+ steps$/));
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

  it('names the stage a run stopped at and keeps what the model said', async () => {
    const dir = scratch();
    const out = join(dir, 'failed');
    const unusable = client({ ...liveModel(), script: { complete: async () => 'FADE IN on nothing usable.' } });
    await expect(author(required(out), { client: unusable, log: () => undefined })).rejects.toThrowError(
      /^author failed at script: E_LLM script output unusable after repair/,
    );
    expect(read(join(out, 'meta.json'))).toMatchObject({ model: 'fixture-model', failed: { stage: 'script' } });
    expect(read<Recording>(join(out, 'recording.json')).script).toBe('FADE IN on nothing usable.');
    expect(existsSync(join(out, 'bundle'))).toBe(false);

    // A main build that fails still leaves its plan, on disk and in the recording.
    const stalled = join(dir, 'stalled');
    const words = client({ ...liveModel(), situations: { complete: async () => 'no situations here' }, build: { step: async () => ({ kind: 'done', text: 'In words.' }) } });
    await expect(author(required(stalled), { client: words, log: () => undefined })).rejects.toThrowError(/^author failed at main questline: E_LLM/);
    expect(readFileSync(join(stalled, 'main.plan.md'), 'utf8')).toBe(RECORDING.plans['The Weir Line']!.trim());
    expect(read<Recording>(join(stalled, 'recording.json')).plans).toEqual({ 'The Weir Line': RECORDING.plans['The Weir Line'] });

    // A server that cannot be reached is the model stage, with meta.json saying so.
    const offline = join(dir, 'offline');
    vi.spyOn(OpenAICompatibleClient, 'connect').mockRejectedValue(new Error('cannot reach http://127.0.0.1:9/v1/models: connect ECONNREFUSED 127.0.0.1:9'));
    await expect(author(required(offline), { log: () => undefined })).rejects.toThrowError(/^author failed at model: cannot reach .*ECONNREFUSED/);
    expect(read(join(offline, 'meta.json'))).toMatchObject({ failed: { stage: 'model' } });
    expect(read(join(offline, 'meta.json'))).not.toHaveProperty('model');
  });

  it('checks every argument and file before the model server is asked anything', async () => {
    const dir = scratch();
    const out = join(dir, 'unused');
    writeFileSync(join(dir, 'handoff.json'), JSON.stringify({ missionAssetRequests: 5 }));
    const connect = vi.spyOn(OpenAICompatibleClient, 'connect');
    const refused = (args: string[]) => expect(author(args, { log: () => undefined })).rejects;

    await refused(['--world', worldPath]).toThrowError(/^usage: author.ts/);
    await refused([...required(out), '--colour', 'grey']).toThrowError(/unknown option --colour/);
    // A flag is never read as the value of the one before it.
    await refused([...required(out), '--prompt', '--mechanics=goto']).toThrowError(/^--prompt needs a value$/);
    await refused([...required(out), '--mechanics', 'goto,fly']).toThrowError(/unknown step kind fly/);
    await refused([...required(out), '--parcels=']).toThrowError(/parcels names no building/);
    await refused([...required(out), '--parcels=p0,nope1,nope2']).toThrowError(/parcels not in the world: nope1, nope2$/);
    await refused([...required(out), '--handoff', join(dir, 'handoff.json')]).toThrowError(expect.objectContaining({ code: 'E_HANDOFF' }));
    expect(connect).not.toHaveBeenCalled();
    expect(existsSync(out)).toBe(false);
  });
});
