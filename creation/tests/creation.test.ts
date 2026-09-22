/**
 * Contract-surface tests for quests/creation, run on the sample recording the
 * launcher replays: the whole workflow with no model present, its warn and
 * E_LLM paths, the materialize entry with and without a set of open parcels,
 * and the engine questline set.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it, vi } from 'vitest';
import { QuestlineSetValidator } from '../../flow/QuestlineSet.js';
import type { QuestlineDefinition } from '../../flow/schema.js';
import { StubSimulation, WorldContextNormalizer, type NamedWorld, type NPCTypeSet } from '../../world/index.js';
import { QuestlineCreation } from '../QuestlineCreation.js';
import { questlineSetFromSample, writeQuestlineSet } from '../samples/QuestlineSetWriter.js';
import { materialize } from '../samples/materialize.js';
import { recordedPorts, type Recording } from '../samples/RecordedPorts.js';
import type { CreationProgress, StagePorts } from '../schema.js';
import { pickupAssetRequests } from '../samples/PickupAssetRequests.js';
import { EngineHandoff } from '../../handoff/EngineHandoff.js';

const sampleDir = fileURLToPath(new URL('../samples/urbe-small/', import.meta.url));
const recordingPath = join(sampleDir, 'recording.json');
const namedWorldPath = join(sampleDir, 'world.json');
const typesPath = join(sampleDir, 'npc-types.json');

const read = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;
const RECORDING = read<Recording>(recordingPath);
const SOURCE_WORLD = read<NamedWorld>(namedWorldPath);
const SOURCE_TYPES = read<NPCTypeSet>(typesPath);
const { world, types } = new WorldContextNormalizer().normalize({ world: SOURCE_WORLD, types: SOURCE_TYPES });

const junk = (text: string) => ({ complete: async () => text });

/** Every building a questline names, by step and by item. */
const parcelsNamed = (definition: QuestlineDefinition): string[] => [
  ...definition.steps.flatMap((step) => {
    const t = step.target;
    if (t.kind === 'talk' || t.kind === 'listen' || t.kind === 'work') return t.atParcelId === undefined ? [] : [t.atParcelId];
    return 'place' in t && 'parcelId' in t.place ? [t.place.parcelId] : [];
  }),
  ...definition.items.flatMap((item) => (item.atParcelId === undefined ? [] : [item.atParcelId])),
];

/** Replays the recorded run; overrides swap one stage for a failing one. */
function run(overrides: Partial<StagePorts> = {}, extra: Record<string, unknown> = {}) {
  const sim = new StubSimulation({ seed: 'creation-test', world, types });
  return new QuestlineCreation().run({
    prompt: RECORDING.prompt, world, types, sim,
    ports: { ...recordedPorts(RECORDING, world), ...overrides },
    ...extra,
  });
}

/** Answers in words for one assignment, so that translation fails the way a model can. */
const refuses = (title: string): Partial<StagePorts> => {
  const recorded = recordedPorts(RECORDING, world);
  return {
    build: {
      step: async (request) =>
        request.prompt.includes(`Title: ${title}`)
          ? { kind: 'done', text: 'I would rather describe it.' }
          : recorded.build.step(request),
    },
  };
};

/** The recorded main questline, reused as the engine payload under test. */
const MAIN: QuestlineDefinition = (await run()).main.definition;

describe('QuestlineCreation', () => {
  it('runs script, main translation, situations and side translations from one prompt', async () => {
    const recorded = recordedPorts(RECORDING, world);
    const planPrompts: string[] = [];
    const events: CreationProgress[] = [];
    const result = await run(
      { plan: { complete: async (request) => { planPrompts.push(request.prompt); return recorded.plan.complete(request); } } },
      { progress: (event: CreationProgress) => events.push(event) },
    );

    expect(result.script.script.title).toBe('The Weir Line');
    expect(result.situations.situations.map((s) => s.title)).toEqual([
      'Last Call at Oxide Filter', 'Signal Under Sump Row', 'The Exchange Rate',
    ]);
    expect(result.side.map((s) => s.situationId)).toEqual(['sit_1', 'sit_2', 'sit_3']);

    // Assignments: the main line carries the logline, every card and the movements; a situation carries its own parts.
    const mainPlan = planPrompts.find((prompt) => prompt.includes('Title: The Weir Line'))!;
    expect(mainPlan).toContain('Role: a harbour crane operator on the Sump Row gantries');
    expect(mainPlan).toContain("The Lift That Wasn't Scheduled");
    const sidePlan = planPrompts.find((prompt) => prompt.includes('Title: Last Call at Oxide Filter'))!;
    expect(sidePlan).toContain('Voice: Precise, then suddenly plain');
    expect(sidePlan).toContain('the barista behind the counter at Oxide Filter');
    expect(sidePlan).not.toContain("The Lift That Wasn't Scheduled");

    expect(result.main.definition.steps.length).toBeGreaterThan(0);
    expect(Object.keys(result.main.cast).length).toBeGreaterThan(0);

    expect(events[0]?.kind).toBe('script');
    expect(events.filter((e) => e.kind === 'build')).not.toHaveLength(0);
    expect(events.filter((e) => e.kind === 'questline').map((e) => e.kind === 'questline' && e.questline).sort())
      .toEqual(['main', 'sit_1', 'sit_2', 'sit_3']);
  });

  it('drops a side quest that fails to build, warns, and keeps the rest of the run', async () => {
    const warnings: string[] = [];
    const result = await run(refuses('Last Call at Oxide Filter'), { warn: (message: string) => warnings.push(message) });

    expect(result.main.definition.steps.length).toBeGreaterThan(0);
    expect(result.side.map((s) => s.situationId)).toEqual(['sit_2', 'sit_3']);
    expect(warnings).toEqual([expect.stringContaining('side quest sit_1 dropped')]);
  });

  it('drops every side quest when the situations text cannot be read, and still returns the main line', async () => {
    const warnings: string[] = [];
    const result = await run({ situations: junk('not a situation list') }, { warn: (message: string) => warnings.push(message) });

    expect(result.main.definition.steps.length).toBeGreaterThan(0);
    expect(result.situations).toEqual({ situations: [], raw: 'not a situation list' });
    expect(result.side).toEqual([]);
    expect(warnings).toEqual([expect.stringContaining('every side quest dropped')]);
  });

  it('gives every character their own person and keeps a borrowed character the same person', async () => {
    const result = await run();
    const questlines = [result.main, ...result.side];
    const cast = questlines.flatMap((questline) =>
      questline.definition.roles.map((role) => ({ character: role.roleId, npcId: questline.cast[role.roleId]! })),
    );

    const byPerson = new Map<string, Set<string>>();
    for (const entry of cast) byPerson.set(entry.npcId, (byPerson.get(entry.npcId) ?? new Set()).add(entry.character));
    expect([...byPerson].filter(([, characters]) => characters.size > 1)).toEqual([]);

    // r_talis is borrowed by a side quest from the main line: one character, one person.
    const talis = cast.filter((entry) => entry.character === 'r_talis');
    expect(talis).toHaveLength(2);
    expect(new Set(talis.map((entry) => entry.npcId)).size).toBe(1);
  });

  it('keeps recorded character names without reserving or renaming the generated cast', async () => {
    const sim = new StubSimulation({ seed: 'character-name-test', world, types });
    const reserve = vi.spyOn(sim, 'reserveNPC');
    const result = await run({}, { sim });
    const authored = new Map(Object.values(RECORDING.builds).flat(2)
      .filter((call) => call.tool === 'add_role')
      .map((call) => {
        const input = call.input as { roleId: string; reservedName?: { given: string; family: string } };
        return [input.roleId, input.reservedName] as const;
      }));
    const questlines = [result.main, ...result.side];

    for (const questline of questlines) for (const role of questline.definition.roles) {
      expect(role.reservedName).toBeUndefined();
      expect(role.characterName).toEqual(authored.get(role.roleId));
      const person = sim.getNPC(questline.cast[role.roleId]!);
      if (role.characterName) expect(person.name).not.toEqual(role.characterName);
    }
    expect(reserve).not.toHaveBeenCalled();
    expect(result.main.definition.roles.find((role) => role.roleId === 'r_petra')?.characterName)
      .toEqual({ given: 'Petra', family: 'Moss' });
    expect(authored.get('r_petra')).toEqual({ given: 'Petra', family: 'Moss' });
    expect(questlines.flatMap((questline) => questline.definition.roles).find((role) => role.roleId === 'r_guard')?.characterName)
      .toBeUndefined();
  });

  it('fails the run with E_LLM when the script or the main line is unusable', async () => {
    await expect(run({ script: junk('no script') })).rejects.toThrowError(
      expect.objectContaining({ code: 'E_LLM', detail: expect.objectContaining({ stage: 'script' }) }),
    );
    await expect(run(refuses('The Weir Line'))).rejects.toThrowError(expect.objectContaining({ code: 'E_LLM' }));
  });
});

describe('materialize entry', () => {
  it('preserves Naming output and marks only a raw Atlas fallback', async () => {
    const outputDir = mkdtempSync(join(tmpdir(), 'quests-materialize-'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const named = await materialize([recordingPath, 'named', namedWorldPath, typesPath, join(outputDir, 'named', 'questlines.json')]);
      expect(named.world.meta.naming).toEqual(SOURCE_WORLD.meta.naming);
      expect(named.types.namePool.givenByGender).toEqual(SOURCE_TYPES.namePool.givenByGender);
      expect(named.questlines).toHaveLength(4);
      const assets = read<{ assetId: string; family: string; requiredInteractions: string[] }[]>(join(dirname(named.outputPath), 'mission-assets.json'));
      const bindings = read<{ questId: string; itemId: string; assetId: string }[]>(join(dirname(named.outputPath), 'mission-item-bindings.json'));
      expect(bindings).toEqual([{ questId: 'q_weir_line', itemId: 'i_drive', assetId: assets[0]!.assetId }]);
      expect(assets).toHaveLength(1);
      expect(assets[0]).toMatchObject({ family: 'data-drive', requiredInteractions: ['inspect', 'take', 'use'] });

      const atlasSource = structuredClone(SOURCE_WORLD) as { meta: { naming?: unknown }; districts: { name?: string }[] };
      delete atlasSource.meta.naming;
      delete atlasSource.districts[0]!.name;
      const atlasPath = join(outputDir, 'atlas.json');
      writeFileSync(atlasPath, JSON.stringify(atlasSource));
      const fallback = await materialize([recordingPath, 'atlas', atlasPath, typesPath, join(outputDir, 'atlas', 'questlines.json')]);

      expect(fallback.world.meta.naming).toEqual({ theme: SOURCE_TYPES.meta.theme, namedAt: 'derived-from-atlas' });
      expect(fallback.world.districts[0]!.name).toBe('commercial d0');
      expect(fallback.questlines).toHaveLength(4);
      expect(readFileSync(join(dirname(fallback.outputPath), 'mission-assets.json'), 'utf8'))
        .toBe(readFileSync(join(dirname(named.outputPath), 'mission-assets.json'), 'utf8'));
      expect(readFileSync(join(dirname(fallback.outputPath), 'questlines.meta.json'), 'utf8')).toContain('"profile": "atlas"');
    } finally {
      log.mockRestore();
      rmSync(outputDir, { recursive: true, force: true });
    }
  });

  it('keeps every place inside the parcels it is given, and stops when one has nowhere to go', async () => {
    const outputDir = mkdtempSync(join(tmpdir(), 'quests-parcels-'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      // What the assembler opened. The corporate tower the story wrote, p2, is not one of them.
      const open = ['p0', 'p1', 'p4', 'p6', 'p7', 'p10', 'p11', 'p32', 'p40'];
      const openFile = join(outputDir, 'open-parcels.json');
      writeFileSync(openFile, JSON.stringify(open));
      const run = await materialize([
        recordingPath, 'open', namedWorldPath, typesPath, join(outputDir, 'open', 'questlines.json'), `--parcels=@${openFile}`,
      ]);

      const named = run.questlines.flatMap(parcelsNamed);
      expect(named.length).toBeGreaterThan(0);
      expect([...new Set(named)].filter((id) => !open.includes(id))).toEqual([]);
      expect(named).not.toContain('p2');
      expect(run.blocked).toEqual([]);

      // The city's one clinic stayed shut, and the main line has to meet its doctor somewhere.
      await expect(
        materialize([
          recordingPath, 'shut', namedWorldPath, typesPath, join(outputDir, 'shut', 'questlines.json'),
          '--parcels=p0,p1,p4,p6,p7,p10,p11,p40',
        ]),
      ).rejects.toThrow(/main questline cannot be placed.*s_doc \(p32\)/);
    } finally {
      log.mockRestore();
      rmSync(outputDir, { recursive: true, force: true });
    }
  });
});

describe('recorded pickup appearance templates', () => {
  it('uses quest and item identities, keeps explicit assets, and refuses unrenderable pickups', () => {
    const definition = structuredClone(MAIN);
    definition.id = 'another_quest';
    const pickup = definition.steps.find((step) => step.target.kind === 'pickup')!;
    if (pickup.target.kind !== 'pickup') throw new Error('missing fixture pickup');
    const oldId = pickup.target.itemId;
    const item = definition.items.find((candidate) => candidate.itemId === oldId)!;
    item.itemId = 'another_device';
    pickup.target.itemId = item.itemId;
    for (const step of definition.steps) {
      step.gives = step.gives.map((id) => id === oldId ? item.itemId : id);
      step.needs = step.needs.map((id) => id === oldId ? item.itemId : id);
    }
    const generated = pickupAssetRequests([definition], {}, RECORDING.missionItemTemplates);
    expect(generated.missionItemBindings).toEqual([{
      questId: 'another_quest', itemId: 'another_device', assetId: generated.missionAssetRequests![0]!.assetId,
    }]);
    expect(generated.missionAssetRequests![0]!.assetId).not.toBe(
      pickupAssetRequests([MAIN], {}, RECORDING.missionItemTemplates).missionAssetRequests![0]!.assetId,
    );
    expect(new EngineHandoff().assemble([definition], generated).missionItemBindings).toEqual(generated.missionItemBindings);
    expect(pickupAssetRequests([definition], generated, {})).toEqual(generated);
    expect(() => pickupAssetRequests([definition], {}, {})).toThrowError(/no mission asset binding or device template/);
    expect(() => pickupAssetRequests([definition], { missionItemBindings: 'invalid' }, RECORDING.missionItemTemplates))
      .toThrowError(expect.objectContaining({ code: 'E_HANDOFF' }));
  });
});

describe('engine questline set', () => {
  const definition = (id: string): QuestlineDefinition => ({ ...structuredClone(MAIN), id });

  it('writes the main quest first, side quests in stable order, and drops creation-time casts', () => {
    const dir = mkdtempSync(join(tmpdir(), 'quests-set-'));
    for (const [file, id] of [['side-z.questline.json', 'side_z'], ['main.questline.json', 'main'], ['side-a.questline.json', 'side_a']]) {
      writeFileSync(join(dir, file!), JSON.stringify({ definition: definition(id!), cast: { speaker: 'npc_local' } }));
    }

    expect(questlineSetFromSample(dir).map((entry) => entry.id)).toEqual(['main', 'side_a', 'side_z']);
    const output = join(dir, 'out', 'questlines.json');
    writeQuestlineSet(dir, output);
    const written = read<unknown[]>(output);
    expect(written).toHaveLength(3);
    expect(written[0]).not.toHaveProperty('cast');
  });

  it('rejects duplicate ids and an empty payload, and publishes the schema the engine accepts', () => {
    const validator = new QuestlineSetValidator();
    expect(() => validator.validate([])).toThrowError(/at least the main/);
    expect(() => validator.validate([definition('same'), definition('same')])).toThrowError(/duplicate questline id same/);

    const ajv = new Ajv2020({ strict: true });
    ajv.addSchema(read<object>(fileURLToPath(new URL('../../flow/schema/questline.schema.json', import.meta.url))));
    const validate = ajv.compile(read<object>(fileURLToPath(new URL('../schema/questline-set.schema.json', import.meta.url))));
    expect(validate([definition('main')]), JSON.stringify(validate.errors)).toBe(true);
    expect(validate([{ ...definition('main'), unexpected: true }])).toBe(false);
  });
});
