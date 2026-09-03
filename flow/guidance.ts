import type { QuestPlace } from './places.js';

export type RouteDestination = { kind: 'parcel' | 'station' | 'stop'; id: string };
export type GuidanceReason = 'target-unavailable' | 'district-area' | 'street-edge' | 'moving-route';

/** Route-ready projection of one objective place. */
export type StepGuidance =
  | { questId: string; stepId: string; place: QuestPlace; destination: RouteDestination }
  | { questId: string; stepId: string; place?: QuestPlace; reason: GuidanceReason };

export function guidanceFor(questId: string, stepId: string, place: QuestPlace | undefined): StepGuidance {
  if (place === undefined) return { questId, stepId, reason: 'target-unavailable' };
  if (place.kind === 'parcel' || place.kind === 'station' || place.kind === 'stop') {
    return { questId, stepId, place, destination: place };
  }
  const reason: GuidanceReason =
    place.kind === 'district' ? 'district-area' : place.kind === 'edge' ? 'street-edge' : 'moving-route';
  return { questId, stepId, place, reason };
}
