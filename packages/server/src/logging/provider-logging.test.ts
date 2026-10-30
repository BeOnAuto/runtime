import { describe, expect, it } from 'vitest';

import { linesLoggedBy } from '../testing/records/logged-lines.ts';
import { logOperatorHint, logProviderMessage } from './provider-logging.ts';

describe('logProviderMessage', () => {
  it('warns with the provider, the model, the status, the run and what the provider said', async () => {
    const [line] = await linesLoggedBy(
      logProviderMessage({
        provider: 'gateway',
        model: 'gateway/no-such-model',
        status: 404,
        message: 'No fallback model group found',
        run_id: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a',
      }),
    );

    expect(line).toContain('"message":"Model provider gateway answered with an error","level":"WARN"');
    expect(line).toContain(
      '"annotations":{"provider":"gateway","model":"gateway/no-such-model","status":404,"run_id":"0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a","provider_message":"No fallback model group found"}',
    );
  });
});

describe('logOperatorHint', () => {
  it('warns with what the operator must do, the provider, the model and the run', async () => {
    const [line] = await linesLoggedBy(
      logOperatorHint({
        provider: 'gateway',
        model: 'gateway/llama-3.3-70b',
        hint: 'The TLS certificate of gateway is not trusted; add its certificate authority with NODE_EXTRA_CA_CERTS',
        run_id: null,
      }),
    );

    expect(line).toContain(
      '"message":"Model provider gateway could not be called: The TLS certificate of gateway is not trusted; add its certificate authority with NODE_EXTRA_CA_CERTS","level":"WARN"',
    );
    expect(line).toContain('"annotations":{"provider":"gateway","model":"gateway/llama-3.3-70b","run_id":null}');
  });
});
