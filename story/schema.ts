/** Story pass output: the world's main history line plus side quest premises. */

export interface StoryDocument {
  theme: string;
  mainline: {
    introduction: string;
    development: string;
    conflict: string;
    resolution: string;
  };
  sidePremises: SidePremise[];
}

export interface SidePremise {
  premiseId: string;
  title: string;
  premise: string;
}

export interface StoryPassResult {
  document: StoryDocument;
  /** Raw model text, persisted before validation so nothing creative is lost. */
  raw: string;
}
