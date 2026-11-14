import { readFileSync } from 'node:fs';

import { goalsGuideIn } from '../goals-guide-renditions.ts';

export const goalsGuideFile = readFileSync(new URL('goals.md', import.meta.url), 'utf8');

export const markers = {
  with: '<!-- with messages -->',
  without: '<!-- without messages -->',
  end: '<!-- end -->',
} as const;

export const withMessages = goalsGuideIn(goalsGuideFile, { messages: true });

export const withoutMessages = goalsGuideIn(goalsGuideFile, { messages: false });

export function headingsOf(guide: string): readonly string[] {
  return guide.split('\n').filter((line) => /^##+ /u.test(line));
}

export function gapRowsOf(section: string): readonly (readonly [string, string])[] {
  return section.split('\n').flatMap((line) => {
    const cells = /^\| `([a-z_]+)` +\| (Person|Agent) +\|/u.exec(line);
    return cells === null ? [] : [[String(cells[1]), String(cells[2])] as const];
  });
}

export function sectionOf(guide: string, heading: string): string {
  const start = guide.indexOf(`\n${heading}\n`);
  const next = guide.indexOf('\n## ', start + heading.length + 2);
  return guide.slice(start, next === -1 ? undefined : next);
}
