import type { AccessMode, SignInSettings, StudioSettings } from '@on.auto/identity';

import { release } from '../composition/release.ts';
import type { ColorDepth } from '../logging/terminal.ts';
import type { Install, LicenseNotice } from '../server-options/server-options.ts';
import { clearedLine, headerOf, readyNoticeOf, startingLine, stoppedNotice, stoppingNotice } from './local-banner.ts';

interface LocalServer {
  readonly port: number;
  readonly publicUrl: string | undefined;
  readonly mode: AccessMode;
  readonly signIn: SignInSettings | undefined;
  readonly studio: StudioSettings;
  readonly install: Install | undefined;
  readonly licenseNotice?: LicenseNotice;
  stop(): Promise<void>;
}

export interface LocalServerHost {
  readonly depth: ColorDepth;
  readonly write: (text: string) => void;
  readonly clock: () => number;
  readonly tickEvery: (milliseconds: number, tick: () => void) => () => void;
  readonly run: () => Promise<LocalServer>;
  readonly stopRequested: Promise<void>;
}

const spinnerTickMs = 80;

async function startedWithSpinner(host: LocalServerHost): Promise<LocalServer> {
  let frame = 0;
  host.write(startingLine(frame, host.depth));
  const stopSpinning = host.tickEvery(spinnerTickMs, () => {
    frame += 1;
    host.write(startingLine(frame, host.depth));
  });
  try {
    return await host.run();
  } finally {
    stopSpinning();
    host.write(clearedLine);
  }
}

export async function servedLocally(host: LocalServerHost): Promise<void> {
  const startedAt = host.clock();
  host.write(headerOf(release.version, host.depth));
  const server = await (host.depth === 1 ? host.run() : startedWithSpinner(host));
  host.write(
    readyNoticeOf(
      {
        version: release.version,
        port: server.port,
        publicUrl: server.publicUrl,
        readyInMs: Math.round(host.clock() - startedAt),
        mode: server.mode,
        identityService: server.signIn?.issuer,
        studio: server.studio,
        install: server.install,
        license: await server.licenseNotice?.(),
      },
      host.depth,
    ),
  );
  await host.stopRequested;
  host.write(stoppingNotice(host.depth));
  await server.stop();
  host.write(stoppedNotice(host.depth));
}
