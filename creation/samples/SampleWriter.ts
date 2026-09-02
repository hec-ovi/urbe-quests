/**
 * Writes a sample run to creation/samples/<name>/ the moment each stage
 * lands, so a run that stops late keeps what it made.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import type { CreationProgress } from '../schema.js';

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
        this.write(`${label}.questline.json`, JSON.stringify({ definition, cast }, null, 2) + '\n');
        log(
          `questline ${event.questline} "${definition.title}": ${definition.steps.length} steps, ${definition.roles.length} roles, ${definition.items.length} items, ${definition.endings.length} endings`,
        );
        return;
      }
    }
  }
}
