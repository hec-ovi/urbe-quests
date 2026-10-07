/**
 * Checks on what a person says, for tests and evaluations of the talk: words
 * of the machinery behind a person that must never reach a prompt or a
 * reply, stock genre phrases, and what a reply claims that the person's own
 * context does not give them (an incident, a relative, a named person or
 * place). Plain heuristics over words: a problem they report is worth a look,
 * and a reply they pass may still be wrong.
 */

/** Words that would give the person away as anything but a resident. */
export const META_WORDS = ['npc', 'npcs', 'game', 'games', 'gameplay', 'player', 'players', 'ai', 'model', 'models', 'simulation', 'simulated', 'roleplay'];

/** Stock phrases of the genre and words for the street's drainage, which no resident talks in. */
export const STOCK_PHRASES = [
  'rain-soaked', 'rain soaked', 'neon', 'neon-drenched', 'neon-lit', 'chrome', 'gutter', 'gutters', 'storm drain', 'drains',
  'in this city', 'this city never', 'the streets never sleep', 'concrete jungle', 'the sprawl', 'megacorp', 'netrunner', 'cyberspace',
  'choom', 'corpo', 'wetware', 'the grid hums',
];

/** Incidents a person can only speak of when their context holds them. */
const INCIDENTS = /\b(crash(?:ed|es)?|accident|collision|hit by a car|ran (?:him|her|them|someone) (?:over|down)|run over|shot|shooting|stabb(?:ed|ing)|kill(?:ed|ing)|murder(?:ed)?|bod(?:y|ies)|corpse|explosion|blew up|riot|raid(?:ed)?|overdos(?:e|ed)|fire)\b/gi;

/** A relative the speaker claims, by the kind of tie: `my son`, `our kids`, `my wife`. */
const KIN: Record<string, string[]> = {
  child: ['son', 'sons', 'daughter', 'daughters', 'kid', 'kids', 'child', 'children', 'boy', 'girl', 'baby'],
  partner: ['wife', 'husband', 'partner', 'girlfriend', 'boyfriend', 'fiance', 'fiancee'],
  parent: ['mother', 'mom', 'mum', 'father', 'dad', 'parents', 'ma', 'pa'],
  sibling: ['brother', 'brothers', 'sister', 'sisters', 'siblings'],
  roommate: ['roommate', 'roommates', 'flatmate', 'flatmates'],
  other: ['grandmother', 'grandma', 'grandfather', 'grandpa', 'uncle', 'aunt', 'cousin', 'nephew', 'niece'],
};
/** The words a context gives each tie by. */
const KIN_GIVEN: Record<string, RegExp> = {
  child: /\byour (child|children|son|sons|daughter|daughters)\b/i,
  partner: /\byour (partner|wife|husband)\b/i,
  parent: /\byour (parent|parents|mother|father)\b/i,
  sibling: /\byour (brother|brothers|sister|sisters|siblings|brother or sister)\b/i,
  roommate: /\byour (roommate|roommates)\b/i,
  other: /\byour (grandmother|grandfather|uncle|aunt|cousin|nephew|niece)\b/i,
};

/** Everyday phrases an incident word stands in, which are no incident: a place to crash, killing time, fire away. */
const IDIOMS = new RegExp([
  '\\b(?:place|somewhere|room|bed|couch|sofa|floor|spot) to crash\\b', '\\bcrash(?:ed|es|ing)?\\s+(?:at|here|there|on|with|in|for|over)\\b', '\\bcrash course\\b',
  '\\bkill(?:ing|ed|s)?\\s+(?:some\\s+)?(?:time|an hour|the hours|the evening)\\b', '\\bkill(?:ing|s)? (?:me|myself laughing)\\b', '\\bdressed to kill\\b',
  '\\bfire away\\b', '\\bon fire\\b', '\\b(?:give it|have) a shot\\b', '\\ba shot of\\b', '\\b(?:long|big|mug) ?shot\\b', '\\bshot (?:of|at) (?:it|this)\\b',
].join('|'), 'i');
/** The speaker says they live alone, or by themselves. */
const ALONE = /\b(?:i|i've|i have|i'm|i am|been)\b[^.?!]{0,40}\b(?:liv(?:e|es|ed|ing)|stay(?:ing)?)\s+(?:all\s+)?(?:alone|by myself|on my own)\b/i;

/** Capitalised words that are no name of a person or place. */
const COMMON = new Set([
  'i', 'i\'m', 'i\'ve', 'i\'ll', 'i\'d', 'im', 'ive', 'ill', 'id', 'ok', 'okay', 'mr', 'mrs', 'ms', 'dr', 'sir', 'madam', 'god', 'christ',
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december',
]);

/** Each word of `words` the text uses, as a whole word, lower-cased. */
function used(text: string, words: string[]): string[] {
  const lower = text.toLowerCase();
  return words.filter((word) => new RegExp(`(^|[^a-z])${word.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')}([^a-z]|$)`).test(lower));
}

/** Words of the machinery and stock phrases a prompt or a reply holds: `meta: player`, `stock: gutters`. */
export function voiceProblems(text: string): string[] {
  return [...used(text, META_WORDS).map((word) => `meta: ${word}`), ...used(text, STOCK_PHRASES).map((phrase) => `stock: ${phrase}`)];
}

/**
 * What a reply claims that the person's `context` (the whole prompt they
 * were given) does not: an incident it does not mention, a relative of a tie
 * the person has none of, living alone with a household, and a capitalised
 * name, not opening a sentence, the context never says. `incident: crash`,
 * `family: my son`, `household: lives alone`, `name: Rian`. An incident
 * word in an everyday phrase (a place to crash, killing time) is none.
 */
export function groundingProblems(text: string, context: string): string[] {
  const problems: string[] = [];
  // One kind of apostrophe, so "I’m" reads as "I'm".
  const reply = text.replace(/[\u2018\u2019\u02bc]/g, "'");
  const known = context.toLowerCase();
  for (const match of reply.matchAll(INCIDENTS)) {
    const word = match[0].toLowerCase();
    const around = reply.slice(Math.max(0, match.index - 30), match.index + match[0].length + 30);
    if ([...around.matchAll(new RegExp(IDIOMS.source, 'gi'))].some((idiom) => idiom[0].toLowerCase().includes(word))) continue;
    const stem = word.replace(/(ed|es|ing|s)$/, '');
    if (!new RegExp(`\\b${stem}`).test(known)) problems.push(`incident: ${word}`);
  }
  for (const [tie, words] of Object.entries(KIN)) {
    const claim = new RegExp(`\\b(my|our)\\s+(?:\\w+\\s+)?(${words.join('|')})\\b`, 'i').exec(reply);
    if (claim && !KIN_GIVEN[tie]!.test(context)) problems.push(`family: ${claim[0].toLowerCase()}`);
  }
  // Living alone when the household holds somebody, or living with somebody when it holds nobody.
  if (ALONE.test(reply) && /\bYou live with your\b/.test(context)) problems.push('household: lives alone');
  const sentences = reply.split(/(?<=[.!?…"])\s+/);
  for (const sentence of sentences) {
    const words = sentence.replace(/^[^A-Za-z]+/, '').split(/\s+/);
    for (const [index, raw] of words.entries()) {
      const word = raw.replace(/[^A-Za-z'-]/g, '').replace(/'s$/, '');
      if (index === 0 || !/^[A-Z][a-z'-]+$/.test(word) || COMMON.has(word.toLowerCase())) continue;
      if (!new RegExp(`\\b${word.toLowerCase().replace(/[^a-z'-]/g, '')}\\b`).test(known)) problems.push(`name: ${word}`);
    }
  }
  return [...new Set(problems)];
}
