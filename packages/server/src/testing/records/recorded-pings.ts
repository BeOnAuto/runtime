import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Schema } from 'effect';

import { release } from '../../composition/release.ts';

const recordedPingsFileVariable = 'RECORDED_PINGS_FILE';

const recordingPreload = new URL('../entries/record-pings.ts', import.meta.url).href;

const decodeFile = Schema.decodeUnknownSync(Schema.NonEmptyString);

export interface RecordedPings {
  readonly settings: Readonly<Record<string, string>>;
  readonly urls: () => readonly string[];
}

export function pingsRecordedIn(
  environment: Readonly<Record<string, string | undefined>>,
): (url: string) => Promise<Response> {
  const file = decodeFile(environment[recordedPingsFileVariable]);
  return (url) => {
    appendFileSync(file, `${url}\n`);
    return Promise.resolve(new Response(''));
  };
}

export function pingsRecordedInto(folder: string): RecordedPings {
  const file = join(folder, 'pings');
  return {
    settings: {
      DO_NOT_TRACK: '',
      SERVE_STUDIO: 'false',
      NODE_OPTIONS: `--import=${recordingPreload}`,
      [recordedPingsFileVariable]: file,
    },
    urls: () =>
      existsSync(file)
        ? readFileSync(file, 'utf8')
            .split('\n')
            .filter((line) => line !== '')
        : [],
  };
}

export function startPingOf(distribution: string, install: string): string {
  const { platform, arch, versions } = process;
  const facts = `platform=${platform}&arch=${arch}&node=${versions.node}`;
  return `https://telemetry.on.auto/runtime/start?version=${release.version}&${facts}&distribution=${distribution}&install=${install}`;
}
