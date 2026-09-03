import { AuthoringError } from './AuthoringError.js';
import type { AdaptationOutput, Mechanic, QuestlineDefinition, StoryOutput } from './schema.js';

export class CauseEffectAudit {
  validate(output: AdaptationOutput, story: StoryOutput, selected: Mechanic[]): void {
    const problems: string[] = [];
    const definition = output.definition;
    const steps = new Map(definition.steps.map((step) => [step.stepId, step]));
    const choices = uniqueMap(output.mechanicChoices, (choice) => choice.stepId, 'mechanic choice', problems);
    const beatIds = new Set(Object.values(story.movements).flat().map((beat) => beat.beatId));
    const representedBeats = new Set<string>();

    for (const step of definition.steps) {
      const choice = choices.get(step.stepId);
      if (!choice) {
        problems.push(`step ${step.stepId} has no mechanic choice`);
        continue;
      }
      if (choice.mechanic !== step.target.kind) {
        problems.push(`step ${step.stepId} records ${choice.mechanic} but targets ${step.target.kind}`);
      }
      for (const beatId of choice.storyBeatIds) {
        if (!beatIds.has(beatId)) problems.push(`step ${step.stepId} references unknown story beat ${beatId}`);
        representedBeats.add(beatId);
      }
      const expectedTransitions = step.next.map((edge) => edge.toStepId);
      const recordedTransitions = choice.transitions.map((transition) => transition.toStepId);
      if (!sameArray(recordedTransitions, expectedTransitions)) {
        problems.push(`step ${step.stepId} transition trace does not match its ordered graph edges`);
      }
    }
    for (const stepId of choices.keys()) {
      if (!steps.has(stepId)) problems.push(`mechanic choice names unknown step ${stepId}`);
    }
    for (const beatId of beatIds) {
      if (!representedBeats.has(beatId)) problems.push(`story beat ${beatId} is absent from the gameplay adaptation`);
    }

    const used = new Set(definition.steps.map((step) => step.target.kind));
    const selectedSet = new Set(selected);
    for (const mechanic of used) {
      if (!selectedSet.has(mechanic)) problems.push(`questline uses mechanic ${mechanic} without selecting its skill`);
    }
    for (const mechanic of selectedSet) {
      if (!used.has(mechanic)) problems.push(`selected mechanic ${mechanic} is unused`);
    }

    this.checkEndings(output, story, definition, problems);
    if (problems.length > 0) throw new AuthoringError('E_CAUSE_EFFECT', 'questline cause and effect audit failed', problems);
  }

  private checkEndings(
    output: AdaptationOutput,
    story: StoryOutput,
    definition: QuestlineDefinition,
    problems: string[],
  ): void {
    const routes = uniqueMap(output.endingRoutes, (route) => route.endingId, 'ending route', problems);
    const endings = new Set(definition.endings.map((ending) => ending.endingId));
    const outcomes = new Set(story.decisions.flatMap((decision) => decision.options.map((option) => option.outcomeId)));
    const outcomeEnding = new Map<string, string>();

    for (const endingId of endings) {
      const route = routes.get(endingId);
      if (!route) {
        problems.push(`ending ${endingId} has no cause and effect route`);
        continue;
      }
      const expectedTerminal = definition.steps.filter((step) => step.endingId === endingId).map((step) => step.stepId).sort();
      if (!sameArray([...route.terminalStepIds].sort(), expectedTerminal)) {
        problems.push(`ending ${endingId} terminal step trace does not match the quest graph`);
      }
      for (const outcomeId of route.storyOutcomeIds) {
        if (!outcomes.has(outcomeId)) problems.push(`ending ${endingId} references unknown story outcome ${outcomeId}`);
        if (outcomeEnding.has(outcomeId)) problems.push(`story outcome ${outcomeId} maps to more than one ending`);
        outcomeEnding.set(outcomeId, endingId);
      }
      if (outcomes.size > 0 && route.storyOutcomeIds.length === 0) {
        problems.push(`ending ${endingId} has no story outcome`);
      }
    }
    for (const endingId of routes.keys()) {
      if (!endings.has(endingId)) problems.push(`ending route names unknown ending ${endingId}`);
    }
    for (const outcomeId of outcomes) {
      if (!outcomeEnding.has(outcomeId)) problems.push(`story outcome ${outcomeId} has no quest ending`);
    }
    if (outcomes.size === 0 && endings.size > 1) {
      problems.push('multiple quest endings require explicit story outcomes');
    }
    for (const decision of story.decisions) {
      const mapped = decision.options.map((option) => outcomeEnding.get(option.outcomeId)).filter((id): id is string => Boolean(id));
      if (new Set(mapped).size !== mapped.length) {
        problems.push(`decision ${decision.decisionId} collapses distinct outcomes into one ending`);
      }
    }
  }
}

function uniqueMap<T>(values: T[], id: (value: T) => string, subject: string, problems: string[]): Map<string, T> {
  const found = new Map<string, T>();
  for (const value of values) {
    const key = id(value);
    if (found.has(key)) problems.push(`duplicate ${subject} for ${key}`);
    found.set(key, value);
  }
  return found;
}

function sameArray(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
