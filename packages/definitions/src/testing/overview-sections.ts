export function sectionIn(overview: string, heading: string): string {
  return overview.split(`## ${heading}\n\n`)[1]?.split('\n\n## ')[0] ?? '';
}
