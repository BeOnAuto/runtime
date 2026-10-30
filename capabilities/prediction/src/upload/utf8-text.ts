export interface Utf8Reading {
  readonly text: string;
  readonly rest: Uint8Array;
  readonly invalid: boolean;
}

interface Sequence {
  readonly length: number;
  readonly least: number;
  readonly most: number;
}

const notALead: Sequence = { length: 0, least: 0, most: 0 };

const byteOrderMark = '﻿';

interface Lead {
  readonly from: number;
  readonly to: number;
  readonly sequence: (lead: number) => Sequence;
}

const leads: readonly Lead[] = [
  { from: 0x00, to: 0x7f, sequence: () => ({ length: 1, least: 0x80, most: 0xbf }) },
  { from: 0xc2, to: 0xdf, sequence: () => ({ length: 2, least: 0x80, most: 0xbf }) },
  {
    from: 0xe0,
    to: 0xef,
    sequence: (lead) => ({ length: 3, least: lead === 0xe0 ? 0xa0 : 0x80, most: lead === 0xed ? 0x9f : 0xbf }),
  },
  {
    from: 0xf0,
    to: 0xf4,
    sequence: (lead) => ({ length: 4, least: lead === 0xf0 ? 0x90 : 0x80, most: lead === 0xf4 ? 0x8f : 0xbf }),
  },
];

function sequenceOf(lead: number): Sequence {
  const range = leads.find(({ from, to }) => lead >= from && lead <= to);
  return range === undefined ? notALead : range.sequence(lead);
}

type Scanned = 'whole' | 'incomplete' | 'invalid';

function scannedAt(bytes: Readonly<Uint8Array>, at: number, { length, least, most }: Sequence): Scanned {
  if (length === 0) {
    return 'invalid';
  }
  for (let next = 1; next < length; next += 1) {
    const byte = bytes[at + next];
    if (byte === undefined) {
      return 'incomplete';
    }
    const [low, high] = next === 1 ? [least, most] : [0x80, 0xbf];
    if (byte < low || byte > high) {
      return 'invalid';
    }
  }
  return 'whole';
}

function validPrefixOf(bytes: Readonly<Uint8Array>): string {
  let at = 0;
  let reached: Scanned = 'whole';
  while (at < bytes.length && reached === 'whole') {
    const sequence = sequenceOf(Number(bytes[at]));
    reached = scannedAt(bytes, at, sequence);
    at += reached === 'whole' ? sequence.length : 0;
  }
  return new TextDecoder('utf-8', { fatal: false, ignoreBOM: true }).decode(bytes.subarray(0, at));
}

function isContinuation(byte: number | undefined): boolean {
  return byte !== undefined && byte >= 0x80 && byte <= 0xbf;
}

function incompleteTailOf(bytes: Readonly<Uint8Array>): number {
  let start = bytes.length - 1;
  while (start > bytes.length - 4 && isContinuation(bytes[start])) {
    start -= 1;
  }
  const lead = bytes[start];
  return lead !== undefined && sequenceOf(lead).length > bytes.length - start ? bytes.length - start : 0;
}

export function utf8Of(bytes: Readonly<Uint8Array>, ending: boolean): Utf8Reading {
  const whole = bytes.subarray(0, bytes.length - (ending ? 0 : incompleteTailOf(bytes)));
  try {
    return {
      text: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(whole),
      rest: bytes.slice(whole.length),
      invalid: false,
    };
  } catch {
    return { text: validPrefixOf(bytes), rest: new Uint8Array(), invalid: true };
  }
}

export function withoutByteOrderMark(text: string): string {
  return text.startsWith(byteOrderMark) ? text.slice(1) : text;
}
