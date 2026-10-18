import { listed } from '@on.auto/operations';
import { Schema } from 'effect';

const NamedSchema = Schema.String.check(Schema.isMinLength(1));

export const wayFields = {
  in: Schema.Literals(['header', 'query', 'security']),
  name: NamedSchema,
  scheme: NamedSchema,
  issuer: Schema.String,
  scope: Schema.String,
};

export const WayKindSchema = Schema.Literals(['secret', 'client_credentials', 'none']);

export type WayKind = typeof WayKindSchema.Type;

const CredentialWayFieldsSchema = Schema.Struct({
  kind: WayKindSchema,
  in: Schema.optionalKey(wayFields.in),
  name: Schema.optionalKey(wayFields.name),
  scheme: Schema.optionalKey(wayFields.scheme),
  issuer: Schema.optionalKey(wayFields.issuer),
  scope: Schema.optionalKey(wayFields.scope),
  description: Schema.optionalKey(NamedSchema),
});

type CredentialWayFields = typeof CredentialWayFieldsSchema.Type;

type Field = Exclude<keyof CredentialWayFields, 'kind' | 'description'>;

interface TakenFields {
  readonly required: readonly Field[];
  readonly optional: readonly Field[];
}

const everyField: readonly Field[] = ['in', 'name', 'scheme', 'issuer', 'scope'];

const fieldsOfEachKind: Readonly<Record<WayKind, TakenFields>> = {
  secret: { required: ['in', 'name'], optional: ['scheme'] },
  client_credentials: { required: ['issuer'], optional: ['scope'] },
  none: { required: [], optional: [] },
};

interface FieldIssue {
  readonly path: readonly [Field];
  readonly issue: string;
}

function takenInWords({ required, optional }: TakenFields): string {
  const taken = [...required, ...optional];
  return taken.length === 0 ? 'no other field but its description' : listed(taken);
}

function presenceIssuesOf(way: CredentialWayFields): readonly FieldIssue[] {
  const taken = fieldsOfEachKind[way.kind];
  return everyField.flatMap((field): readonly FieldIssue[] => {
    const given = way[field] !== undefined;
    if (!given && taken.required.includes(field)) {
      return [{ path: [field], issue: `Expected ${field}, which a ${way.kind} way takes` }];
    }
    return given && !taken.required.includes(field) && !taken.optional.includes(field)
      ? [{ path: [field], issue: `Expected no ${field}: a ${way.kind} way takes ${takenInWords(taken)}` }]
      : [];
  });
}

export const CredentialWaySchema = CredentialWayFieldsSchema.check(
  Schema.makeFilter((way: CredentialWayFields) => presenceIssuesOf(way)),
);

export type CredentialWay = typeof CredentialWaySchema.Type;
