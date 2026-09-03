import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { QuestlineSetValidator } from '../../flow/QuestlineSet.js';
import type { QuestlineDefinition } from '../../flow/schema.js';
import { questlineSetFromSample, writeQuestlineSet } from '../samples/QuestlineSetWriter.js';

function definition(id: string): QuestlineDefinition {
  return {
    id,
    title: id,
    premise: 'A complete small story.',
    roles: [{ roleId: 'speaker', npcType: 'cafe_barista', persona: 'Needs the truth recorded.' }],
    items: [],
    facts: [],
    acts: [{ actId: 'opening', title: 'Opening', summary: 'The question is asked.' }],
    steps: [
      {
        stepId: 'ask',
        actId: 'opening',
        narrative: { description: 'Ask.', playerHint: 'Talk.', stake: 'Silence leaves the lie intact.' },
        wantedByRoleId: 'speaker',
        target: { kind: 'talk', roleId: 'speaker' },
        gives: [],
        needs: [],
        conditions: [],
        effects: [],
        next: [],
        branching: 'parallel',
        endingId: 'answered',
      },
    ],
    endings: [{ endingId: 'answered', title: 'Answered', epilogue: 'The answer is recorded.' }],
    flags: [],
    entryStepIds: ['ask'],
  };
}

describe('engine questline set', () => {
  it('writes the main quest first, side quests in stable order, and drops creation-time casts', () => {
    const dir = mkdtempSync(join(tmpdir(), 'quests-set-'));
    const writeSample = (file: string, def: QuestlineDefinition) =>
      writeFileSync(join(dir, file), JSON.stringify({ definition: def, cast: { speaker: 'npc_local' } }));
    writeSample('side-z.questline.json', definition('side_z'));
    writeSample('main.questline.json', definition('main'));
    writeSample('side-a.questline.json', definition('side_a'));

    expect(questlineSetFromSample(dir).map((entry) => entry.id)).toEqual(['main', 'side_a', 'side_z']);
    const output = join(dir, 'out', 'questlines.json');
    writeQuestlineSet(dir, output);
    const written = JSON.parse(readFileSync(output, 'utf8')) as unknown[];
    expect(written).toHaveLength(3);
    expect(written[0]).not.toHaveProperty('cast');
  });

  it('rejects duplicate ids and an empty game payload', () => {
    const validator = new QuestlineSetValidator();
    expect(() => validator.validate([])).toThrowError(/at least the main/);
    expect(() => validator.validate([definition('same'), definition('same')])).toThrowError(/duplicate questline id same/);
  });

  it('publishes an exact JSON schema accepted by the engine payload', () => {
    const questlineSchema = JSON.parse(
      readFileSync(new URL('../../flow/schema/questline.schema.json', import.meta.url), 'utf8'),
    ) as object;
    const setSchema = JSON.parse(
      readFileSync(new URL('../schema/questline-set.schema.json', import.meta.url), 'utf8'),
    ) as object;
    const ajv = new Ajv2020({ strict: true });
    ajv.addSchema(questlineSchema);
    const validate = ajv.compile(setSchema);

    expect(validate([definition('main')]), JSON.stringify(validate.errors)).toBe(true);
    const withUnknown = { ...definition('main'), unexpected: true };
    expect(validate([withUnknown])).toBe(false);
    for (const size of ['small', 'medium', 'large']) {
      const payload = JSON.parse(readFileSync(new URL(`../samples/games/${size}/questlines.json`, import.meta.url), 'utf8'));
      expect(validate(payload), `${size}: ${JSON.stringify(validate.errors)}`).toBe(true);
    }
  });

  it('ships deterministic small, medium and large game sets with the full story shape', () => {
    const validator = new QuestlineSetValidator();
    for (const size of ['small', 'medium', 'large']) {
      const payload = JSON.parse(
        readFileSync(new URL(`../samples/games/${size}/questlines.json`, import.meta.url), 'utf8'),
      ) as QuestlineDefinition[];
      validator.validate(payload);
      expect(payload).toHaveLength(4);
      expect(payload[0]).toMatchObject({ id: 'q_weir_line' });
      expect(payload[0]!.acts.map((act) => act.actId)).toEqual(['a1_grief', 'a2_glass', 'a3_board', 'a4_choice']);
      expect(payload[0]!.endings).toHaveLength(2);
      expect(payload[0]!.steps.find((step) => step.stepId === 's_listen')).toMatchObject({ branching: 'parallel' });
      expect(payload.slice(1).every((questline) => questline.steps.length === 5)).toBe(true);
      expect(new Set(payload.flatMap((questline) => questline.steps.map((step) => step.target.kind)))).toEqual(
        new Set(['goto', 'observe', 'talk', 'listen', 'pickup', 'deliver', 'steal', 'work']),
      );
    }
  });
});
