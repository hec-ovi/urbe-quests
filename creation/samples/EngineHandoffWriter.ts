import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import type { HandoffBundle, HandoffInput } from '../../handoff/schema.js';

export const HANDOFF_FILES = Object.freeze({
  hostCapabilities: 'host-capabilities.json',
  objectives: 'objectives.json',
  investigations: 'investigations.json',
  mechanicTargetBindings: 'mechanic-target-bindings.json',
  missionAssetRequests: 'mission-assets.json',
  missionItemBindings: 'mission-item-bindings.json',
  manifest: 'quest-bundle.json',
});

export interface HandoffManifest {
  contractVersion: '1.1';
  files: {
    hostCapabilities: string;
    questlines: string;
    objectives: string;
    investigations: string;
    mechanicTargetBindings: string;
    missionAssetRequests: string;
    missionItemBindings: string;
  };
  counts: {
    questlines: number;
    objectives: number;
    investigations: number;
    mechanicTargetBindings: number;
    missionAssetRequests: number;
    missionItemBindings: number;
  };
}

export function readHandoffInput(path: string | undefined): unknown {
  return path === undefined ? {} : JSON.parse(readFileSync(resolve(path), 'utf8'));
}

export function writeEngineHandoff(questlinesPath: string, bundle: HandoffBundle): HandoffManifest {
  const outputPath = resolve(questlinesPath);
  const outputDir = dirname(outputPath);
  mkdirSync(outputDir, { recursive: true });
  const manifest: HandoffManifest = {
    contractVersion: '1.1',
    files: {
      hostCapabilities: HANDOFF_FILES.hostCapabilities,
      questlines: basename(outputPath),
      objectives: HANDOFF_FILES.objectives,
      investigations: HANDOFF_FILES.investigations,
      mechanicTargetBindings: HANDOFF_FILES.mechanicTargetBindings,
      missionAssetRequests: HANDOFF_FILES.missionAssetRequests,
      missionItemBindings: HANDOFF_FILES.missionItemBindings,
    },
    counts: {
      questlines: bundle.questlines.length,
      objectives: bundle.objectives.length,
      investigations: bundle.investigations.length,
      mechanicTargetBindings: bundle.mechanicTargetBindings.length,
      missionAssetRequests: bundle.missionAssetRequests.length,
      missionItemBindings: bundle.missionItemBindings.length,
    },
  };
  writeJson(resolve(outputDir, HANDOFF_FILES.hostCapabilities), bundle.hostCapabilities);
  writeJson(outputPath, bundle.questlines);
  writeJson(resolve(outputDir, HANDOFF_FILES.objectives), bundle.objectives);
  writeJson(resolve(outputDir, HANDOFF_FILES.investigations), bundle.investigations);
  writeJson(resolve(outputDir, HANDOFF_FILES.mechanicTargetBindings), bundle.mechanicTargetBindings);
  writeJson(resolve(outputDir, HANDOFF_FILES.missionAssetRequests), bundle.missionAssetRequests);
  writeJson(resolve(outputDir, HANDOFF_FILES.missionItemBindings), bundle.missionItemBindings);
  writeJson(resolve(outputDir, HANDOFF_FILES.manifest), manifest);
  return manifest;
}

const writeJson = (path: string, value: unknown): void => writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
