// Minimal typing for the Workers runtime module used by the Durable Object.
declare module 'cloudflare:workers' {
  export class DurableObject<Env = unknown> {
    protected ctx: any;
    protected env: Env;
    constructor(ctx: any, env: Env);
  }
}
