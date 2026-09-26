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
import { QuestlineRuntime } from '../../flow/QuestlineRuntime.js';
import type { PlayerEvent } from '../../flow/events.js';
import type { QuestlineDefinition } from '../../flow/schema.js';
import { StubSimulation, WorldContextNormalizer, type NamedWorld, type NPCTypeSet } from '../../world/index.js';
import { QuestlineCreation } from '../QuestlineCreation.js';
import { questlineSetFromSample, writeQuestlineSet } from '../samples/QuestlineSetWriter.js';
import { materialize, materializeRecording } from '../samples/materialize.js';
import { recordedPorts, type Recording } from '../samples/RecordedPorts.js';
import type { CreationProgress, StagePorts } from '../schema.js';
import { checkMissionItemTemplates, pickupAssetRequests } from '../samples/PickupAssetRequests.js';
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

  it('plays every recorded conversation offline through both main endings and all side endings, preserving saves', async () => {
    const sim = new StubSimulation({ seed: 'recorded-dialogue-test', world, types });
    const result = await run({}, { sim });
    const authored = [result.main, ...result.side];
    expect(authored.flatMap((quest) => quest.definition.steps).filter((step) => step.dialogue)).toHaveLength(15);
    expect(authored.flatMap((quest) => quest.definition.steps.flatMap((step) => step.dialogue?.choices ?? [])))
      .toHaveLength(32);

    // A host's appointment projection: the exact cast is physically present at the current authored target.
    let currentParcel = 'p0';
    vi.spyOn(sim, 'behaviorAt').mockImplementation(() => ({
      mode: 'interior', activity: 'working', place: { kind: 'parcel', id: currentParcel }, interrupted: false,
    }));
    const journeys = [
      { quest: result.main, endingStepId: 's_expose', endingId: 'e_on_record' },
      { quest: result.main, endingStepId: 's_sellout', endingId: 'e_payout' },
      ...result.side.map((quest) => ({ quest, endingStepId: '', endingId: quest.definition.endings[0]!.endingId })),
    ];
    for (const { quest, endingStepId, endingId } of journeys) {
      let runtime = new QuestlineRuntime(quest.definition, quest.cast, sim);
      for (let count = 0; count < 25 && runtime.status() !== 'completed'; count++) {
        const steps = runtime.activeSteps();
        const step = steps.find((candidate) => candidate.stepId === endingStepId) ?? steps[0]!;
        const target = step.target;
        const timeMin = step.window === undefined ? 600 : step.window.days[0]! * 1440 + step.window.startMin;
        if ((target.kind === 'talk' || target.kind === 'listen') && target.atParcelId !== undefined) {
          currentParcel = target.atParcelId;
        }
        if (target.kind === 'talk') {
          expect(step.dialogue, `${quest.definition.id}/${step.stepId}`).toBeDefined();
          const npcId = quest.cast[target.roleId]!;
          const before = runtime.serialize();
          const dialogue = runtime.dialogueFor(step.stepId, npcId, timeMin)!;
          expect(dialogue.characterName).toEqual(quest.definition.roles.find((role) => role.roleId === target.roleId)?.characterName);
          expect(dialogue.opening).not.toBe(step.narrative.description);
          for (const question of dialogue.choices.filter((choice) => !choice.completesStep)) {
            expect(runtime.chooseDialogue(step.stepId, npcId, question.id, timeMin)).toEqual({ accepted: true, reply: question.reply });
            expect(runtime.serialize()).toEqual(before);
          }
          const commitment = dialogue.choices.find((choice) => choice.completesStep)!;
          expect(runtime.chooseDialogue(step.stepId, npcId, commitment.id, timeMin)).toMatchObject({
            accepted: true, reply: commitment.reply, advanceResult: { completedStepIds: [step.stepId] },
          });
        } else {
          let event: PlayerEvent;
          switch (target.kind) {
            case 'goto': event = { kind: 'arrivedAt', ...target.place }; break;
            case 'pickup': event = { kind: 'pickedUp', itemId: target.itemId }; break;
            case 'observe': event = { kind: 'observed', districtId: target.districtId }; break;
            case 'listen': event = { kind: 'overheard', npcIds: target.roleIds.map((role) => quest.cast[role]!) }; break;
            case 'steal': event = { kind: 'stole', itemId: target.itemId }; break;
            case 'work': event = { kind: 'workedShift', parcelId: target.atParcelId }; break;
            case 'deliver': event = { kind: 'delivered', itemId: target.itemId, ...target.place }; break;
            default: throw new Error(`Uncovered recorded mechanic: ${target.kind}`);
          }
          runtime.advance(event, timeMin);
        }
        runtime = QuestlineRuntime.restore(quest.definition, quest.cast, sim, runtime.serialize());
      }
      expect(runtime.ending()?.endingId).toBe(endingId);
      expect(runtime.activeSteps()).toEqual([]);
    }
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

  it('drops a side quest built under a questline id the set already holds, and keeps the rest', async () => {
    const recorded = recordedPorts(RECORDING, world);
    const warnings: string[] = [];
    const result = await run({
      build: {
        step: async (request) => {
          const reply = await recorded.build.step(request);
          if (reply.kind !== 'calls' || !request.prompt.includes('Title: Signal Under Sump Row')) return reply;
          return { kind: 'calls', calls: reply.calls.map((call) => call.tool === 'create_questline' ? { ...call, input: { ...(call.input as object), id: MAIN.id } } : call) };
        },
      },
    }, { warn: (message: string) => warnings.push(message) });

    expect(result.side.map((quest) => quest.situationId)).toEqual(['sit_1', 'sit_3']);
    expect(warnings).toEqual([`side quest sit_2 dropped: questline id ${MAIN.id} is already taken`]);
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
      expect(named.questlines.flatMap((quest) => quest.steps).filter((step) => step.dialogue)).toHaveLength(15);
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

describe('mechanic allowlist on a recording', () => {
  const materializeWith = async (mechanics: Recording['mechanics'], warn: string[] = []) => {
    const outputDir = mkdtempSync(join(tmpdir(), 'quests-mechanics-'));
    try {
      return await materializeRecording({
        world, types, recording: { ...RECORDING, mechanics }, recordingName: 'recording.json', typesName: 'npc-types.json',
        profile: 'mechanics', outputPath: join(outputDir, 'questlines.json'), log: (line) => warn.push(line),
      });
    } finally {
      rmSync(outputDir, { recursive: true, force: true });
    }
  };

  it('replays the allowlist it was made under: the host set keeps every questline, a narrower one refuses what it bans', async () => {
    const playable = await materializeWith(['goto', 'observe', 'talk', 'listen', 'pickup', 'deliver', 'steal', 'work']);
    expect(playable.questlines).toHaveLength(4);

    // Last Call at Oxide Filter turns on a theft; without steal the builder is refused that step and the side quest is dropped.
    const warnings: string[] = [];
    const narrow = await materializeWith(['goto', 'observe', 'talk', 'listen', 'pickup', 'deliver', 'work'], warnings);
    expect(narrow.questlines.map((quest) => quest.title)).not.toContain('Last Call at Oxide Filter');
    expect(narrow.questlines).toHaveLength(3);
    expect(warnings).toContainEqual(expect.stringContaining('side quest sit_1 dropped'));
  });

  it('refuses an allowlist naming no step kind before any model is asked', async () => {
    const script = vi.fn(async () => RECORDING.script);
    await expect(run({ script: { complete: script } }, { mechanics: ['goto', 'teleport'] })).rejects.toThrowError(/unknown step kind teleport/);
    expect(script).not.toHaveBeenCalled();
  });
});

describe('recorded pickup appearance templates', () => {
  it('ships one checked template per physical item kind, each a pickup the handoff accepts', () => {
    const templates = checkMissionItemTemplates(read(fileURLToPath(new URL('../samples/mission-item-templates.json', import.meta.url))));
    expect(Object.keys(templates).sort()).toEqual(['device', 'document', 'key', 'substance', 'valuable', 'weapon']);
    expect(templates.device).toEqual(RECORDING.missionItemTemplates!.device);

    // The recorded main line once per kind, its one pickup made of that kind.
    const pickedUp = (MAIN.steps.find((step) => step.target.kind === 'pickup')!.target as { itemId: string }).itemId;
    const definitions = Object.keys(templates).map((kind) => {
      const definition = structuredClone(MAIN);
      definition.id = `q_${kind}`;
      definition.items.find((item) => item.itemId === pickedUp)!.kind = kind as keyof typeof templates;
      return definition;
    });
    const bundle = new EngineHandoff().assemble(definitions, pickupAssetRequests(definitions, {}, templates));
    const families = new Map(bundle.missionAssetRequests.map((request) => [request.assetId, request.family]));
    expect(Object.fromEntries(bundle.missionItemBindings.map((binding) => [binding.questId, families.get(binding.assetId)]))).toEqual({
      q_device: 'data-drive', q_weapon: 'tool', q_document: 'document', q_key: 'data-drive', q_substance: 'package', q_valuable: 'package',
    });
  });

  it('refuses a template for no physical kind, one the creator would reject, and one nobody can pick up', () => {
    const device = RECORDING.missionItemTemplates!.device!;
    expect(() => checkMissionItemTemplates({ information: device })).toThrowError(/no physical item kind: information/);
    expect(() => checkMissionItemTemplates({ device: { ...device, materials: [{ slot: 'surface', key: 'cyberpunk/fabric/mid', variantId: 'flat' }] } }))
      .toThrowError(/cannot use fabric material on its surface/);
    expect(() => checkMissionItemTemplates({ device: { ...device, requiredInteractions: ['inspect', 'use'] } }))
      .toThrowError(/cannot pick up: device/);
  });

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
