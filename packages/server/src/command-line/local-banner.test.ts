import { stripVTControlCharacters } from 'node:util';

import { describe, expect, it } from 'vitest';

import { headerOf, readyNoticeOf, stoppedNotice, stoppingNotice } from './local-banner.ts';
import { logoHeight, logoWidth } from './logo.ts';

const servedStudio = { origin: 'https://studio.on.auto', served: true };

const hostedStudio = { origin: 'https://studio.on.auto', served: false };

const ready = {
  version: '0.9.1',
  port: 5555,
  publicUrl: undefined,
  readyInMs: 640,
  mode: 'local',
  identityService: undefined,
  studio: servedStudio,
  install: undefined,
  license: '12 of 100 free runs used, then a free key from Studio',
} as const;

const newInstall = { id: '6f1c2b8e-3d4a-4e5f-9a0b-1c2d3e4f5a6b', isNew: true };

const firstStartLine =
  '  Auto Runtime sends an anonymous usage ping when it starts. To turn it off, set DO_NOT_TRACK=1 or USAGE_PING=false. https://on.auto/docs/self-host/configuration#usage-ping';

describe('the header of the auto-runtime command', () => {
  it('names the runtime and its version in plain text where there are no colors', () => {
    expect(headerOf('0.7.0', 1)).toBe('\nAuto Runtime v0.7.0\nRuns the playbooks your agent builds\n\n');
  });

  it('draws the logo with the name and the version beside its middle where there are colors', () => {
    const lines = headerOf('0.7.0', 24).split('\n');
    const plain = lines.map((line) => stripVTControlCharacters(line));

    expect(lines).toHaveLength(logoHeight + 3);
    const titleLine = Math.floor(logoHeight / 2);

    expect(plain[titleLine]?.slice(2 + logoWidth)).toBe('  Auto Runtime v0.7.0');
    expect(plain[titleLine + 1]?.slice(2 + logoWidth)).toBe('  Runs the playbooks your agent builds');
  });
});

const localModeLine =
  '  Local mode: no sign-in, so anyone using this computer can act as you. To require sign-in, set PUBLIC_URL.';

describe('the notice that the server is ready', () => {
  it('gives the addresses, the free runs it used, that it is in local mode and how to require sign-in, and how to connect an agent', () => {
    expect(readyNoticeOf(ready, 1).split('\n')).toEqual([
      '  ✔ Ready in 640 ms',
      '  ➜  Studio   http://localhost:5555/studio/',
      '     Server   http://localhost:5555',
      '     MCP      http://localhost:5555/mcp',
      '     Docs     https://on.auto/docs/',
      '',
      '  12 of 100 free runs used, then a free key from Studio',
      localModeLine,
      '',
      '  Connect your agent',
      '    Claude Code   claude mcp add auto-runtime -- npx -y @on.auto/runtime@0.9.1 mcp',
      '    Codex         codex mcp add auto-runtime -- npx -y @on.auto/runtime@0.9.1 mcp',
      '',
      '  Press Ctrl+C to stop.',
      '',
    ]);
  });

  it('links the addresses where the terminal shows colors', () => {
    const notice = readyNoticeOf(ready, 24);

    expect(notice).toContain('\u001B]8;;http://localhost:5555/mcp\u001B\\http://localhost:5555/mcp\u001B]8;;\u001B\\');
    expect(stripVTControlCharacters(notice)).toBe(readyNoticeOf(ready, 1));
  });
});

describe('the Studio entry of the notice that the server is ready', () => {
  it('shows the Studio the server serves by its address alone for the default server, and links to it with the server and this terminal', () => {
    const notice = readyNoticeOf(ready, 24);

    expect(notice).toContain(
      '\u001B]8;;http://localhost:5555/studio/?server=http%3A%2F%2Flocalhost%3A5555&src=terminal\u001B\\http://localhost:5555/studio/\u001B]8;;\u001B\\',
    );
  });

  it('links to Studio with the install of the server too, where it has one, and shows it no differently', () => {
    const notice = readyNoticeOf({ ...ready, install: { ...newInstall, isNew: false } }, 24);

    expect(notice).toContain(
      '\u001B]8;;http://localhost:5555/studio/?server=http%3A%2F%2Flocalhost%3A5555&src=terminal&install=6f1c2b8e-3d4a-4e5f-9a0b-1c2d3e4f5a6b\u001B\\http://localhost:5555/studio/\u001B]8;;\u001B\\',
    );
    expect(stripVTControlCharacters(notice)).toBe(readyNoticeOf(ready, 1));
  });

  it('shows the Studio host with the server where the server serves no Studio, since its root alone opens Auto Cloud', () => {
    expect([
      readyNoticeOf({ ...ready, studio: hostedStudio }, 1).split('\n')[1],
      readyNoticeOf({ ...ready, port: 6000, studio: hostedStudio }, 1).split('\n')[1],
    ]).toEqual([
      '  ➜  Studio   https://studio.on.auto/?server=http://localhost:5555',
      '  ➜  Studio   https://studio.on.auto/?server=http://localhost:6000',
    ]);
  });
});

describe('how the notice shows Studio', () => {
  it('shows the Studio the server serves by its address alone on any port, since it opens the server that serves it', () => {
    expect(readyNoticeOf({ ...ready, port: 6000 }, 1)).toContain('  ➜  Studio   http://localhost:6000/studio/\n');
  });

  it('sets the Studio link apart, in bold cyan, and dims the labels of the others', () => {
    const lines = readyNoticeOf(ready, 24).split('\n');
    const studio = String(lines.find((line) => line.includes('Studio')));
    const server = String(lines.find((line) => line.includes('Server')));

    expect(studio).toContain('\u001B[36m\u001B[1m\u001B]8;;http://localhost:5555/studio/');
    expect(server).toContain('\u001B[2mServer  \u001B[22m');
    expect(server).not.toContain('\u001B[1m');
  });
});

describe('the notice that a server in local mode is ready', () => {
  it('dims the line of its license and the line of local mode', () => {
    const lines = readyNoticeOf({ ...ready, port: 6000 }, 24).split('\n');

    expect(lines).toContain('  \u001B[2m12 of 100 free runs used, then a free key from Studio\u001B[22m');
    expect(lines).toContain(
      '  \u001B[2mLocal mode: no sign-in, so anyone using this computer can act as you. To require sign-in, set PUBLIC_URL.\u001B[22m',
    );
  });

  it('says who it is licensed to once it is licensed, and leaves out the line of a license it cannot read', () => {
    const licensed = readyNoticeOf({ ...ready, license: 'Licensed to acme (team plan)' }, 1).split('\n');
    const unread = readyNoticeOf({ ...ready, license: undefined }, 1).split('\n');

    expect(licensed.slice(5, 8)).toEqual(['', '  Licensed to acme (team plan)', localModeLine]);
    expect(unread.slice(5, 8)).toEqual(['', localModeLine, '']);
  });
});

describe('the notice that the server is ready, the first time it starts with a usage ping', () => {
  it('says once, above the way to stop it, that it sends an anonymous usage ping and how to turn it off', () => {
    const lines = readyNoticeOf({ ...ready, install: newInstall }, 1).split('\n');

    expect(lines.slice(-6)).toEqual([
      '    Codex         codex mcp add auto-runtime -- npx -y @on.auto/runtime@0.9.1 mcp',
      '',
      firstStartLine,
      '',
      '  Press Ctrl+C to stop.',
      '',
    ]);
  });

  it('dims the line where the terminal shows colors', () => {
    expect(readyNoticeOf({ ...ready, install: newInstall }, 24)).toContain(
      `  \u001B[2m${firstStartLine.trimStart()}\u001B[22m\n`,
    );
  });

  it('says nothing of it once the install was made at an earlier start, or where the usage ping is off', () => {
    expect([
      readyNoticeOf({ ...ready, install: { ...newInstall, isNew: false } }, 1),
      readyNoticeOf(ready, 1),
    ]).not.toContainEqual(expect.stringContaining('usage ping'));
  });
});

describe('how the notice says to connect an agent', () => {
  it('gives the mcp command of its own release the port of a server in local mode on another port', () => {
    const notice = readyNoticeOf({ ...ready, port: 6060 }, 1);

    expect(notice).toContain(
      '    Claude Code   claude mcp add --env PORT=6060 auto-runtime -- npx -y @on.auto/runtime@0.9.1 mcp\n',
    );
    expect(notice).toContain(
      '    Codex         codex mcp add auto-runtime --env PORT=6060 -- npx -y @on.auto/runtime@0.9.1 mcp\n',
    );
  });

  it('connects an agent over HTTP to a server that signs people in, so that the agent signs its person in', () => {
    const notice = readyNoticeOf({ ...ready, mode: 'credentials', identityService: 'https://clerk.on.auto' }, 1);

    expect(notice).toContain(
      '    Claude Code   claude mcp add --transport http auto-runtime http://localhost:5555/mcp\n',
    );
    expect(notice).toContain('    Codex         codex mcp add auto-runtime --url http://localhost:5555/mcp\n');
  });
});

describe('the notice that a server that signs persons in is ready', () => {
  it('names the identity service they sign in through, beneath the MCP endpoint, and says nothing of local mode', () => {
    const signingIn = {
      ...ready,
      mode: 'credentials',
      identityService: 'https://clerk.on.auto',
      license: undefined,
    } as const;
    const lines = readyNoticeOf(signingIn, 1).split('\n');

    expect(lines.slice(3, 8)).toEqual([
      '     MCP      http://localhost:5555/mcp',
      '     Sign-in  https://clerk.on.auto',
      '     Docs     https://on.auto/docs/',
      '',
      '  Connect your agent',
    ]);
  });
});

describe('the notice that a server that takes keys alone is ready', () => {
  it('names no identity service and says nothing of local mode', () => {
    const lines = readyNoticeOf({ ...ready, mode: 'credentials', license: undefined }, 1).split('\n');

    expect(lines.slice(3, 7)).toEqual([
      '     MCP      http://localhost:5555/mcp',
      '     Docs     https://on.auto/docs/',
      '',
      '  Connect your agent',
    ]);
  });
});

const atItsAddress = {
  ...ready,
  publicUrl: 'https://auto.example.com',
  mode: 'credentials',
  identityService: 'https://clerk.on.auto',
  studio: hostedStudio,
  license: undefined,
} as const;

describe('the notice that a server reached at its PUBLIC_URL is ready', () => {
  it('gives that address for Studio, the server, MCP and the agent commands, and never localhost', () => {
    const lines = readyNoticeOf(atItsAddress, 1).split('\n');

    expect(lines).toEqual([
      '  ✔ Ready in 640 ms',
      '  ➜  Studio   https://studio.on.auto/?server=https://auto.example.com',
      '     Server   https://auto.example.com',
      '     MCP      https://auto.example.com/mcp',
      '     Sign-in  https://clerk.on.auto',
      '     Docs     https://on.auto/docs/',
      '',
      '  Connect your agent',
      '    Claude Code   claude mcp add --transport http auto-runtime https://auto.example.com/mcp',
      '    Codex         codex mcp add auto-runtime --url https://auto.example.com/mcp',
      '',
      '  Press Ctrl+C to stop.',
      '',
    ]);
    expect(lines.join('\n')).not.toContain('localhost');
  });

  it('links Studio on the Studio host to that address, from this terminal', () => {
    expect(readyNoticeOf(atItsAddress, 24)).toContain(
      '\u001B]8;;https://studio.on.auto/?server=https%3A%2F%2Fauto.example.com&src=terminal\u001B\\https://studio.on.auto/?server=https://auto.example.com\u001B]8;;\u001B\\',
    );
  });

  it('gives the address of a server in local mode that is given one on this computer, as a container is', () => {
    const lines = readyNoticeOf({ ...ready, port: 5555, publicUrl: 'http://127.0.0.1:6100' }, 1).split('\n');

    expect(lines.slice(1, 4)).toEqual([
      '  ➜  Studio   http://127.0.0.1:6100/studio/',
      '     Server   http://127.0.0.1:6100',
      '     MCP      http://127.0.0.1:6100/mcp',
    ]);
  });
});

describe('the notices of a stop', () => {
  it('say that the server is stopping and then that it stopped', () => {
    expect(stoppingNotice(1)).toBe('\n  Stopping…\n');
    expect(stoppedNotice(1)).toBe('  ✔ Stopped\n');
    expect(stripVTControlCharacters(stoppedNotice(24))).toBe(stoppedNotice(1));
  });
});
