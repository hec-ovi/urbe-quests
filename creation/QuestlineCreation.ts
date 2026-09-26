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
import type { StepKind } from '../flow/schema.js';
import type { SceneryCapabilities } from '../handoff/schema.js';
import { ScriptPass } from '../story/ScriptPass.js';
import { SituationsPass } from '../story/SituationsPass.js';
import type { SituationsPassResult } from '../story/schema.js';
import type { NamedWorld } from '../world/types/named-world.js';
import { Assignments } from './Assignments.js';
import { UniqueCast } from './UniqueCast.js';
import type { CreationInput, CreationProgress, CreationResult, SideQuest } from './schema.js';

/**
 * The buildings a story may use, as given: omitted, the whole world. An empty
 * list or an id the world does not have is a caller error.
 */
export function openParcels(world: NamedWorld, parcels?: readonly string[]): readonly string[] | undefined {
  if (parcels === undefined) return undefined;
  if (parcels.length === 0) throw new Error('parcels names no building');
  const known = new Set(world.parcels.map((parcel) => parcel.id));
  const unknown = parcels.filter((id) => !known.has(id));
  if (unknown.length > 0) throw new Error(`parcels not in the world: ${unknown.join(', ')}`);
  return parcels;
}

/**
 * The step kinds a host plays, as given: omitted, every kind. A list naming no
 * real kind is a caller error, and so is one naming investigation from a host
 * that stages no scenery: a story shows its clues on the scenes it stages.
 */
export function hostKinds(mechanics: readonly string[] | undefined, scenery: SceneryCapabilities | undefined): readonly StepKind[] | undefined {
  if (mechanics === undefined) return undefined;
  const kinds = playableKinds(mechanics);
  if (kinds.includes('investigation') && scenery === undefined) {
    throw new Error('investigation needs the host scenery capability: a story shows its clues on the scenes it stages');
  }
  return kinds;
}

export class QuestlineCreation {
  async run(input: CreationInput): Promise<CreationResult> {
    const { world, types, sim, ports, scenery, referenceTimeMin, maxRounds } = input;
    // An allowlist naming no real kind or an unstageable one, or open parcels the world lacks, fail here, before any model is asked.
    const mechanics = hostKinds(input.mechanics, scenery);
    const parcels = openParcels(world, input.parcels);
    const progress = (event: CreationProgress) => input.progress?.(event);
    const stagesScenes = scenery !== undefined;
    const script = await new ScriptPass().run({ world, types, llm: ports.script, prompt: input.prompt, minimums: input.minimums?.script, stagesScenes });
    progress({ kind: 'script', result: script });
    const assignments = new Assignments(script.script);
    const translator = new QuestlineTranslator();
    const translate = async (questline: 'main' | string, assignment: QuestAssignment) => {
      const result = await translator.translate({
        assignment, world, types, sim, parcels, mechanics, scenery, referenceTimeMin, maxRounds,
        ports: { plan: ports.plan, build: ports.build },
        planned: (plan) => progress({ kind: 'plan', questline, result: plan }),
        progress: (build) => progress({ kind: 'build', questline, build }),
      });
      progress({ kind: 'questline', questline, result });
      return result;
    };

    /** A situations text that cannot be read costs the side quests, not the run: the main line is the product. */
    const runSituations = async (): Promise<SituationsPassResult> => {
      try {
        return await new SituationsPass().run({ script: script.script, world, types, llm: ports.situations, minimums: input.minimums?.situations, stagesScenes });
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
