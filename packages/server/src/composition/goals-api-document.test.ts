import { openApiPath } from '@on.auto/api';
import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { servingReasoning } from '../testing/servers/reasoning-server.ts';
import { servingReasoningWithGoals } from '../testing/settings/goals-kept.ts';

const Properties = Schema.Record(Schema.String, Schema.Unknown);

const Body = Schema.Struct({
  content: Schema.optionalKey(
    Schema.Struct({
      'application/json': Schema.optionalKey(
        Schema.Struct({ schema: Schema.Struct({ properties: Schema.optionalKey(Properties) }) }),
      ),
    }),
  ),
});

const Operation = Schema.Struct({
  requestBody: Schema.optionalKey(Body),
  responses: Schema.Record(Schema.String, Body),
});

const ServedDocument = Schema.Struct({ paths: Schema.Record(Schema.String, Schema.Record(Schema.String, Operation)) });

type Served = typeof ServedDocument.Type;

const textOf = async (serving: typeof servingReasoning): Promise<string> => {
  const server = await serving([]);
  try {
    return await (await fetch(`${server.origin}${openApiPath}`)).text();
  } finally {
    await server.stop();
  }
};

const documentOf = async (serving: typeof servingReasoning): Promise<Served> =>
  Schema.decodeUnknownSync(ServedDocument)(JSON.parse(await textOf(serving)));

const playbooks = '/orgs/{org}/playbooks';
const playbook = '/orgs/{org}/playbooks/{playbook}';

const takenBy = ({ paths }: Readonly<Served>, path: string, method: string) =>
  paths[path]?.[method]?.requestBody?.content?.['application/json']?.schema.properties?.['goals'];

const answeredBy = ({ paths }: Readonly<Served>, path: string, method: string, status: string) =>
  paths[path]?.[method]?.responses[status]?.content?.['application/json']?.schema.properties?.['goals'];

const argumentsAndAnswers = (document: Readonly<Served>) => [
  takenBy(document, playbooks, 'post'),
  takenBy(document, playbook, 'put'),
  answeredBy(document, playbooks, 'post', '201'),
  answeredBy(document, playbook, 'put', '200'),
  answeredBy(document, playbook, 'get', '200'),
];

describe('the API document of a server that keeps goals', () => {
  it('carries the goals argument of create and update and the goals answer of create, update and get', async () => {
    const asked: unknown = expect.objectContaining({ type: 'string', maxLength: 16_384 });
    const answer = { $ref: '#/$defs/PlaybookGoals' };

    expect(argumentsAndAnswers(await documentOf(servingReasoningWithGoals))).toEqual([
      asked,
      asked,
      answer,
      answer,
      answer,
    ]);
  });

  it('carries none of them where a server keeps no goals', async () => {
    expect(argumentsAndAnswers(await documentOf(servingReasoning))).toEqual(Array.from({ length: 5 }, () => void 0));
  });

  it('defines the goals answer with its source, version, gaps and the kinds of gap', async () => {
    const document = await textOf(servingReasoningWithGoals);

    expect(
      ['PlaybookGoals', 'GoalGap', 'no_goal', 'fixed_by', 'version', 'source'].filter(
        (word) => !document.includes(`"${word}"`),
      ),
    ).toEqual([]);
  });
});

const GuideParameters = Schema.Struct({
  paths: Schema.Struct({
    '/guides/{guide}': Schema.Struct({
      get: Schema.Struct({
        parameters: Schema.Array(Schema.Struct({ schema: Schema.Struct({ enum: Schema.Array(Schema.String) }) })),
      }),
    }),
  }),
});

const guidesNamedBy = async (serving: typeof servingReasoning): Promise<readonly string[]> =>
  Schema.decodeUnknownSync(GuideParameters)(JSON.parse(await textOf(serving))).paths[
    '/guides/{guide}'
  ].get.parameters.flatMap(({ schema }) => schema.enum);

describe('the guides the API document names', () => {
  it('are those of a server without goals and the goals guide after the terminology, only where goals are kept', async () => {
    const [withGoals, without] = [
      await guidesNamedBy(servingReasoningWithGoals),
      await guidesNamedBy(servingReasoning),
    ];

    expect(withGoals).toEqual(without.toSpliced(2, 0, 'goals'));
    expect(without).not.toContain('goals');
  });
});
