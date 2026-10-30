import { describe, expect, it } from 'vitest';

import { explanationOf, unsuccessfulWords, type ExplainedRejection, type Remedies } from '../index.ts';

const toolsNamed =
  'This can be put right on your side: whoever runs the server decides which tool servers and tools this playbook may use, which search shows, so once it names only those, it can be tried again.';

const serverFailed =
  'Nothing was called through it, so it can be tried again later; if it keeps happening, whoever runs the server can look into that tool server.';

const toolsOnlyRead =
  "Every tool it called only reads, by its server's own account, so running it again is safe: a new run, or a workflow's retry, may make it; its history shows what it called.";

const effectUnknown =
  'It is not run again by itself: a person decides, or a workflow rule that names this kind; its history shows the call.';

const calledAndUnfinished = 'it called tools but could not finish';

const mayHaveChanged =
  'it could not finish after calling a tool that may change something, so whether that happened is not known';

const unfinishedBecauses = [
  ['server_failed', 'a tool server failed', 'because a tool server failed'],
  ['tool_error', 'a tool answered an error', 'because the tool answered an error, which the details below give'],
  ['model_unavailable', 'the model did not finish', 'because the model stopped answering'],
  [
    'definition_refused',
    'its definition was refused',
    'because its definition was refused before its model could be called again',
  ],
  ['run_bound', 'ran out of time', 'because it ran out of time'],
  ['no_answer', 'never came to an answer', 'because the model kept calling tools instead of answering'],
] as const;

const toolEndings: ReadonlyArray<readonly [string, ExplainedRejection, string, string]> = [
  [
    'a tool server not set up for the playbook',
    { reason: 'unavailable', kind: 'tool_not_offered', because: 'tool_server_not_configured' },
    'this server does not offer a tool it names, because whoever runs the server has not set up a tool server of that name for this playbook',
    toolsNamed,
  ],
  [
    'a tool outside what is allowed',
    { reason: 'unavailable', kind: 'tool_not_offered', because: 'tool_not_allowed' },
    'this server does not offer a tool it names, because it is not among the tools whoever runs the server allows',
    toolsNamed,
  ],
  [
    'a tool its server does not have',
    { reason: 'unavailable', kind: 'tool_not_offered', because: 'tool_not_listed' },
    'this server does not offer a tool it names, because the tool server it names does not have that tool',
    toolsNamed,
  ],
  [
    'a connection whose credential cannot be read just now',
    { reason: 'unavailable', kind: 'tool_not_offered', because: 'connection_unavailable' },
    'this server does not offer a tool it names, because the credential of the connection it names cannot be read just now',
    'Nothing needs to change in the connection: trying again later can work, once whoever runs the server puts right what the details say.',
  ],
  [
    'a tool server that kept failing before any call',
    { reason: 'unavailable', kind: 'tool_server_failed', because: 'failing' },
    'a tool server it needs could not be used, because the tool server kept failing',
    serverFailed,
  ],
  [
    'a tool server that asked to slow down',
    { reason: 'unavailable', kind: 'tool_server_failed', because: 'rate_limited' },
    'a tool server it needs could not be used, because the tool server asked it to slow down for longer than a run waits',
    serverFailed,
  ],
  [
    'a tool server that did not accept its key',
    { reason: 'unavailable', kind: 'tool_server_failed', because: 'key_refused' },
    'a tool server it needs could not be used, because the tool server did not accept the key this server gives it',
    'Trying again will not help until whoever runs the server checks the key it gives that tool server.',
  ],
  [
    'a tool server that asks for a scope its credential lacks',
    { reason: 'unavailable', kind: 'tool_server_failed', because: 'scope_lacking' },
    'a tool server it needs could not be used, because the tool server asks for a scope its credential lacks, which the details name',
    'Trying again will not help until its credential is granted the scope the details name.',
  ],
  [
    'a tool server out of reach',
    { reason: 'unavailable', kind: 'tool_server_failed', because: 'unreachable' },
    'a tool server it needs could not be used, because the tool server could not be reached in time',
    serverFailed,
  ],
];

const unfinishedEndings: ReadonlyArray<readonly [string, ExplainedRejection, string, string]> =
  unfinishedBecauses.flatMap(([because, ended, words]) => [
    [
      `calls of tools that only read, where ${ended}`,
      { reason: 'unavailable', kind: 'tools_unfinished', because },
      `${calledAndUnfinished}, ${words}`,
      toolsOnlyRead,
    ],
    [
      `calls of a tool that may change something, where ${ended}`,
      { reason: 'conflict', kind: 'effect_unknown', because },
      `${mayHaveChanged}, ${words}`,
      effectUnknown,
    ],
  ]);

describe('explanationOf a run that needs tools', () => {
  it.each([...toolEndings, ...unfinishedEndings])('explains %s', (_case, rejection, why, remedy) => {
    expect(explanationOf(rejection)).toMatchObject({ why, remedy });
  });

  it('says only of tool calls whose effect is not known that something may have changed', () => {
    const changing = [...toolEndings, ...unfinishedEndings].filter(
      ([, rejection]) => explanationOf(rejection).mayHaveChanged === true,
    );

    expect(changing.map(([, rejection]) => rejection.kind)).toEqual(Array.from({ length: 6 }, () => 'effect_unknown'));
  });

  it('says why the effect is not known in 105 characters and what to do in 117, and that tools that only read may run again in 171', () => {
    const unknown = explanationOf({ reason: 'conflict', kind: 'effect_unknown' });
    const onlyRead = explanationOf({ reason: 'unavailable', kind: 'tools_unfinished' });

    expect([unknown.why.length, unknown.remedy.length, onlyRead.remedy.length]).toEqual([105, 117, 171]);
    expect(
      explanationOf({ reason: 'conflict', kind: 'effect_unknown', because: 'tool_error' }).why.slice(
        unknown.why.length + 2,
      ),
    ).toHaveLength(64);
  });
});

const serverNamed = 'search shows the tool servers this playbook may use.';

const ownRemedies: Remedies = { tool_server_not_configured: serverNamed };

const notConfigured = {
  status: 'rejected',
  reason: 'unavailable',
  detail: 'x',
  kind: 'tool_not_offered',
  because: 'tool_server_not_configured',
} as const;

describe('the remedies an operation gives of its own', () => {
  it('take the place of the shared remedy for their because, and leave it for any other', () => {
    expect(explanationOf(notConfigured, ownRemedies).remedy).toBe(serverNamed);
    expect(explanationOf({ ...notConfigured, because: 'tool_not_listed' }, ownRemedies).remedy).toBe(toolsNamed);
    expect(explanationOf(notConfigured).remedy).toBe(toolsNamed);
  });

  it('end the words of a refusal for their because', () => {
    expect(unsuccessfulWords('call the tool', 'command', notConfigured, ownRemedies)).toBe(
      `Could not call the tool: this server does not offer a tool it names, because whoever runs the server has not set up a tool server of that name for this playbook. Nothing was changed. ${serverNamed}`,
    );
  });
});

const calledTools = { status: 'rejected', reason: 'conflict', detail: 'x', kind: 'tools_called' } as const;

const calledOnlyReading = { ...calledTools, because: 'only_read' } as const;

describe('a run not made again under its id after calling tools that only read', () => {
  it('says that nothing was changed, which a run whose tools may have changed something never says', () => {
    expect(unsuccessfulWords('run the function', 'command', calledOnlyReading)).toBe(
      "Could not run the function: an attempt of this run under the same id did not succeed, and every tool it called only reads, by its server's own account. Nothing was changed. So it was not run again under its id: start a new run instead; its history shows what it called.",
    );
    expect(unsuccessfulWords('run the function', 'command', calledTools)).not.toContain('Nothing was changed.');
  });
});
