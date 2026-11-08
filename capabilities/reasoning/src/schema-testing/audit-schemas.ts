import { place, withOptionalStrings, type AnswerSchemaCase } from './answer-schemas.ts';

const sixOptional = withOptionalStrings('city', ['line1', 'line2', 'region', 'postcode', 'country', 'note']);

const anyValue = 'a value of any type';

export const auditSchemas: readonly AnswerSchemaCase[] = [
  {
    name: '$ref with a description sibling',
    document: {
      type: 'object',
      additionalProperties: false,
      required: ['home'],
      $defs: { address: place },
      properties: { home: { $ref: '#/$defs/address', description: 'Where the person lives' } },
    },
    issues: [],
  },
  {
    name: 'required name not in properties (open object)',
    document: { type: 'object', required: ['id'], properties: { name: { type: 'string' } } },
    issues: [{ pointer: '/required', detail: 'required names with no schema in properties: id' }],
  },
  {
    name: 'property of any value ({})',
    document: { type: 'object', additionalProperties: false, required: ['payload'], properties: { payload: {} } },
    issues: [{ pointer: '/properties/payload', detail: anyValue }],
  },
  {
    name: 'map keyed by propertyNames enum',
    document: { type: 'object', propertyNames: { enum: ['low', 'high'] }, additionalProperties: { type: 'number' } },
    issues: [],
  },
  {
    name: 'closed empty object',
    document: {
      type: 'object',
      additionalProperties: false,
      required: ['meta'],
      properties: { meta: { type: 'object', additionalProperties: false } },
    },
    issues: [],
  },
  {
    name: 'either email or phone (oneOf of required sets beside properties)',
    document: {
      type: 'object',
      additionalProperties: false,
      properties: { email: { type: 'string', format: 'email' }, phone: { type: 'string' } },
      oneOf: [{ required: ['email'] }, { required: ['phone'] }],
    },
    issues: [
      { pointer: '', detail: 'oneOf beside type, additionalProperties, properties' },
      { pointer: '/oneOf/0', detail: anyValue },
      { pointer: '/oneOf/1', detail: anyValue },
    ],
  },
  {
    name: 'optional nullable properties with maxProperties',
    document: {
      type: 'object',
      additionalProperties: false,
      maxProperties: 2,
      properties: { a: { type: ['string', 'null'] }, b: { type: ['string', 'null'] }, c: { type: ['string', 'null'] } },
    },
    issues: [{ pointer: '', detail: 'a count of properties beside optional properties that may be null' }],
  },
  {
    name: 'a definition with 6 optional fields used 3 times (18 after inlining)',
    document: {
      type: 'object',
      additionalProperties: false,
      required: ['billing', 'shipping', 'office'],
      $defs: { address: sixOptional },
      properties: {
        billing: { $ref: '#/$defs/address' },
        shipping: { $ref: '#/$defs/address' },
        office: { $ref: '#/$defs/address' },
      },
    },
    issues: [
      {
        pointer: '',
        detail: '18 fields that may be null or are a choice of types, counted where each definition is used (most 16)',
        rewrite: 'make some of these fields required and of one type, or split the answer',
      },
    ],
  },
  {
    name: 'wrapped array root',
    document: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name'],
        properties: { name: { type: 'string', maxLength: 3 } },
      },
    },
    issues: [],
  },
  {
    name: 'map of numbers',
    document: { type: 'object', additionalProperties: { type: 'number', maximum: 10 } },
    issues: [],
  },
];
