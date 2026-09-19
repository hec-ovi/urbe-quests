# Changelog

0.9.0: a published step and its cast name the same place. `CastResolver.cast` answers the questline pinned to the buildings its people work in, plus the cast and a `blocked` reason when the city cannot fill a role, so a questline nobody can staff is shown blocked instead of disappearing. The simulation says where the city hires, and a building published for residents alone is no story venue.

0.8.5: a quest place carries the venue's name and a step that names an hour carries the window the runtime checks. Story venues are buildings that publish a post for the character, the cast is queried at the story's own hour, and one person plays one character across a questline set. Engine bundle 1.1 gains those fields and keeps its shape.

0.8.4: each box's tests cover its contract surface once, on the sample recording the launcher replays.

0.8.3: separate story and gameplay agents share deterministic flow validation; tool descriptions and prompts are Markdown assets. The sample client streams uncapped text and tool calls. Engine bundle 1.1 uses schema-validated handoff inputs. Compiled library output includes standalone fixtures; replay output stays local. API calls live in the root skill and contract; open integration proposals live in docs/ISSUES.md.
