# Quest text 1.0

Authoring checks for visible English quest text. No model, IO or mutation.

`questTextProblems(definition)`, `questHeadingProblems({title, prologue?})`,
`stepTextProblems(step)` and `textProblems(path, text, kind)` return field-specific
repair messages (`string[]`); an empty list passes. `textWords(text)` counts
whitespace-separated visible words. `QUEST_TEXT_LIMITS` publishes the limits.

| Kind | Words | Unicode characters | Sentences |
| --- | ---: | ---: | ---: |
| title | 6 | 60 | unrestricted |
| prologue | 45 | 300 | 3 |
| objective | 10 (aim for 8) | 90 | 1 |
| scene | 24 | 180 | 1 |
| stake | 24 | 180 | 1 |
| speech (opening/reply) | 45 | 300 | 3 |
| choice | 12 | 100 | 2 |

Visible text excludes the six supported speech cues. Sentences use the runtime's
English `Intl.Segmenter`, with Dr/Mr/Mrs/Ms/Prof/St titles before a name protected; words split on whitespace. Non-prologue fields reject
line breaks. Scenes and optional prologues may be blank (the builder omits a blank prologue); other checked fields must contain visible text.
Premises, act summaries, epilogues, personas and facts keep the longer story.
They are not subject to these glance limits. No text is clipped or rewritten by code.

Builder tools reject a heading, act/ending title or step before mutation, returning
the reasons for another call. Finish checks the stamped definition again.
Gameplay adaptation rejects with `E_AUTHORING_OUTPUT` and the same reasons.
Flow/save validation and existing bundle loading have no new limits.

Editorial checks (imperative action, correct person/place, understandable names,
one starting step, no spoilers) are prompt/review rules, not claimed as machine
proof. Depends on flow types/cue stripping and `Intl.Segmenter`. Node authoring
entry exports this API; no browser runtime dependency or saved-state field.
