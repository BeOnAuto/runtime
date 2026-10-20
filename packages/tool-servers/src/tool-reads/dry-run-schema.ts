import { Schema } from 'effect';

import { UnavailableBecauseSchema } from '../listing/tool-server.ts';
import { ArgumentCheckSchema } from './argument-checks.ts';

const ReachedSchema = Schema.Struct({
  reachable: Schema.Literals(['yes', 'no']).annotate({
    description: 'yes when the server listed its tools just now, no when it could not be asked for them',
  }),
  because: Schema.optionalKey(
    UnavailableBecauseSchema.annotate({
      description:
        'Why it could not be asked: key_refused when it did not accept the key this server gives it, which only whoever runs this server can put right; failing, rate_limited or unreachable when asking again later may work; connection_not_allowed when a rule of whoever runs this server no longer allows the connection; connection_unavailable when the credential of the connection cannot be read just now, so asking again later may work',
    }),
  ),
});

export const DryRunSchema = Schema.Struct({
  would_run: Schema.Boolean.annotate({
    description:
      'Whether execute would call the tool now: the caller may, the playbook is not retired, whoever runs this server allows it, and its server answered',
  }),
  needs: Schema.Literal('playbook:write').annotate({
    description: 'The permission execute needs, whatever the tool does, since a call acts as the playbook',
  }),
  caller_may: Schema.Boolean.annotate({ description: 'Whether the caller holds the permission execute needs' }),
  playbook_retired: Schema.Boolean.annotate({
    description:
      'Whether the playbook is retired, which execute refuses, since a retired playbook can no longer change',
  }),
  allowed: Schema.Boolean.annotate({
    description: "Whether whoever runs this server allows the tool on its server's entry, for runs and execute alike",
  }),
  read_only: Schema.NullOr(Schema.Boolean).annotate({
    description:
      "Whether the tool's server marks it read-only; null when its listing was not read, as for a tool that is not allowed or a server that could not be asked",
  }),
  arguments: Schema.NullOr(ArgumentCheckSchema).annotate({
    description: "The arguments checked against the tool's input schema; null when none were given",
  }),
  server: ReachedSchema.annotate({ description: 'Whether the tool server could be asked for its tools just now' }),
});

export type DryRun = typeof DryRunSchema.Type;

export type Reached = typeof ReachedSchema.Type;
