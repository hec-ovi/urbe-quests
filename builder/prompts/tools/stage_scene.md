## description

Stage what the story leaves in one place for the player to walk into: a body where it fell, blood beside it, a person kneeling over it or keeping watch, an item left behind. Stage a scene only where the story has one (a death, a crime or its aftermath the player comes upon), never for atmosphere. Every figure and mark comes from this call; the city adds nothing. An investigation step shows its clue on one element of the scene staged under its sceneId, so each investigation step needs that scene. Calling it again with a sceneId already staged replaces that scene.

## narrative

What the player finds there, in the story's words: who lies or stands where, what marks the floor, what was left behind.

## sceneId

A short id you author. For a scene the player investigates, the sceneId its investigation steps name.

## purpose

crime-scene (a killing or a break-in as it was left), aftermath (what remains of the story's violence or accident), wake (people mourning someone), stakeout (people watching a place), ambient (a moment the story sets in a place).

## stagedBy

The step that brings the scene into the city.

## stagedWhen

active: the scene is there once that step is open, so the player finds it when they go; done: it appears once that step is complete, as after a killing. A scene the player investigates stands before its investigation steps are done: staged by an earlier step, or by the investigation step while it is active.

## place

Where the scene stands: atStepId names the step whose building it is in, on that building's ground floor. For a scene the player investigates, that is the investigation step. Otherwise name a step that happens in a building (the building it meets its people in, goes to or ends at, or where its item lies); an assassinate or observe step happens in none.
- room: a room of that building, of one of roomKinds when given.
- story-slot: a room where the building keeps space for a story, of one of roomKinds when given.
- parcel-entry: the room behind the building's main door.
- street: the pavement in front of the building's door.

## roomKinds

For a room or story-slot only: the kinds of room it may be. Name only kinds that building surely has (a restaurant's kitchen, an office's office_open); leave it out for any room.

## actors

At most {{actors}} people. role says what they are to the scene. A quest character appears only dead: roleId with a death pose, and a step must kill them first (the assassinate step that targets them kills them; so does any step whose effects hold simFlag with their roleId and op die); the scene waits until they are dead. Everybody else is anonymous and names a gender (male or female) instead of a roleId. zone places a figure: center, perimeter (along the walls), incident (by the first body) or entry-side (by the door); nearActorId puts them beside an actor listed before them.
- death-a: dead, lying where they fell.
- death-b: dead, fallen another way.
- wounded-crawl: hurt on the floor, dragging themselves.
- ground-sit: sitting on the ground.
- kneel-examine: kneeling over something to examine it.
- crouch-examine: crouching low to look closer.
- search-torch: standing, searching with a torch.
- grieving: standing, crying.
- standing-guard: standing watch.

## props

At most {{props}} marks and objects, each near an actor (nearActorId), near a mission asset listed before it (nearPropId), or on its own.
- blood-pool: blood on the floor.
- tyre-marks: skid marks on the ground.
- mission-asset: a physical quest item left there (itemId), in its own look.

## evidence

For a scene the player investigates: one entry per investigation step naming this sceneId, with that step's evidenceId and the elementId (an actorId or propId) the clue is on. One element shows one clue.

## clearedBy

A step after which the scene is cleared away. Left out, the scene clears when the questline ends.

## lasting

true keeps the scene in the city after the questline ends, as a lasting mark of the story.
