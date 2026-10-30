import { existsSync, writeFileSync } from 'node:fs';
import { setTimeout } from 'node:timers';
import { parseArgs } from 'node:util';

import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';

import { fakeToolServer, type ReceivedCall } from './fake-tools.ts';

const exitCode = 3;

const { values } = parseArgs({
  options: {
    stdout: { type: 'string', default: '' },
    chatter: { type: 'string', default: '1' },
    pad: { type: 'string', default: '0' },
    'linger-ms': { type: 'string', default: '1' },
    'start-once': { type: 'string', default: '' },
  },
});

const startedBefore = 4;

const marker = values['start-once'];

if (marker !== '' && existsSync(marker)) {
  process.exit(startedBefore);
}

if (marker !== '') {
  writeFileSync(marker, String(process.pid));
}

function say(text: string): void {
  process.stderr.write(text);
}

for (let line = 1; line <= Number(values.chatter); line += 1) {
  say(`The fake MCP server says line ${line} on stderr${'.'.repeat(Number(values.pad))}\n`);
}

process.stdout.write(values.stdout);

setTimeout(say, Number(values['linger-ms']), 'The fake MCP server lingered\n');

const received: ReceivedCall[] = [];

const server = fakeToolServer({
  receive: (call) => received.push(call),
  isRemoved: () => false,
  annotated: true,
  hints: {},
  data: false,
  exit: () => {
    process.exit(exitCode);
  },
});

await server.connect(new StdioServerTransport());
