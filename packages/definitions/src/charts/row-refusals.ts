import { fewestCells, mostCells, rowLinesIn, type WrittenRow } from './chart-rows.ts';

interface RowRefusal {
  readonly at: number;
  readonly detail: string;
}

const unclosedWords = 'This row is never closed: write ::: on a line of its own after its last cell';

const nestedWords = 'Rows do not nest: close the row above with ::: before opening another';

const strayWords = 'This ::: closes no row, since no row is open here';

const indentedWords =
  'A row stands at the top level: write its ::: lines at the start of the line, with no space before them';

const emptyWords = 'The cell after this line is empty: write its Markdown, or leave the cell out';

function unknownWords(line: string): string {
  return /^\s/u.test(line)
    ? indentedWords
    : `A row opens with ::: row and closes with :::, each alone on its line, and ${line.trim()} is neither`;
}

function cellsWords(count: number): string {
  return `This row holds ${count === 1 ? '1 cell' : `${count} cells`}, and a row holds ${fewestCells} to ${mostCells}, separated by lines of ---`;
}

function holdsATag(lines: readonly string[], from: number, to: number): boolean {
  return lines.slice(from + 1, to).some((line) => line.includes('{%'));
}

function cellRefusals(lines: readonly string[], { opens, separators }: WrittenRow, closes: number): RowRefusal[] {
  const bounds = [opens, ...separators, closes];
  const count = bounds.length - 1;
  if (count < fewestCells || count > mostCells) {
    return [{ at: opens, detail: cellsWords(count) }];
  }
  return bounds.slice(1).flatMap((to, index) => {
    const from = Number(bounds[index]);
    return lines.slice(from + 1, to).every((line) => line.trim() === '') ? [{ at: from, detail: emptyWords }] : [];
  });
}

function refusalsOf(lines: readonly string[], row: WrittenRow): RowRefusal[] {
  const nesting = row.nested.map((at) => ({ at, detail: nestedWords }));
  if (row.closes === undefined) {
    return [{ at: row.opens, detail: unclosedWords }, ...nesting];
  }
  return nesting.length > 0 || holdsATag(lines, row.opens, row.closes) ? nesting : cellRefusals(lines, row, row.closes);
}

export function rowRefusalsIn(lines: readonly string[]): readonly RowRefusal[] {
  const { rows, strays, unknown } = rowLinesIn(lines);
  return [
    ...rows.flatMap((row) => refusalsOf(lines, row)),
    ...strays.map((at) => ({ at, detail: strayWords })),
    ...unknown.map((at) => ({ at, detail: unknownWords(String(lines[at])) })),
  ].toSorted((one, other) => one.at - other.at);
}
