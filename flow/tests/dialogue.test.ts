import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { loadFixtureWorld, StubSimulation } from '../../world/index.js';
import { QuestlineRuntime } from '../QuestlineRuntime.js';
import type { QuestlineDefinition, QuestStep, QuestStepDialogue } from '../schema.js';
import questlineSchema from '../schema/questline.schema.json' with { type: 'json' };
import { FlowValidator } from '../validate.js';

const TUE_10 = 1440 + 600;
const TUE_03 = 1440 + 180;
const TUE_20 = 1440 + 1200;

function dialogue(subject: string): QuestStepDialogue {
  return {
    opening: `We need to discuss ${subject}.`,
    choices: [
      { id: 'ask', text: 'Why does this matter?', reply: `There is more to ${subject}.`, completesStep: false },
      { id: 'commit', text: `I agree to ${subject}.`, reply: `Then ${subject} is settled.`, completesStep: true },
    ],
  };
}

function talk(input: Partial<QuestStep> & Pick<QuestStep, 'stepId'>): QuestStep {
  return {
    actId: 'a1',
    narrative: { description: 'A clerk has a difficult decision.', playerHint: 'Hear the clerk out.', stake: 'Her job is at risk.' },
    target: { kind: 'talk', roleId: 'clerk', atParcelId: 'p4' },
    dialogue: dialogue(input.stepId),
    gives: [], needs: [], conditions: [], effects: [], next: [], branching: 'parallel',
    ...input,
  };
}

/** Two active talks share one cast person; either final decision ends the quest. */
function definition(): QuestlineDefinition {
  return {
    id: 'q_dialogue', title: 'The Missing Ledger', premise: 'A clerk decides what to do with evidence.',
    roles: [{ roleId: 'clerk', npcType: 'cafe_barista', persona: 'Careful and direct.', characterName: { given: 'Inez', family: 'Vale' } }],
    items: [
      { itemId: 'lead', name: 'Ledger location', description: 'The clerk knows where it is.', kind: 'information' },
      { itemId: 'ledger', name: 'Ledger', description: 'The original records.', kind: 'document', atParcelId: 'p7' },
    ],
    facts: [], acts: [{ actId: 'a1', title: 'A decision', summary: 'Choose what happens to the evidence.' }],
    steps: [
      talk({
        stepId: 'briefing', gives: ['lead'],
        effects: [{ kind: 'setFlag', flag: 'briefed' }, { kind: 'simFlag', roleId: 'clerk', op: { kind: 'custom', tag: 'briefing_committed' } }],
        next: [{ toStepId: 'publish', when: [] }, { toStepId: 'conceal', when: [] }],
      }),
      talk({ stepId: 'other_lead', effects: [{ kind: 'setFlag', flag: 'other_done' }], next: [{ toStepId: 'publish', when: [] }] }),
      talk({ stepId: 'publish', endingId: 'public' }),
      talk({ stepId: 'conceal', endingId: 'hidden' }),
    ],
    endings: [
      { endingId: 'public', title: 'On the Record', epilogue: 'The ledger becomes public.' },
      { endingId: 'hidden', title: 'A Kept Secret', epilogue: 'The clerk keeps the evidence safe.' },
    ],
    flags: ['briefed', 'other_done'], entryStepIds: ['briefing', 'other_lead'],
  };
}

function setup(def = definition()) {
  const { world, types } = loadFixtureWorld('neon-bay');
  const sim = new StubSimulation({ seed: 'dialogue-test', world, types });
  const clerk = sim.getNPCVendor({ type: 'cafe_barista', timeMin: TUE_10 });
  const other = sim.reserveNPC({ name: { given: 'Other', family: 'Clerk' }, type: 'cafe_barista', jobParcelId: 'p4' });
  const runtime = new QuestlineRuntime(def, { clerk: clerk.npcId }, sim);
  const snapshot = () => ({
    state: runtime.serialize(), inventory: [...runtime.inventory()], status: runtime.status(),
    npcFlags: structuredClone(sim.getNPC(clerk.npcId).flags),
  });
  return { runtime, sim, npcId: clerk.npcId, wrongNpcId: other.npcId, snapshot };
}

describe('quest dialogue runtime', () => {
  it('opens repeatedly without state changes and returns independent dialogue data', () => {
    const { runtime, npcId, snapshot } = setup();
    const before = snapshot();
    const expected = {
      ...dialogue('briefing'), questlineId: 'q_dialogue', stepId: 'briefing', roleId: 'clerk', npcId,
      characterName: { given: 'Inez', family: 'Vale' }, availability: { available: true },
    };
    for (let i = 0; i < 3; i++) expect(runtime.dialogueFor('briefing', npcId, TUE_10)).toEqual(expected);
    const opened = runtime.dialogueFor('briefing', npcId, TUE_10)!;
    opened.choices[0]!.reply = 'Changed by the caller';
    opened.choices[0]!.completesStep = true;
    opened.characterName!.given = 'Changed';
    opened.availability.available = false;
    expect(runtime.dialogueFor('briefing', npcId, TUE_10)).toEqual(expected);
    expect(snapshot()).toEqual(before);
  });

  it('answers noncommitting questions repeatedly without granting items or applying effects', () => {
    const { runtime, npcId, snapshot } = setup();
    const before = snapshot();
    for (let i = 0; i < 3; i++) {
      expect(runtime.chooseDialogue('briefing', npcId, 'ask', TUE_10)).toEqual({
        accepted: true, reply: 'There is more to briefing.',
      });
      expect(snapshot()).toEqual(before);
    }
    expect(runtime.dialogueFor('briefing', npcId, TUE_10)).toBeDefined();
  });

  it('commits only the selected step when two active talks use the same NPC', () => {
    const { runtime, sim, npcId } = setup();
    expect(runtime.chooseDialogue('briefing', npcId, 'commit', TUE_10)).toEqual({
      accepted: true, reply: 'Then briefing is settled.',
      advanceResult: { completedStepIds: ['briefing'], activatedStepIds: ['publish', 'conceal'] },
    });
    expect(runtime.serialize()).toEqual({
      activeStepIds: ['other_lead', 'publish', 'conceal'], completedStepIds: ['briefing'], flags: ['briefed'],
    });
    expect(runtime.inventory()).toEqual(new Set(['lead']));
    expect(sim.getNPC(npcId).flags.custom).toContain('briefing_committed');
    expect(runtime.dialogueFor('other_lead', npcId, TUE_10)).toBeDefined();
    expect(runtime.flags().has('other_done')).toBe(false);
  });

  it('rejects missing, inactive, wrong-cast and unknown-choice requests without mutation', () => {
    const { runtime, npcId, wrongNpcId, snapshot } = setup();
    const before = snapshot();
    for (const [stepId, castId, choiceId, reason] of [
      ['missing', npcId, 'commit', 'stale'],
      ['publish', npcId, 'commit', 'stale'],
      ['briefing', wrongNpcId, 'commit', 'wrong_npc'],
      ['briefing', npcId, 'invented_choice', 'unknown_choice'],
    ]) {
      expect(runtime.chooseDialogue(stepId!, castId!, choiceId!, TUE_10)).toEqual({ accepted: false, reason });
      expect(snapshot()).toEqual(before);
    }
    expect(runtime.dialogueFor('briefing', wrongNpcId, TUE_10)).toBeUndefined();
    expect(runtime.dialogueFor('publish', npcId, TUE_10)).toBeUndefined();
    expect(runtime.dialogueFor('missing', npcId, TUE_10)).toBeUndefined();

    runtime.chooseDialogue('briefing', npcId, 'commit', TUE_10);
    const afterCommit = snapshot();
    expect(runtime.chooseDialogue('briefing', npcId, 'commit', TUE_10)).toEqual({ accepted: false, reason: 'stale' });
    expect(runtime.dialogueFor('briefing', npcId, TUE_10)).toBeUndefined();
    expect(snapshot()).toEqual(afterCommit);
  });

  it.each([
    { reason: 'off_duty', time: TUE_20, change: (_step: QuestStep) => {} },
    { reason: 'not_present', time: TUE_03, change: (_step: QuestStep) => {} },
    { reason: 'missing_item', time: TUE_10, change: (step: QuestStep) => { step.needs = ['ledger']; } },
    { reason: 'condition', time: TUE_10, change: (step: QuestStep) => { step.conditions = [{ kind: 'flagSet', flag: 'other_done' }]; } },
    { reason: 'outside_window', time: TUE_10, change: (step: QuestStep) => {
      step.window = { label: 'appointment', days: [1], startMin: 660, endMin: 720 };
    } },
  ])('reports $reason and rejects both kinds of choice without mutation', ({ reason, time, change }) => {
    const def = definition();
    change(def.steps[0]!);
    const { runtime, npcId, snapshot } = setup(def);
    const before = snapshot();
    expect(runtime.dialogueFor('briefing', npcId, time)?.availability).toEqual({ available: false, reason });
    for (const choiceId of ['ask', 'commit']) {
      expect(runtime.chooseDialogue('briefing', npcId, choiceId, time)).toEqual({
        accepted: false, reason: 'unavailable', availability: { available: false, reason },
      });
      expect(snapshot()).toEqual(before);
    }
  });

  it('rechecks presence and liveness after an available dialogue has opened', () => {
    const { runtime, sim, npcId, snapshot } = setup();
    expect(runtime.dialogueFor('briefing', npcId, TUE_10)?.availability).toEqual({ available: true });
    const before = snapshot();
    expect(runtime.chooseDialogue('briefing', npcId, 'commit', TUE_20)).toEqual({
      accepted: false, reason: 'unavailable', availability: { available: false, reason: 'off_duty' },
    });
    expect(snapshot()).toEqual(before);
    sim.applyFlag(npcId, { kind: 'die' });
    const afterDeath = snapshot();
    expect(runtime.chooseDialogue('briefing', npcId, 'commit', TUE_10)).toEqual({
      accepted: false, reason: 'unavailable', availability: { available: false, reason: 'role_dead' },
    });
    expect(snapshot()).toEqual(afterDeath);
  });

  it.each([['publish', 'public'], ['conceal', 'hidden']])('chooses the %s ending and clears competing active steps', (stepId, endingId) => {
    const { runtime, npcId, snapshot } = setup();
    runtime.chooseDialogue('briefing', npcId, 'commit', TUE_10);
    expect(runtime.chooseDialogue(stepId, npcId, 'commit', TUE_10)).toEqual({
      accepted: true, reply: `Then ${stepId} is settled.`,
      advanceResult: { completedStepIds: [stepId], activatedStepIds: [], endingId },
    });
    expect(runtime.activeSteps()).toEqual([]);
    expect(runtime.status()).toBe('completed');
    expect(runtime.ending()?.endingId).toBe(endingId);
    const ended = snapshot();
    for (const staleStep of ['other_lead', 'publish', 'conceal']) {
      expect(runtime.dialogueFor(staleStep, npcId, TUE_10)).toBeUndefined();
      expect(runtime.chooseDialogue(staleStep, npcId, 'commit', TUE_10)).toEqual({ accepted: false, reason: 'stale' });
    }
    expect(snapshot()).toEqual(ended);
  });

  it('does not let a raw talkedTo event bypass authored choices', () => {
    const { runtime, npcId, snapshot } = setup();
    const before = snapshot();
    expect(() => runtime.advance({ kind: 'talkedTo', npcId }, TUE_10)).toThrowError(
      expect.objectContaining({ code: 'E_WRONG_STATE' }),
    );
    expect(snapshot()).toEqual(before);
  });

  it('keeps legacy definitions playable through deterministic fallback dialogue', () => {
    const def = definition();
    for (const step of def.steps) delete step.dialogue;
    const { runtime, npcId, snapshot } = setup(def);
    const before = snapshot();
    const opened = runtime.dialogueFor('briefing', npcId, TUE_10)!;
    expect(opened.opening).toContain(def.title);
    expect(opened.choices.map(({ id, completesStep }) => ({ id, completesStep }))).toEqual([
      { id: 'ask_details', completesStep: false }, { id: 'resolve', completesStep: true },
    ]);
    expect(runtime.chooseDialogue('briefing', npcId, 'ask_details', TUE_10)).toEqual({
      accepted: true, reply: def.steps[0]!.narrative.stake,
    });
    expect(snapshot()).toEqual(before);
    expect(runtime.chooseDialogue('briefing', npcId, 'resolve', TUE_10)).toMatchObject({
      accepted: true, advanceResult: { completedStepIds: ['briefing'], activatedStepIds: ['publish', 'conceal'] },
    });
    expect(runtime.chooseDialogue('publish', npcId, 'resolve', TUE_10)).toEqual({
      accepted: true, reply: def.endings[0]!.epilogue,
      advanceResult: { completedStepIds: ['publish'], activatedStepIds: [], endingId: 'public' },
    });
  });
});

describe('authored dialogue validation', () => {
  it('accepts valid dialogue, NPC lines with cues and legacy steps with no dialogue', () => {
    const validator = new FlowValidator();
    expect(() => validator.validate(definition())).not.toThrow();
    const cued = definition();
    cued.steps[0]!.dialogue!.opening = '[sigh] We need to talk.';
    cued.steps[0]!.dialogue!.choices[1]!.reply = 'Then it is settled. [whisper] Tell no one.';
    expect(() => validator.validate(cued)).not.toThrow();
    const legacy = definition();
    for (const step of legacy.steps) delete step.dialogue;
    expect(() => validator.validate(legacy)).not.toThrow();
  });

  it.each<{ name: string; change: (step: QuestStep) => void }>([
    { name: 'empty opening', change: (step) => { step.dialogue!.opening = ''; } },
    { name: 'blank opening', change: (step) => { step.dialogue!.opening = ' \n '; } },
    { name: 'empty choices', change: (step) => { step.dialogue!.choices = []; } },
    { name: 'duplicate choice ids', change: (step) => { step.dialogue!.choices[1]!.id = 'ask'; } },
    { name: 'blank choice id', change: (step) => { step.dialogue!.choices[0]!.id = ' '; } },
    { name: 'blank player text', change: (step) => { step.dialogue!.choices[0]!.text = ' '; } },
    { name: 'blank NPC reply', change: (step) => { step.dialogue!.choices[0]!.reply = ' '; } },
    { name: 'an opening of cues alone', change: (step) => { step.dialogue!.opening = '[sigh] '; } },
    { name: 'a stage direction in a reply', change: (step) => { step.dialogue!.choices[0]!.reply = 'Fine. [nods]'; } },
    { name: 'a cue in the player text', change: (step) => { step.dialogue!.choices[0]!.text = '[sigh] Why?'; } },
    { name: 'no committing choice', change: (step) => { step.dialogue!.choices[1]!.completesStep = false; } },
    { name: 'dialogue on a non-talk step', change: (step) => { step.target = { kind: 'observe', districtId: 'd1' }; } },
  ])('rejects $name', ({ change }) => {
    const def = definition();
    change(def.steps[0]!);
    expect(() => new FlowValidator().validate(def)).toThrowError(expect.objectContaining({ code: 'E_INVALID_FLOW' }));
  });

  const validateJson = new Ajv2020({ strict: true }).compile(questlineSchema);

  it('accepts authored and legacy definitions through the JSON schema', () => {
    expect(validateJson(definition()), JSON.stringify(validateJson.errors)).toBe(true);
    const legacy = definition();
    for (const step of legacy.steps) delete step.dialogue;
    expect(validateJson(legacy), JSON.stringify(validateJson.errors)).toBe(true);
  });

  const committingChoice = { id: 'agree', text: 'I agree.', reply: 'Thank you.', completesStep: true };
  it.each([
    { name: 'unknown dialogue field', value: { opening: 'Hello.', choices: [committingChoice], hiddenEffect: 'grant_item' } },
    { name: 'unknown choice field', value: { opening: 'Hello.', choices: [{ ...committingChoice, nextStep: 'publish' }] } },
    { name: 'non-string opening', value: { opening: 42, choices: [committingChoice] } },
    { name: 'empty opening', value: { opening: '', choices: [committingChoice] } },
    { name: 'missing choices', value: { opening: 'Hello.' } },
    { name: 'non-array choices', value: { opening: 'Hello.', choices: committingChoice } },
    { name: 'empty choices', value: { opening: 'Hello.', choices: [] } },
    { name: 'null choice', value: { opening: 'Hello.', choices: [null, committingChoice] } },
    { name: 'missing reply', value: { opening: 'Hello.', choices: [{ id: 'agree', text: 'I agree.', completesStep: true }] } },
    { name: 'non-string player text', value: { opening: 'Hello.', choices: [{ ...committingChoice, text: 42 }] } },
    { name: 'non-boolean commitment', value: { opening: 'Hello.', choices: [{ ...committingChoice, completesStep: 'true' }] } },
    { name: 'no committing choice', value: { opening: 'Hello.', choices: [{ ...committingChoice, completesStep: false }] } },
  ])('rejects $name in JSON', ({ value }) => {
    const def = definition();
    const input = { ...def, steps: [{ ...def.steps[0]!, dialogue: value }, ...def.steps.slice(1)] };
    expect(validateJson(input)).toBe(false);
  });

  it('rejects dialogue attached to a non-talk target in JSON', () => {
    const def = definition();
    def.steps[0]!.target = { kind: 'observe', districtId: 'd1' };
    expect(validateJson(def)).toBe(false);
  });
});
