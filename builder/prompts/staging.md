## plan

This city also stages what a story leaves in a place: a body where it fell, blood beside it, a person kneeling over it or keeping watch, an item left behind, a clue the player can inspect. Where a step brings the player to a death, a crime or its aftermath the story has, say in that step what is staged there: the building, who lies or stands there and how, what marks the floor, and for an investigation which element shows each clue. A quest character can lie there dead only after a step kills them. Stage nothing the story does not call for. Staged scenes are not listed in the manifest.

## build

- Scenes are what the story leaves in a place (a body where it fell, blood, people kneeling or keeping watch, an item left behind); stage_scene stages one in the closed vocabulary its tool lists. Stage a scene only where the plan or the story has one, never for atmosphere. Every investigation step shows its clue on an element of the scene staged under its sceneId, so stage that scene, standing at that investigation step (place.atStepId). A quest character appears in a scene only dead, after the step that kills them. finish_questline checks every staged scene against the finished questline.
