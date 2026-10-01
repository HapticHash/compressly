// Upper bounds for a single report; anything larger is rejected as bogus.
const MAX_FILES_PER_REPORT = 1000;
const MAX_BYTES_PER_REPORT = 100 * 1024 ** 3; // 100 GB

function json(data: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init.headers },
  });
}

export function isValidCount(value: unknown, max: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= max;
}

/** The single global counter instance. */
function counter(env: any) {
  return env.STATS_COUNTER.get(env.STATS_COUNTER.idFromName('global'));
}

export async function handleStatsGet(env: any) {
  try {
    const stats = await counter(env).getStats();
    return json(stats, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=60',
      },
    });
  } catch (err: any) {
    return json({ error: err.message }, { status: 500 });
  }
}

export async function handleStatsPost(request: Request, env: any) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { filesCount, bytesSaved } = body ?? {};
  if (
    !isValidCount(filesCount, MAX_FILES_PER_REPORT) ||
    !isValidCount(bytesSaved, MAX_BYTES_PER_REPORT)
  ) {
    return json({ error: 'Invalid stats' }, { status: 400 });
  }

  try {
    await counter(env).add(filesCount, bytesSaved);
    return json({ success: true });
  } catch (err: any) {
    return json({ error: err.message }, { status: 500 });
  }
}
