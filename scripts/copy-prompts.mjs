/** Copy runtime Markdown and fixture data beside compiled library modules. */
import { cpSync } from 'node:fs';

for (const path of [
  'authoring/skills',
  'builder/prompts',
  'dialog/prompts',
  'story/prompts',
  'story/fixtures',
  'world/fixtures',
]) {
  cpSync(path, `dist/${path}`, { recursive: true });
}
