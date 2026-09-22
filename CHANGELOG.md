# Changelog

0.10.5: Last Call at Oxide Filter now describes the theft it actually runs: district observation identifies the guard and his route, then the player follows the marked guard and takes the bagged notes he carries. Recorded situation, plan, item, dialogue and objective prose agree without changing quest targets, cast, progression or saved-state shapes.

0.10.4: talk steps carry authored offline openings, informational replies and explicit commitments. Runtime conversations bind one quest step to its exact cast, return current availability, and reject stale or blocked selections without mutation. Only a completing choice advances that one step; opening, closing and typed chat do not. The Weir Line and all three recorded side stories cover all 15 talks, including explicit expose and settlement endings. Legacy definitions receive fallback choices; bundle 1.1 and saved-state shapes are unchanged.

0.10.3: roles preserve authored character names as optional display metadata independently of generated NPC identities. Recorded unreserved roles retain the script's names without reserving people. Scoped dialog context and replies use the same character name while simulation names, cast IDs, routines and bystanders remain unchanged.

0.10.2: materialize creates exact portable pickup assets from authored item-kind templates and preserves explicit bindings. Handoffs reject missing pickup bindings or assets without a portable take anchor instead of publishing an impossible collection step.

0.10.1: casting searches real weekly staffing posts when a game opens outside business hours and never assigns different characters to the same person. Live hosts can check authored talk/listen appointment eligibility before placing the cast, while quest completion still requires their exact physical presence, the authored hour, items and conditions.

0.10.0: a creation run takes the buildings the story may use (`parcels`, `--parcels=<ids|@file>` on materialize) and keeps every place inside them: venues are chosen from the set, a building outside it moves to one of the same kind that is in it, and a questline with nowhere to go is named with its reason instead of shipped. A host that opens part of the city gets a bundle that only points at buildings the player can walk into.

0.9.1: where a step happens is settled while the questline is built. Casting reads the questline and reports the building each character holds a post in; the creation stage pins with it, so the bundle ships the final places and a host at load plays them. A step moves only for the people it meets, only to a building one of them holds a post in, so a character found off a post never pulls a story onto their own address.

0.9.0: a published step and its cast name the same place. The simulation says where the city hires, a building published for residents alone is no story venue, and a questline nobody can staff is published blocked with its reason instead of disappearing.

0.8.5: a quest place carries the venue's name and a step that names an hour carries the window the runtime checks. Story venues are buildings that publish a post for the character, the cast is queried at the story's own hour, and one person plays one character across a questline set. Engine bundle 1.1 gains those fields and keeps its shape.

0.8.4: each box's tests cover its contract surface once, on the sample recording the launcher replays.

0.8.3: separate story and gameplay agents share deterministic flow validation; tool descriptions and prompts are Markdown assets. The sample client streams uncapped text and tool calls. Engine bundle 1.1 uses schema-validated handoff inputs. Compiled library output includes standalone fixtures; replay output stays local. API calls live in the root skill and contract; open integration proposals live in docs/ISSUES.md.
