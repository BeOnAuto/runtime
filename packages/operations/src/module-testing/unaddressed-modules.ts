import { registerHooks, type LoadFnOutput, type ResolveFnOutput } from 'node:module';

type ResolveContext = Readonly<{ parentURL: string | undefined }>;

type LoadContext = Readonly<{ format?: string | null | undefined }>;

type NextResolve = (specifier: string, context: ResolveContext) => ResolveFnOutput;

type NextLoad = (url: string, context: LoadContext) => LoadFnOutput;

const scheme = 'unaddressed:';

function isUnaddressed(url: string | undefined): url is string {
  return url !== undefined && url.startsWith(scheme);
}

function addressedOf(url: string): string {
  return decodeURIComponent(url.slice(scheme.length));
}

function unaddressedOf(url: string): string {
  return url.startsWith('file:') && !url.includes('/node_modules/') ? `${scheme}${encodeURIComponent(url)}` : url;
}

function resolved(specifier: string, context: ResolveContext, nextResolve: NextResolve): ResolveFnOutput {
  if (isUnaddressed(specifier)) {
    return { url: specifier, shortCircuit: true };
  }
  if (!isUnaddressed(context.parentURL)) {
    return nextResolve(specifier, context);
  }
  const answer = nextResolve(specifier, { ...context, parentURL: addressedOf(context.parentURL) });
  return { ...answer, url: unaddressedOf(answer.url) };
}

function loaded(url: string, context: LoadContext, nextLoad: NextLoad): LoadFnOutput {
  return isUnaddressed(url) ? { ...nextLoad(addressedOf(url), context), shortCircuit: true } : nextLoad(url, context);
}

export async function importedWithoutAnAddress(module: Readonly<URL>): Promise<object> {
  const hooks = registerHooks({ resolve: resolved, load: loaded });
  try {
    const namespace: unknown = await import(unaddressedOf(module.href));
    return new Object(namespace);
  } finally {
    hooks.deregister();
  }
}
