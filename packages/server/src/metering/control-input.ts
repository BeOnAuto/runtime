import type { ProblemReason } from '@on.auto/api';
import { boundedAnswerOf } from '@on.auto/outbound';
import { Schema } from 'effect';

export class ControlInputRefused extends Error {
  readonly reason: ProblemReason;

  constructor(reason: ProblemReason, detail: string) {
    super(detail);
    this.reason = reason;
  }
}

export async function controlInput(request: Readonly<Request>): Promise<unknown> {
  if (request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json')
    throw new ControlInputRefused('unsupported_media_type', 'Send this license request as application/json.');
  let oversized = false;
  try {
    const bounded = boundedAnswerOf(new Response(request.body), 4096, () => {
      oversized = true;
    });
    const value: unknown = await bounded.json();
    return value;
  } catch {
    throw oversized
      ? new ControlInputRefused('content_too_large', 'A license request may contain at most 4096 bytes.')
      : new ControlInputRefused('bad_request', 'The license request must contain a JSON object.');
  }
}

const activation = Schema.decodeUnknownSync(
  Schema.Struct({ activationKey: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(1024)) }),
  { onExcessProperty: 'error' },
);
const closure = Schema.decodeUnknownSync(
  Schema.Struct({ allocationId: Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_.:-]{1,256}$/u)) }),
  { onExcessProperty: 'error' },
);

export function activationKey(value: unknown): string {
  try {
    return activation(value).activationKey;
  } catch {
    throw new ControlInputRefused('invalid_input', 'Supply an activationKey containing 1 to 1024 characters.');
  }
}

export function allocationId(value: unknown): string {
  try {
    return closure(value).allocationId;
  } catch {
    throw new ControlInputRefused('invalid_input', 'Supply the allocationId shown by this installation.');
  }
}
