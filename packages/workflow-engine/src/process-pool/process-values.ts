import { Buffer } from 'node:buffer';

import { Effect, Schema, SchemaGetter, SchemaIssue, type Option } from 'effect';

export type TypedArray = Readonly<
  | Int8Array
  | Uint8Array
  | Uint8ClampedArray
  | Int16Array
  | Uint16Array
  | Int32Array
  | Uint32Array
  | Float32Array
  | Float64Array
  | BigInt64Array
  | BigUint64Array
>;

export type ProcessValue =
  | null
  | boolean
  | number
  | string
  | TypedArray
  | readonly ProcessValue[]
  | { readonly [name: string]: ProcessValue };

interface TypedKind {
  readonly bytesEach: number;
  readonly of: (bytes: Readonly<ArrayBuffer>) => TypedArray;
}

const typedKinds: ReadonlyMap<string, TypedKind> = new Map<string, TypedKind>([
  ['Int8Array', { bytesEach: Int8Array.BYTES_PER_ELEMENT, of: (bytes) => new Int8Array(bytes) }],
  ['Uint8Array', { bytesEach: Uint8Array.BYTES_PER_ELEMENT, of: (bytes) => new Uint8Array(bytes) }],
  [
    'Uint8ClampedArray',
    { bytesEach: Uint8ClampedArray.BYTES_PER_ELEMENT, of: (bytes) => new Uint8ClampedArray(bytes) },
  ],
  ['Int16Array', { bytesEach: Int16Array.BYTES_PER_ELEMENT, of: (bytes) => new Int16Array(bytes) }],
  ['Uint16Array', { bytesEach: Uint16Array.BYTES_PER_ELEMENT, of: (bytes) => new Uint16Array(bytes) }],
  ['Int32Array', { bytesEach: Int32Array.BYTES_PER_ELEMENT, of: (bytes) => new Int32Array(bytes) }],
  ['Uint32Array', { bytesEach: Uint32Array.BYTES_PER_ELEMENT, of: (bytes) => new Uint32Array(bytes) }],
  ['Float32Array', { bytesEach: Float32Array.BYTES_PER_ELEMENT, of: (bytes) => new Float32Array(bytes) }],
  ['Float64Array', { bytesEach: Float64Array.BYTES_PER_ELEMENT, of: (bytes) => new Float64Array(bytes) }],
  ['BigInt64Array', { bytesEach: BigInt64Array.BYTES_PER_ELEMENT, of: (bytes) => new BigInt64Array(bytes) }],
  ['BigUint64Array', { bytesEach: BigUint64Array.BYTES_PER_ELEMENT, of: (bytes) => new BigUint64Array(bytes) }],
]);

const TypedWireSchema = Schema.Struct({ $typed: Schema.String, base64: Schema.String });

type TypedWire = typeof TypedWireSchema.Type;

const typedWireNames: ReadonlySet<string> = new Set(Object.keys(TypedWireSchema.fields));

function isTypedArray(value: unknown): value is TypedArray {
  const kind: unknown = ArrayBuffer.isView(value) ? Reflect.get(value, Symbol.toStringTag) : undefined;
  return typeof kind === 'string' && typedKinds.has(kind);
}

function typedOf(wire: TypedWire): Effect.Effect<TypedArray, SchemaIssue.Issue> {
  const kind = typedKinds.get(wire.$typed);
  const decoded = Buffer.from(wire.base64, 'base64');
  if (kind === undefined || decoded.byteLength % kind.bytesEach !== 0) {
    return Effect.fail(new SchemaIssue.InvalidValue({ message: 'Expected the bytes of a typed array' }, wire));
  }
  const bytes = new Uint8Array(decoded.byteLength);
  bytes.set(decoded);
  return Effect.succeed(kind.of(bytes.buffer));
}

function typedWireOf(typed: TypedArray): TypedWire {
  return {
    $typed: typed[Symbol.toStringTag],
    base64: Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength).toString('base64'),
  };
}

function isTypedWireShape(record: object): boolean {
  const names = Object.keys(record);
  return names.length === typedWireNames.size && names.every((name) => typedWireNames.has(name));
}

const TypedArraySchema = TypedWireSchema.pipe(
  Schema.decodeTo(Schema.declare(isTypedArray), {
    decode: SchemaGetter.transformEffect(typedOf),
    encode: SchemaGetter.transform(typedWireOf),
  }),
);

const ProcessValueSchema: Schema.Codec<ProcessValue, unknown> = Schema.Union([
  Schema.Null,
  Schema.Boolean,
  Schema.Finite,
  Schema.String,
  TypedArraySchema,
  Schema.Array(Schema.suspend((): Schema.Codec<ProcessValue, unknown> => ProcessValueSchema)),
  Schema.Record(
    Schema.String,
    Schema.suspend((): Schema.Codec<ProcessValue, unknown> => ProcessValueSchema),
  ).check(Schema.makeFilter((record) => !isTypedWireShape(record))),
]);

export const valueOf: (wire: unknown) => Option.Option<ProcessValue> = Schema.decodeUnknownOption(ProcessValueSchema, {
  onExcessProperty: 'error',
});

export const wireOf: (value: ProcessValue) => Option.Option<unknown> = Schema.encodeOption(ProcessValueSchema);
