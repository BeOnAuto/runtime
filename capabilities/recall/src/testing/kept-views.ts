import type { KeptView, ViewsPort } from '@on.auto/workflow-host';
import { Effect } from 'effect';

export interface KeptViews {
  readonly views: ViewsPort;
  readonly keep: (view: KeptView) => void;
  readonly newest: (at: string | undefined) => void;
}

export function keptViews(): KeptViews {
  const kept = new Map<string, KeptView>();
  const newest: { at: string | undefined } = { at: undefined };
  return {
    views: {
      viewOf: (_playbook, name) => Effect.sync(() => kept.get(name)),
      newestRecordAt: () => Effect.sync(() => newest.at),
    },
    keep: (view) => {
      kept.set(view.name, view);
    },
    newest: (at) => {
      newest.at = at;
    },
  };
}
