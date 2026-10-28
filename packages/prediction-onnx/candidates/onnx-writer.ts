import { Buffer } from 'node:buffer';

export type Bytes = Readonly<Uint8Array>;

export type Dimension = number | string;

export const elementTypes = { float: 1, int64: 7 } as const;

type ElementType = (typeof elementTypes)[keyof typeof elementTypes];

const wire = { varint: 0, fixed32: 5, delimited: 2 } as const;

const attributeTypes = { float: 1, int: 2, tensor: 4, ints: 7 } as const;

const irVersion = 8;

function varint(integer: bigint): readonly number[] {
  let left = BigInt.asUintN(64, integer);
  const bytes: number[] = [];
  do {
    const low = Number(left & 0x7fn);
    left >>= 7n;
    bytes.push(left === 0n ? low : low | 0x80);
  } while (left !== 0n);
  return bytes;
}

function joined(parts: readonly Bytes[]): Bytes {
  return Buffer.concat(parts);
}

function keyOf(field: number, kind: number): Bytes {
  return new Uint8Array(varint(BigInt((field << 3) | kind)));
}

function delimited(field: number, bytes: Bytes): Bytes {
  return joined([keyOf(field, wire.delimited), new Uint8Array(varint(BigInt(bytes.length))), bytes]);
}

function text(field: number, words: string): Bytes {
  return delimited(field, Buffer.from(words, 'utf8'));
}

function whole(field: number, integer: number | bigint): Bytes {
  return joined([keyOf(field, wire.varint), new Uint8Array(varint(BigInt(integer)))]);
}

function packed(field: number, values: readonly number[]): Bytes {
  return delimited(field, new Uint8Array(values.flatMap((each) => varint(BigInt(each)))));
}

function single(field: number, float: number): Bytes {
  const bytes = Buffer.alloc(4);
  bytes.writeFloatLE(float);
  return joined([keyOf(field, wire.fixed32), bytes]);
}

function rawOf(type: ElementType, values: readonly number[]): Bytes {
  if (type === elementTypes.float) {
    return new Uint8Array(Float32Array.from(values).buffer);
  }
  return new Uint8Array(BigInt64Array.from(values, BigInt).buffer);
}

export function tensor(name: string, type: ElementType, dims: readonly number[], values: readonly number[]): Bytes {
  return joined([packed(1, dims), whole(2, type), text(8, name), delimited(9, rawOf(type, values))]);
}

export function externalTensor(name: string, dims: readonly number[], location: string): Bytes {
  const entry = joined([text(1, 'location'), text(2, location)]);
  return joined([packed(1, dims), whole(2, elementTypes.float), text(8, name), delimited(13, entry), whole(14, 1)]);
}

function dimension(dim: Dimension): Bytes {
  return delimited(1, typeof dim === 'number' ? whole(1, dim) : text(2, dim));
}

function tensorTypeOf(type: ElementType, dims: readonly Dimension[]): Bytes {
  const shape = joined(dims.map((dim) => dimension(dim)));
  return delimited(1, joined([whole(1, type), delimited(2, shape)]));
}

export function valueInfo(name: string, type: ElementType, dims: readonly Dimension[]): Bytes {
  return joined([text(1, name), delimited(2, tensorTypeOf(type, dims))]);
}

export function sequenceInfo(name: string, type: ElementType, dims: readonly Dimension[]): Bytes {
  return joined([text(1, name), delimited(2, delimited(4, delimited(1, tensorTypeOf(type, dims))))]);
}

type Attribute =
  | { readonly name: string; readonly int: number }
  | { readonly name: string; readonly ints: readonly number[] }
  | { readonly name: string; readonly float: number };

function attribute(given: Attribute): Bytes {
  if ('int' in given) {
    return joined([text(1, given.name), whole(20, attributeTypes.int), whole(3, given.int)]);
  }
  if ('ints' in given) {
    return joined([text(1, given.name), whole(20, attributeTypes.ints), packed(8, given.ints)]);
  }
  return joined([text(1, given.name), whole(20, attributeTypes.float), single(2, given.float)]);
}

export interface Node {
  readonly op: string;
  readonly inputs: readonly string[];
  readonly outputs: readonly string[];
  readonly attributes?: readonly Attribute[];
}

function node({ op, inputs, outputs, attributes = [] }: Node, index: number): Bytes {
  return joined([
    ...inputs.map((name) => text(1, name)),
    ...outputs.map((name) => text(2, name)),
    text(3, `${op.toLowerCase()}_${index}`),
    text(4, op),
    ...attributes.map((each) => delimited(5, attribute(each))),
  ]);
}

export interface Graph {
  readonly name: string;
  readonly nodes: readonly Node[];
  readonly initializers: readonly Bytes[];
  readonly inputs: readonly Bytes[];
  readonly outputs: readonly Bytes[];
  readonly opset?: number;
}

export function model({ name, nodes, initializers, inputs, outputs, opset = 13 }: Graph): Bytes {
  const graph = joined([
    ...nodes.map((each, index) => delimited(1, node(each, index))),
    text(2, name),
    ...initializers.map((each) => delimited(5, each)),
    ...inputs.map((each) => delimited(11, each)),
    ...outputs.map((each) => delimited(12, each)),
  ]);
  const operators = joined([text(1, ''), whole(2, opset)]);
  return joined([
    whole(1, irVersion),
    text(2, 'auto-runtime candidates'),
    delimited(7, graph),
    delimited(8, operators),
  ]);
}
