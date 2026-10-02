import { handleStatsGet, handleStatsPost } from './stats';

export { StatsCounter } from './stats-counter';

// Entry point for the Cloudflare Worker. Static files in ./dist are served
// by the assets binding; only /api/* reaches this code (see wrangler.toml).
export default {
  async fetch(request: Request, env: any): Promise<Response> {
    const { pathname } = new URL(request.url);

    if (pathname === '/api/health') {
      return Response.json({ status: 'ok' });
    }

    if (pathname === '/api/stats') {
      if (request.method === 'GET') return handleStatsGet(env);
      if (request.method === 'POST') return handleStatsPost(request, env);
      return new Response(null, { status: 405, headers: { Allow: 'GET, POST' } });
    }

    // Normally handled by the service worker; this only runs if it isn't
    // installed yet, so send the user to the app instead of an error.
    if (pathname === '/share-target') {
      return Response.redirect(new URL('/', request.url).toString(), 303);
    }

    if (pathname.startsWith('/api/')) {
      return Response.json({ error: 'Not found' }, { status: 404 });
    }

    return env.ASSETS.fetch(request);
  },
};
