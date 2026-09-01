/** Story outputs: the film-style script and the side situations written from it. */

export interface ScriptCharacter {
  name: string;
  /** What they are in this city (a barista, an executive), never a system id. */
  role: string;
  background: string;
  want: string;
  /** Tone of their lines, with example lines in their own voice. */
  voice: string;
}

export interface Passage {
  heading: string;
  text: string;
}

export type MovementName = 'presentation' | 'development' | 'conflict' | 'resolution';

export const MOVEMENTS: readonly MovementName[] = ['presentation', 'development', 'conflict', 'resolution'];

export interface StoryScript {
  /** The creation prompt the script answers. */
  prompt: string;
  title: string;
  logline: string;
  characters: ScriptCharacter[];
  /** Four movements, each a sequence of passages that turn. */
  movements: Record<MovementName, Passage[]>;
}

/** Floors the script must reach; ranges upward are open so the model is never quota'd. */
export interface ScriptMinimums {
  characters: number;
  passagesPerMovement: number;
}

export interface ScriptPassResult {
  script: StoryScript;
  /** Raw model text, persisted before validation so nothing creative is lost. */
  raw: string;
}

export interface SituationCharacter {
  name: string;
  /** Who they are and how they speak; "from the script" for a borrowed character. */
  description: string;
}

/** A small self-contained arc orbiting the main story; the seed of one side quest. */
export interface Situation {
  situationId: string;
  title: string;
  characters: SituationCharacter[];
  presentation: string;
  development: string;
  conflict: string;
  resolution: string;
}

export interface SituationMinimums {
  situations: number;
}

export interface SituationsPassResult {
  situations: Situation[];
  raw: string;
}
