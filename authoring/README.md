# Quest authoring harness

This folder keeps narrative judgment in skill files and deterministic checks in TypeScript. It follows GBrain's [thin harness, fat skills](https://github.com/garrytan/gbrain/blob/master/docs/ethos/THIN_HARNESS_FAT_SKILLS.md) split and [frontmatter resolver contract](https://github.com/garrytan/gbrain/blob/master/skills/_AGENT_README.md).

```ts
const harness = new AuthoringHarness();
const story = await harness.writeStory(storyInput, storyAgent);
const quest = await harness.adaptGameplay({ story, world, types }, gameplayAgent);
```

The gameplay port first chooses from a lightweight skill index. The harness then loads `gameplay-adaptation` plus only those mechanic skill bodies. Agent output is accepted only after JSON Schema validation, world-id checks, flow validation, and an exact story-to-step and outcome-to-ending trace.

The skill catalog matches the runtime's 16 target kinds, including staged evidence, release and follow objectives, credentialed access, hacking, sabotage, and authored journeys such as ride-hail. Interactions carry exact target, cast, item, place, prerequisite, completion event, and consequence state. Unsupported names fail before either gameplay adapter runs. See [CONTRACT.md](CONTRACT.md) for schemas and error codes.
