export interface Line {
  readonly start: number;
  readonly text: string;
}

interface Segment {
  readonly start: number;
  readonly end: number;
}

export function linesOf(text: string, start: number): readonly Line[] {
  const lines: Line[] = [];
  let at = start;
  for (const line of text.split('\n')) {
    lines.push({ start: at, text: line });
    at += line.length + 1;
  }
  return lines;
}

function barsOf(line: string): readonly number[] {
  const bars: number[] = [];
  let escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line.charAt(index);
    if (character === '|' && !escaped) {
      bars.push(index);
    }
    escaped = character === '\\' && !escaped;
  }
  return bars;
}

export function cellStartsOf(line: string): readonly number[] {
  const segments: Segment[] = [];
  let start = 0;
  for (const bar of [...barsOf(line), line.length]) {
    segments.push({ start, end: bar });
    start = bar + 1;
  }
  const blank = ({ start: from, end }: Segment): boolean => line.slice(from, end).trim() === '';
  const kept = segments.slice(segments.slice(0, 1).filter((segment) => blank(segment)).length);
  const read = kept.slice(0, kept.length - kept.slice(-1).filter((segment) => blank(segment)).length);
  return read.map(({ start: from, end }) => {
    const written = line.slice(from, end);
    return from + written.length - written.trimStart().length;
  });
}

function lineEndFrom(text: string, offset: number): number {
  const end = text.indexOf('\n', offset);
  return end === -1 ? text.length : end;
}

export function offsetWritten(raw: string, read: string, offset: number): number {
  const line = read.slice(0, offset).split('\n').length - 1;
  const writtenLineEnd = raw
    .split('\n')
    .slice(0, line + 1)
    .join('\n').length;
  return writtenLineEnd - (lineEndFrom(read, offset) - offset);
}
