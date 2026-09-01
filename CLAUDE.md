# quests: story, questlines and NPC dialog context

You own this box. You build only what lives in this repo.

## Context (general, do not expand it)
This repo is one isolated layer of a larger build: a seeded, deterministic city world that ends as a playable 3D game (map, buildings, transit, NPCs, quests). Nine layers are built in parallel by separate sessions, each locked to its own repo, coupled only through CONTRACT.md files. Never read another layer's code or tests, only its CONTRACT.md. Your raw requirements are in docs/REQUIREMENTS.md, in the user's own words: they win over any summary here.

## Scope
- Story pass: from the world prompt and the named zones, an LLM writes the main history line (introduction, development, conflict, resolution) and small premises for side quests. History quality is the one priority: this step gets deep focus and context isolated from all geometry and math detail.
- Questline builder: a flow tool, create then step by step. Step kinds: pick up item, talk or gather information, sit near two NPCs talking and listen, steal, assassinate, observe a zone, join a job to gain access to a restricted place, plus theme-permitting variants (hacking fits cyberpunk, not medieval: provide varied scenario examples per era so the model picks what fits, a car to a garage, a camel to a zone, a plane flying).
- Branching supported: a questline can split by acts and end different ways.
- Schedule gated: a quest at the bar exists only while that NPC is working there. Availability windows come from routines.
- The agent never places NPCs by id and coordinates. It asks for a type ("coffeeshopguy", "CEO", "unemployed person") through the simulation query functions (getNPCVendor style); the deterministic side resolves who, where and when, and hands back the full mathematical background (lives in zone X, works here, family, routine). The agent adds personality, needs and story on top.
- NPC dialog runtime context: NPCs have memory; a knowledge graph per instance, compaction and summarization on long contexts, caching for common instances, and elegant deflection when the player asks something the NPC cannot know or feeds fake info. No hallucinated knowledge.
- Version two milestone: simple quests first (go to this place, talk to this person, pick up this item), heavy on story, no timers, no failure states.
- First testbed runs entirely on the 2D plane: quests live on the 2D mathematical positions, the 3D render is only another representation.

## Out of scope
No geometry, no rendering, no population statistics (you consume simulation), no naming (you consume the named world).

## Depends on
../naming/CONTRACT.md, ../simulation/CONTRACT.md

## Consumers
../engine

## Working order
1. Deep research first: 2026 state of the art on LLM quest generation, state machine quest flows, knowledge graphs for NPC memory. Compact conclusions to docs/RESEARCH.md.
2. Draft CONTRACT.md before code (the flow schema and the dialog context API).
3. Implement against fixture named worlds and a stub simulation, on the 2D plane.
4. Keep CONTRACT.md and docs/INDEX.md current.

## Hard requirements
- Every prompt, boilerplate and few-shot set lives in its own .md file, never inline in code.
- Never cap LLM output length in params or prompt wording: steer by describing the content.
- The rigid part is rigid: a dead NPC gives no quests, flags drive availability, all state transitions are code, only dialog and story are creative.
- Standalone: runs with fixtures, no other layer present.

## Coordination
- Read docs/FEEDBACK.md at the start of every session.
- Write blockers and cross-layer questions to docs/ISSUES.md.

## Master requirements (background only)
docs/FULL-REQUIREMENTS.md holds the user's complete raw requirements for the whole project, so you see your surroundings. Read it once for awareness. It never widens your scope: what you build is defined by this file and docs/REQUIREMENTS.md only.
