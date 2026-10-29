import { Buffer } from 'node:buffer';

import { describe, expect, it } from 'vitest';

import type { CallSettled } from '../clients/server-client.ts';
import { settledOf } from './api-answers.ts';
import type { AnswerSchemas } from './api-parameters.ts';

const answering = { requestIdHeader: null, now: () => Date.parse('2026-10-29T09:00:00.000Z') };

function resultOf(settled: CallSettled): unknown {
  return 'result' in settled ? settled.result : settled;
}

function base64url(text: string): string {
  return Buffer.from(text).toString('base64url');
}

const gmailAnswers: AnswerSchemas = {
  schemas: [{ $ref: '#/$defs/Message' }],
  components: {
    Message: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        snippet: { type: 'string' },
        payload: { $ref: '#/$defs/MessagePart' },
        sizeEstimate: { type: 'integer' },
      },
    },
    MessagePart: {
      type: 'object',
      properties: {
        mimeType: { type: 'string' },
        body: { $ref: '#/$defs/MessagePartBody' },
        parts: { type: 'array', items: { $ref: '#/$defs/MessagePart' } },
      },
    },
    MessagePartBody: {
      type: 'object',
      properties: { attachmentId: { type: 'string' }, data: { type: 'string', format: 'byte' } },
    },
  },
};

const greeting = 'Hello Ada,\r\nthe café opens at 9 — bring the plans?\r\n';

const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString('base64url');

function messageOf(text: string, image: string, belled: string) {
  return {
    id: '18c2f0',
    snippet: 'SGVsbG8',
    sizeEstimate: 2048,
    payload: {
      mimeType: 'multipart/mixed',
      parts: [
        { mimeType: 'text/plain', body: { data: text } },
        { mimeType: 'image/png', body: { attachmentId: 'ANGjdJ8', data: image } },
        { mimeType: 'text/plain', body: { data: belled } },
        { mimeType: 'text/plain', body: { data: 'not base64!' } },
      ],
    },
  };
}

const envelopeAnswers: AnswerSchemas = {
  schemas: [{ $ref: '#/$defs/Envelope' }],
  components: {
    Envelope: {
      type: 'object',
      properties: {
        headers: { type: 'object', additionalProperties: { type: 'string', format: 'byte' } },
        either: { anyOf: [{ type: 'null' }, { type: 'string', format: 'byte' }] },
        merged: { allOf: [{ $ref: '#/$defs/Loop' }] },
        absent: { $ref: '#/$defs/Absent' },
        elsewhere: { $ref: 'https://schemas.example.com/byte' },
        count: { type: 'integer' },
        labels: { type: 'array', items: { type: 'string' } },
      },
    },
    Loop: { $ref: '#/$defs/Loop' },
  },
};

describe('an answer of an HTTP API whose document marks a string format byte', () => {
  it('shows a Gmail message with the body of each part decoded where its bytes are text, and the rest as it came', async () => {
    const sent = messageOf(base64url(greeting), pngHeader, base64url('\u0007ring'));

    const settled = await settledOf(Response.json(sent), answering, gmailAnswers);

    const shown = messageOf(greeting, pngHeader, base64url('\u0007ring'));
    expect(resultOf(settled)).toEqual({
      content: [{ type: 'text', text: JSON.stringify(shown) }],
      structuredContent: shown,
    });
  });

  it('decodes the standard alphabet as the URL-safe one, and leaves a string of another length or of both alphabets', async () => {
    const standard = Buffer.from('é?>').toString('base64');
    const answers: AnswerSchemas = {
      schemas: [{ type: 'array', items: { type: 'string', format: 'byte' } }],
      components: {},
    };

    const settled = await settledOf(Response.json([standard, 'aGVsbG8=x', 'ab+_', '']), answering, answers);

    expect(resultOf(settled)).toMatchObject({ structuredContent: ['é?>', 'aGVsbG8=x', 'ab+_', ''] });
  });

  it('follows maps, compositions and references as far as they lead', async () => {
    const sent = { headers: { Subject: base64url('Hi') }, either: base64url('x'), absent: 'aGk', elsewhere: 'aGk' };

    const decoded = await settledOf(Response.json(sent), answering, envelopeAnswers);

    expect(resultOf(decoded)).toMatchObject({
      structuredContent: { headers: { Subject: 'Hi' }, either: 'x', absent: 'aGk', elsewhere: 'aGk' },
    });
  });

  it('keeps the text the API sent where nothing decodes', async () => {
    const plain = '{\n  "count": 2,\n  "merged": "aGk",\n  "labels": ["INBOX"]\n}';

    const kept = await settledOf(
      new Response(plain, { headers: { 'content-type': 'application/json' } }),
      answering,
      envelopeAnswers,
    );

    expect(resultOf(kept)).toEqual({
      content: [{ type: 'text', text: plain }],
      structuredContent: { count: 2, merged: 'aGk', labels: ['INBOX'] },
    });
  });
});
