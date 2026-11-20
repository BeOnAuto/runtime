import {
  ActedContextSchema,
  recordedDecoder,
  type KeyedProjection,
  type ProjectedMessage,
  type ProjectedRow,
} from '@on.auto/operations';
import { Option, Schema } from 'effect';

export const dismissalsName = 'activity_dismissals';

const ThingOfAGoalSchema = { at: Schema.String, by: Schema.Struct({ id: Schema.String }) };

const DismissalFactSchema = Schema.Union([
  Schema.Struct({
    type: Schema.Literal('goal_dismissed'),
    data: Schema.Struct({ ...ThingOfAGoalSchema, requests: Schema.Array(Schema.String) }),
    context: ActedContextSchema,
  }),
  Schema.Struct({
    type: Schema.Literal('goal_restored'),
    data: Schema.Struct(ThingOfAGoalSchema),
    context: ActedContextSchema,
  }),
]);

const dismissalFactOf = recordedDecoder(DismissalFactSchema);

function rowAfter(_row: ProjectedRow | undefined, message: ProjectedMessage): ProjectedRow | undefined {
  return Option.getOrUndefined(
    Option.map(dismissalFactOf(message), ({ type, data }) => ({
      dismissed: type === 'goal_dismissed',
      at: Date.parse(data.at),
      by: data.by.id,
      requests: JSON.stringify('requests' in data ? data.requests : []),
    })),
  );
}

export const dismissalRows: KeyedProjection = {
  name: dismissalsName,
  version: 2,
  scopes: ['definition'],
  kinds: ['assessments'],
  types: ['goal_dismissed', 'goal_restored'],
  columns: [
    { name: 'dismissed', kind: 'boolean' },
    { name: 'at', kind: 'integer' },
    { name: 'by', kind: 'text' },
    { name: 'requests', kind: 'text' },
  ],
  indexes: [{ name: 'dismissed', columns: ['dismissed', 'at', 'row_key'] }],
  rowAfter,
};
