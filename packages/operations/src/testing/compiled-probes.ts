export interface RejectedProbe {
  readonly because: string;
  readonly source: readonly string[];
}

export interface Probes {
  readonly accepted: Readonly<Record<string, readonly string[]>>;
  readonly rejected: Readonly<Record<string, RejectedProbe>>;
}

export const probeHeader: readonly string[] = [
  "import { Effect, Schema } from 'effect';",
  "import * as Operations from '../../../src/index.ts';",
  'const Empty = Schema.Record(Schema.String, Schema.Never);',
  "const about = { title: 'Probe', description: 'Probe.' };",
];
