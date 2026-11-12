import { readFileSync } from 'node:fs';

import { shippedFilesOnDisk } from '@on.auto/shipped-files/on-disk';
import { describe, expect, it } from 'vitest';

import { apiShippedRoots } from '../index.ts';
import { recipesFor } from './recipes.ts';

const recipeFiles = shippedFilesOnDisk(apiShippedRoots());

const connectAService = readFileSync(new URL('recipes/connect-a-service.md', import.meta.url), 'utf8');

const withNoFormatGuide = await recipesFor(recipeFiles, [], []);

describe('the connect-a-service recipe', () => {
  it('is offered whatever format guides are carried, since it names none, as its file has it', () => {
    const recipes = withNoFormatGuide;

    expect(recipes.map(({ name, formatGuide, text }) => [name, formatGuide, text])).toEqual([
      ['connect-a-service', undefined, connectAService],
    ]);
  });

  it('asks the person in their own words, and calls the tools that connect a service and set it up by hand', () => {
    const recipes = withNoFormatGuide;
    const recipe = recipes.find(({ name }) => name === 'connect-a-service');

    expect(recipe?.request({ service: 'Linear' })).toBe(
      'Connect Linear to Auto for my team, then tell me what it can do.',
    );
    expect(recipe?.calls).toEqual([
      'search',
      'introspect',
      'add_connection',
      'list_connections',
      'reconnect_connection',
      'remove_connection',
      'query_connection',
      'execute_connection',
    ]);
  });
});

describe('what the connect-a-service recipe says', () => {
  it('works out first what the runs will do at the service and what must exist there, asks for the access both take in one add_connection, and sets the service up and checks it by hand once the person agrees, never with a function or workflow', () => {
    expect(connectAService).toContain(
      'A run does not set a service up, nor does it check that one is set up. You do, here, with the person, before the first run, and you ask for the access that takes when you ask for the connection.',
    );
    expect(connectAService).toContain(
      "what the playbook's functions and workflows will do at the service, run by run, and what must exist there first for that to work.",
    );
    expect(connectAService).toContain(
      'in the same call ask for what setting the service up needs: where search lists a group of `more` under the provider that covers it, name it in `more`, so the person approves once.',
    );
    expect(connectAService).toContain(
      "Where none of the provider's tools can make what must exist, and the service has an HTTP API or an MCP server that can, add that too, by hand",
    );
    expect(connectAService).toContain(
      'Once they agree, make each change with execute_connection and read it back with query_connection. Where no connected tool can make a change, tell the person exactly what to change in the service and where, and read it back once they say it is done. Never make a function or workflow to set a service up or to check that it is set up: that is your work, with these tools, before the first run and whenever something there changes.',
    );
  });

  it('connects a service no provider serves by what the service offers, its MCP server where its documentation names one and else its HTTP API, by the address of its document only where its documentation states it and else by a document the agent writes, tells the person where the documentation gives no address for the calls, and never asks the person for anything technical', () => {
    expect(connectAService).toContain(
      "Where search lists `providers` but none serves the service, or its provider's tools cannot do what is needed, connect what the service itself offers, by hand, in this order. Where its own documentation names an MCP server, add that, leaving its credential out, since the server says how it authenticates; where add_connection refuses it with an error at `/credential` saying the server names no way of its own to authenticate, call it again with the credential saying how the server takes its key, never the key.",
    );
    expect(connectAService).toContain(
      "Give `document` only where the service's documentation states the address of its OpenAPI document. Otherwise write that document yourself from the documentation, describing the calls the job needs and their parameters, and give it as `document_text`, with `base_url`, the address the documentation gives for those calls; the credential says where the key goes, the header or query parameter the documentation names, and with `instructions` and `key_page` where the person makes it.",
    );
    expect(connectAService).toContain(
      'Where the documentation gives no address for those calls, tell the person the service cannot be connected this way. Never guess an address, never ask the person for one, and never ask them to host a file or to write anything technical: the person pastes the key on the page and approves.',
    );
  });

  it('tells a search that offers no providers, where no connection can be added here, from one that lists providers but none for the service', () => {
    expect(connectAService).toContain(
      "Where search's answer to a call without `server` has no `providers` at all, no connection can be added here:",
    );
    expect(connectAService).toContain('4. Where search lists `providers` but none serves the service,');
  });

  it('sends an agent to reconnect_connection where search says a connection is broken and its words say to reconnect it', () => {
    expect(connectAService).toContain(
      "Where search says a server's connection is `connection_broken` and its words say to reconnect it, call reconnect_connection with its `connection` as `id` and give the person the link it answers, rather than removing the connection and adding it again.",
    );
  });
});

describe('how the connect-a-service recipe finds a service, keeps what it read and corrects a document it wrote', () => {
  it('reads one call of an HTTP API whose document the agent wrote once it is connected, and corrects the document after that read by adding the connection again as list_connections answered it, the person approving and giving a key once more', () => {
    expect(connectAService).toContain(
      'For an HTTP API whose document you wrote, read with one of its calls first and tell the person what came back: a call the document declares as GET or HEAD is marked reads, which query_connection calls; any other may change something, so call it with execute_connection, once the person agrees.',
    );
    expect(connectAService).toContain(
      'Where the service answers that first read by saying a path or a parameter is wrong, correct the document: read the connection with list_connections, remove it with remove_connection, and add it again with what list_connections answered for it, its `name`, `type`, `credential` and its whole `entry`, with the document corrected in `document_text`; then tell the person they will approve it and paste the key once more, or make a new key where the service shows a key only once.',
    );
  });

  it("searches by the service's name too, since search finds a provider by the words of its name, title and description", () => {
    expect(connectAService).toContain(
      "Put the service's name in `terms` too: search finds a provider by the words of its name, title and description.",
    );
  });

  it('gives what must exist at a service as kinds of thing, none of them the pattern, and keeps the ids of what it read', () => {
    expect(connectAService).toContain(
      'expect what they act on to be there already: a channel, a folder, a label, a field, the stages work moves through.',
    );
    expect(connectAService).toContain('8. Keep the ids you read of what must exist, for the functions that use them.');
  });
});
