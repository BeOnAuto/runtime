import type { Located } from './diagnostics.ts';
import { placeEntries, signatures, type EntryName, type ExportedFunction, type Place } from './module-rules.ts';

interface PresentEntry {
  readonly name: EntryName;
  readonly contract: string;
  readonly line: number;
}

interface ContractEntry {
  readonly contractLine: number;
  readonly name: EntryName;
  readonly line: number;
}

export interface Contract {
  readonly text: string;
  readonly entries: readonly ContractEntry[];
}

const importLine = "import * as program from './program.ts';";

export function contractOf(exported: readonly ExportedFunction[], place: Place): Contract {
  const present = placeEntries[place].flatMap(({ name, contract }): readonly PresentEntry[] =>
    exported
      .filter((declared) => declared.name === name)
      .slice(0, 1)
      .map(({ line }) => ({ name, contract, line })),
  );
  return {
    text: [
      importLine,
      ...present.map(
        ({ name, contract }, index) => `export const entry${index}: ${contract} = program[${JSON.stringify(name)}];`,
      ),
    ].join('\n'),
    entries: present.map(({ name, line }, index) => ({ contractLine: index + 2, name, line })),
  };
}

export function contractIssues(located: readonly Located[], { entries }: Contract): readonly Located[] {
  return entries.flatMap(({ contractLine, name, line }) =>
    located
      .filter((issue) => issue.line === contractLine)
      .map(({ detail }) => ({ line, detail: `${signatures[name]}: ${detail}` })),
  );
}
