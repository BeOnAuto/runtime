const opening: Readonly<Record<string, boolean>> = {
  '<!-- with messages -->': true,
  '<!-- without messages -->': false,
};

const ending = '<!-- end -->';

interface Open {
  readonly line: number;
  readonly messages: boolean;
}

interface Reading {
  readonly kept: readonly string[];
  readonly open: Open | undefined;
  readonly blankDropped: boolean;
}

function blockOpenedBy(line: string): boolean | undefined {
  return opening[line];
}

function opened(reading: Reading, messages: boolean, number: number): Reading {
  if (reading.open !== undefined) {
    throw new Error(
      `The goals guide opens a block on line ${String(number)} inside the block opened on line ${String(reading.open.line)}`,
    );
  }
  return { kept: reading.kept, open: { line: number, messages }, blankDropped: true };
}

function ended(reading: Reading, number: number): Reading {
  if (reading.open === undefined) {
    throw new Error(`The goals guide ends a block on line ${String(number)} that was never opened`);
  }
  return { kept: reading.kept, open: undefined, blankDropped: true };
}

function readLine(reading: Reading, line: string, number: number, messages: boolean): Reading {
  const opener = blockOpenedBy(line);
  if (opener !== undefined) {
    return opened(reading, opener, number);
  }
  if (line === ending) {
    return ended(reading, number);
  }
  const keeps = reading.open === undefined || reading.open.messages === messages;
  const blankAfterAMarker = reading.blankDropped && line === '';
  const kept = keeps && !blankAfterAMarker ? [...reading.kept, line] : reading.kept;
  return { kept, open: reading.open, blankDropped: false };
}

export function goalsGuideIn(text: string, { messages }: { readonly messages: boolean }): string {
  const read = text
    .split('\n')
    .reduce<Reading>((reading, line, index) => readLine(reading, line, index + 1, messages), {
      kept: [],
      open: undefined,
      blankDropped: false,
    });
  if (read.open !== undefined) {
    throw new Error(`The goals guide opens a block on line ${String(read.open.line)} and never ends it`);
  }
  return read.kept.join('\n');
}
