import { serveOnLoopback } from '../testing/loopback-server.ts';
import { fakeGatewayAnswers, type FakeGateway, type FakeGatewayOptions } from './fake-gateway.ts';

export async function serveFakeGateway(options: FakeGatewayOptions = {}): Promise<FakeGateway> {
  const answers = fakeGatewayAnswers(options);
  return answers.gatewayAt(await serveOnLoopback(answers.handlerAt));
}
