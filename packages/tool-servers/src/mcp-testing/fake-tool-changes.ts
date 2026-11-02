import type { FakeHints } from './fake-tools.ts';

export interface FakeToolChanges {
  readonly removed: ReadonlySet<string>;
  readonly hints: FakeHints;
  readonly removeTool: (name: string) => void;
  readonly annotateTool: (name: string, hints: Readonly<Record<string, boolean>>) => void;
}

export function fakeToolChanges(given: FakeHints = {}): FakeToolChanges {
  const removed = new Set<string>();
  const hints: Record<string, Readonly<Record<string, boolean>>> = { ...given };
  return {
    removed,
    hints,
    removeTool: (name) => {
      removed.add(name);
    },
    annotateTool: (name, annotations) => {
      hints[name] = annotations;
    },
  };
}
