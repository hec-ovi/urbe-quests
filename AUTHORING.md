# Authoring a story as an external author

You, an agent, answer every stage the creation workflow would ask a model: the script, the side situations, one plan per questline and the build rounds that commit each plan through the builder's tools. Each file you write goes through the same parsers, repair reasons, tools and validation a model's answer meets, and the run ends in a replayable `recording.json` and an Engine bundle. No model server is asked.

## Run

```sh
npm run author -- --world <named-world.json> --types <npc-types.json> --out <out-dir> --external <author-dir> \
  [--prompt <text|@file>] [--handoff <file>] [--mechanics <kind,kind,...>] [--parcels=<ids|@file>] [--profile <label>] [--model <label>]
```

The inputs are those of any author run ([creation contract](creation/CONTRACT.md#sample)). `<author-dir>` and `<out-dir>` are two directories. `--model` is the name the recording gives you, `claude-opus-5-5` by default. Exit 2: files are owed. Exit 0: the bundle is written. Exit 1: a failure, named on stderr and in `<out-dir>/meta.json`. Never pass `--live`: it asks the model server instead of you.

## Loop

1. Run it.
2. Read `needs` in `<out-dir>/meta.json` (the same lines are on stderr). Each need names the `file` to write and the `request` files that hold what a model would be asked, under `<author-dir>/requests/`.
3. Read the request, write the file. A need with `problems` is a file you wrote that its stage refused, for the reasons a model's repair round would read: rewrite it whole.
4. Run again. Every run replays the whole workflow from your files, so it goes on where the last one stopped, and one run may owe several files at once (the main plan and the situations, then the first round of every build).

Stop at exit 0. Any file may be edited and the run repeated. A change upstream changes the requests after it: a new script title is a new plan file, a new plan manifest needs new rounds.

## Files you write

- `script.md`, `situations.md`, `plans/<title>.md`: the answer text in the format its request asks for, nothing around it.
- `builds/<title>/round-NN.json`, from `round-01`: one round of tool calls, `[{ "tool": "add_role", "input": { ... } }, ...]`, each input following its schema in `requests/builds/<title>/tools.json`. A whole questline fits in one round; put `finish_questline` last.

After a round, `requests/builds/<title>/round-NN.results.json` holds what each call answered. An answer that starts with `error:` was refused: the next round fixes it (an add tool called again with the same id replaces that piece) and calls `finish_questline` again. The build ends when `finish_questline` succeeds.

`<title>` is the questline's title as a file name (`The Tuesday Barrel` is `the-tuesday-barrel`); every need spells it out.

## What you get

Each run first clears what the last one left in `<out-dir>` and `<author-dir>/requests/`, so both show this run only. At exit 0 `<out-dir>` holds each stage, `recording.json` (it replays through `npm run replay` and `npm run materialize` with no author present), `meta.json` with `bundle`, and the bundle under `bundle/`. That directory is the story: Engine's creation `importStory` takes it as `recording` ([Engine creation](../engine/src/creation/CONTRACT.md)). At exit 2 or 1 it is not one, and a run that owes files writes no `recording.json`.

[creation/samples/urbe-small/author/](creation/samples/urbe-small/author/) is a complete author directory, The Short Measure, written for the sample world. Copy it to `<author-dir>` and run:

```sh
npm run author -- --world creation/samples/urbe-small/world.json --types creation/samples/urbe-small/npc-types.json \
  --handoff creation/samples/urbe-small/handoff-input.json --mechanics goto,observe,talk,listen,pickup,deliver,steal,work,investigation,escort \
  --parcels=p0,p1,p4,p6,p7,p10,p11,p32,p40 --profile small --external <author-dir> --out <out-dir> \
  --prompt "A short rain-soaked noir: a clinic courier learns the water ration she runs for a corporation is being skimmed, and has to decide who hears about it first."
```
