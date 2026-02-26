/// <reference types="@cloudflare/workers-types" />
import { Hono } from 'hono';
import {
  createSession,
  deleteSession,
  getUserBySession,
  getSessionIdFromCookie,
  createSessionCookie,
  createLogoutCookie,
  generateId,
} from './auth/session';
import {
  getGoogleAuthUrl,
  exchangeCodeForTokens,
  getGoogleUserInfo,
} from './auth/google';
import type { User } from './auth/types';

type Bindings = {
  DB: D1Database;
  ASSETS: { fetch: (request: Request) => Promise<Response> };
  COVERS: R2Bucket;
  AI: Ai;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
};

type Vars = {
  user: User | null;
};

type AppEnv = {
  Bindings: Bindings;
  Variables: Vars;
};

const app = new Hono<AppEnv>();

// Helper to generate short random token
function generateToken(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let token = '';
  const array = new Uint8Array(8);
  crypto.getRandomValues(array);
  for (let i = 0; i < 8; i++) {
    token += chars[array[i] % chars.length];
  }
  return token;
}

// Auth middleware - sets user in context if logged in
app.use('/api/*', async (c, next) => {
  const sessionId = getSessionIdFromCookie(c.req.header('Cookie') ?? null);
  if (sessionId) {
    const user = await getUserBySession(c.env.DB, sessionId);
    c.set('user', user);
  } else {
    c.set('user', null);
  }
  await next();
});

// Health check
app.get('/api/health', (c) => c.json({ ok: true }));

// ============ Auth ============

// Get current user
app.get('/api/auth/me', (c) => {
  const user = c.get('user');
  if (!user) {
    return c.json({ user: null });
  }
  return c.json({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      avatarUrl: user.avatarUrl,
    },
  });
});

// Start Google OAuth flow
app.get('/api/auth/google', (c) => {
  const url = new URL(c.req.url);
  const redirectUri = `${url.origin}/api/auth/google/callback`;

  // Generate state for CSRF protection
  const state = generateToken();

  const authUrl = getGoogleAuthUrl(
    c.env.GOOGLE_CLIENT_ID,
    redirectUri,
    state
  );

  // Set state cookie for verification
  return c.redirect(authUrl, 302);
});

// Google OAuth callback
app.get('/api/auth/google/callback', async (c) => {
  const url = new URL(c.req.url);
  const code = url.searchParams.get('code');

  if (!code) {
    return c.redirect('/login?error=no_code', 302);
  }

  try {
    const redirectUri = `${url.origin}/api/auth/google/callback`;

    // Exchange code for tokens
    const tokens = await exchangeCodeForTokens(
      code,
      c.env.GOOGLE_CLIENT_ID,
      c.env.GOOGLE_CLIENT_SECRET,
      redirectUri
    );

    // Get user info from Google
    const googleUser = await getGoogleUserInfo(tokens.access_token);

    // Find or create user
    let user = await c.env.DB.prepare(
      `SELECT id, provider, provider_id as providerId, email, name,
              avatar_url as avatarUrl, created_at as createdAt
       FROM users WHERE provider = ? AND provider_id = ?`
    )
      .bind('google', googleUser.id)
      .first<User>();

    if (!user) {
      // Create new user
      const userId = generateId();
      await c.env.DB.prepare(
        `INSERT INTO users (id, provider, provider_id, email, name, avatar_url)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
        .bind(
          userId,
          'google',
          googleUser.id,
          googleUser.email,
          googleUser.name,
          googleUser.picture
        )
        .run();

      user = {
        id: userId,
        provider: 'google',
        providerId: googleUser.id,
        email: googleUser.email,
        name: googleUser.name,
        avatarUrl: googleUser.picture,
        createdAt: new Date().toISOString(),
      };
    } else {
      // Update user info
      await c.env.DB.prepare(
        `UPDATE users SET email = ?, name = ?, avatar_url = ?,
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE id = ?`
      )
        .bind(googleUser.email, googleUser.name, googleUser.picture, user.id)
        .run();
    }

    // Create session
    const session = await createSession(c.env.DB, user.id);

    // Redirect to trips page with session cookie
    return new Response(null, {
      status: 302,
      headers: {
        Location: '/trips',
        'Set-Cookie': createSessionCookie(session.id),
      },
    });
  } catch (error) {
    console.error('Google auth error:', error);
    return c.redirect('/login?error=auth_failed', 302);
  }
});

// Logout
app.post('/api/auth/logout', async (c) => {
  const sessionId = getSessionIdFromCookie(c.req.header('Cookie') ?? null);
  if (sessionId) {
    await deleteSession(c.env.DB, sessionId);
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': createLogoutCookie(),
    },
  });
});

// ============ Trips ============

// List all trips (for logged in user)
app.get('/api/trips', async (c) => {
  const user = c.get('user');

  let query = 'SELECT id, title, start_date as startDate, end_date as endDate, theme, cover_image_url as coverImageUrl, created_at as createdAt FROM trips';
  const params: string[] = [];

  if (user) {
    // Show user's trips only
    query += ' WHERE user_id = ?';
    params.push(user.id);
  } else {
    // Show trips without owner (legacy data or anonymous)
    query += ' WHERE user_id IS NULL';
  }

  query += ' ORDER BY created_at DESC';

  const stmt = params.length > 0
    ? c.env.DB.prepare(query).bind(...params)
    : c.env.DB.prepare(query);

  const { results } = await stmt.all();
  return c.json({ trips: results });
});

// Get single trip with days and items
app.get('/api/trips/:id', async (c) => {
  const id = c.req.param('id');
  const user = c.get('user');

  const trip = await c.env.DB.prepare(
    'SELECT id, title, start_date as startDate, end_date as endDate, theme, cover_image_url as coverImageUrl, user_id as userId, created_at as createdAt, updated_at as updatedAt FROM trips WHERE id = ?'
  ).bind(id).first<{
    id: string;
    title: string;
    startDate: string | null;
    endDate: string | null;
    theme: string | null;
    coverImageUrl: string | null;
    userId: string | null;
    createdAt: string;
    updatedAt: string;
  }>();

  if (!trip) {
    return c.json({ error: 'Trip not found' }, 404);
  }

  // Check ownership - allow if:
  // 1. Trip has no owner (legacy)
  // 2. User is the owner
  // 3. User is not logged in and trip has no owner
  const isOwner = !trip.userId || (user && trip.userId === user.id);

  const { results: days } = await c.env.DB.prepare(
    'SELECT id, date, sort FROM days WHERE trip_id = ? ORDER BY sort ASC'
  ).bind(id).all();

  const { results: items } = await c.env.DB.prepare(
    'SELECT id, day_id as dayId, title, area, time_start as timeStart, time_end as timeEnd, map_url as mapUrl, note, cost, sort FROM items WHERE trip_id = ? ORDER BY sort ASC'
  ).bind(id).all();

  return c.json({
    trip: { ...trip, days, items },
    isOwner,
  });
});

// Create trip
app.post('/api/trips', async (c) => {
  const user = c.get('user');
  const body = await c.req.json<{ title: string; startDate?: string; endDate?: string; theme?: string; coverImageUrl?: string }>();

  if (!body.title?.trim()) {
    return c.json({ error: 'Title is required' }, 400);
  }

  const id = generateId();
  const theme = body.theme === 'photo' ? 'photo' : 'quiet';

  await c.env.DB.prepare(
    'INSERT INTO trips (id, title, start_date, end_date, theme, cover_image_url, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, body.title.trim(), body.startDate ?? null, body.endDate ?? null, theme, body.coverImageUrl ?? null, user?.id ?? null).run();

  const trip = await c.env.DB.prepare(
    'SELECT id, title, start_date as startDate, end_date as endDate, theme, cover_image_url as coverImageUrl, created_at as createdAt FROM trips WHERE id = ?'
  ).bind(id).first();

  return c.json({ trip }, 201);
});

// Update trip
app.put('/api/trips/:id', async (c) => {
  const id = c.req.param('id');
  const user = c.get('user');
  const body = await c.req.json<{ title?: string; startDate?: string; endDate?: string; theme?: string; coverImageUrl?: string }>();

  const existing = await c.env.DB.prepare(
    'SELECT id, user_id as userId FROM trips WHERE id = ?'
  ).bind(id).first<{ id: string; userId: string | null }>();

  if (!existing) {
    return c.json({ error: 'Trip not found' }, 404);
  }

  // Check ownership
  if (existing.userId && (!user || existing.userId !== user.id)) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  // Validate theme if provided
  const theme = body.theme !== undefined
    ? (body.theme === 'photo' ? 'photo' : 'quiet')
    : null;

  await c.env.DB.prepare(
    `UPDATE trips SET
      title = COALESCE(?, title),
      start_date = COALESCE(?, start_date),
      end_date = COALESCE(?, end_date),
      theme = COALESCE(?, theme),
      cover_image_url = COALESCE(?, cover_image_url),
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE id = ?`
  ).bind(body.title ?? null, body.startDate ?? null, body.endDate ?? null, theme, body.coverImageUrl ?? null, id).run();

  const trip = await c.env.DB.prepare(
    'SELECT id, title, start_date as startDate, end_date as endDate, theme, cover_image_url as coverImageUrl, created_at as createdAt, updated_at as updatedAt FROM trips WHERE id = ?'
  ).bind(id).first();

  return c.json({ trip });
});

// Delete trip
app.delete('/api/trips/:id', async (c) => {
  const id = c.req.param('id');
  const user = c.get('user');

  const existing = await c.env.DB.prepare(
    'SELECT id, user_id as userId FROM trips WHERE id = ?'
  ).bind(id).first<{ id: string; userId: string | null }>();

  if (!existing) {
    return c.json({ error: 'Trip not found' }, 404);
  }

  // Check ownership
  if (existing.userId && (!user || existing.userId !== user.id)) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  await c.env.DB.prepare('DELETE FROM trips WHERE id = ?').bind(id).run();

  return c.json({ ok: true });
});

// ============ Days ============

// Helper to check trip ownership
async function checkTripOwnership(
  db: D1Database,
  tripId: string,
  user: User | null
): Promise<{ ok: boolean; error?: string; status?: number }> {
  const trip = await db
    .prepare('SELECT id, user_id as userId FROM trips WHERE id = ?')
    .bind(tripId)
    .first<{ id: string; userId: string | null }>();

  if (!trip) {
    return { ok: false, error: 'Trip not found', status: 404 };
  }

  if (trip.userId && (!user || trip.userId !== user.id)) {
    return { ok: false, error: 'Forbidden', status: 403 };
  }

  return { ok: true };
}

// Create day
app.post('/api/trips/:tripId/days', async (c) => {
  const tripId = c.req.param('tripId');
  const user = c.get('user');
  const body = await c.req.json<{ date: string; sort?: number }>();

  const check = await checkTripOwnership(c.env.DB, tripId, user);
  if (!check.ok) {
    return c.json({ error: check.error }, check.status as 403 | 404);
  }

  if (!body.date) {
    return c.json({ error: 'Date is required' }, 400);
  }

  const id = generateId();
  const sort = body.sort ?? Date.now();

  await c.env.DB.prepare(
    'INSERT INTO days (id, trip_id, date, sort) VALUES (?, ?, ?, ?)'
  ).bind(id, tripId, body.date, sort).run();

  const day = await c.env.DB.prepare(
    'SELECT id, date, sort FROM days WHERE id = ?'
  ).bind(id).first();

  return c.json({ day }, 201);
});

// Update day
app.put('/api/trips/:tripId/days/:dayId', async (c) => {
  const { tripId, dayId } = c.req.param();
  const user = c.get('user');
  const body = await c.req.json<{ date?: string; sort?: number }>();

  const check = await checkTripOwnership(c.env.DB, tripId, user);
  if (!check.ok) {
    return c.json({ error: check.error }, check.status as 403 | 404);
  }

  const existing = await c.env.DB.prepare(
    'SELECT id FROM days WHERE id = ? AND trip_id = ?'
  ).bind(dayId, tripId).first();

  if (!existing) {
    return c.json({ error: 'Day not found' }, 404);
  }

  await c.env.DB.prepare(
    'UPDATE days SET date = COALESCE(?, date), sort = COALESCE(?, sort) WHERE id = ?'
  ).bind(body.date ?? null, body.sort ?? null, dayId).run();

  const day = await c.env.DB.prepare('SELECT id, date, sort FROM days WHERE id = ?').bind(dayId).first();

  return c.json({ day });
});

// Delete day
app.delete('/api/trips/:tripId/days/:dayId', async (c) => {
  const { tripId, dayId } = c.req.param();
  const user = c.get('user');

  const check = await checkTripOwnership(c.env.DB, tripId, user);
  if (!check.ok) {
    return c.json({ error: check.error }, check.status as 403 | 404);
  }

  const existing = await c.env.DB.prepare(
    'SELECT id FROM days WHERE id = ? AND trip_id = ?'
  ).bind(dayId, tripId).first();

  if (!existing) {
    return c.json({ error: 'Day not found' }, 404);
  }

  await c.env.DB.prepare('DELETE FROM days WHERE id = ?').bind(dayId).run();

  return c.json({ ok: true });
});

// ============ Items ============

// Create item
app.post('/api/trips/:tripId/items', async (c) => {
  const tripId = c.req.param('tripId');
  const user = c.get('user');
  const body = await c.req.json<{
    dayId: string;
    title: string;
    area?: string;
    timeStart?: string;
    timeEnd?: string;
    mapUrl?: string;
    note?: string;
    cost?: number;
    sort?: number;
  }>();

  const check = await checkTripOwnership(c.env.DB, tripId, user);
  if (!check.ok) {
    return c.json({ error: check.error }, check.status as 403 | 404);
  }

  if (!body.dayId || !body.title?.trim()) {
    return c.json({ error: 'dayId and title are required' }, 400);
  }

  const day = await c.env.DB.prepare('SELECT id FROM days WHERE id = ? AND trip_id = ?').bind(body.dayId, tripId).first();
  if (!day) {
    return c.json({ error: 'Day not found' }, 404);
  }

  const id = generateId();
  const sort = body.sort ?? Date.now();

  await c.env.DB.prepare(
    `INSERT INTO items (id, trip_id, day_id, title, area, time_start, time_end, map_url, note, cost, sort)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id, tripId, body.dayId, body.title.trim(),
    body.area ?? null, body.timeStart ?? null, body.timeEnd ?? null,
    body.mapUrl ?? null, body.note ?? null, body.cost ?? null, sort
  ).run();

  const item = await c.env.DB.prepare(
    'SELECT id, day_id as dayId, title, area, time_start as timeStart, time_end as timeEnd, map_url as mapUrl, note, cost, sort FROM items WHERE id = ?'
  ).bind(id).first();

  return c.json({ item }, 201);
});

// Update item
app.put('/api/trips/:tripId/items/:itemId', async (c) => {
  const { tripId, itemId } = c.req.param();
  const user = c.get('user');
  const body = await c.req.json<{
    dayId?: string;
    title?: string;
    area?: string;
    timeStart?: string;
    timeEnd?: string;
    mapUrl?: string;
    note?: string;
    cost?: number;
    sort?: number;
  }>();

  const check = await checkTripOwnership(c.env.DB, tripId, user);
  if (!check.ok) {
    return c.json({ error: check.error }, check.status as 403 | 404);
  }

  const existing = await c.env.DB.prepare(
    'SELECT id FROM items WHERE id = ? AND trip_id = ?'
  ).bind(itemId, tripId).first();

  if (!existing) {
    return c.json({ error: 'Item not found' }, 404);
  }

  await c.env.DB.prepare(
    `UPDATE items SET
      day_id = COALESCE(?, day_id),
      title = COALESCE(?, title),
      area = COALESCE(?, area),
      time_start = COALESCE(?, time_start),
      time_end = COALESCE(?, time_end),
      map_url = COALESCE(?, map_url),
      note = COALESCE(?, note),
      cost = COALESCE(?, cost),
      sort = COALESCE(?, sort),
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE id = ?`
  ).bind(
    body.dayId ?? null, body.title ?? null, body.area ?? null,
    body.timeStart ?? null, body.timeEnd ?? null, body.mapUrl ?? null,
    body.note ?? null, body.cost ?? null, body.sort ?? null, itemId
  ).run();

  const item = await c.env.DB.prepare(
    'SELECT id, day_id as dayId, title, area, time_start as timeStart, time_end as timeEnd, map_url as mapUrl, note, cost, sort FROM items WHERE id = ?'
  ).bind(itemId).first();

  return c.json({ item });
});

// Delete item
app.delete('/api/trips/:tripId/items/:itemId', async (c) => {
  const { tripId, itemId } = c.req.param();
  const user = c.get('user');

  const check = await checkTripOwnership(c.env.DB, tripId, user);
  if (!check.ok) {
    return c.json({ error: check.error }, check.status as 403 | 404);
  }

  const existing = await c.env.DB.prepare(
    'SELECT id FROM items WHERE id = ? AND trip_id = ?'
  ).bind(itemId, tripId).first();

  if (!existing) {
    return c.json({ error: 'Item not found' }, 404);
  }

  await c.env.DB.prepare('DELETE FROM items WHERE id = ?').bind(itemId).run();

  return c.json({ ok: true });
});

// ============ Share Tokens ============

// Create share token for a trip
app.post('/api/trips/:tripId/share', async (c) => {
  const tripId = c.req.param('tripId');
  const user = c.get('user');

  const check = await checkTripOwnership(c.env.DB, tripId, user);
  if (!check.ok) {
    return c.json({ error: check.error }, check.status as 403 | 404);
  }

  // Check if share token already exists
  const existing = await c.env.DB.prepare(
    'SELECT token FROM share_tokens WHERE trip_id = ?'
  ).bind(tripId).first<{ token: string }>();

  if (existing) {
    return c.json({ token: existing.token });
  }

  // Create new token
  const id = generateId();
  const token = generateToken();

  await c.env.DB.prepare(
    'INSERT INTO share_tokens (id, trip_id, token) VALUES (?, ?, ?)'
  ).bind(id, tripId, token).run();

  return c.json({ token }, 201);
});

// Get share token for a trip
app.get('/api/trips/:tripId/share', async (c) => {
  const tripId = c.req.param('tripId');

  const share = await c.env.DB.prepare(
    'SELECT token FROM share_tokens WHERE trip_id = ?'
  ).bind(tripId).first<{ token: string }>();

  if (!share) {
    return c.json({ token: null });
  }

  return c.json({ token: share.token });
});

// Delete share token
app.delete('/api/trips/:tripId/share', async (c) => {
  const tripId = c.req.param('tripId');
  const user = c.get('user');

  const check = await checkTripOwnership(c.env.DB, tripId, user);
  if (!check.ok) {
    return c.json({ error: check.error }, check.status as 403 | 404);
  }

  await c.env.DB.prepare('DELETE FROM share_tokens WHERE trip_id = ?').bind(tripId).run();

  return c.json({ ok: true });
});

// Get shared trip by token (public endpoint)
app.get('/api/shared/:token', async (c) => {
  const token = c.req.param('token');

  const share = await c.env.DB.prepare(
    'SELECT trip_id FROM share_tokens WHERE token = ?'
  ).bind(token).first<{ trip_id: string }>();

  if (!share) {
    return c.json({ error: 'Invalid share link' }, 404);
  }

  const trip = await c.env.DB.prepare(
    'SELECT id, title, start_date as startDate, end_date as endDate, theme, cover_image_url as coverImageUrl FROM trips WHERE id = ?'
  ).bind(share.trip_id).first();

  if (!trip) {
    return c.json({ error: 'Trip not found' }, 404);
  }

  const { results: days } = await c.env.DB.prepare(
    'SELECT id, date, sort FROM days WHERE trip_id = ? ORDER BY sort ASC'
  ).bind(share.trip_id).all();

  const { results: items } = await c.env.DB.prepare(
    'SELECT id, day_id as dayId, title, area, time_start as timeStart, time_end as timeEnd, map_url as mapUrl, note, cost, sort FROM items WHERE trip_id = ? ORDER BY sort ASC'
  ).bind(share.trip_id).all();

  return c.json({ trip: { ...trip, days, items } });
});

// ============ Cover Images (R2) ============

// Upload cover image
app.post('/api/trips/:tripId/cover', async (c) => {
  const tripId = c.req.param('tripId');
  const user = c.get('user');

  const check = await checkTripOwnership(c.env.DB, tripId, user);
  if (!check.ok) {
    return c.json({ error: check.error }, check.status as 403 | 404);
  }

  const contentType = c.req.header('Content-Type') || '';
  if (!contentType.startsWith('image/')) {
    return c.json({ error: 'Only image files are allowed' }, 400);
  }

  // Validate file size (max 5MB)
  const contentLength = parseInt(c.req.header('Content-Length') || '0', 10);
  if (contentLength > 5 * 1024 * 1024) {
    return c.json({ error: 'File too large (max 5MB)' }, 400);
  }

  const ext = contentType.split('/')[1] || 'jpg';
  const key = `covers/${tripId}.${ext}`;

  try {
    const body = await c.req.arrayBuffer();
    await c.env.COVERS.put(key, body, {
      httpMetadata: {
        contentType,
      },
    });

    const url = new URL(c.req.url);
    const coverImageUrl = `${url.origin}/api/covers/${tripId}.${ext}`;

    // Update trip with cover image URL
    await c.env.DB.prepare(
      'UPDATE trips SET cover_image_url = ?, updated_at = strftime(\'%Y-%m-%dT%H:%M:%fZ\',\'now\') WHERE id = ?'
    ).bind(coverImageUrl, tripId).run();

    return c.json({ coverImageUrl }, 201);
  } catch (error) {
    console.error('Failed to upload cover image:', error);
    return c.json({ error: 'Failed to upload image' }, 500);
  }
});

// Get cover image
app.get('/api/covers/:key', async (c) => {
  const key = `covers/${c.req.param('key')}`;

  const object = await c.env.COVERS.get(key);
  if (!object) {
    return c.json({ error: 'Image not found' }, 404);
  }

  const headers = new Headers();
  headers.set('Content-Type', object.httpMetadata?.contentType || 'image/jpeg');
  headers.set('Cache-Control', 'public, max-age=31536000');
  headers.set('ETag', object.etag);

  return new Response(object.body, { headers });
});

// Delete cover image
app.delete('/api/trips/:tripId/cover', async (c) => {
  const tripId = c.req.param('tripId');
  const user = c.get('user');

  const check = await checkTripOwnership(c.env.DB, tripId, user);
  if (!check.ok) {
    return c.json({ error: check.error }, check.status as 403 | 404);
  }

  // Get current cover URL to determine the key
  const trip = await c.env.DB.prepare(
    'SELECT cover_image_url as coverImageUrl FROM trips WHERE id = ?'
  ).bind(tripId).first<{ coverImageUrl: string | null }>();

  if (trip?.coverImageUrl) {
    // Extract key from URL
    const urlParts = trip.coverImageUrl.split('/api/covers/');
    if (urlParts[1]) {
      const key = `covers/${urlParts[1]}`;
      await c.env.COVERS.delete(key);
    }
  }

  // Clear cover image URL in database
  await c.env.DB.prepare(
    'UPDATE trips SET cover_image_url = NULL, updated_at = strftime(\'%Y-%m-%dT%H:%M:%fZ\',\'now\') WHERE id = ?'
  ).bind(tripId).run();

  return c.json({ ok: true });
});

// ============ AI Trip Generation ============

type TripStyle = 'relaxed' | 'active' | 'gourmet' | 'sightseeing';

interface GeneratedItem {
  title: string;
  timeStart: string;
  timeEnd?: string;
  area?: string;
  note?: string;
  cost?: number;
}

interface GeneratedDay {
  date: string;
  items: GeneratedItem[];
}

interface GeneratedTrip {
  title: string;
  days: GeneratedDay[];
}

// AI usage limits
const AI_DAILY_LIMIT_USER = 5;  // Per user per day
const AI_DAILY_LIMIT_IP = 10;   // Per IP per day (to catch abuse)

// Helper to get client IP
function getClientIp(c: { req: { header: (name: string) => string | undefined } }): string {
  // Cloudflare provides the real IP in CF-Connecting-IP header
  return c.req.header('CF-Connecting-IP') ||
         c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() ||
         'unknown';
}

// Get AI usage stats for a user
app.get('/api/ai/usage', async (c) => {
  const user = c.get('user');
  const ip = getClientIp(c);
  const today = new Date().toISOString().split('T')[0];

  let userUsedToday = 0;
  let userRemaining = AI_DAILY_LIMIT_USER;

  if (user) {
    const userResult = await c.env.DB.prepare(
      `SELECT COUNT(*) as count FROM ai_usage
       WHERE user_id = ? AND created_at >= ? || 'T00:00:00.000Z'`
    ).bind(user.id, today).first<{ count: number }>();
    userUsedToday = userResult?.count || 0;
    userRemaining = Math.max(0, AI_DAILY_LIMIT_USER - userUsedToday);
  }

  // Also check IP usage
  const ipResult = await c.env.DB.prepare(
    `SELECT COUNT(*) as count FROM ai_usage
     WHERE ip_address = ? AND created_at >= ? || 'T00:00:00.000Z'`
  ).bind(ip, today).first<{ count: number }>();
  const ipUsedToday = ipResult?.count || 0;
  const ipRemaining = Math.max(0, AI_DAILY_LIMIT_IP - ipUsedToday);

  // Return the more restrictive limit
  const remaining = user ? Math.min(userRemaining, ipRemaining) : ipRemaining;

  return c.json({
    usedToday: user ? userUsedToday : ipUsedToday,
    remaining,
    limit: user ? AI_DAILY_LIMIT_USER : AI_DAILY_LIMIT_IP,
  });
});

// Generate trip with AI
app.post('/api/trips/generate', async (c) => {
  const user = c.get('user');
  const ip = getClientIp(c);

  // Require login for AI generation
  if (!user) {
    return c.json({ error: 'AI旅程生成にはログインが必要です' }, 401);
  }

  const today = new Date().toISOString().split('T')[0];

  // Check user rate limit
  const userUsageResult = await c.env.DB.prepare(
    `SELECT COUNT(*) as count FROM ai_usage
     WHERE user_id = ? AND created_at >= ? || 'T00:00:00.000Z'`
  ).bind(user.id, today).first<{ count: number }>();

  const userUsedToday = userUsageResult?.count || 0;
  if (userUsedToday >= AI_DAILY_LIMIT_USER) {
    return c.json({
      error: `本日の利用上限（${AI_DAILY_LIMIT_USER}回）に達しました。明日また利用できます。`,
      limitReached: true,
      remaining: 0,
    }, 429);
  }

  // Check IP rate limit
  const ipUsageResult = await c.env.DB.prepare(
    `SELECT COUNT(*) as count FROM ai_usage
     WHERE ip_address = ? AND created_at >= ? || 'T00:00:00.000Z'`
  ).bind(ip, today).first<{ count: number }>();

  const ipUsedToday = ipUsageResult?.count || 0;
  if (ipUsedToday >= AI_DAILY_LIMIT_IP) {
    return c.json({
      error: 'このIPアドレスからの利用上限に達しました。明日また利用できます。',
      limitReached: true,
      remaining: 0,
    }, 429);
  }

  const body = await c.req.json<{
    destination: string;
    startDate: string;
    endDate: string;
    style?: TripStyle;
    budget?: number;
    notes?: string;
  }>();

  if (!body.destination?.trim() || !body.startDate || !body.endDate) {
    return c.json({ error: '目的地と日程は必須です' }, 400);
  }

  // Calculate number of days
  const start = new Date(body.startDate);
  const end = new Date(body.endDate);
  const dayCount = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;

  if (dayCount < 1 || dayCount > 14) {
    return c.json({ error: '日程は1〜14日間で指定してください' }, 400);
  }

  const styleLabels: Record<TripStyle, string> = {
    relaxed: 'のんびり・ゆったり',
    active: 'アクティブ・観光重視',
    gourmet: 'グルメ・食べ歩き',
    sightseeing: '観光名所巡り',
  };

  const styleLabel = body.style ? styleLabels[body.style] : 'バランスの取れた';
  const budgetInfo = body.budget ? `予算は約${body.budget.toLocaleString()}円です。` : '';
  const notesInfo = body.notes ? `その他の要望: ${body.notes}` : '';

  const prompt = `あなたは旅行プランナーです。以下の条件で${body.destination}への旅行プランを作成してください。

条件:
- 目的地: ${body.destination}
- 日程: ${body.startDate} から ${body.endDate} (${dayCount}日間)
- 旅のスタイル: ${styleLabel}
${budgetInfo}
${notesInfo}

以下のJSON形式で出力してください。他の説明は不要です:
{
  "title": "旅程のタイトル（例: 京都3日間の旅）",
  "days": [
    {
      "date": "YYYY-MM-DD形式の日付",
      "items": [
        {
          "title": "スポット名や活動名",
          "timeStart": "HH:MM形式の開始時間",
          "timeEnd": "HH:MM形式の終了時間（省略可）",
          "area": "エリア名（例: 祇園、嵐山など）",
          "note": "簡単な説明やおすすめポイント",
          "cost": 推定費用（数値、円単位）
        }
      ]
    }
  ]
}

各日は朝から夜まで3〜5個の予定を入れてください。
観光スポット、食事、移動などをバランスよく配置してください。
費用は入場料や食事代の目安を入れてください。`;

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await (c.env.AI as any).run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
      messages: [
        { role: 'user', content: prompt }
      ],
      max_tokens: 4096,
    });

    // Extract JSON from response
    const responseText = typeof response === 'object' && 'response' in response
      ? (response as { response: string }).response
      : String(response);

    // Try to parse JSON from the response
    let generatedTrip: GeneratedTrip;
    try {
      // Find JSON in the response
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }
      generatedTrip = JSON.parse(jsonMatch[0]);
    } catch {
      console.error('Failed to parse AI response:', responseText);
      return c.json({ error: 'AIの応答を解析できませんでした' }, 500);
    }

    // Create trip in database
    const tripId = generateId();
    const theme = 'quiet';

    await c.env.DB.prepare(
      'INSERT INTO trips (id, title, start_date, end_date, theme, user_id) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(tripId, generatedTrip.title || `${body.destination}の旅`, body.startDate, body.endDate, theme, user?.id ?? null).run();

    // Create days and items
    for (let i = 0; i < generatedTrip.days.length; i++) {
      const day = generatedTrip.days[i];
      const dayId = generateId();
      const dayDate = day.date || new Date(start.getTime() + i * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      await c.env.DB.prepare(
        'INSERT INTO days (id, trip_id, date, sort) VALUES (?, ?, ?, ?)'
      ).bind(dayId, tripId, dayDate, i).run();

      // Create items for this day
      for (let j = 0; j < (day.items || []).length; j++) {
        const item = day.items[j];
        const itemId = generateId();

        await c.env.DB.prepare(
          `INSERT INTO items (id, trip_id, day_id, title, area, time_start, time_end, note, cost, sort)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          itemId, tripId, dayId,
          item.title || '未定',
          item.area || null,
          item.timeStart || null,
          item.timeEnd || null,
          item.note || null,
          item.cost || null,
          j
        ).run();
      }
    }

    // Record AI usage (with both user_id and ip_address)
    const usageId = generateId();
    await c.env.DB.prepare(
      'INSERT INTO ai_usage (id, user_id, ip_address) VALUES (?, ?, ?)'
    ).bind(usageId, user.id, ip).run();

    // Calculate remaining uses (use the more restrictive limit)
    const userRemaining = AI_DAILY_LIMIT_USER - userUsedToday - 1;
    const ipRemaining = AI_DAILY_LIMIT_IP - ipUsedToday - 1;
    const remaining = Math.min(userRemaining, ipRemaining);

    // Fetch the created trip
    const trip = await c.env.DB.prepare(
      'SELECT id, title, start_date as startDate, end_date as endDate, theme, created_at as createdAt FROM trips WHERE id = ?'
    ).bind(tripId).first();

    return c.json({ trip, tripId, remaining }, 201);
  } catch (error) {
    console.error('AI generation error:', error);
    return c.json({ error: 'AIによる旅程生成に失敗しました' }, 500);
  }
});

// SPA routes - serve index.html for client-side routing
const spaRoutes = ['/trips', '/trips/', '/s/', '/login'];

app.get('*', async (c) => {
  const url = new URL(c.req.url);
  const path = url.pathname;

  // Check if this is a SPA route that needs index.html
  const isSpaRoute = spaRoutes.some(route => path.startsWith(route)) ||
    path === '/' ||
    path.match(/^\/trips\/[^/]+$/) ||  // /trips/:id
    path.match(/^\/trips\/[^/]+\/edit$/);  // /trips/:id/edit

  if (isSpaRoute) {
    url.pathname = '/index.html';
    return c.env.ASSETS.fetch(new Request(url.toString(), c.req.raw));
  }

  // Serve static assets
  return c.env.ASSETS.fetch(c.req.raw);
});

export default app;
