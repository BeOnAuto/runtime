export const loopbackNames: readonly string[] = ['localhost', '127.0.0.1', '[::1]'];

export function namesTheLoopback(hostname: string): boolean {
  return loopbackNames.includes(hostname);
}
