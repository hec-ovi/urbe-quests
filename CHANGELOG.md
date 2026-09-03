# Changelog

0.8.1: NPC dialogue is typed text. Quests supplies scoped context, text replies, and serializable verbatim-tail memory with summarized digests. Engine owns conversation actor lifecycle and accepted-action animation.

0.8.0: quest plans use depth floors with open step, act and branch counts. Tool execution keeps a plan-sized safety round budget. The package test command runs once, runtime Ajv validation is a production dependency, and the simulation contract is v0.9.1.

0.7.0: engine bundle v1.1 maps rescue, access, hacking and sabotage targets to fixed mission assets and exact interaction anchors. Host capability declarations gate transportation modes. The writer includes mechanic target bindings and the validated host profile.

0.6.0: named-world transit identities flow into exact quest targets and route-ready guidance. Saved states validate history, active frontier, flags and ending. Engine handoff emits questlines, objectives, investigations, mission assets, item bindings and its manifest.

0.5.0: the closed quest vocabulary covers staged investigation, rescue, escort, access, hacking, sabotage and story-directed transportation. Each interaction carries exact cast, target, place, prerequisite, completion and consequence identities.

0.4.0: progressive skill resolution keeps story writing and gameplay adaptation in separate schema-constrained stages. Gameplay loads only selected supported mechanic skills and audits world targets, flow structure, story beats, transitions and ending routes.

0.3.0: recorded stories materialize deterministically across city sizes through semantic place and fallback role bindings. Small, medium and large bundles pass real-simulation casting and exclusive-branch validation.

0.2.15: cast resolution branches on simulation error codes, retries work shifts and resolves non-worker roles from existing people of the requested type.

0.2.14: the small-city sample contains a ten-step main line in four acts with two endings and three side quests.

0.2.13: `npm run replay` feeds recorded text and tool calls through the creation workflow with no model connection.

0.2.12: `stepPlace` returns the authored parcel or district, an item's parcel, or a targeted NPC's live place.

0.2.11: the browser-entry audit rejects runtime imports that leave the box.

0.2.10: an unreadable situations pass returns an empty side set through `warn`; the main questline remains available.

0.2.9: every builder tool call passes its own schema before reaching the draft, and invalid calls return the missing fields as tool results.

0.2.8: each plan closes with a manifest that bounds ids and references. Build execution uses two rounds per planned piece plus eight and reports progress after each round.

0.2.7: the creation sample sends `LLM_API_KEY` as bearer authentication when configured.

0.2.5: text-only builder replies receive a tool-use nudge that names remaining manifest work. Side quest build failures are reported through `warn`.

0.2.4: `runtime.ts` exposes the browser-safe flow runtime, validator, cast resolver, errors and types.

0.2.3: dialog context holds one attached runtime per questline id.

0.2.2: `CastResolver` is public, and the creation sample accepts named-world and NPC-type paths.

0.2.1: `Converse` produces one NPC reply from ordered dialog context. Build output includes consumer modules and their prompt files.

0.2.0: creation runs script, main translation, situations and side translations from one prompt with one injected port per stage. Typed items, step prerequisites and effects drive runtime inventory and dialog wants.

0.1.0: story and repair passes, tool-driven questline building, cast-by-type resolution, deterministic flow, scoped dialog context, fixture worlds and stub simulation.
