import type { Option } from 'effect';

import type { Ending } from './job-endings.ts';
import type { JobSchema } from './job-envelopes.ts';

type Envelope = typeof JobSchema.Encoded;

export interface Job<Answer, Message = Envelope> {
  readonly key: string;
  readonly module: Readonly<URL>;
  readonly envelope: (job: number) => Message;
  readonly decode: (answer: unknown) => Option.Option<Answer>;
}

export interface Running {
  readonly until: number;
  readonly signal?: Readonly<AbortSignal> | undefined;
  readonly afterReady?: number;
}

export type Evaluate<Message = Envelope> = <Answer>(
  job: Job<Answer, Message>,
  running: Running,
) => Promise<Ending<Answer>>;
