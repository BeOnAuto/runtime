import { describe, expect, it } from 'vitest';

import { linesLoggedBy } from '../testing/records/logged-lines.ts';
import { logLeftOutOperation, logServerMessage } from './tool-server-logging.ts';

describe('logServerMessage', () => {
  it('tells a line a tool server wrote, as information', async () => {
    const [line] = await linesLoggedBy(
      logServerMessage({ server: 'limitless', message: 'Listening on stdio', run_id: null, call_id: null }),
    );

    expect(line).toContain('"message":"Tool server limitless wrote: Listening on stdio","level":"INFO"');
    expect(line).toContain('"annotations":{"tool_server":"limitless"}');
  });

  it('warns of a call a tool server failed, with the run and what the server said', async () => {
    const [line] = await linesLoggedBy(
      logServerMessage({
        server: 'graph',
        message: 'The tool server answered HTTP 503',
        run_id: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a',
        call_id: null,
      }),
    );

    expect(line).toContain('"message":"Tool server graph failed a call","level":"WARN"');
    expect(line).toContain(
      '"annotations":{"tool_server":"graph","run_id":"0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a","server_message":"The tool server answered HTTP 503"}',
    );
  });

  it('warns of a call made by hand that a tool server failed, naming the call as a run is named', async () => {
    const [line] = await linesLoggedBy(
      logServerMessage({
        server: 'graph',
        message: 'The tool server answered HTTP 503',
        run_id: null,
        call_id: '0199b7e2-4c1d-7a3e-8f5b-6d2c1e0f9a8b',
      }),
    );

    expect(line).toContain('"message":"Tool server graph failed a call","level":"WARN"');
    expect(line).toContain(
      '"annotations":{"tool_server":"graph","call_id":"0199b7e2-4c1d-7a3e-8f5b-6d2c1e0f9a8b","server_message":"The tool server answered HTTP 503"}',
    );
  });
});

describe('logLeftOutOperation', () => {
  it('warns of an operation of the document of a tool server that no tool is offered for, saying why', async () => {
    const [line] = await linesLoggedBy(
      logLeftOutOperation('billing', {
        operation: 'upload (POST /uploads)',
        because: 'its body is application/xml, and a call sends a body only as JSON',
      }),
    );

    expect(line).toContain(
      '"message":"The tool server billing offers no tool for the operation upload (POST /uploads) of its document: its body is application/xml, and a call sends a body only as JSON","level":"WARN"',
    );
    expect(line).toContain('"annotations":{"tool_server":"billing"}');
  });
});
