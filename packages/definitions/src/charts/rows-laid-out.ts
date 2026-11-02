import { chartsDrawn } from './chart-drawing.ts';
import { fewestCells, mostCells, rowLinesIn, type WrittenRow } from './chart-rows.ts';

function whyNotLaidOut({ closes, nested, separators }: WrittenRow): string | undefined {
  const cells = separators.length + 1;
  if (closes === undefined) {
    return 'it is not closed by a line of :::';
  }
  if (nested.length > 0) {
    return 'it holds another row, and rows do not nest';
  }
  if (cells > mostCells) {
    return `it holds ${cells} cells, and a row holds at most ${mostCells}`;
  }
  return cells < fewestCells ? `it holds 1 cell, and a row holds at least ${fewestCells}` : undefined;
}

function withoutBlankEnds(lines: readonly string[]): readonly string[] {
  const first = lines.findIndex((line) => line.trim() !== '');
  const last = lines.findLastIndex((line) => line.trim() !== '');
  return lines.slice(first, last + 1);
}

function cellsOneAfterAnother(lines: readonly string[], { closes, marks }: WrittenRow): readonly string[] {
  const bounds = [...marks, closes ?? lines.length];
  return bounds
    .slice(1)
    .map((to, index) => withoutBlankEnds(lines.slice(Number(bounds[index]) + 1, to)))
    .flatMap((cell) => (cell.length === 0 ? [] : ['', cell.join('\n')]));
}

function rowsLaidOut(markdown: string): string {
  const lines = markdown.split('\n');
  return rowLinesIn(lines)
    .rows.reduceRight((current: readonly string[], row: WrittenRow) => {
      const why = whyNotLaidOut(row);
      return why === undefined
        ? current
        : [
            ...current.slice(0, row.opens),
            `This row could not be laid out: ${why}.`,
            ...cellsOneAfterAnother(lines, row),
            ...current.slice((row.closes ?? lines.length) + 1),
          ];
    }, lines)
    .join('\n');
}

export function chartsDrawnAndLaidOut(markdown: string): string {
  return rowsLaidOut(chartsDrawn(markdown));
}
