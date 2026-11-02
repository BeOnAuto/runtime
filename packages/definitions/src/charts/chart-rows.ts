import { fencesIn } from './chart-fences.ts';

export const fewestCells = 2;

export const mostCells = 4;

export interface WrittenRow {
  readonly opens: number;
  readonly closes: number | undefined;
  readonly separators: readonly number[];
  readonly nested: readonly number[];
  readonly marks: readonly number[];
}

interface RowLines {
  readonly rows: readonly WrittenRow[];
  readonly strays: readonly number[];
  readonly unknown: readonly number[];
}

type Mark = 'opens' | 'closes' | 'separates' | 'unknown' | 'text';

interface Marked {
  readonly at: number;
  readonly mark: Mark;
}

interface Span {
  readonly opens: number;
  readonly closes: number | undefined;
  readonly from: number;
  readonly to: number;
}

interface Opener {
  readonly at: number;
  readonly index: number;
}

const opening = /^:::\s*row\s*$/u;

const closing = /^:::\s*$/u;

const separating = /^---\s*$/u;

const container = /^\s*:::/u;

function markOf(line: string): Mark {
  if (opening.test(line)) {
    return 'opens';
  }
  if (closing.test(line)) {
    return 'closes';
  }
  if (separating.test(line)) {
    return 'separates';
  }
  return container.test(line) ? 'unknown' : 'text';
}

function fencedLines(lines: readonly string[]): ReadonlySet<number> {
  return new Set(
    fencesIn(lines).flatMap(({ first, last }) => Array.from({ length: last - first + 1 }, (_, index) => first + index)),
  );
}

function markedLines(lines: readonly string[]): readonly Marked[] {
  const fenced = fencedLines(lines);
  return lines.flatMap((line, at) => {
    const mark = fenced.has(at) ? 'text' : markOf(line);
    return mark === 'text' ? [] : [{ at, mark }];
  });
}

function spansIn(marked: readonly Marked[]): { readonly spans: readonly Span[]; readonly strays: readonly number[] } {
  const spans: Span[] = [];
  const strays: number[] = [];
  let opener: Opener | undefined;
  let depth = 0;
  for (const [index, { at, mark }] of marked.entries()) {
    if (mark === 'opens' && opener === undefined) {
      opener = { at, index };
    } else if (mark === 'opens') {
      depth += 1;
    } else if (mark !== 'closes') {
      continue;
    } else if (opener === undefined) {
      strays.push(at);
    } else if (depth > 0) {
      depth -= 1;
    } else {
      spans.push({ opens: opener.at, closes: at, from: opener.index + 1, to: index });
      opener = undefined;
    }
  }
  const unclosed =
    opener === undefined ? [] : [{ opens: opener.at, closes: undefined, from: opener.index + 1, to: marked.length }];
  return { spans: [...spans, ...unclosed], strays };
}

function rowOf(marked: readonly Marked[], { opens, closes, from, to }: Span): WrittenRow {
  const inner = marked.slice(from, to);
  const linesOf = (wanted: Mark): readonly number[] => inner.filter(({ mark }) => mark === wanted).map(({ at }) => at);
  return {
    opens,
    closes,
    separators: linesOf('separates'),
    nested: linesOf('opens'),
    marks: [opens, ...inner.filter(({ mark }) => mark !== 'unknown').map(({ at }) => at)],
  };
}

export function rowLinesIn(lines: readonly string[]): RowLines {
  const marked = markedLines(lines);
  const { spans, strays } = spansIn(marked);
  return {
    rows: spans.map((span) => rowOf(marked, span)),
    strays,
    unknown: marked.filter(({ mark }) => mark === 'unknown').map(({ at }) => at),
  };
}
