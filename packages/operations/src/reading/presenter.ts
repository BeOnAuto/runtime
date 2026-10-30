import type { Schema } from 'effect';

import type { ChangesNamed } from '../changes/change-naming.ts';
import type { RecordedFact } from './recorded-read.ts';

export interface PresentedPart {
  readonly number: number;
  readonly causedBy: number;
}

export interface PresentedFact {
  readonly type: string;
  readonly summary: string;
  readonly data: Schema.JsonObject;
  readonly part?: PresentedPart;
}

export type KeptContent = (sha256: string) => string | undefined;

export interface Presenter {
  readonly streamKind: string;
  readonly publicNames: Readonly<Record<string, readonly string[]>>;
  readonly present: (recorded: RecordedFact, content: KeptContent) => readonly PresentedFact[];
  readonly changes: ChangesNamed;
}
