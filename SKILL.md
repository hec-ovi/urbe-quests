# Quests API 0.8.3

Quests writes narrative with injected agents, adapts it into typed quests, runs the rules in code and prepares Engine handoffs.

Call the Node library at `dist/index.js` after `npm run build`; browser gameplay uses `dist/runtime.js`. CLI calls are in [README.md](README.md#cli).

| Request | Fields and defaults | Response |
| --- | --- | --- |
| `AuthoringHarness.writeStory(input, agent)` | Required `prompt`, `world`, `types`; optional `requirements` has no added defaults; `agent.write` required | Narrative [StoryOutput](authoring/schema/story-output.schema.json) |
| `AuthoringHarness.adaptGameplay(input, agent)` | Required `story`, `world`, `types`; omitted `requestedMechanics` allows all 16 declared mechanics; injected `selectMechanics` and `adapt` | [Definition, mechanic choices, ending routes](authoring/schema/adaptation-output.schema.json) |
| `QuestlineCreation.run(input)` | Required `prompt`, `world`, `types`, `sim`, `ports.script/situations/plan/build`; minimums default to 5 characters, 2 passages per movement, 3 situations; `referenceTimeMin=2040`; `maxRounds=2*plannedPieces+8`; `warn`/`progress` optional | Script/raw text, situations/raw text, main translation and successful sides |
| `EngineHandoff.assemble(questlines, input={})` | Main first; optional `investigations`, `missionAssetRequests`, `missionItemBindings`, `mechanicTargetBindings` default `[]`; `hostCapabilities` defaults `{transportationModes:[]}` | [HandoffBundle](handoff/schema.ts), validated semantic payloads for bundle 1.1 |

Story writing receives semantic city context only. Adaptation chooses roles by type and uses existing place IDs. Naming input is currently supplied by the caller. The host must admit the selected mechanics and cast roles through Simulation at game load. Failed sides are reported through `warn`; callers must inspect the delivered side count. Prompts have no output caps.

Errors are closed `QuestError` and `AuthoringError` domain sets listed with meanings in [CONTRACT.md#errors](CONTRACT.md#errors). Provider, Simulation and CLI I/O exceptions can pass through. Missing investigation/fixed-target bindings or unsupported transport fail with `E_HANDOFF`.

Copy from the repository root. These fixture agents exercise the real story and adaptation boundaries without a model:

```sh
npm run build
node --input-type=module <<'JS'
import { readFileSync } from 'node:fs';
import { AuthoringHarness, EngineHandoff } from './dist/index.js';
const read = name => JSON.parse(readFileSync(`authoring/fixtures/${name}.json`, 'utf8'));
const context = read('world-context');
const source = read('story');
const adapted = read('adaptation');
const api = new AuthoringHarness();
const story = await api.writeStory({ ...context, prompt: source.prompt }, {
  write: async () => structuredClone(source),
});
const result = await api.adaptGameplay({ ...context, story, requestedMechanics: ['talk', 'pickup', 'deliver'] }, {
  selectMechanics: async () => ({ mechanics: ['talk', 'pickup', 'deliver'] }),
  adapt: async () => structuredClone(adapted),
});
const bundle = new EngineHandoff().assemble([result.definition]);
console.log(JSON.stringify({ title: story.title, objectives: bundle.objectives.length }));
JS
```

The example validates a semantic bundle. Physical asset creation and measured placement are host responsibilities. Full request schemas and runtime/dialogue calls: [CONTRACT.md](CONTRACT.md).
