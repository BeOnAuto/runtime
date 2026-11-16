export interface Edit {
  readonly start: number;
  readonly end: number;
  readonly words: string;
}

interface StaleDefault {
  readonly edit: Edit;
  readonly fault: string;
}

export interface Reading {
  readonly edits: readonly Edit[];
  readonly faults: readonly string[];
  readonly stale: readonly StaleDefault[];
}

export function readingsJoined(readings: readonly Reading[]): Reading {
  return {
    edits: readings.flatMap(({ edits }) => edits),
    faults: readings.flatMap(({ faults }) => faults),
    stale: readings.flatMap(({ stale }) => stale),
  };
}

const longestQuote = 80;

export function faultAt(page: string, offset: number, fault: string): string {
  const line = page
    .slice(page.lastIndexOf('\n', offset - 1) + 1)
    .split('\n', 1)
    .join('');
  const quoted = line.length > longestQuote ? `${line.slice(0, longestQuote)}…` : line;
  return `The line "${quoted}" ${fault}`;
}

export function faultedAt(page: string, offset: number, fault: string): Reading {
  return { edits: [], faults: [faultAt(page, offset, fault)], stale: [] };
}

export const unknownForm =
  'writes a marking in a form a page may not use: a passage opens with <div data-audience="…"> alone on its line, a clause is wrapped in <span data-audience="…">, a value in <span data-variable="…">, and a code example that holds values in <div data-variable="…"> alone on its line.';

export const unread =
  'holds a marking the Markdown parser does not place where it is written, so a guide cannot read it.';

export function undeclared(name: string): string {
  return `names the value ${name}, which this server does not declare.`;
}
