import type { Schema } from 'effect';

function closed(properties: Schema.JsonObject, required: readonly string[]): Schema.JsonObject {
  return { type: 'object', additionalProperties: false, required, properties };
}

const name: Schema.JsonObject = { type: 'string', minLength: 1, maxLength: 80 };

const money = closed(
  { amount: { type: 'number', minimum: 0 }, currency: { type: 'string', enum: ['EUR', 'USD', 'GBP'] } },
  ['amount', 'currency'],
);

const contact = closed({ name, email: { type: 'string', format: 'email' }, phone: { type: 'string', maxLength: 32 } }, [
  'name',
  'email',
]);

const site = closed(
  {
    city: name,
    address: closed(
      {
        street: name,
        postcode: { type: 'string', maxLength: 16 },
        building: closed({ name, floor: closed({ number: { type: 'integer', minimum: 0 }, wing: name }, ['number']) }, [
          'floor',
        ]),
      },
      ['street', 'building'],
    ),
  },
  ['city', 'address'],
);

const team = closed(
  {
    name,
    lead: { $ref: '#/$defs/contact' },
    size: { type: 'integer', minimum: 1, maximum: 500 },
    budget: { $ref: '#/$defs/money' },
    site,
  },
  ['name', 'lead', 'budget', 'site'],
);

const department = closed({ name, cost_centre: { type: 'string', maxLength: 16 }, team }, ['name', 'team']);

const organisation = closed(
  { division: closed({ name, head: { $ref: '#/$defs/contact' }, department }, ['name', 'department']) },
  ['division'],
);

const verdict: Schema.JsonObject = {
  oneOf: [
    closed(
      { kind: { const: 'approve' }, limit: { $ref: '#/$defs/money' }, until: { type: 'string', format: 'date' } },
      ['kind', 'limit'],
    ),
    closed({ kind: { const: 'reject' }, reason: { type: 'string', maxLength: 200 } }, ['kind', 'reason']),
  ],
};

export const referenceSchema: Schema.JsonObject = {
  type: 'object',
  additionalProperties: false,
  required: ['account', 'review'],
  $defs: { money, contact },
  properties: {
    account: closed(
      {
        id: { type: 'string', format: 'uuid' },
        name: { type: 'string', minLength: 1, maxLength: 120 },
        tier: { type: 'string', enum: ['free', 'pro', 'enterprise'] },
        region: { type: 'string', enum: ['emea', 'amer', 'apac'] },
        owner: { $ref: '#/$defs/contact' },
        organisation,
        website: { type: 'string', format: 'uri' },
      },
      ['id', 'name', 'tier', 'owner', 'organisation'],
    ),
    review: closed(
      {
        verdict,
        spend: {
          type: 'object',
          description: 'What the account spent each month, by the month as YYYY-MM',
          additionalProperties: { $ref: '#/$defs/money' },
        },
        notes: { type: 'string', maxLength: 500 },
        follow_up: closed({ by: { type: 'string', format: 'date' }, owner: name }, ['by']),
      },
      ['verdict', 'spend'],
    ),
  },
};

const section: Schema.JsonObject = closed(
  { heading: name, sections: { type: 'array', items: { $ref: '#/$defs/section' }, maxItems: 5 } },
  ['heading'],
);

export const outlineSchema: Schema.JsonObject = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'sections'],
  $defs: { section },
  properties: {
    title: name,
    sections: { type: 'array', items: { $ref: '#/$defs/section' }, minItems: 1, maxItems: 5 },
  },
};

const contactCardFields = [
  'email',
  'phone',
  'mobile',
  'street',
  'city',
  'region',
  'postcode',
  'country',
  'company',
  'title',
  'department',
  'website',
  'birthday',
  'language',
  'timezone',
  'pronouns',
  'notes',
];

const mayBeNull: Schema.JsonObject = { type: ['string', 'null'] };

export const contactCardSchema = closed(
  {
    name: { type: 'string' },
    ...Object.fromEntries(contactCardFields.map((field) => [field, mayBeNull])),
  },
  ['name', ...contactCardFields],
);

export const mostShapeValues = 200;

export const citiesSchema = closed(
  {
    values: {
      type: 'array',
      maxItems: mostShapeValues,
      items: closed({ name: { type: 'string' }, value: { type: 'number' } }, ['name', 'value']),
    },
  },
  ['values'],
);
