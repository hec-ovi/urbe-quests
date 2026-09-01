/** Pure predicate evaluation over quest state and simulation liveness/schedule. */

import type { Predicate } from './schema.js';

export interface PredicateContext {
  flags: ReadonlySet<string>;
  completedSteps: ReadonlySet<string>;
  isRoleAlive(roleId: string): boolean;
  isRoleOnDuty(roleId: string, timeMin: number): boolean;
}

export class PredicateEvaluator {
  constructor(private readonly ctx: PredicateContext) {}

  all(predicates: Predicate[], timeMin: number): boolean {
    return predicates.every((p) => this.one(p, timeMin));
  }

  one(p: Predicate, timeMin: number): boolean {
    switch (p.kind) {
      case 'flagSet':
        return this.ctx.flags.has(p.flag);
      case 'flagNotSet':
        return !this.ctx.flags.has(p.flag);
      case 'stepDone':
        return this.ctx.completedSteps.has(p.stepId);
      case 'roleAlive':
        return this.ctx.isRoleAlive(p.roleId);
      case 'roleOnDuty':
        return this.ctx.isRoleOnDuty(p.roleId, timeMin);
    }
  }
}
