import { DurableObject } from 'cloudflare:workers';

export interface Stats {
  totalFilesCompressed: number;
  totalDataSaved: number;
}

const STORAGE_KEY = 'stats';

/**
 * Holds the global totals. A Durable Object handles one request at a time,
 * so increments can't overwrite each other the way KV read-modify-writes did.
 */
export class StatsCounter extends DurableObject<any> {
  private stats: Stats = { totalFilesCompressed: 0, totalDataSaved: 0 };

  constructor(ctx: any, env: any) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      const stored = await ctx.storage.get(STORAGE_KEY);
      this.stats = stored ?? (await importFromKv(env.COMPRESSLY_STATS));
      if (!stored) await ctx.storage.put(STORAGE_KEY, this.stats);
    });
  }

  async getStats(): Promise<Stats> {
    return this.stats;
  }

  async add(filesCount: number, bytesSaved: number): Promise<Stats> {
    this.stats = {
      totalFilesCompressed: this.stats.totalFilesCompressed + filesCount,
      totalDataSaved: this.stats.totalDataSaved + bytesSaved,
    };
    await this.ctx.storage.put(STORAGE_KEY, this.stats);
    return this.stats;
  }
}

/** One-time carry-over of the totals previously kept in KV. */
async function importFromKv(kv: any): Promise<Stats> {
  if (!kv) return { totalFilesCompressed: 0, totalDataSaved: 0 };
  const stored = await kv.get('stats', 'json');
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
