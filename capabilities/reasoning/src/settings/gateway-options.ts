import { JsonPointer, Result } from 'effect';

import { DefinitionInvalid } from '../failure/definition-invalid.ts';
import type { ProviderOptions } from '../model/model-request.ts';
import { providerNamespaces } from '../model/offered-provider-options.ts';
import type { GatewaySettings } from './gateway-settings.ts';

export type ProviderOptionsCheck = (
  provider: string,
  options: ProviderOptions | undefined,
) => Result.Result<void, DefinitionInvalid>;

interface Disallowed {
  readonly namespace: string;
  readonly field: string;
}

const compatibleNamespaces = ['openaiCompatible', 'openai-compatible'];

function camelCase(name: string): string {
  return name.replaceAll(/[_-]([a-z])/gu, (_, letter: string) => letter.toUpperCase());
}

function namespacesOf(name: string): readonly string[] {
  return [...new Set([name, camelCase(name), ...compatibleNamespaces])];
}

function disallowedIn(gateway: GatewaySettings, options: ProviderOptions): readonly Disallowed[] {
  return namespacesOf(gateway.name).flatMap((namespace) =>
    Object.keys(options[namespace] ?? {})
      .filter((field) => !gateway.allowed_provider_options.has(field))
      .map((field) => ({ namespace, field })),
  );
}

function rejection(gateway: string, first: Disallowed, found: readonly Disallowed[]): DefinitionInvalid {
  return new DefinitionInvalid({
    detail: `The gateway ${gateway} does not allow the provider option ${first.field}`,
    provider: gateway,
    status: null,
    provider_message: null,
    issues: found.map(({ namespace, field }) => ({
      pointer: `/provider_options/${JsonPointer.escapeToken(namespace)}/${JsonPointer.escapeToken(field)}`,
      detail: `The gateway ${gateway} does not allow this option`,
    })),
  });
}

function unreadNamespace(provider: string, namespace: string): DefinitionInvalid {
  return new DefinitionInvalid({
    detail: `No configured provider reads the provider options under ${namespace}`,
    provider,
    status: null,
    provider_message: null,
    issues: [
      {
        pointer: `/provider_options/${JsonPointer.escapeToken(namespace)}`,
        detail: 'Expected the namespace of a built-in provider or of a configured gateway',
      },
    ],
  });
}

export function gatewayOptionsCheck(gateways: readonly GatewaySettings[]): ProviderOptionsCheck {
  const byName = new Map(gateways.map((gateway) => [gateway.name, gateway]));
  const known = new Set([...providerNamespaces, ...gateways.flatMap((gateway) => namespacesOf(gateway.name))]);
  return (provider, options = {}) => {
    const unread = Object.keys(options).find((namespace) => !known.has(namespace));
    if (unread !== undefined) {
      return Result.fail(unreadNamespace(provider, unread));
    }
    const gateway = byName.get(provider);
    const found = gateway === undefined ? [] : disallowedIn(gateway, options);
    const [first] = found;
    return first === undefined ? Result.void : Result.fail(rejection(provider, first, found));
  };
}
