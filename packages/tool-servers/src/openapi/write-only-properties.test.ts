import { describe, expect, it } from 'vitest';

import type { CallSettled } from '../clients/server-client.ts';
import { settledOf } from './api-answers.ts';
import type { AnswerSchemas } from './api-parameters.ts';

const answering = {
  requestIdHeader: null,
  failureCodes: null,
  now: () => Date.parse('2026-11-16T09:00:00.000Z'),
  input: {},
};

const ADDRESS = 'pat.person@team.example';

function resultOf(settled: CallSettled): unknown {
  return 'result' in settled ? settled.result : settled;
}

const peopleAnswers: AnswerSchemas = {
  schemas: [
    {
      allOf: [
        { $ref: '#/$defs/Answer' },
        {
          type: 'object',
          properties: {
            members: { type: 'array', items: { $ref: '#/$defs/Person' } },
            person: { $ref: '#/$defs/Person' },
            either: { anyOf: [{ type: 'null' }, { type: 'string', writeOnly: true }] },
            notWritten: { type: 'string', writeOnly: false },
          },
        },
      ],
    },
  ],
  headers: {},
  describesNoBody: false,
  components: {
    Answer: { type: 'object', properties: { ok: { type: 'boolean' } } },
    Person: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        profile: {
          type: 'object',
          properties: { real_name: { type: 'string' }, email: { type: 'string', writeOnly: true } },
        },
      },
    },
  },
};

function personWith(id: string, profile: Readonly<Record<string, unknown>>) {
  return { id, deleted: false, profile };
}

describe('a property an answer’s schema marks writeOnly', () => {
  it('is left out wherever the schema reaches it, through references, compositions and items, and the text is written again without it', async () => {
    const sent = {
      ok: true,
      members: [personWith('U1', { real_name: 'Pat', email: ADDRESS }), personWith('U2', { real_name: 'Sam' })],
      person: personWith('U1', { real_name: 'Pat', email: ADDRESS }),
      either: ADDRESS,
      notWritten: 'kept',
    };

    const result = resultOf(await settledOf(Response.json(sent), answering, peopleAnswers));

    const expected = {
      ok: true,
      members: [personWith('U1', { real_name: 'Pat' }), personWith('U2', { real_name: 'Sam' })],
      person: personWith('U1', { real_name: 'Pat' }),
      notWritten: 'kept',
    };
    expect(result).toEqual({
      content: [{ type: 'text', text: JSON.stringify(expected) }],
      structuredContent: expected,
    });
    expect(JSON.stringify(result)).not.toContain(ADDRESS);
  });

  it('leaves the text the API sent as it came where the answer holds none', async () => {
    const plain = '{ "ok": true, "person": { "id": "U2", "profile": { "real_name": "Sam" } } }';

    const result = resultOf(
      await settledOf(
        new Response(plain, { headers: { 'content-type': 'application/json' } }),
        answering,
        peopleAnswers,
      ),
    );

    expect(result).toEqual({
      content: [{ type: 'text', text: plain }],
      structuredContent: { ok: true, person: { id: 'U2', profile: { real_name: 'Sam' } } },
    });
  });
});
