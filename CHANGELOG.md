# Changelog

0.2.4: runtime.ts, the browser-safe entry (flow runtime, validator, cast resolver, errors, types) with no node APIs behind it.
0.2.3: `attachQuestline` replaces a runtime of the same questline id instead of stacking it.
0.2.2: `CastResolver` exported for hosts that cast a questline against their own simulation; the local-model creation sample takes a named world and type set as paths.
0.2.1: `Converse` turns one player line into the NPC's spoken reply from its dialog context layers (prompt in dialog/prompts/reply.md, no output caps); `npm run build` emits dist/ for consumers, prompts copied beside it.
0.2: questline creation workflow from one prompt: a text-only film script with enforced minimums (characters, passages per movement), translation as a text-only plan pass followed by the flow tool build, side situations (each with its own presentation, development, conflict and resolution) translated the same way, one injected port per stage. Items are typed artifacts (device, weapon, document, key, substance, valuable, information); steps carry gives and needs and the runtime derives the inventory; every step names who wants it and its stake, and NPC dialog context carries the giver's active wants and ending reactions. Committed fixture story and a local-model sample; 42 tests.
0.1: contract v0.1 against naming v0.1 and simulation v0.1. Story pass (backbone call, repair round), questline builder (agent tool loop, era step catalog, cast by type), deterministic flow runtime (typed step DAG, schedule-gated availability, flags, endings), dialog context service (cache-ordered layers, flag-gated knowledge, tiered memory). Two fixture worlds and a stub simulation; 30 tests.
0.0: scaffold, contract pending.
