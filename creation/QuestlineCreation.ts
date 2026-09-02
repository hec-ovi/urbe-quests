/**
 * The questline creation workflow, from one creation prompt:
 * 1. script pass, text only: the whole story as a film script;
 * 2. translation of the script into the main questline (plan, then build);
 * 3. in parallel with 2, situations pass from the script, each situation
 *    translated into a side questline the same way.
 */

import type { QuestAssignment } from '../builder/schema.js';
import { QuestlineTranslator } from '../builder/QuestlineTranslator.js';
import { ScriptPass } from '../story/ScriptPass.js';
import { SituationsPass } from '../story/SituationsPass.js';
import { Assignments } from './Assignments.js';
import type { CreationInput, CreationResult, SideQuest } from './schema.js';

export class QuestlineCreation {
  async run(input: CreationInput): Promise<CreationResult> {
    const { world, types, sim, ports } = input;
    const script = await new ScriptPass().run({
      world,
      types,
      llm: ports.script,
      prompt: input.prompt,
      ...(input.minimums?.script !== undefined ? { minimums: input.minimums.script } : {}),
    });
    const assignments = new Assignments(script.script);
    const translator = new QuestlineTranslator();
    const translate = (assignment: QuestAssignment) =>
      translator.translate({
        assignment,
        world,
        types,
        sim,
        ports: { plan: ports.plan, build: ports.build },
        ...(input.referenceTimeMin !== undefined ? { referenceTimeMin: input.referenceTimeMin } : {}),
        ...(input.maxRounds !== undefined ? { maxRounds: input.maxRounds } : {}),
      });

    const sideQuests = async (): Promise<{ situations: CreationResult['situations']; side: SideQuest[] }> => {
      const situations = await new SituationsPass().run({
        script: script.script,
        world,
        types,
        llm: ports.situations,
        ...(input.minimums?.situations !== undefined ? { minimums: input.minimums.situations } : {}),
      });
      // A side quest that fails to build is dropped with a word to the caller; the main line is the product.
      const settled = await Promise.allSettled(
        situations.situations.map(async (situation) => ({
          situationId: situation.situationId,
          ...(await translate(assignments.situation(situation))),
        })),
      );
      const side: SideQuest[] = [];
      settled.forEach((outcome, i) => {
        if (outcome.status === 'fulfilled') side.push(outcome.value);
        else input.warn?.(`side quest ${situations.situations[i]!.situationId} dropped: ${String(outcome.reason)}`);
      });
      return { situations, side };
    };

    const [main, { situations, side }] = await Promise.all([translate(assignments.main()), sideQuests()]);
    return { script, situations, main, side };
  }
}
