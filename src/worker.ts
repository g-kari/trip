/// <reference types="@cloudflare/workers-types" />
import { Hono } from 'hono';

type Bindings = {
  DB: D1Database;
  ASSETS: { fetch: (request: Request) => Promise<Response> };
};

type Vars = {};

type AppEnv = {
  Bindings: Bindings;
  Variables: Vars;
};

const app = new Hono<AppEnv>();

app.get('/api/health', (c) => c.json({ ok: true }));

// Trips list (very first stub)
app.get('/api/trips', async (c) => {
  const { results } = await c.env.DB.prepare(
    'select id, title, start_date as startDate, end_date as endDate, created_at as createdAt from trips order by created_at desc'
  ).all();
  return c.json({ trips: results });
});

// Fallback to static assets
app.get('*', async (c) => {
  return c.env.ASSETS.fetch(c.req.raw);
});

export default app;
