# CONTRACT: two-stage quest authoring

Purpose: exposes story writing and gameplay adaptation as separate agent stages behind a GBrain-style skill resolver, with deterministic validation below the agent boundary.

## Inputs

- Skill index query: [schema/skill-index-query.schema.json](schema/skill-index-query.schema.json).
- Skill route query: [schema/skill-route-query.schema.json](schema/skill-route-query.schema.json). Frontmatter trigger substrings are authoritative.
- Skill resolve query: [schema/skill-resolve-query.schema.json](schema/skill-resolve-query.schema.json). Full skill bodies load only for the named skills.
- Story request: [schema/story-request.schema.json](schema/story-request.schema.json). It contains the user's prompt and named world context, without quest mechanics.
- Gameplay adaptation request: [schema/adaptation-request.schema.json](schema/adaptation-request.schema.json). It contains a completed story, the same named world context, and an optional mechanic allowlist.
- Story agent response: [schema/story-output.schema.json](schema/story-output.schema.json).
- Mechanic selector response: [schema/mechanic-selection.schema.json](schema/mechanic-selection.schema.json).
- Gameplay agent response: [schema/adaptation-output.schema.json](schema/adaptation-output.schema.json).

## Outputs

- Lightweight skill index: [schema/skill-index.schema.json](schema/skill-index.schema.json).
- Lightweight routed matches: [schema/skill-route-result.schema.json](schema/skill-route-result.schema.json).
- Resolved full skill bodies: [schema/resolved-skills.schema.json](schema/resolved-skills.schema.json).
- Story agent request: [schema/story-agent-request.schema.json](schema/story-agent-request.schema.json). It carries only the story-writing skill and the story output schema bundle.
- Story-stage result: [schema/story-output.schema.json](schema/story-output.schema.json). It contains the grounded setting, character motivations and voices, presentation, development, conflict and ending scenes, scripted dialogue, decisions, and consequences.
- Mechanic selection agent request: [schema/mechanic-selection-agent-request.schema.json](schema/mechanic-selection-agent-request.schema.json). It carries the gameplay-adaptation skill and a lightweight mechanic index.
- Gameplay agent request: [schema/gameplay-agent-request.schema.json](schema/gameplay-agent-request.schema.json). It carries the gameplay-adaptation skill plus only the selected mechanic skill bodies.
- Gameplay-stage result: [schema/adaptation-output.schema.json](schema/adaptation-output.schema.json). Every step records its mechanic choice, story beats, narrative reason, cause, effect, and ordered transition trace. Every ending records terminal steps and story outcomes.
- Closed error envelope: [schema/authoring-error.schema.json](schema/authoring-error.schema.json).

The shared named world envelope is [schema/world-context.schema.json](schema/world-context.schema.json). Shared ids, mechanics, skill summaries, and schema bundles are [schema/values.schema.json](schema/values.schema.json).

## Events

- `skillIndex()`, `route(message)`, and `resolveSkills(names)` expose progressive skill discovery.
- `writeStory(input, agent)` validates the request, loads `story-writing`, calls the injected agent once, validates the structured result, then checks identity and character references.
- `adaptGameplay(input, agent)` exposes the lightweight mechanic index to the selector, validates its selection, loads only those full skills, calls the injected adaptation agent, then runs flow, world-target, and cause-effect audits.

## Errors

- `E_AUTHORING_INPUT`: a caller request does not match its schema.
- `E_AUTHORING_OUTPUT`: an agent response or agent request does not match its schema.
- `E_SKILL_CONTRACT`: skill frontmatter is incomplete or duplicate.
- `E_UNKNOWN_SKILL`: a full skill name cannot be resolved.
- `E_UNSUPPORTED_MECHANIC`: the caller named a mechanic outside the runtime vocabulary.
- `E_MECHANIC_SELECTION`: the selector chose an unsupported or disallowed mechanic.
- `E_WORLD_TARGET`: a role type, parcel, district, item placement, or promotion destination is absent from the supplied world.
- `E_CAUSE_EFFECT`: story ids, mechanic traces, graph transitions, beats, decisions, or ending routes disagree.
- `E_INVALID_FLOW`: the finished definition fails the deterministic flow validator.

## Dependencies

- `flow`, only through [../flow/CONTRACT.md](../flow/CONTRACT.md) and [../flow/schema/questline.schema.json](../flow/schema/questline.schema.json). Authoring imports no flow implementation.
- `world`, through [../world/CONTRACT.md](../world/CONTRACT.md) and mirrored named world types.
- Injected story and gameplay agent ports. The layer owns no model client.

## Invariants

- Story writing never emits quest mechanics, system ids, or runtime events. Its named scene places must exist in the supplied world; gameplay adaptation owns exact target ids.
- Gameplay adaptation receives the completed story unchanged.
- The lightweight index is read before mechanic bodies. Only selected mechanic bodies enter the gameplay adaptation request.
- Skill frontmatter `triggers` are the routing source of truth. `skills/RESOLVER.md` mirrors them for human scanning.
- Supported mechanics are exactly `goto`, `observe`, `talk`, `listen`, `pickup`, `deliver`, `steal`, `assassinate`, and `work`.
- Hacking, sabotage, rescue, escort, entry codes, transportation, and staged clue investigation fail closed until the flow schema and runtime implement them.
- Every story beat reaches at least one quest step. Every story decision outcome reaches a distinct quest ending.
- Every quest step has exactly one matching mechanic record and an ordered trace of all outgoing edges.
- Agent responses are constrained by the same JSON Schemas used for boundary validation. No output length cap is added.

## How to modify this blackbox safely

Add a mechanic only after `flow` supports its target and player event. Add its skill, frontmatter route, resolver row, schema enum, world checks, trace tests, and fixtures together. Run the authoring contract tests, full tests, typecheck, build, and the compiled resolver smoke test.
