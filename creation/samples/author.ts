/**
 * Authors a story and makes it a bundle. The creation workflow runs against
 * the given world and writes each stage into --out as it lands; what the
 * author said is kept as recording.json, and that recording is materialized
 * in-process into bundle 1.2, exactly as a later `npm run materialize` of the
 * same recording, world, profile and parcels would write it. Every run names
 * its author: --external, an agent writing each completion as a file
 * (ExternalAuthor), where a run stops at the files it owes and the next run
 * goes on from there; or --live, the model server. A host whose handoff
 * declares scenery gets stories that stage the scenes they have, and may name
 * investigation among its mechanics.
 */

import { rmSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { StepKind } from '../../flow/schema.js';
import type { AgentPort, LLMPort } from '../../ports/llm.js';
import { hostKinds, openParcels, QuestlineCreation } from '../QuestlineCreation.js';
import type { CreationProgress, CreationResult, StagePorts } from '../schema.js';
import { loadWorld, parseArgs, readJson, readParcels, readText } from './CliInputs.js';
import { readHandoffInput } from './EngineHandoffWriter.js';
import { EXTERNAL_MODEL, ExternalAuthor, type AuthorNeed } from './ExternalAuthor.js';
import { materializedFiles, materializeRecording, profileSimulation, type MaterializeResult } from './materialize.js';
import { OpenAICompatibleClient } from './OpenAICompatibleClient.js';
import { checkMissionItemTemplates } from './PickupAssetRequests.js';
import { titleOf, type Recording } from './RecordedPorts.js';
import { recordingPorts } from './RecordingPorts.js';
import { SampleWriter, type Log } from './SampleWriter.js';

const OPTIONS = ['world', 'types', 'out', 'prompt', 'parcels', 'mechanics', 'templates', 'handoff', 'questlines', 'profile', 'external', 'model'];
const USAGE =
  'usage: author.ts --world <named-world|atlas.json> --types <npc-types.json> --out <dir> (--external <author-dir> [--model <label>] | --live) ' +
  '[--prompt <text|@file>] [--parcels=<ids|@file>] [--mechanics <kind,kind,...>] [--templates <file>] [--handoff <file>] [--questlines <path>] [--profile <label>]';
const DEFAULT_TEMPLATES = fileURLToPath(new URL('./mission-item-templates.json', import.meta.url));

/** One model for the text stages and the tool loop, and the name it goes by. */
export type AuthorClient = LLMPort & AgentPort & { readonly model: string };

export interface AuthorOptions {
  /** The --live author; omitted, OpenAICompatibleClient.connect() reads LLM_BASE_URL, LLM_MODEL and LLM_API_KEY. */
  client?: AuthorClient;
  log?: Log;
}

export type AuthorResult =
  | { status: 'done'; outDir: string; recording: Recording; creation: CreationResult; bundle: MaterializeResult }
  /** An external run stopped at the files its author owes; the next run goes on from there. */
  | { status: 'needs'; outDir: string; needs: AuthorNeed[] };

/** One live client answers every stage. */
const everyStage = (client: AuthorClient) => ({ model: client.model, ports: { script: client, situations: client, plan: client, build: client } });

/** The stage a run stopped at, with what stopped it; meta.json and recording.json are already written. */
export class AuthorFailure extends Error {
  constructor(readonly stage: string, cause: unknown) {
    const { code, message } = (cause ?? {}) as { code?: string; message?: string };
    super(`author failed at ${stage}: ${[code, message ?? String(cause)].filter(Boolean).join(' ')}`, { cause });
  }
}

export async function author(args: readonly string[], options: AuthorOptions = {}): Promise<AuthorResult> {
  const { positional, options: flags, switches } = parseArgs(args, OPTIONS, ['live']);
  const [worldPath, typesPath, outDir, authorDir] = [flags.get('world'), flags.get('types'), flags.get('out'), flags.get('external')];
  if (positional.length > 0 || worldPath === undefined || typesPath === undefined || outDir === undefined) throw new Error(USAGE);
  const live = switches.has('live');
  if (live === (authorDir !== undefined)) throw new Error('name one author: --external <author-dir>, an agent writing each stage as a file, or --live, the model server');
  if (flags.has('model') && live) throw new Error('--model names an external author; a live model is named by LLM_MODEL');
  for (const name of ['external', 'model']) if (flags.get(name) === '') throw new Error(`--${name} needs a value`);
  if (authorDir !== undefined && resolve(authorDir) === resolve(outDir)) throw new Error('--external and --out name one directory; the run writes its stages over the author\'s files');
  const started = Date.now();
  const elapsed = () => Math.round((Date.now() - started) / 1000);
  const log = options.log ?? ((line: string) => console.error(`[${elapsed()}s] ${line}`));

  // Every file and option is read and checked before the model server is asked anything.
  const context = loadWorld(worldPath, typesPath);
  const prompt = (flags.has('prompt') ? readText(flags.get('prompt')!).trim() : '') || context.world.meta.naming.theme;
  const handoff = readHandoffInput(flags.get('handoff'));
  const scenery = handoff.hostCapabilities?.scenery;
  const listed = flags.get('mechanics')?.split(',').map((kind) => kind.trim()).filter((kind) => kind.length > 0);
  const mechanics: StepKind[] | undefined = listed === undefined ? undefined : [...hostKinds(listed, scenery)];
  const parcels = openParcels(context.world, readParcels(flags.get('parcels')));
  const missionItemTemplates = checkMissionItemTemplates(readJson(flags.get('templates') ?? DEFAULT_TEMPLATES));
  const profile = flags.get('profile') ?? 'author';
  const writer = new SampleWriter(outDir);
  const questlinesPath = resolve(flags.get('questlines') ?? join(writer.path, 'bundle', 'questlines.json'));
  // What --out holds describes this run alone: an earlier run's stages, recording, meta and bundle go first.
  writer.clear(['recording.json', 'meta.json']);
  for (const path of materializedFiles(questlinesPath)) rmSync(path, { force: true });

  const meta = {
    prompt,
    // Named once the server answers, or by the external author's label.
    model: undefined as string | undefined,
    world: basename(worldPath),
    types: basename(typesPath),
    profile,
    ...(mechanics !== undefined ? { mechanics } : {}),
    ...(scenery !== undefined ? { scenery: true } : {}),
    ...(parcels !== undefined ? { parcels: parcels.length } : {}),
    ranAt: new Date(started).toISOString(),
  };
  /** Seconds from the start at which each stage landed. */
  const landed: Record<string, number> = {};
  const json = (value: unknown) => JSON.stringify(value, null, 2) + '\n';
  const fail = (stage: string, cause: unknown): AuthorFailure => {
    const failure = new AuthorFailure(stage, cause);
    writer.write('meta.json', json({ ...meta, seconds: { ...landed, failed: elapsed() }, failed: { stage, message: failure.message } }));
    return failure;
  };

  // An external author answers from files; a live one is asked on the model server.
  const external = authorDir !== undefined ? new ExternalAuthor(authorDir) : undefined;
  let source: { model: string; ports: StagePorts };
  try {
    source = external !== undefined
      ? { model: flags.get('model') ?? EXTERNAL_MODEL, ports: external.ports }
      : everyStage(options.client ?? (await OpenAICompatibleClient.connect()));
  } catch (error) {
    throw fail('model', error);
  }
  meta.model = source.model;
  log(
    `${external !== undefined ? `external author ${source.model} in ${external.dir}` : `model ${source.model}`}, world ${basename(worldPath)} (${context.world.parcels.length} parcels` +
      `${parcels !== undefined ? `, ${parcels.length} open` : ''}, ${context.types.types.length} types)` +
      `, ${mechanics !== undefined ? `mechanics ${mechanics.join(', ')}` : 'every mechanic'}` +
      `${scenery !== undefined ? ', staged scenes' : ''}`,
  );
  const timed = (label: (prompt: string) => string, port: LLMPort): LLMPort => ({
    complete: async (request) => {
      const begun = Date.now();
      const text = await port.complete(request);
      log(`${label(request.prompt)}: ${text.length} chars in ${Math.round((Date.now() - begun) / 1000)}s`);
      return text;
    },
  });
  const capture = recordingPorts(
    {
      script: timed(() => 'script', source.ports.script),
      situations: timed(() => 'situations', source.ports.situations),
      plan: timed((asked) => `plan "${titleOf(asked)}"`, source.ports.plan),
      build: source.ports.build,
    },
    { prompt, model: source.model, mechanics, scenery, missionItemTemplates },
  );

  // A live run keeps what the model said as it lands, so a run stopped from outside keeps it. An external
  // author's files are that record: its recording.json is written once creation finishes, and never for a run that owes files.
  const keep = () => writer.write('recording.json', json(capture.recording()));
  let stage = 'script';
  let outcome: CreationResult | AuthorNeed[];
  try {
    const run = new QuestlineCreation().run({
      ...context,
      prompt,
      sim: profileSimulation(profile, context),
      ports: capture.ports,
      parcels,
      mechanics,
      scenery,
      warn: log,
      progress: (event: CreationProgress) => {
        writer.onProgress(event, log);
        if (live) keep();
        if (event.kind === 'script') stage = 'main questline';
        if (event.kind === 'script' || event.kind === 'situations') landed[event.kind] = elapsed();
        if (event.kind === 'questline') landed[event.questline === 'main' ? 'main' : `side ${event.questline}`] = elapsed();
      },
    });
    outcome = external === undefined ? await run : await Promise.race([run, external.stalled]);
  } catch (error) {
    // What the model said is kept even when the run fails: a failed run is read from it.
    if (live) keep();
    throw fail((error as { detail?: { stage?: string } } | null)?.detail?.stage ?? stage, error);
  }
  if (Array.isArray(outcome)) {
    for (const need of outcome) log(need.problems !== undefined ? `rejected ${need.file}: ${need.problems.join('; ')}` : `needs ${need.file} (request ${need.request.join(', ')})`);
    writer.write('meta.json', json({ ...meta, seconds: { ...landed, stopped: elapsed() }, needs: outcome }));
    return { status: 'needs', outDir: writer.path, needs: outcome };
  }
  const creation = outcome;
  keep();
  writer.writeQuestlines(creation);

  const recording = capture.recording();
  let bundle: MaterializeResult;
  try {
    bundle = await materializeRecording({
      ...context,
      recording,
      recordingName: 'recording.json',
      typesName: basename(typesPath),
      profile,
      outputPath: questlinesPath,
      handoff,
      parcels,
      // The replay meets the same dropped side quests the live run did; its lines say they come from the replay.
      log: (line) => log(`materialize: ${line}`),
    });
  } catch (error) {
    throw fail('materialize', error);
  }
  landed['materialize'] = elapsed();
  writer.write('meta.json', json({ ...meta, seconds: landed, bundle: { path: bundle.outputPath, ...bundle.manifest.counts }, blocked: bundle.blocked }));
  log(`done: ${bundle.questlines.length} questlines, ${bundle.blocked.length} blocked, bundle at ${bundle.outputPath}`);
  return { status: 'done', outDir: writer.path, recording, creation, bundle };
}

// Exit 0 once the bundle is written, 2 while an external author owes files, 1 on a failure.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if ((await author(process.argv.slice(2))).status === 'needs') process.exitCode = 2;
  } catch (error) {
    console.error(error instanceof AuthorFailure ? error.message : error);
    process.exit(1);
  }
}
