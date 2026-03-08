export async function onRequestGet(context: any) {
  try {
    const { env } = context;
    // COMPRESSLY_STATS is the KV namespace binding
    let totalFilesCompressed = await env.COMPRESSLY_STATS.get('totalFilesCompressed');
    let totalDataSaved = await env.COMPRESSLY_STATS.get('totalDataSaved');

    return new Response(JSON.stringify({
      totalFilesCompressed: parseInt(totalFilesCompressed || '0', 10),
      totalDataSaved: parseInt(totalDataSaved || '0', 10)
    }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}

export async function onRequestPost(context: any) {
  try {
    const { request, env } = context;
    const body = await request.json();
    const { filesCount = 0, bytesSaved = 0 } = body;

    let currentFiles = parseInt(await env.COMPRESSLY_STATS.get('totalFilesCompressed') || '0', 10);
    let currentSaved = parseInt(await env.COMPRESSLY_STATS.get('totalDataSaved') || '0', 10);

    const newFiles = currentFiles + filesCount;
    const newSaved = currentSaved + bytesSaved;

    await env.COMPRESSLY_STATS.put('totalFilesCompressed', newFiles.toString());
    await env.COMPRESSLY_STATS.put('totalDataSaved', newSaved.toString());

    return new Response(JSON.stringify({ success: true }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
