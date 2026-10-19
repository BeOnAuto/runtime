import { html } from 'hono/html';

const pageHeaders = { 'content-type': 'text/html; charset=UTF-8', 'cache-control': 'no-store' };

export async function unreachableStudioPage(origin: string): Promise<Response> {
  const page = await html`<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="light dark" />
        <title>Studio cannot be fetched now</title>
      </head>
      <body>
        <main>
          <h1>Studio cannot be fetched now</h1>
          <p>
            Auto Runtime serves Studio from ${origin}, which it cannot reach now, and it keeps no copy of this page.
          </p>
          <p>Reload the page once ${origin} can be reached from the computer Auto Runtime runs on.</p>
        </main>
      </body>
    </html>`;
  return new Response(page.toString(), { status: 503, headers: pageHeaders });
}
