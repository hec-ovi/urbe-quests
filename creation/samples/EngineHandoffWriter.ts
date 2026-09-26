import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { HandoffInputBoundary } from '../../handoff/HandoffInputBoundary.js';
import type { HandoffBundle, HandoffInput } from '../../handoff/schema.js';

export const HANDOFF_FILES = Object.freeze({
  hostCapabilities: 'host-capabilities.json',
  objectives: 'objectives.json',
  investigations: 'investigations.json',
  mechanicTargetBindings: 'mechanic-target-bindings.json',
  missionAssetRequests: 'mission-assets.json',
  missionItemBindings: 'mission-item-bindings.json',
  scenery: 'scenery.json',
  manifest: 'quest-bundle.json',
});

export interface HandoffManifest {
  contractVersion: '1.2';
  files: {
    hostCapabilities: string;
    questlines: string;
    objectives: string;
    investigations: string;
    mechanicTargetBindings: string;
    missionAssetRequests: string;
    missionItemBindings: string;
    scenery: string;
  };
  counts: {
    questlines: number;
    objectives: number;
    investigations: number;
    mechanicTargetBindings: number;
    missionAssetRequests: number;
    missionItemBindings: number;
    scenery: number;
  };
}

/** Explicit bindings and host capabilities from a file, checked at the handoff boundary before anything uses them. */
export function readHandoffInput(path: string | undefined): HandoffInput {
  return path === undefined ? {} : new HandoffInputBoundary().parse(JSON.parse(readFileSync(resolve(path), 'utf8')));
}

export function writeEngineHandoff(questlinesPath: string, bundle: HandoffBundle): HandoffManifest {
  const outputPath = resolve(questlinesPath);
  const outputDir = dirname(outputPath);
  mkdirSync(outputDir, { recursive: true });
  const manifest: HandoffManifest = {
    contractVersion: '1.2',
    files: {
      hostCapabilities: HANDOFF_FILES.hostCapabilities,
      questlines: basename(outputPath),
      objectives: HANDOFF_FILES.objectives,
      investigations: HANDOFF_FILES.investigations,
      mechanicTargetBindings: HANDOFF_FILES.mechanicTargetBindings,
      missionAssetRequests: HANDOFF_FILES.missionAssetRequests,
      missionItemBindings: HANDOFF_FILES.missionItemBindings,
      scenery: HANDOFF_FILES.scenery,
    },
    counts: {
      questlines: bundle.questlines.length,
      objectives: bundle.objectives.length,
      investigations: bundle.investigations.length,
      mechanicTargetBindings: bundle.mechanicTargetBindings.length,
      missionAssetRequests: bundle.missionAssetRequests.length,
      missionItemBindings: bundle.missionItemBindings.length,
      scenery: bundle.scenery.length,
    },
  };
  writeJson(resolve(outputDir, HANDOFF_FILES.hostCapabilities), bundle.hostCapabilities);
  writeJson(outputPath, bundle.questlines);
  writeJson(resolve(outputDir, HANDOFF_FILES.objectives), bundle.objectives);
  writeJson(resolve(outputDir, HANDOFF_FILES.investigations), bundle.investigations);
  writeJson(resolve(outputDir, HANDOFF_FILES.mechanicTargetBindings), bundle.mechanicTargetBindings);
  writeJson(resolve(outputDir, HANDOFF_FILES.missionAssetRequests), bundle.missionAssetRequests);
  writeJson(resolve(outputDir, HANDOFF_FILES.missionItemBindings), bundle.missionItemBindings);
  writeJson(resolve(outputDir, HANDOFF_FILES.scenery), bundle.scenery);
  writeJson(resolve(outputDir, HANDOFF_FILES.manifest), manifest);
  return manifest;
}

const writeJson = (path: string, value: unknown): void => writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
