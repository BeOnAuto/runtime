import { Schema } from 'effect';

function orNull<S extends Schema.Constraint>(schema: S, description: string): Schema.NullOr<S> {
  return Schema.NullOr(schema).annotate({ description });
}

const Credits = Schema.Struct({
  available: Schema.Number.annotate({ description: 'The credits the org held when Auto signed the license' }),
  owed: Schema.Number.annotate({ description: 'The overage the org owed then, which its next credits repay' }),
  overage_cap: Schema.Number.annotate({ description: 'The most overage its plan lets it owe' }),
});

const FreeRate = Schema.Struct({
  per_day: Schema.Int.annotate({ description: 'The runs it may start at the free rate each UTC day' }),
  per_month: Schema.Int.annotate({ description: 'The runs it may start at the free rate each UTC calendar month' }),
  used_today: Schema.Int.annotate({ description: 'The runs it started at the free rate this UTC day' }),
  used_this_month: Schema.Int.annotate({ description: 'The runs it started at the free rate this UTC month' }),
  lifts_at: orNull(Schema.String, 'When the free rate lets it run again, while it has used what the rate allows'),
});

export const LicenseStatusSchema = Schema.Struct({
  state: Schema.Literals(['unregistered', 'licensed', 'out_of_touch', 'limited', 'offline', 'invalid']).annotate({
    description:
      'unregistered without a key; licensed while it runs on the license Auto signed; out_of_touch once it has not reached Auto since that license warns from, still running on it; limited while it runs at the free rate though it holds a key; offline while it spends offline credits; invalid once those credits stopped',
  }),
  limited_because: orNull(
    Schema.Literals(['credits', 'cap', 'out_of_touch', 'key_rotated', 'key_revoked', 'org_closed', 'not_activated']),
    'While it is limited, why: its org has no credits, or owes its overage cap; it has not reached Auto since its license limits from; its key was replaced or no longer stands; its org was closed; or it holds a key Auto has not answered for yet',
  ),
  runtime_id: Schema.String.annotate({ description: 'The id of this runtime, which an owner registers in Studio' }),
  free_runs: orNull(
    Schema.Struct({
      used: Schema.Int.annotate({ description: 'The first runs it has used, at most the runs it may run so' }),
      of: Schema.Int.annotate({ description: 'The first runs it may run without a key' }),
    }),
    'The first runs of a runtime that has never held a license, and null once it has',
  ),
  org: orNull(Schema.String, 'The id of the org at Auto its license is of'),
  org_name: orNull(
    Schema.String,
    'The name of that org, as Auto signed it into the license, or null where it named none',
  ),
  plan: orNull(Schema.String, 'The plan of that org'),
  standing: orNull(
    Schema.Literals(['ok', 'low', 'empty', 'overage', 'near_cap', 'capped']),
    'Where the credits of its org stood when Auto signed the license',
  ),
  licensed: Schema.Int.annotate({ description: 'The runs it has started on a license, in all' }),
  runs_left: orNull(Schema.Int, 'The runs it may still start on its license, and null without one'),
  credits: orNull(Credits, 'The credits of its org when Auto signed the license'),
  issued_at: orNull(Schema.String, 'When Auto signed the license'),
  warn_at: orNull(Schema.String, 'From when Auto warns that the runtime is out of touch, unless it reports first'),
  limit_at: orNull(Schema.String, 'From when it runs at the free rate, unless it reports first'),
  last_report_at: orNull(Schema.String, 'When it last took a license from Auto, as it activated or reported'),
  fallback: orNull(FreeRate, 'The free rate it runs at, while it runs at it'),
  key_source: orNull(
    Schema.Literals(['environment', 'configuration', 'activated']),
    'Where the key in force came from: AUTO_RUNTIME_LICENSE_KEY, license.key of the configuration file, or an activation',
  ),
  offline: orNull(
    Schema.Struct({
      credits: Schema.Int.annotate({ description: 'The offline credits it holds' }),
      spent: Schema.Int.annotate({ description: 'What it has spent of them' }),
      usable_until: Schema.String.annotate({ description: 'When they stop unless Auto refreshes them' }),
    }),
    'The offline credits of a runtime that does not reach Auto',
  ),
  invalid_because: orNull(Schema.String, 'While it is invalid, the words a run is refused in'),
  summary: Schema.String.annotate({
    description: 'Where it stands in plain words, and how to put it right, as it says as it starts',
  }),
});
