import { InvalidInput, defineCommand } from '@on.auto/operations';
import { Effect, Schema } from 'effect';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { calledAnsweringForms, type FormAnswering } from '../testing/elicited-calls.ts';
import { listenOnLoopback, type Listening } from '../testing/listening.ts';
import { problemIn } from '../testing/mcp-clients.ts';
import { acmeAdmin, operationServer, type OperationServer } from '../testing/operation-server.ts';

const saved = { times: 0 };

const sayWhere = 'Say where the note goes: to the team, or to an agent';

const unsaid = new InvalidInput({
  detail: 'The note has a problem',
  issues: [{ pointer: '/way', detail: sayWhere }],
  options: {
    question: 'Where should the note go?',
    choices: [
      { value: 'team', title: 'The team', issues: [{ pointer: '/way', detail: 'Write way: team' }] },
      { value: 'agent', title: 'An agent', issues: [{ pointer: '/way', detail: 'Write way: agent' }] },
    ],
  },
});

const saveNote = defineCommand('org', {
  name: 'save_note',
  title: 'Save note',
  description:
    'Saves a note that says where it goes. Use it when the person writes a note. It answers whether it saved it.',
  route: { method: 'POST', path: '/notes' },
  inputSchema: Schema.Struct({ text: Schema.String, way: Schema.optionalKey(Schema.String) }),
  outputSchema: Schema.Struct({ saved: Schema.Boolean }),
  reasons: ['invalid_input'],
  handle: ({ way }) =>
    Effect.suspend(() => {
      saved.times += 1;
      return way === undefined ? Effect.fail(unsaid) : Effect.succeed({ saved: true });
    }),
  plainLanguage: {
    task: 'save a note',
    attempt: () => 'save the note',
    outcome: () => 'Saved the note.',
  },
});

let server: OperationServer;
let listening: Listening;

beforeAll(async () => {
  server = await operationServer({ operations: [saveNote] });
  listening = await listenOnLoopback(server.handler);
});

afterAll(async () => {
  await listening.close();
  await server.runtime.dispose();
});

const aNote = { text: 'Hello' };

function saving(answering: Partial<FormAnswering>, input: Readonly<Record<string, unknown>> = aNote) {
  const connection = { url: `${listening.origin}/mcp`, headers: { authorization: `Bearer ${acmeAdmin.key}` } };
  return calledAnsweringForms(connection, { name: 'save_note', arguments: input }, answering);
}

const theForm = {
  mode: 'form',
  message: 'Where should the note go?',
  requestedSchema: {
    type: 'object',
    properties: {
      choice: {
        type: 'string',
        title: 'Choose one',
        oneOf: [
          { const: 'team', title: 'The team' },
          { const: 'agent', title: 'An agent' },
        ],
      },
    },
    required: ['choice'],
  },
};

const refusedWithEveryOption: unknown = expect.objectContaining({
  detail: 'The note has a problem',
  errors: [{ pointer: '/way', detail: sayWhere }],
});

describe('a refusal that offers options, to a client that answers forms', () => {
  it('asks the person the question once, with a titled choice for each option, and refuses in the words of the chosen one', async () => {
    const before = saved.times;

    const { answer, elicited } = await saving({ content: { choice: 'team' } });

    expect(elicited).toEqual([theForm]);
    expect(answer.isError).toBe(true);
    expect(problemIn(answer)).toMatchObject({
      detail: 'The note has a problem',
      errors: [{ pointer: '/way', detail: 'Write way: team' }],
    });
    expect(saved.times - before).toBe(2);
  });

  it('refuses with every option, as without asking, when the person declines, cancels, or answers no option offered', async () => {
    const answers = await Promise.all([
      saving({ action: 'decline' }),
      saving({ action: 'cancel' }),
      saving({ content: { choice: 'elsewhere' } }),
      saving({ content: { way: 'team' } }),
    ]);

    expect(answers.map(({ elicited }) => elicited)).toEqual([[theForm], [theForm], [theForm], [theForm]]);
    expect(answers.map(({ answer }) => problemIn(answer))).toEqual(
      Array.from({ length: 4 }, () => refusedWithEveryOption),
    );
  });

  it('asks a client that declares elicitation with neither mode, which the SDK reads as forms', async () => {
    const { answer, elicited } = await saving({ declares: 'no mode', content: { choice: 'agent' } });

    expect(elicited).toEqual([theForm]);
    expect(problemIn(answer)).toMatchObject({ errors: [{ pointer: '/way', detail: 'Write way: agent' }] });
  });

  it('asks nothing of a call that succeeds', async () => {
    const { answer, elicited } = await saving({}, { text: 'Hello', way: 'team' });

    expect([elicited, answer.structuredContent]).toEqual([[], { saved: true }]);
  });
});

describe('a refusal that offers options, to a client that does not answer forms', () => {
  it('refuses at once with every option, never asking a client that declares no elicitation, links alone, or speaks 2025-11-25', async () => {
    const answers = await Promise.all([
      saving({ declares: 'no elicitation' }),
      saving({ declares: 'links alone' }),
      saving({ revision: 'previous revision' }),
    ]);

    expect(answers.map(({ elicited }) => elicited)).toEqual([[], [], []]);
    expect(answers.map(({ answer }) => problemIn(answer))).toEqual(
      Array.from({ length: 3 }, () => refusedWithEveryOption),
    );
  });
});
