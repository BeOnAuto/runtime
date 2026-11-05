import { readFileSync } from 'node:fs';

import { shippedFilesOnDisk } from '@on.auto/shipped-files/on-disk';
import { describe, expect, it } from 'vitest';

import { apiShippedRoots } from '../index.ts';
import { recipesFor } from './recipes.ts';

const recipeFiles = shippedFilesOnDisk(apiShippedRoots());

const connectAService = readFileSync(new URL('recipes/connect-a-service.md', import.meta.url), 'utf8');

const withNoFormatGuide = await recipesFor(recipeFiles, []);

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

  it('sends an agent to reconnect_connection where search says a connection is broken and its words say to reconnect it', () => {
    expect(connectAService).toContain(
      "Where search says a server's connection is `connection_broken` and its words say to reconnect it, call reconnect_connection with its `connection` as `id` and give the person the link it answers, rather than removing the connection and adding it again.",
    );
  });
});
