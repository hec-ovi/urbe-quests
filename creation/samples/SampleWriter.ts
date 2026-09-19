/**
 * Writes a sample run to creation/samples/<name>/ the moment each stage
 * lands, so a run that stops late keeps what it made.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import type { CreationProgress, CreationResult } from '../schema.js';
import { QuestlineSetValidator } from '../../flow/QuestlineSet.js';

export type Log = (line: string) => void;

export class SampleWriter {
  private readonly dir: URL;

  constructor(name: string) {
    this.dir = new URL(`./${name}/`, import.meta.url);
    mkdirSync(this.dir, { recursive: true });
  }

  get path(): string {
    return this.dir.pathname;
  }

  write(file: string, text: string): void {
    writeFileSync(new URL(file, this.dir), text);
  }

  /** Engine payload: the main definition first, then side quests in situation order, with the finished cast. */
  writeQuestlines(result: CreationResult): void {
    const definitions = [result.main.definition, ...result.side.map((side) => side.definition)];
    new QuestlineSetValidator().validate(definitions);
    this.write('questlines.json', JSON.stringify(definitions, null, 2) + '\n');
    this.writeQuestline('main', result.main);
    for (const side of result.side) this.writeQuestline(`side-${side.situationId}`, side);
  }

  private writeQuestline(label: string, result: { definition: CreationResult['main']['definition']; cast: CreationResult['main']['cast'] }): void {
    this.write(`${label}.questline.json`, JSON.stringify({ definition: result.definition, cast: result.cast }, null, 2) + '\n');
  }

  onProgress(event: CreationProgress, log: Log): void {
    switch (event.kind) {
      case 'script':
        this.write('script.md', event.result.raw);
        return;
      case 'situations':
        this.write('situations.md', event.result.raw);
        return;
      case 'build': {
        const b = event.build;
        log(`build ${event.questline} round ${b.round}/${b.maxRounds}: ${b.note} (${b.committed}/${b.planned} planned pieces)`);
        return;
      }
      case 'questline': {
        const label = event.questline === 'main' ? 'main' : `side-${event.questline}`;
        const { definition, cast } = event.result;
        this.write(`${label}.plan.md`, event.result.plan);
        this.writeQuestline(label, { definition, cast });
        log(
          `questline ${event.questline} "${definition.title}": ${definition.steps.length} steps, ${definition.roles.length} roles, ${definition.items.length} items, ${definition.endings.length} endings`,
        );
        return;
      }
    }
  }
}
