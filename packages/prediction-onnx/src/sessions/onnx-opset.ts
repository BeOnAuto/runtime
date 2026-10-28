type Bytes = Readonly<Uint8Array>;

interface Read<Value> {
  readonly value: Value;
  readonly next: number;
}

const wire = { varint: 0, fixed64: 1, delimited: 2, fixed32: 5 } as const;

const fixedBytes: Readonly<Record<number, number>> = { [wire.fixed64]: 8, [wire.fixed32]: 4 };

const operatorSets = 8;

const defaultDomains: ReadonlySet<string> = new Set(['', 'ai.onnx']);

function varintAt(bytes: Bytes, at: number): Read<number> | undefined {
  let value = 0;
  let scale = 1;
  for (let cursor = at; cursor < bytes.length; cursor += 1) {
    const byte = Number(bytes[cursor]);
    value += (byte & 0x7f) * scale;
    if (byte < 0x80) {
      return { value, next: cursor + 1 };
    }
    scale *= 128;
  }
  return undefined;
}

interface Field {
  readonly number: number;
  readonly kind: number;
  readonly value: number | Bytes;
}

function fixedAt(kind: number, at: number): Read<number> | undefined {
  const length = fixedBytes[kind];
  return length === undefined ? undefined : { value: length, next: at };
}

function fieldAt(bytes: Bytes, at: number): Read<Field> | undefined {
  const key = varintAt(bytes, at);
  if (key === undefined) {
    return undefined;
  }
  const kind = key.value % 8;
  const number = Math.floor(key.value / 8);
  if (kind === wire.varint) {
    const read = varintAt(bytes, key.next);
    return read === undefined ? undefined : { value: { number, kind, value: read.value }, next: read.next };
  }
  const length = kind === wire.delimited ? varintAt(bytes, key.next) : fixedAt(kind, key.next);
  if (length === undefined || length.next + length.value > bytes.length) {
    return undefined;
  }
  const end = length.next + length.value;
  return { value: { number, kind, value: bytes.subarray(length.next, end) }, next: end };
}

function fieldsOf(bytes: Bytes): readonly Field[] {
  const fields: Field[] = [];
  for (let read = fieldAt(bytes, 0); read !== undefined; read = fieldAt(bytes, read.next)) {
    fields.push(read.value);
  }
  return fields;
}

function versionOfTheDefaultDomain(entry: Bytes): number | undefined {
  const fields = fieldsOf(entry);
  const domain = fields.find(
    (field): field is Field & { readonly value: Bytes } => field.number === 1 && typeof field.value !== 'number',
  );
  const version = fields.find(({ number, value }) => number === 2 && typeof value === 'number');
  const named = domain === undefined ? '' : new TextDecoder().decode(domain.value);
  return defaultDomains.has(named) && typeof version?.value === 'number' ? version.value : undefined;
}

export function opsetOf(model: Bytes): number {
  const versions = fieldsOf(model).flatMap(({ number, value }) => {
    const version = number === operatorSets && typeof value !== 'number' ? versionOfTheDefaultDomain(value) : undefined;
    return version === undefined ? [] : [version];
  });
  return Math.max(0, ...versions);
}
