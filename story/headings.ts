/** Markdown heading grammar shared by the story parsers. */

export interface Section {
  heading: string;
  body: string;
}

/** Splits text into the sections opened by headings of exactly `level`; deeper headings stay in the body. */
export function splitSections(text: string, level: 2 | 3): Section[] {
  const marker = level === 2 ? /^##(?!#)\s*/m : /^###(?!#)\s*/m;
  return text
    .split(marker)
    .slice(1)
    .map((part) => {
      const newline = part.indexOf('\n');
      const heading = (newline === -1 ? part : part.slice(0, newline)).trim();
      const body = (newline === -1 ? '' : part.slice(newline + 1)).trim();
      return { heading, body };
    })
    .filter((section) => section.heading.length > 0);
}

export function titleOf(text: string): string {
  return /^#(?!#)\s*(.+)$/m.exec(text)?.[1]?.trim() ?? '';
}

/** Case-insensitive lookup of a section by heading. */
export function sectionNamed(sections: Section[], heading: string): Section | undefined {
  return sections.find((s) => s.heading.toLowerCase() === heading);
}

/** Text the model wrote but the parser could not use: listed so the repair round can fix all of it at once. */
export class ProseShortfall extends Error {
  constructor(readonly problems: string[]) {
    super(`output unusable: ${problems.join('; ')}`);
    this.name = 'ProseShortfall';
  }
}
