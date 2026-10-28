import { Buffer } from 'node:buffer';

import { describe, expect, it } from 'vitest';

import { candidateBytes } from '../candidates-testing/onnx-candidates.ts';
import { opsetOf } from './onnx-opset.ts';

function text(field: number, value: string): readonly number[] {
  const bytes = [...Buffer.from(value, 'utf8')];
  return [(field << 3) | 2, bytes.length, ...bytes];
}

function operatorSet(...entry: readonly number[]): readonly number[] {
  return [(8 << 3) | 2, entry.length, ...entry];
}

function opsetIn(...fields: readonly (readonly number[])[]): number {
  return opsetOf(Uint8Array.from(fields.flat()));
}

describe('the operator set of a model file', () => {
  it('is the version of the default domain a candidate imports', () => {
    expect([opsetOf(candidateBytes('visits-mean')), opsetOf(candidateBytes('visits-opset-12'))]).toEqual([13, 12]);
  });

  it('reads the default domain whether it is named ai.onnx or left empty, and passes over the others', () => {
    expect([
      opsetIn(operatorSet(...text(1, 'ai.onnx'), 2 << 3, 17)),
      opsetIn(operatorSet(2 << 3, 15)),
      opsetIn(operatorSet(...text(1, 'ai.onnx.ml'), 2 << 3, 3)),
    ]).toEqual([17, 15, 0]);
  });

  it('passes over the fields of fixed width around it and an entry with no version or a domain that is no text', () => {
    expect([
      opsetIn([(3 << 3) | 1, 1, 2, 3, 4, 5, 6, 7, 8], [(4 << 3) | 5, 1, 2, 3, 4], operatorSet(2 << 3, 14)),
      opsetIn(operatorSet(...text(1, ''))),
      opsetIn(operatorSet(1 << 3, 5, 2 << 3, 16)),
      opsetIn([8 << 3, 21]),
    ]).toEqual([14, 0, 16, 0]);
  });

  it('is none for a file that is not a model or that ends inside a field', () => {
    expect([
      opsetOf(candidateBytes('not-a-model')),
      opsetIn([8 << 3, 0x80]),
      opsetIn([(8 << 3) | 2, 0x80]),
      opsetIn([(8 << 3) | 2, 40, 1]),
      opsetIn([0x80]),
      opsetIn([(1 << 3) | 3]),
      opsetIn(operatorSet(2 << 3)),
    ]).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });
});
