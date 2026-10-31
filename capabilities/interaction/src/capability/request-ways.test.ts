import { defineUpdateDefinition } from '@on.auto/definitions';
import { savedIn } from '@on.auto/definitions/testing';
import { OperationsServed } from '@on.auto/operations';
import type { ToolServer } from '@on.auto/tool-servers';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  agentDelivery,
  approvalDocument,
  fakeTools,
  interactionHarness,
  noTools,
  notificationDocument,
} from '../testing/index.ts';
import { requestDocumentOf } from '../testing/route-documents.ts';
import { partyInWords } from './request-way-words.ts';
import { wayCheck } from './request-ways.ts';

const unsaid = approvalDocument([]);

const theAgentWay =
  'deliver: agent holds the request for an agent, which reads it with list_interactions and answers it with answer_interaction';

const sayHow = `Line 2, /deliver: Say how the owner is reached: deliver names the tool of a connection that sends the request, with replies naming its tool that reads the replies, or ${theAgentWay}.`;

const throughTheChat =
  'Line 2, /deliver: Deliver through chat: write deliver with server chat and tool post_message, its sent pointing into what post_message answers, and replies with tool thread_replies; learn what each tool takes with introspect, and call post_message with execute once the person agrees.';

const forAnAgent =
  'Line 2, /deliver: Write deliver: agent; an agent reads the request with list_interactions and answers it with answer_interaction.';

const throughAConnection = 'it goes through a connection, deliver naming the tool that sends it';

describe('a request saved without saying how its party is reached', () => {
  it('is refused, naming the connections whose tools can send a request and read its replies, and the agent way, with a choice for each', async () => {
    const playbook = interactionHarness({ tools: fakeTools() });

    expect(await playbook.define('approve-brief', unsaid)).toEqual({
      status: 'rejected',
      reason: 'invalid_input',
      detail: 'The interaction function definition has a problem',
      issues: [
        {
          pointer: '/source',
          detail: `${sayHow} This playbook can send a request and read its replies through the connection chat (post_message, thread_replies).`,
        },
      ],
      options: {
        question: 'Where should the owner be asked?',
        choices: [
          { value: 'connection:chat', title: 'chat', issues: [{ pointer: '/source', detail: throughTheChat }] },
          { value: 'agent', title: 'An agent, such as this one', issues: [{ pointer: '/source', detail: forAnAgent }] },
        ],
      },
    });
  });

  it('is refused on an update as on a create, once its version that names deliver: agent is saved', async () => {
    const playbook = interactionHarness({ tools: fakeTools() });
    const updating = (source: string) =>
      playbook.call(defineUpdateDefinition(playbook.capabilities), {
        type: 'interaction',
        name: 'approve-brief',
        source,
      });

    expect(await playbook.define('approve-brief', approvalDocument())).toMatchObject({ status: 'succeeded' });
    expect(await updating(unsaid)).toMatchObject({ status: 'rejected', reason: 'invalid_input' });
  });
});

function throughTheChatAlone(line: number): string {
  return `Line ${line}, /deliver: Deliver through chat: write deliver with server chat and tool post_message; learn what it takes with introspect, and call it with execute once the person agrees.`;
}

const reachedThroughTheChat = 'This playbook can send it through the connection chat (post_message).';

function refusedNotification(detail: string, line: number) {
  return {
    status: 'rejected',
    reason: 'invalid_input',
    detail: 'The interaction function definition has a problem',
    issues: [{ pointer: '/source', detail: `${detail} ${reachedThroughTheChat}` }],
    options: {
      question: 'Where should the owner be told?',
      choices: [
        {
          value: 'connection:chat',
          title: 'chat',
          issues: [{ pointer: '/source', detail: throughTheChatAlone(line) }],
        },
      ],
    },
  };
}

describe('a notification saved without a tool that sends it', () => {
  it('is refused said for an agent, as one that goes through a connection, offering the connections that can send it alone', async () => {
    const playbook = interactionHarness({ tools: fakeTools() });

    expect(await playbook.define('brief-out', notificationDocument(agentDelivery))).toEqual(
      refusedNotification(
        `Line 4, /deliver: A notification takes no answer, so no agent holds it: ${throughAConnection}.`,
        4,
      ),
    );
  });

  it('is refused unsaid in the same way, saying how its party is reached', async () => {
    const playbook = interactionHarness({ tools: fakeTools() });

    expect(await playbook.define('brief-out', notificationDocument([]))).toEqual(
      refusedNotification(
        `Line 2, /deliver: Say how the owner is reached: a notification takes no answer, so ${throughAConnection}.`,
        2,
      ),
    );
  });

  it('offers nothing to choose where no connection or tool server can send it', async () => {
    const refused = await interactionHarness({ tools: noTools }).define('brief-out', notificationDocument([]));

    expect(refused).toMatchObject({ status: 'rejected', reason: 'invalid_input' });
    expect(refused).not.toHaveProperty('options');
  });
});

interface Reaching {
  readonly servers: readonly ToolServer[];
  readonly takesConnections: boolean;
  readonly served: readonly string[] | 'every operation';
}

const everywhere: Reaching = { servers: [], takesConnections: true, served: 'every operation' };

function refusedOver(reaching: Partial<Reaching>, source = unsaid) {
  const { servers, takesConnections, served } = { ...everywhere, ...reaching };
  const ports = { ...noTools, takesConnections, listServers: () => Effect.succeed(servers) };
  const serves = (name: string) => served === 'every operation' || served.includes(name);
  const checked = wayCheck(ports)(requestDocumentOf(source), source, savedIn);
  return Effect.runPromise(Effect.flip(checked.pipe(Effect.provideService(OperationsServed, serves))));
}

async function reachedOver(reaching: Partial<Reaching>): Promise<string | undefined> {
  const refused = await refusedOver(reaching);
  return refused.issues[0]?.detail.slice(sayHow.length + 1);
}

function serverOf(name: string, fields: Partial<ToolServer>): ToolServer {
  return { name, type: 'mcp', record_content: true, playbooks: ['*'], provider: null, tools: [], ...fields };
}

const mail = serverOf('mail', {
  tools: [
    { name: 'send_mail', description: 'Sends mail.', input_schema: {} },
    { name: 'mail_replies', description: 'Lists the replies.', input_schema: {}, annotations: { readOnlyHint: true } },
  ],
});

const pending = serverOf('crm', {
  connection: 'conn_crm',
  unavailable: 'Nobody has approved the connection crm yet',
  because: 'connection_pending',
});

const files = serverOf('files', { tools: [{ name: 'list_files', description: 'Lists files.', input_schema: {} }] });

const drive = serverOf('drive', {
  connection: 'conn_drive',
  tools: [{ name: 'upload_file', description: 'Uploads a file.', input_schema: {} }],
});

describe('the way a request is reached, where no connection can carry it', () => {
  it('says how one is connected, with search and add_connection only where both are served, whenever no connection can carry it', async () => {
    expect([
      await reachedOver({}),
      await reachedOver({ served: ['search'] }),
      await reachedOver({ takesConnections: false }),
      await reachedOver({ servers: [files] }),
      await reachedOver({ servers: [drive] }),
      await reachedOver({ servers: [mail], served: ['search'] }),
      await reachedOver({ servers: [mail], takesConnections: false }),
    ]).toEqual([
      'No connection or tool server serves this playbook; one can be connected with search and add_connection.',
      'No connection or tool server serves this playbook; a person can add one to the org as a connection.',
      'No connection or tool server serves this playbook; whoever runs this server can set one up.',
      'No connection or tool server of this playbook has tools that can send a request and read its replies; one can be connected with search and add_connection.',
      'No connection or tool server of this playbook has tools that can send a request and read its replies; one can be connected with search and add_connection.',
      'This playbook can send a request and read its replies through the tool server mail (send_mail, mail_replies); a person can also add a connection to the org.',
      'This playbook can send a request and read its replies through the tool server mail (send_mail, mail_replies).',
    ]);
  });

  it('tells a playbook whose connections cannot be used why, and offers the agent way alone', async () => {
    const refused = await refusedOver({ servers: [pending] });

    expect(refused.issues[0]?.detail.slice(sayHow.length + 1)).toBe(
      'No connection or tool server of this playbook has tools that can send a request and read its replies; one can be connected with search and add_connection. “crm” cannot be used: Nobody has approved the connection crm yet.',
    );
    expect(refused.options?.choices.map(({ value }) => value)).toEqual(['agent']);
  });

  it('names a tool server of the settings as a tool server, its choice apart from any connection of the same name', async () => {
    const refused = await refusedOver({ servers: [mail] });

    expect(refused.issues[0]?.detail.slice(sayHow.length + 1)).toBe(
      'This playbook can send a request and read its replies through the tool server mail (send_mail, mail_replies); a connection can also be added with search and add_connection.',
    );
    expect(refused.options?.choices.map(({ value }) => value)).toEqual(['tool_server:mail', 'agent']);
  });
});

describe('a request said for an agent', () => {
  it('is saved, wherever it is saved', async () => {
    expect(await interactionHarness({ tools: noTools }).define('approve-brief', approvalDocument())).toMatchObject({
      status: 'succeeded',
    });
  });
});

describe('the party of a request in words', () => {
  it('names the input value it reads, the person where it is any other template, and is the text as written otherwise', () => {
    expect([
      partyInWords({ text: '{{ input.owner }}' }),
      partyInWords({ text: '{{input.account_manager}}' }),
      partyInWords({ text: '#approvals-{{ input.team }}' }),
      partyInWords({ text: '{% if input.urgent %}ops{% endif %}' }),
      partyInWords({ text: 'ada' }),
    ]).toEqual(['the owner', 'the account manager', 'the person', 'the person', 'ada']);
  });
});
