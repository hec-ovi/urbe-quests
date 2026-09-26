/**
 * Authors a story with a live model and makes it a bundle. The creation
 * workflow runs against the given world and writes each stage into --out as
 * it lands; what the model said is kept as recording.json, and that
 * recording is materialized in-process into bundle 1.1, exactly as a later
 * `npm run materialize` of the same recording, world, profile and parcels
 * would write it.
 */

import { basename, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { playableKinds } from '../../builder/mechanics.js';
import type { StepKind } from '../../flow/schema.js';
import type { AgentPort, LLMPort } from '../../ports/llm.js';
import { openParcels, QuestlineCreation } from '../QuestlineCreation.js';
import type { CreationProgress, CreationResult } from '../schema.js';
import { loadWorld, parseArgs, readJson, readParcels, readText } from './CliInputs.js';
import { readHandoffInput } from './EngineHandoffWriter.js';
import { materializeRecording, profileSimulation, type MaterializeResult } from './materialize.js';
import { OpenAICompatibleClient } from './OpenAICompatibleClient.js';
import { checkMissionItemTemplates } from './PickupAssetRequests.js';
import { titleOf, type Recording } from './RecordedPorts.js';
import { recordingPorts } from './RecordingPorts.js';
import { SampleWriter, type Log } from './SampleWriter.js';

const OPTIONS = ['world', 'types', 'out', 'prompt', 'parcels', 'mechanics', 'templates', 'handoff', 'questlines', 'profile'];
const USAGE =
  'usage: author.ts --world <named-world|atlas.json> --types <npc-types.json> --out <dir> [--prompt <text|@file>] [--parcels=<ids|@file>] ' +
  '[--mechanics <kind,kind,...>] [--templates <file>] [--handoff <file>] [--questlines <path>] [--profile <label>]';
const DEFAULT_TEMPLATES = fileURLToPath(new URL('./mission-item-templates.json', import.meta.url));

/** One model for the text stages and the tool loop, and the name it goes by. */
export type AuthorClient = LLMPort & AgentPort & { readonly model: string };

export interface AuthorOptions {
  /** Omitted, OpenAICompatibleClient.connect() reads LLM_BASE_URL, LLM_MODEL and LLM_API_KEY. */
  client?: AuthorClient;
  log?: Log;
}

export interface AuthorResult {
  outDir: string;
  recording: Recording;
  creation: CreationResult;
  bundle: MaterializeResult;
}

/** The stage a run stopped at, with what stopped it; meta.json and recording.json are already written. */
export class AuthorFailure extends Error {
  constructor(readonly stage: string, cause: unknown) {
    const { code, message } = (cause ?? {}) as { code?: string; message?: string };
    super(`author failed at ${stage}: ${[code, message ?? String(cause)].filter(Boolean).join(' ')}`, { cause });
  }
}

export async function author(args: readonly string[], options: AuthorOptions = {}): Promise<AuthorResult> {
  const { positional, options: flags } = parseArgs(args, OPTIONS);
  const [worldPath, typesPath, outDir] = [flags.get('world'), flags.get('types'), flags.get('out')];
  if (positional.length > 0 || worldPath === undefined || typesPath === undefined || outDir === undefined) throw new Error(USAGE);
  const started = Date.now();
  const elapsed = () => Math.round((Date.now() - started) / 1000);
  const log = options.log ?? ((line: string) => console.error(`[${elapsed()}s] ${line}`));

  // Every file and option is read and checked before the model server is asked anything.
  const context = loadWorld(worldPath, typesPath);
  const prompt = (flags.has('prompt') ? readText(flags.get('prompt')!).trim() : '') || context.world.meta.naming.theme;
  const mechanics: StepKind[] | undefined = flags.has('mechanics')
    ? [...playableKinds(flags.get('mechanics')!.split(',').map((kind) => kind.trim()).filter((kind) => kind.length > 0))]
    : undefined;
  const parcels = openParcels(context.world, readParcels(flags.get('parcels')));
  const missionItemTemplates = checkMissionItemTemplates(readJson(flags.get('templates') ?? DEFAULT_TEMPLATES));
  const handoff = readHandoffInput(flags.get('handoff'));
  const profile = flags.get('profile') ?? 'author';
  const writer = new SampleWriter(outDir);
  const questlinesPath = resolve(flags.get('questlines') ?? join(writer.path, 'bundle', 'questlines.json'));

  const meta = {
    prompt,
    // Named once the server answers.
    model: undefined as string | undefined,
    world: basename(worldPath),
    types: basename(typesPath),
    profile,
    ...(mechanics !== undefined ? { mechanics } : {}),
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

  let client: AuthorClient;
  try {
    client = options.client ?? (await OpenAICompatibleClient.connect());
  } catch (error) {
    throw fail('model', error);
  }
  meta.model = client.model;
  log(
    `model ${client.model}, world ${basename(worldPath)} (${context.world.parcels.length} parcels` +
      `${parcels !== undefined ? `, ${parcels.length} open` : ''}, ${context.types.types.length} types)` +
      `, ${mechanics !== undefined ? `mechanics ${mechanics.join(', ')}` : 'every mechanic'}`,
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
      script: timed(() => 'script', client),
      situations: timed(() => 'situations', client),
      plan: timed((asked) => `plan "${titleOf(asked)}"`, client),
      build: client,
    },
    { prompt, model: client.model, mechanics, missionItemTemplates },
  );

  let stage = 'script';
  let creation: CreationResult;
  try {
    creation = await new QuestlineCreation().run({
      ...context,
      prompt,
      sim: profileSimulation(profile, context),
      ports: capture.ports,
      parcels,
      mechanics,
      warn: log,
      progress: (event: CreationProgress) => {
        writer.onProgress(event, log);
        // The recording lands with every stage, plan and build round, so a run stopped from outside keeps what the model said.
        writer.write('recording.json', json(capture.recording()));
        if (event.kind === 'script') stage = 'main questline';
        if (event.kind === 'script' || event.kind === 'situations') landed[event.kind] = elapsed();
        if (event.kind === 'questline') landed[event.questline === 'main' ? 'main' : `side ${event.questline}`] = elapsed();
      },
    });
  } catch (error) {
    throw fail((error as { detail?: { stage?: string } } | null)?.detail?.stage ?? stage, error);
  } finally {
    // What the model said is kept even when the run fails: a failed run is read from it.
    writer.write('recording.json', json(capture.recording()));
  }
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
  return { outDir: writer.path, recording, creation, bundle };
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    await author(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof AuthorFailure ? error.message : error);
    process.exit(1);
  }
}
