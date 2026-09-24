const STATS_KEY = 'stats';
// Upper bounds for a single report; anything larger is rejected as bogus.
const MAX_FILES_PER_REPORT = 1000;
const MAX_BYTES_PER_REPORT = 100 * 1024 ** 3; // 100 GB

interface Stats {
  totalFilesCompressed: number;
  totalDataSaved: number;
}

function json(data: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init.headers },
  });
}

function isValidCount(value: unknown, max: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= max;
}

// Both totals live in one key, so each update costs a single KV write.
// Falls back to the legacy per-counter keys the first time it runs.
async function readStats(kv: any): Promise<Stats> {
  const stored = await kv.get(STATS_KEY, 'json');
  if (stored) return stored;
  const [files, saved] = await Promise.all([
    kv.get('totalFilesCompressed'),
    kv.get('totalDataSaved'),
  ]);
  return {
    totalFilesCompressed: parseInt(files || '0', 10) || 0,
    totalDataSaved: parseInt(saved || '0', 10) || 0,
  };
}

export async function onRequestGet(context: any) {
  try {
    const stats = await readStats(context.env.COMPRESSLY_STATS);
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

// Note: KV has no atomic increment, so concurrent reports can still overwrite
// each other. A Durable Object or D1 counter is needed for exact totals.
export async function onRequestPost(context: any) {
  const { request, env } = context;
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
    const stats = await readStats(env.COMPRESSLY_STATS);
    await env.COMPRESSLY_STATS.put(
      STATS_KEY,
      JSON.stringify({
        totalFilesCompressed: stats.totalFilesCompressed + filesCount,
        totalDataSaved: stats.totalDataSaved + bytesSaved,
      }),
    );
    return json({ success: true });
  } catch (err: any) {
    return json({ error: err.message }, { status: 500 });
  }
}
