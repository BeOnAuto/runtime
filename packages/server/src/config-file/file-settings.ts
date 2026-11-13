import { fileSetting, type FileSetting } from '@on.auto/config';
import { connectionsSortsOfCredential, ConnectionsSettingSchema } from '@on.auto/connections';
import { ApiKeysSchema } from '@on.auto/identity';
import { entryProse } from '@on.auto/providers';
import { Schema } from 'effect';

import { extensionsFileSetting } from '../extensions/extension-settings.ts';
import { licenseFileSetting } from '../licensing/license-settings.ts';
import { PayloadSizeThresholdBytes } from '../settings/content-settings.ts';
import { Origin, StudioOrigin } from '../settings/origin.ts';
import { asJson, functionFileSettings } from './function-file-settings.ts';

export const fileSettings: readonly FileSetting[] = [
  fileSetting(
    'ALLOWED_ORIGINS',
    Schema.Array(Origin).annotate({
      description:
        'The origins a page in a browser may call the API from, such as https://app.example.com. ALLOWED_ORIGINS wins over it',
    }),
    (origins) => origins.join(','),
  ),
  fileSetting('STUDIO_ORIGIN', StudioOrigin, (origin) => origin),
  fileSetting(
    'SERVE_STUDIO',
    Schema.Boolean.annotate({
      description:
        'Whether the runtime serves Studio itself at /studio/ on its own address, fetched from the Studio host and kept, since a page on a public address may not reach an address on the machine. On in local mode and off otherwise when left out. SERVE_STUDIO wins over it',
    }),
    String,
  ),
  fileSetting(
    'API_KEYS',
    ApiKeysSchema.annotate({
      description: 'The API keys the server accepts, each as the key command prints it. API_KEYS wins over it',
    }),
    asJson,
  ),
  fileSetting(
    'ACCESS_MODE',
    Schema.Literal('local').annotate({
      description:
        'local declares local mode, where every request acts as the local developer with no credential, for a runtime whose port only this computer reaches, such as a container whose port is published on 127.0.0.1 alone. It takes no API_KEYS, and a PUBLIC_URL only on localhost, 127.0.0.1 or [::1], which names the address of the runtime and signs no one in; a runtime that listens beyond the loopback needs that PUBLIC_URL. ACCESS_MODE wins over it',
    }),
    (mode) => mode,
  ),
  ...functionFileSettings,
  fileSetting('CONNECTIONS', ConnectionsSettingSchema, asJson, {
    references: 'kept',
    sortsOfCredential: connectionsSortsOfCredential,
    prose: entryProse,
    judgedByShape: ['placeholders'],
  }),
  fileSetting(
    'USAGE_PING',
    Schema.Boolean.annotate({
      description:
        'Whether the runtime sends its anonymous usage ping when it starts: its release, the operating system, the processor, the version of Node.js, how it was installed and a random install id, and nothing of its work. On when left out; DO_NOT_TRACK or SCARF_NO_ANALYTICS in the environment turns it off too. USAGE_PING wins over it',
    }),
    String,
  ),
  fileSetting(
    'PAYLOAD_OFFLOADING',
    Schema.Boolean.annotate({
      description:
        "Whether a payload larger than payload_size_threshold_bytes, the input, output or answer of a run, the prompt its record holds, a definition's document or a value a workflow holds, is offloaded: kept once in the content store, the ledger's database or the bucket of CONTENT_STORE_URL, and named in its record by its SHA-256 and its size, as the claim check pattern does. On when left out. Turning it off keeps new payloads in their records and still reads those offloaded before. PAYLOAD_OFFLOADING wins over it",
    }),
    String,
  ),
  fileSetting(
    'PAYLOAD_SIZE_THRESHOLD_BYTES',
    PayloadSizeThresholdBytes.annotate({
      description:
        'The size in bytes of UTF-8 past which a payload is offloaded, from 2048 to 65536; 16384 when left out. A change applies to new payloads alone. PAYLOAD_SIZE_THRESHOLD_BYTES wins over it',
    }),
    String,
  ),
  licenseFileSetting,
  extensionsFileSetting,
];
