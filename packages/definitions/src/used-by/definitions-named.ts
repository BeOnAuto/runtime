interface NameWritten {
  readonly pointer: string;
  readonly type: string;
  readonly name: string;
}

interface SubjectWritten {
  readonly pointer: string;
  readonly type: string;
  readonly subject: string;
}

export interface DefinitionsNamed {
  readonly names: readonly NameWritten[];
  readonly subjects: readonly SubjectWritten[];
  readonly awaited: readonly SubjectWritten[];
}

export const namesNoDefinition: DefinitionsNamed = { names: [], subjects: [], awaited: [] };

export function definitionSubject(type: string, name: string): string {
  return `${type}/${name}`;
}
