/**
 * The questline creation workflow, from one creation prompt:
 * 1. script pass, text only: the whole story as a film script;
 * 2. translation of the script into the main questline (plan, then build);
 * 3. in parallel with 2, situations pass from the script, each situation
 *    translated into a side questline the same way.
 */

import type { QuestAssignment } from '../builder/schema.js';
import { playableKinds } from '../builder/mechanics.js';
import { QuestlineTranslator } from '../builder/QuestlineTranslator.js';
import { QuestError } from '../errors.js';
import { ScriptPass } from '../story/ScriptPass.js';
import { SituationsPass } from '../story/SituationsPass.js';
import type { SituationsPassResult } from '../story/schema.js';
import { Assignments } from './Assignments.js';
import { UniqueCast } from './UniqueCast.js';
import type { CreationInput, CreationProgress, CreationResult, SideQuest } from './schema.js';

export class QuestlineCreation {
  async run(input: CreationInput): Promise<CreationResult> {
    const { world, types, sim, ports, parcels, referenceTimeMin, maxRounds } = input;
    // An allowlist naming no real kind fails here, before any model is asked.
    const mechanics = input.mechanics === undefined ? undefined : playableKinds(input.mechanics);
    const progress = (event: CreationProgress) => input.progress?.(event);
    const script = await new ScriptPass().run({ world, types, llm: ports.script, prompt: input.prompt, minimums: input.minimums?.script });
    progress({ kind: 'script', result: script });
    const assignments = new Assignments(script.script);
    const translator = new QuestlineTranslator();
    const translate = async (questline: 'main' | string, assignment: QuestAssignment) => {
      const result = await translator.translate({
        assignment, world, types, sim, parcels, mechanics, referenceTimeMin, maxRounds,
        ports: { plan: ports.plan, build: ports.build },
        progress: (build) => progress({ kind: 'build', questline, build }),
      });
      progress({ kind: 'questline', questline, result });
      return result;
    };

    /** A situations text that cannot be read costs the side quests, not the run: the main line is the product. */
    const runSituations = async (): Promise<SituationsPassResult> => {
      try {
        return await new SituationsPass().run({ script: script.script, world, types, llm: ports.situations, minimums: input.minimums?.situations });
      } catch (error) {
        if (!(error instanceof QuestError) || error.code !== 'E_LLM') throw error;
        input.warn?.(`every side quest dropped: ${error.message}`);
        return { situations: [], raw: (error.detail as { raw?: string } | undefined)?.raw ?? '' };
      }
    };

    const sideQuests = async (): Promise<{ situations: CreationResult['situations']; side: SideQuest[] }> => {
      const situations = await runSituations();
      progress({ kind: 'situations', result: situations });
      // A side quest that fails to build is dropped with a word to the caller; the main line is the product.
      const settled = await Promise.allSettled(
        situations.situations.map(async (situation) => ({
          situationId: situation.situationId,
          ...(await translate(situation.situationId, assignments.situation(situation))),
        })),
      );
      const side: SideQuest[] = [];
      settled.forEach((outcome, i) => {
        if (outcome.status === 'fulfilled') side.push(outcome.value);
        else input.warn?.(`side quest ${situations.situations[i]!.situationId} dropped: ${String(outcome.reason)}`);
      });
      return { situations, side };
    };

    const [built, { situations, side: builtSide }] = await Promise.all([translate('main', assignments.main()), sideQuests()]);
    // Questlines are known by id across the set; a side quest built under an id already taken is dropped, not the set.
    const taken = new Set([built.definition.id]);
    const distinct = builtSide.filter((quest) => {
      const free = !taken.has(quest.definition.id);
      if (free) taken.add(quest.definition.id);
      else input.warn?.(`side quest ${quest.situationId} dropped: questline id ${quest.definition.id} is already taken`);
      return free;
    });
    const { main, side } = new UniqueCast({ world, types, sim, parcels, referenceTimeMin, warn: input.warn }).apply(built, distinct);
    return { script, situations, main, side };
  }
}
