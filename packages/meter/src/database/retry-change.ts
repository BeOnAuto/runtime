export async function retryChange<A>(change: () => Promise<A | undefined>, attempts = 128): Promise<A> {
  if (attempts === 0) throw new Error('license_clock_contended');
  const changed = await change();
  return changed ?? retryChange(change, attempts - 1);
}
