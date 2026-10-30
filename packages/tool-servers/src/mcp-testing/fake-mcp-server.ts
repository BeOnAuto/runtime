import { serveOnLoopback } from '../testing/loopback-server.ts';
import { fakeMcpAnswers, type FakeMcpOptions, type FakeMcpServer } from './fake-mcp-answers.ts';

export async function serveFakeMcp(options: FakeMcpOptions = {}): Promise<FakeMcpServer> {
  const { handlerAt, ...answers } = fakeMcpAnswers(options);
  const listening = await serveOnLoopback(handlerAt);
  return {
    ...answers,
    url: `${listening.origin}/mcp`,
    origin: listening.origin,
    heard: listening.heard,
    failures: listening.failures,
    close: async () => {
      answers.forgetSessions();
      await listening.close();
    },
  };
}
