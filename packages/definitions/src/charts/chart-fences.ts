export interface ChartFence {
  readonly first: number;
  readonly last: number;
  readonly info: string;
  readonly body: string;
}

const opening = /^(`{3,})([^`]*)$/u;

function closes(line: string, marker: string): boolean {
  const trimmed = line.trimEnd();
  return trimmed.length >= marker.length && /^`+$/u.test(trimmed);
}

function closingOf(lines: readonly string[], from: number, marker: string): number {
  return lines.findIndex((line, index) => index > from && closes(line, marker));
}

export function fencesIn(lines: readonly string[]): readonly ChartFence[] {
  const fences: ChartFence[] = [];
  let at = 0;
  while (at < lines.length) {
    const parts = opening.exec(String(lines[at]));
    const last = parts === null ? -1 : closingOf(lines, at, String(parts[1]));
    if (parts === null || last === -1) {
      at += 1;
    } else {
      fences.push({ first: at, last, info: String(parts[2]).trim(), body: lines.slice(at + 1, last).join('\n') });
      at = last + 1;
    }
  }
  return fences;
}
