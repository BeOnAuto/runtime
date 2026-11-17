import { openApiPath } from '@on.auto/api';
import { Schema } from 'effect';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';
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

interface ServedTexts {
  readonly document: string;
  readonly start: readonly [number, string];
}

const servers: ReasoningServer[] = [];

const served: { withGoals?: ServedTexts; without?: ServedTexts } = {};

async function documented(serving: typeof servingReasoning): Promise<ServedTexts> {
  const server = await serving([]);
  servers.push(server);
  const [document, start] = await Promise.all(
    [openApiPath, '/v1/guides/start'].map((path) => fetch(`${server.origin}${path}`)),
  );
  return { document: (await document?.text()) ?? '', start: [start?.status ?? 0, (await start?.text()) ?? ''] };
}

beforeAll(async () => {
  [served.withGoals, served.without] = await Promise.all([
    documented(servingReasoningWithGoals),
    documented(servingReasoning),
  ]);
});

afterAll(async () => {
  await Promise.all(servers.map((server) => server.stop()));
});

const textOf = (goals: boolean): string => (goals ? served.withGoals : served.without)?.document ?? '';

const documentOf = (goals: boolean): Served => Schema.decodeUnknownSync(ServedDocument)(JSON.parse(textOf(goals)));

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
  it('carries the goals argument of create and update and the goals answer of create, update and get', () => {
    const asked: unknown = expect.objectContaining({ type: 'string', maxLength: 16_384 });
    const answer = { $ref: '#/$defs/PlaybookGoals' };

    expect(argumentsAndAnswers(documentOf(true))).toEqual([asked, asked, answer, answer, answer]);
  });

  it('carries none of them where a server keeps no goals', () => {
    expect(argumentsAndAnswers(documentOf(false))).toEqual(Array.from({ length: 5 }, () => void 0));
  });

  it('defines the goals answer with its source, version, gaps and the kinds of gap', () => {
    const document = textOf(true);

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

const guidesNamedBy = (goals: boolean): readonly string[] =>
  Schema.decodeUnknownSync(GuideParameters)(JSON.parse(textOf(goals))).paths['/guides/{guide}'].get.parameters.flatMap(
    ({ schema }) => schema.enum,
  );

describe('the guides the API document names', () => {
  it('are those of a server without goals and the goals guide after the terminology, only where goals are kept', () => {
    const [withGoals, without] = [guidesNamedBy(true), guidesNamedBy(false)];

    expect(withGoals).toEqual(without.toSpliced(2, 0, 'goals'));
    expect(without).not.toContain('goals');
  });
});

describe('a server composed with the goals option', () => {
  it('serves a start guide that has a goals section only where it keeps goals', () => {
    expect([served.withGoals?.start[0], served.without?.start[0]]).toEqual([200, 200]);
    expect(served.withGoals?.start[1]).toContain('\n## Its goals\n');
    expect(served.without?.start[1]).not.toContain('## Its goals');
  });
});
