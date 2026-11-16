import { cellsOf, type Sentence } from './agent-text-sentences.ts';

export interface SentenceChange {
  readonly before: Sentence | undefined;
  readonly after: Sentence | undefined;
}

interface Hunk {
  readonly removed: readonly Sentence[];
  readonly added: readonly Sentence[];
}

type Step = 'both' | 'removed' | 'added';

type At = readonly [number, number];

interface Table {
  readonly at: (row: number, column: number) => number;
}

const leastLikeness = 0.5;

function keyOf({ kind, source }: Sentence): string {
  return `${kind}\n${source}`;
}

function wordsIn({ source }: Sentence): ReadonlySet<string> {
  return new Set(
    source
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => word !== ''),
  );
}

function sameRow(one: Sentence, other: Sentence): boolean {
  return one.kind === 'row' && other.kind === 'row' && cellsOf(one.source)[0] === cellsOf(other.source)[0];
}

function likenessOf(one: Sentence, other: Sentence): number {
  if (sameRow(one, other)) {
    return 1;
  }
  const ones = wordsIn(one);
  const others = wordsIn(other);
  const shared = [...ones].filter((word) => others.has(word)).length;
  return ones.size + others.size === 0 ? 1 : (2 * shared) / (ones.size + others.size);
}

function tableOf(size: At, cell: (row: number, column: number, table: Table) => number): Table {
  const [rows, columns] = size;
  const width = columns + 1;
  const cells = new Float64Array((rows + 1) * width);
  const table: Table = { at: (row, column) => Number(cells[row * width + column]) };
  for (let row = rows - 1; row >= 0; row -= 1) {
    for (let column = columns - 1; column >= 0; column -= 1) {
      cells[row * width + column] = cell(row, column, table);
    }
  }
  return table;
}

function walk(size: At, stepAt: (row: number, column: number) => Step, visit: (step: Step, at: At) => void): void {
  const [rows, columns] = size;
  let [row, column] = [0, 0];
  while (row < rows || column < columns) {
    const step = stepAt(row, column);
    visit(step, [row, column]);
    row += step === 'added' ? 0 : 1;
    column += step === 'removed' ? 0 : 1;
  }
}

function hunksBetween(before: readonly Sentence[], after: readonly Sentence[]): readonly Hunk[] {
  const keysBefore = before.map((sentence) => keyOf(sentence));
  const keysAfter = after.map((sentence) => keyOf(sentence));
  const size: At = [before.length, after.length];
  const common = tableOf(size, (row, column, table) =>
    keysBefore[row] === keysAfter[column]
      ? table.at(row + 1, column + 1) + 1
      : Math.max(table.at(row + 1, column), table.at(row, column + 1)),
  );
  const stepAt = (row: number, column: number): Step => {
    if (row < before.length && column < after.length && keysBefore[row] === keysAfter[column]) {
      return 'both';
    }
    const removing = row < before.length && common.at(row + 1, column) >= common.at(row, column + 1);
    return column >= after.length || removing ? 'removed' : 'added';
  };
  const hunks: Hunk[] = [];
  let removed: Sentence[] = [];
  let added: Sentence[] = [];
  walk(size, stepAt, (step, [row, column]) => {
    if (step === 'both') {
      hunks.push({ removed, added });
      [removed, added] = [[], []];
    } else if (step === 'removed') {
      removed.push(...before.slice(row, row + 1));
    } else {
      added.push(...after.slice(column, column + 1));
    }
  });
  hunks.push({ removed, added });
  return hunks.filter((hunk) => hunk.removed.length + hunk.added.length > 0);
}

function pairsIn({ removed, added }: Hunk): readonly SentenceChange[] {
  if (removed.length === 1 && added.length === 1) {
    return [{ before: removed[0], after: added[0] }];
  }
  const size: At = [removed.length, added.length];
  const likeness = removed.flatMap((one) => added.map((other) => likenessOf(one, other)));
  const paired = (row: number, column: number, table: Table): number => {
    const alike = Number(likeness[row * added.length + column]);
    return alike >= leastLikeness ? alike + table.at(row + 1, column + 1) : -1;
  };
  const best = tableOf(size, (row, column, table) =>
    Math.max(paired(row, column, table), table.at(row + 1, column), table.at(row, column + 1)),
  );
  const stepAt = (row: number, column: number): Step => {
    if (row < removed.length && column < added.length && best.at(row, column) === paired(row, column, best)) {
      return 'both';
    }
    const removing = row < removed.length && best.at(row, column) === best.at(row + 1, column);
    return column >= added.length || removing ? 'removed' : 'added';
  };
  const changes: SentenceChange[] = [];
  walk(size, stepAt, (step, [row, column]) => {
    changes.push({
      before: step === 'added' ? undefined : removed[row],
      after: step === 'removed' ? undefined : added[column],
    });
  });
  return changes;
}

export function sentenceChangesBetween(
  before: readonly Sentence[],
  after: readonly Sentence[],
): readonly SentenceChange[] {
  return hunksBetween(before, after).flatMap((hunk) => pairsIn(hunk));
}
