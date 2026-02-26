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
  exchangeCodeForTokens as exchangeGoogleCodeForTokens,
  getGoogleUserInfo,
} from './auth/google';
import {
  getLineAuthUrl,
  exchangeCodeForTokens as exchangeLineCodeForTokens,
  getLineUserInfo,
} from './auth/line';
import type { User } from './auth/types';
import { generateOgpImage } from './ogp';

type Bindings = {
  DB: D1Database;
  ASSETS: { fetch: (request: Request) => Promise<Response> };
  COVERS: R2Bucket;
  AI: Ai;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  LINE_CHANNEL_ID: string;
  LINE_CHANNEL_SECRET: string;
};

type Vars = {
  user: User | null;
};

type AppEnv = {
  Bindings: Bindings;
  Variables: Vars;
};

const app = new Hono<AppEnv>();

// Helper to generate random token for share links
function generateToken(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let token = '';
  const array = new Uint8Array(12);
  crypto.getRandomValues(array);
  for (let i = 0; i < 12; i++) {
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
    const tokens = await exchangeGoogleCodeForTokens(
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

// Start LINE OAuth flow
app.get('/api/auth/line', (c) => {
  const url = new URL(c.req.url);
  const redirectUri = `${url.origin}/api/auth/line/callback`;

  // Generate state for CSRF protection
  const state = generateToken();

  const authUrl = getLineAuthUrl(
    c.env.LINE_CHANNEL_ID,
    redirectUri,
    state
  );

  // Set state cookie for verification
  return c.redirect(authUrl, 302);
});

// LINE OAuth callback
app.get('/api/auth/line/callback', async (c) => {
  const url = new URL(c.req.url);
  const code = url.searchParams.get('code');

  if (!code) {
    return c.redirect('/login?error=no_code', 302);
  }

  try {
    const redirectUri = `${url.origin}/api/auth/line/callback`;

    // Exchange code for tokens
    const tokens = await exchangeLineCodeForTokens(
      code,
      c.env.LINE_CHANNEL_ID,
      c.env.LINE_CHANNEL_SECRET,
      redirectUri
    );

    // Get user info from LINE
    const lineUser = await getLineUserInfo(tokens.access_token);

    // Find or create user
    let user = await c.env.DB.prepare(
      `SELECT id, provider, provider_id as providerId, email, name,
              avatar_url as avatarUrl, created_at as createdAt
       FROM users WHERE provider = ? AND provider_id = ?`
    )
      .bind('line', lineUser.userId)
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
          'line',
          lineUser.userId,
          null, // LINE does not provide email in basic profile
          lineUser.displayName,
          lineUser.pictureUrl || null
        )
        .run();

      user = {
        id: userId,
        provider: 'line',
        providerId: lineUser.userId,
        email: null,
        name: lineUser.displayName,
        avatarUrl: lineUser.pictureUrl || null,
        createdAt: new Date().toISOString(),
      };
    } else {
      // Update user info
      await c.env.DB.prepare(
        `UPDATE users SET name = ?, avatar_url = ?,
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE id = ?`
      )
        .bind(lineUser.displayName, lineUser.pictureUrl || null, user.id)
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
    console.error('LINE auth error:', error);
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
    'SELECT id, date, sort, notes, photos FROM days WHERE trip_id = ? ORDER BY sort ASC'
  ).bind(id).all<{ id: string; date: string; sort: number; notes: string | null; photos: string | null }>();

  const { results: items } = await c.env.DB.prepare(
    `SELECT id, day_id as dayId, title, area, time_start as timeStart, time_end as timeEnd,
     map_url as mapUrl, note, cost, sort, photo_url as photoUrl,
     photo_uploaded_by as photoUploadedBy, photo_uploaded_at as photoUploadedAt
     FROM items WHERE trip_id = ? ORDER BY sort ASC`
  ).bind(id).all<{
    id: string; dayId: string; title: string; area: string | null;
    timeStart: string | null; timeEnd: string | null; mapUrl: string | null;
    note: string | null; cost: number | null; sort: number; photoUrl: string | null;
    photoUploadedBy: string | null; photoUploadedAt: string | null;
  }>();

  // Get day_photos from the new table
  const { results: dayPhotos } = await c.env.DB.prepare(
    `SELECT id, day_id as dayId, photo_url as photoUrl, uploaded_by as uploadedBy,
     uploaded_by_name as uploadedByName, uploaded_at as uploadedAt
     FROM day_photos WHERE trip_id = ? ORDER BY uploaded_at ASC`
  ).bind(id).all<{
    id: string; dayId: string; photoUrl: string;
    uploadedBy: string | null; uploadedByName: string | null; uploadedAt: string | null;
  }>();

  // Get uploader names for items
  const uploaderIds = items.filter(i => i.photoUploadedBy).map(i => i.photoUploadedBy);
  const uniqueUploaderIds = [...new Set(uploaderIds)];
  const uploaderNames: Map<string, string> = new Map();

  if (uniqueUploaderIds.length > 0) {
    const placeholders = uniqueUploaderIds.map(() => '?').join(',');
    const { results: users } = await c.env.DB.prepare(
      `SELECT id, name, email FROM users WHERE id IN (${placeholders})`
    ).bind(...uniqueUploaderIds).all<{ id: string; name: string | null; email: string | null }>();
    for (const u of users) {
      uploaderNames.set(u.id, u.name || u.email || '匿名');
    }
  }

  // Enrich items with uploader names
  const itemsWithUploaderNames = items.map((item) => ({
    ...item,
    photoUploadedByName: item.photoUploadedBy ? uploaderNames.get(item.photoUploadedBy) || null : null,
  }));

  // Group day_photos by day_id
  const dayPhotosMap = new Map<string, Array<{
    id: string; photoUrl: string; uploadedBy: string | null;
    uploadedByName: string | null; uploadedAt: string | null;
  }>>();
  for (const photo of dayPhotos) {
    const existing = dayPhotosMap.get(photo.dayId) || [];
    existing.push({
      id: photo.id,
      photoUrl: photo.photoUrl,
      uploadedBy: photo.uploadedBy,
      uploadedByName: photo.uploadedByName,
      uploadedAt: photo.uploadedAt,
    });
    dayPhotosMap.set(photo.dayId, existing);
  }

  // Parse photos JSON for each day and merge with new day_photos
  const daysWithParsedPhotos = days.map((day) => {
    // Old format photos (string array)
    const oldPhotos: string[] = day.photos ? JSON.parse(day.photos) : [];
    const oldPhotosFormatted = oldPhotos.map((url, i) => ({
      id: `legacy-${day.id}-${i}`,
      photoUrl: url,
      uploadedBy: null,
      uploadedByName: null,
      uploadedAt: null,
    }));

    // New format photos from day_photos table
    const newPhotos = dayPhotosMap.get(day.id) || [];

    return {
      ...day,
      photos: [...oldPhotosFormatted, ...newPhotos],
    };
  });

  return c.json({
    trip: { ...trip, days: daysWithParsedPhotos, items: itemsWithUploaderNames },
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

// Duplicate trip
app.post('/api/trips/:id/duplicate', async (c) => {
  const id = c.req.param('id');
  const user = c.get('user');

  // Require login for duplication
  if (!user) {
    return c.json({ error: '複製にはログインが必要です' }, 401);
  }

  // Get the original trip
  const original = await c.env.DB.prepare(
    'SELECT id, title, start_date as startDate, end_date as endDate, theme, cover_image_url as coverImageUrl, user_id as userId FROM trips WHERE id = ?'
  ).bind(id).first<{
    id: string;
    title: string;
    startDate: string | null;
    endDate: string | null;
    theme: string | null;
    coverImageUrl: string | null;
    userId: string | null;
  }>();

  if (!original) {
    return c.json({ error: 'Trip not found' }, 404);
  }

  // Check if user can access the original (owner or shared)
  const isOwner = !original.userId || original.userId === user.id;
  if (!isOwner) {
    // Check if it's shared
    const share = await c.env.DB.prepare(
      'SELECT id FROM share_tokens WHERE trip_id = ?'
    ).bind(id).first();
    if (!share) {
      return c.json({ error: 'Forbidden' }, 403);
    }
  }

  // Create new trip
  const newTripId = generateId();
  const newTitle = `${original.title} (コピー)`;

  await c.env.DB.prepare(
    'INSERT INTO trips (id, title, start_date, end_date, theme, cover_image_url, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(newTripId, newTitle, original.startDate, original.endDate, original.theme, original.coverImageUrl, user.id).run();

  // Copy days
  const { results: days } = await c.env.DB.prepare(
    'SELECT id, date, sort FROM days WHERE trip_id = ? ORDER BY sort ASC'
  ).bind(id).all<{ id: string; date: string; sort: number }>();

  const dayIdMap = new Map<string, string>();

  for (const day of days) {
    const newDayId = generateId();
    dayIdMap.set(day.id, newDayId);

    await c.env.DB.prepare(
      'INSERT INTO days (id, trip_id, date, sort) VALUES (?, ?, ?, ?)'
    ).bind(newDayId, newTripId, day.date, day.sort).run();
  }

  // Copy items
  const { results: items } = await c.env.DB.prepare(
    'SELECT id, day_id, title, area, time_start, time_end, map_url, note, cost, sort FROM items WHERE trip_id = ? ORDER BY sort ASC'
  ).bind(id).all<{
    id: string;
    day_id: string;
    title: string;
    area: string | null;
    time_start: string | null;
    time_end: string | null;
    map_url: string | null;
    note: string | null;
    cost: number | null;
    sort: number;
  }>();

  for (const item of items) {
    const newDayId = dayIdMap.get(item.day_id);
    if (!newDayId) continue;

    const newItemId = generateId();

    await c.env.DB.prepare(
      'INSERT INTO items (id, trip_id, day_id, title, area, time_start, time_end, map_url, note, cost, sort) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(newItemId, newTripId, newDayId, item.title, item.area, item.time_start, item.time_end, item.map_url, item.note, item.cost, item.sort).run();
  }

  // Fetch the new trip
  const newTrip = await c.env.DB.prepare(
    'SELECT id, title, start_date as startDate, end_date as endDate, theme, cover_image_url as coverImageUrl, created_at as createdAt FROM trips WHERE id = ?'
  ).bind(newTripId).first();

  return c.json({ trip: newTrip, tripId: newTripId }, 201);
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

// Reorder items within a day
app.put('/api/trips/:tripId/days/:dayId/reorder', async (c) => {
  const { tripId, dayId } = c.req.param();
  const user = c.get('user');
  const body = await c.req.json<{ itemIds: string[] }>();

  const check = await checkTripOwnership(c.env.DB, tripId, user);
  if (!check.ok) {
    return c.json({ error: check.error }, check.status as 403 | 404);
  }

  if (!body.itemIds || !Array.isArray(body.itemIds)) {
    return c.json({ error: 'itemIds array is required' }, 400);
  }

  // Update sort order for each item
  for (let i = 0; i < body.itemIds.length; i++) {
    await c.env.DB.prepare(
      'UPDATE items SET sort = ?, updated_at = strftime(\'%Y-%m-%dT%H:%M:%fZ\',\'now\') WHERE id = ? AND trip_id = ? AND day_id = ?'
    ).bind(i, body.itemIds[i], tripId, dayId).run();
  }

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

// Get share token for a trip (owner only)
app.get('/api/trips/:tripId/share', async (c) => {
  const tripId = c.req.param('tripId');
  const user = c.get('user');

  const check = await checkTripOwnership(c.env.DB, tripId, user);
  if (!check.ok) {
    return c.json({ error: check.error }, check.status as 403 | 404);
  }

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
    'SELECT id, title, start_date as startDate, end_date as endDate, theme, cover_image_url as coverImageUrl, user_id as userId FROM trips WHERE id = ?'
  ).bind(share.trip_id).first<{
    id: string;
    title: string;
    startDate: string | null;
    endDate: string | null;
    theme: string | null;
    coverImageUrl: string | null;
    userId: string | null;
  }>();

  if (!trip) {
    return c.json({ error: 'Trip not found' }, 404);
  }

  const tripOwnerId = trip.userId;

  const { results: days } = await c.env.DB.prepare(
    'SELECT id, date, sort, notes, photos FROM days WHERE trip_id = ? ORDER BY sort ASC'
  ).bind(share.trip_id).all<{ id: string; date: string; sort: number; notes: string | null; photos: string | null }>();

  const { results: items } = await c.env.DB.prepare(
    `SELECT id, day_id as dayId, title, area, time_start as timeStart, time_end as timeEnd,
     map_url as mapUrl, note, cost, sort, photo_url as photoUrl,
     photo_uploaded_by as photoUploadedBy, photo_uploaded_at as photoUploadedAt
     FROM items WHERE trip_id = ? ORDER BY sort ASC`
  ).bind(share.trip_id).all<{
    id: string; dayId: string; title: string; area: string | null;
    timeStart: string | null; timeEnd: string | null; mapUrl: string | null;
    note: string | null; cost: number | null; sort: number; photoUrl: string | null;
    photoUploadedBy: string | null; photoUploadedAt: string | null;
  }>();

  // Get day_photos from the new table
  const { results: dayPhotos } = await c.env.DB.prepare(
    `SELECT id, day_id as dayId, photo_url as photoUrl, uploaded_by as uploadedBy,
     uploaded_by_name as uploadedByName, uploaded_at as uploadedAt
     FROM day_photos WHERE trip_id = ? ORDER BY uploaded_at ASC`
  ).bind(share.trip_id).all<{
    id: string; dayId: string; photoUrl: string;
    uploadedBy: string | null; uploadedByName: string | null; uploadedAt: string | null;
  }>();

  // Get uploader names for items
  const uploaderIds = items.filter(i => i.photoUploadedBy).map(i => i.photoUploadedBy);
  const uniqueUploaderIds = [...new Set(uploaderIds)];
  const uploaderNames: Map<string, string> = new Map();

  if (uniqueUploaderIds.length > 0) {
    const placeholders = uniqueUploaderIds.map(() => '?').join(',');
    const { results: users } = await c.env.DB.prepare(
      `SELECT id, name, email FROM users WHERE id IN (${placeholders})`
    ).bind(...uniqueUploaderIds).all<{ id: string; name: string | null; email: string | null }>();
    for (const u of users) {
      uploaderNames.set(u.id, u.name || u.email || '匿名');
    }
  }

  // Enrich items with uploader names
  const itemsWithUploaderNames = items.map((item) => ({
    ...item,
    photoUploadedByName: item.photoUploadedBy ? uploaderNames.get(item.photoUploadedBy) || null : null,
  }));

  // Group day_photos by day_id
  const dayPhotosMap = new Map<string, Array<{
    id: string; photoUrl: string; uploadedBy: string | null;
    uploadedByName: string | null; uploadedAt: string | null;
  }>>();
  for (const photo of dayPhotos) {
    const existing = dayPhotosMap.get(photo.dayId) || [];
    existing.push({
      id: photo.id,
      photoUrl: photo.photoUrl,
      uploadedBy: photo.uploadedBy,
      uploadedByName: photo.uploadedByName,
      uploadedAt: photo.uploadedAt,
    });
    dayPhotosMap.set(photo.dayId, existing);
  }

  // Parse photos JSON for each day and merge with new day_photos
  const daysWithParsedPhotos = days.map((day) => {
    // Old format photos (string array)
    const oldPhotos: string[] = day.photos ? JSON.parse(day.photos) : [];
    const oldPhotosFormatted = oldPhotos.map((url, i) => ({
      id: `legacy-${day.id}-${i}`,
      photoUrl: url,
      uploadedBy: null,
      uploadedByName: null,
      uploadedAt: null,
    }));

    // New format photos from day_photos table
    const newPhotos = dayPhotosMap.get(day.id) || [];

    return {
      ...day,
      photos: [...oldPhotosFormatted, ...newPhotos],
    };
  });

  // Remove userId from the response to not expose it, but include tripOwnerId for permission checking
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { userId: _unusedUserId, ...tripWithoutUserId } = trip;
  return c.json({ trip: { ...tripWithoutUserId, days: daysWithParsedPhotos, items: itemsWithUploaderNames }, tripOwnerId });
});

// OGP image for shared trip
app.get('/api/shared/:token/ogp.png', async (c) => {
  const token = c.req.param('token');

  const share = await c.env.DB.prepare(
    'SELECT trip_id FROM share_tokens WHERE token = ?'
  ).bind(token).first<{ trip_id: string }>();

  if (!share) {
    return c.json({ error: 'Invalid share link' }, 404);
  }

  const trip = await c.env.DB.prepare(
    'SELECT title, start_date as startDate, end_date as endDate, theme, cover_image_url as coverImageUrl FROM trips WHERE id = ?'
  ).bind(share.trip_id).first<{
    title: string;
    startDate: string | null;
    endDate: string | null;
    theme: string | null;
    coverImageUrl: string | null;
  }>();

  if (!trip) {
    return c.json({ error: 'Trip not found' }, 404);
  }

  // Format date range
  let dateRange: string | undefined;
  if (trip.startDate && trip.endDate) {
    const start = new Date(trip.startDate);
    const end = new Date(trip.endDate);
    const formatDate = (d: Date) =>
      `${d.getMonth() + 1}/${d.getDate()}`;
    dateRange = `${formatDate(start)} - ${formatDate(end)}`;
  }

  try {
    const png = await generateOgpImage({
      title: trip.title,
      dateRange,
      theme: (trip.theme === 'photo' ? 'photo' : 'quiet') as 'quiet' | 'photo',
      coverImageUrl: trip.coverImageUrl,
    });

    return new Response(png as unknown as ArrayBuffer, {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch (error) {
    console.error('OGP generation error:', error);
    return c.json({ error: 'Failed to generate OGP image' }, 500);
  }
});

// ============ PDF Export ============

// Generate PDF for a trip
app.get('/api/trips/:tripId/pdf', async (c) => {
  const tripId = c.req.param('tripId');
  const user = c.get('user');

  const check = await checkTripOwnership(c.env.DB, tripId, user);
  if (!check.ok) {
    return c.json({ error: check.error }, check.status as 403 | 404);
  }

  const trip = await c.env.DB.prepare(
    'SELECT id, title, start_date as startDate, end_date as endDate FROM trips WHERE id = ?'
  ).bind(tripId).first<{
    id: string;
    title: string;
    startDate: string | null;
    endDate: string | null;
  }>();

  if (!trip) {
    return c.json({ error: 'Trip not found' }, 404);
  }

  const { results: days } = await c.env.DB.prepare(
    'SELECT id, date, sort FROM days WHERE trip_id = ? ORDER BY sort ASC'
  ).bind(tripId).all<{ id: string; date: string; sort: number }>();

  const { results: items } = await c.env.DB.prepare(
    'SELECT id, day_id as dayId, title, area, time_start as timeStart, note, cost, sort FROM items WHERE trip_id = ? ORDER BY sort ASC'
  ).bind(tripId).all<{
    id: string;
    dayId: string;
    title: string;
    area: string | null;
    timeStart: string | null;
    note: string | null;
    cost: number | null;
    sort: number;
  }>();

  // Group items by day
  const dayItems = new Map<string, typeof items>();
  for (const item of items) {
    const existing = dayItems.get(item.dayId) || [];
    existing.push(item);
    dayItems.set(item.dayId, existing);
  }

  // Build PDF data structure
  const pdfData = {
    title: trip.title,
    startDate: trip.startDate,
    endDate: trip.endDate,
    days: days.map((day) => ({
      date: day.date,
      items: (dayItems.get(day.id) || []).map((item) => ({
        title: item.title,
        timeStart: item.timeStart,
        area: item.area,
        cost: item.cost,
        note: item.note,
        mapUrl: null,
      })),
    })),
  };

  try {
    const { generateTripPdf } = await import('./pdf');
    const pdfBuffer = await generateTripPdf(pdfData);

    return new Response(pdfBuffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(trip.title)}.pdf"`,
        'Cache-Control': 'private, max-age=0',
      },
    });
  } catch (error) {
    console.error('PDF generation error:', error);
    return c.json({ error: 'Failed to generate PDF' }, 500);
  }
});

// Generate PDF for shared trip
app.get('/api/shared/:token/pdf', async (c) => {
  const token = c.req.param('token');

  const share = await c.env.DB.prepare(
    'SELECT trip_id FROM share_tokens WHERE token = ?'
  ).bind(token).first<{ trip_id: string }>();

  if (!share) {
    return c.json({ error: 'Invalid share link' }, 404);
  }

  const tripId = share.trip_id;

  const trip = await c.env.DB.prepare(
    'SELECT id, title, start_date as startDate, end_date as endDate FROM trips WHERE id = ?'
  ).bind(tripId).first<{
    id: string;
    title: string;
    startDate: string | null;
    endDate: string | null;
  }>();

  if (!trip) {
    return c.json({ error: 'Trip not found' }, 404);
  }

  const { results: days } = await c.env.DB.prepare(
    'SELECT id, date, sort FROM days WHERE trip_id = ? ORDER BY sort ASC'
  ).bind(tripId).all<{ id: string; date: string; sort: number }>();

  const { results: items } = await c.env.DB.prepare(
    'SELECT id, day_id as dayId, title, area, time_start as timeStart, note, cost, sort FROM items WHERE trip_id = ? ORDER BY sort ASC'
  ).bind(tripId).all<{
    id: string;
    dayId: string;
    title: string;
    area: string | null;
    timeStart: string | null;
    note: string | null;
    cost: number | null;
    sort: number;
  }>();

  // Group items by day
  const dayItems = new Map<string, typeof items>();
  for (const item of items) {
    const existing = dayItems.get(item.dayId) || [];
    existing.push(item);
    dayItems.set(item.dayId, existing);
  }

  // Build PDF data structure
  const pdfData = {
    title: trip.title,
    startDate: trip.startDate,
    endDate: trip.endDate,
    days: days.map((day) => ({
      date: day.date,
      items: (dayItems.get(day.id) || []).map((item) => ({
        title: item.title,
        timeStart: item.timeStart,
        area: item.area,
        cost: item.cost,
        note: item.note,
        mapUrl: null,
      })),
    })),
  };

  try {
    const { generateTripPdf } = await import('./pdf');
    const pdfBuffer = await generateTripPdf(pdfData);

    return new Response(pdfBuffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(trip.title)}.pdf"`,
        'Cache-Control': 'private, max-age=0',
      },
    });
  } catch (error) {
    console.error('PDF generation error:', error);
    return c.json({ error: 'Failed to generate PDF' }, 500);
  }
});

// ============ Calendar Export (ICS) ============

// Generate ICS for a trip (owner only)
app.get('/api/trips/:tripId/calendar.ics', async (c) => {
  const tripId = c.req.param('tripId');
  const user = c.get('user');

  const check = await checkTripOwnership(c.env.DB, tripId, user);
  if (!check.ok) {
    return c.json({ error: check.error }, check.status as 403 | 404);
  }

  const trip = await c.env.DB.prepare(
    'SELECT id, title, start_date as startDate, end_date as endDate FROM trips WHERE id = ?'
  ).bind(tripId).first<{
    id: string;
    title: string;
    startDate: string | null;
    endDate: string | null;
  }>();

  if (!trip) {
    return c.json({ error: 'Trip not found' }, 404);
  }

  const { results: days } = await c.env.DB.prepare(
    'SELECT id, date, sort FROM days WHERE trip_id = ? ORDER BY sort ASC'
  ).bind(tripId).all<{ id: string; date: string; sort: number }>();

  const { results: items } = await c.env.DB.prepare(
    'SELECT id, day_id as dayId, title, area, time_start as timeStart, time_end as timeEnd, map_url as mapUrl, note, cost, sort FROM items WHERE trip_id = ? ORDER BY sort ASC'
  ).bind(tripId).all<{
    id: string;
    dayId: string;
    title: string;
    area: string | null;
    timeStart: string | null;
    timeEnd: string | null;
    mapUrl: string | null;
    note: string | null;
    cost: number | null;
    sort: number;
  }>();

  try {
    const { buildTripIcs } = await import('./ics');
    const icsContent = buildTripIcs({
      id: trip.id,
      title: trip.title,
      startDate: trip.startDate,
      endDate: trip.endDate,
      days: days.map(d => ({ id: d.id, date: d.date })),
      items: items.map(item => ({
        id: item.id,
        dayId: item.dayId,
        title: item.title,
        area: item.area,
        timeStart: item.timeStart,
        timeEnd: item.timeEnd,
        note: item.note,
        cost: item.cost,
        mapUrl: item.mapUrl,
      })),
    });

    return new Response(icsContent, {
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(trip.title)}.ics"`,
        'Cache-Control': 'private, max-age=0',
      },
    });
  } catch (error) {
    console.error('ICS generation error:', error);
    return c.json({ error: 'Failed to generate calendar file' }, 500);
  }
});

// Generate ICS for shared trip
app.get('/api/shared/:token/calendar.ics', async (c) => {
  const token = c.req.param('token');

  const share = await c.env.DB.prepare(
    'SELECT trip_id FROM share_tokens WHERE token = ?'
  ).bind(token).first<{ trip_id: string }>();

  if (!share) {
    return c.json({ error: 'Invalid share link' }, 404);
  }

  const tripId = share.trip_id;

  const trip = await c.env.DB.prepare(
    'SELECT id, title, start_date as startDate, end_date as endDate FROM trips WHERE id = ?'
  ).bind(tripId).first<{
    id: string;
    title: string;
    startDate: string | null;
    endDate: string | null;
  }>();

  if (!trip) {
    return c.json({ error: 'Trip not found' }, 404);
  }

  const { results: days } = await c.env.DB.prepare(
    'SELECT id, date, sort FROM days WHERE trip_id = ? ORDER BY sort ASC'
  ).bind(tripId).all<{ id: string; date: string; sort: number }>();

  const { results: items } = await c.env.DB.prepare(
    'SELECT id, day_id as dayId, title, area, time_start as timeStart, time_end as timeEnd, map_url as mapUrl, note, cost, sort FROM items WHERE trip_id = ? ORDER BY sort ASC'
  ).bind(tripId).all<{
    id: string;
    dayId: string;
    title: string;
    area: string | null;
    timeStart: string | null;
    timeEnd: string | null;
    mapUrl: string | null;
    note: string | null;
    cost: number | null;
    sort: number;
  }>();

  try {
    const { buildTripIcs } = await import('./ics');
    const icsContent = buildTripIcs({
      id: trip.id,
      title: trip.title,
      startDate: trip.startDate,
      endDate: trip.endDate,
      days: days.map(d => ({ id: d.id, date: d.date })),
      items: items.map(item => ({
        id: item.id,
        dayId: item.dayId,
        title: item.title,
        area: item.area,
        timeStart: item.timeStart,
        timeEnd: item.timeEnd,
        note: item.note,
        cost: item.cost,
        mapUrl: item.mapUrl,
      })),
    });

    return new Response(icsContent, {
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(trip.title)}.ics"`,
        'Cache-Control': 'private, max-age=0',
      },
    });
  } catch (error) {
    console.error('ICS generation error:', error);
    return c.json({ error: 'Failed to generate calendar file' }, 500);
  }
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

// ============ Item Photos ============

// Upload photo for an item
app.post('/api/trips/:tripId/items/:itemId/photo', async (c) => {
  const { tripId, itemId } = c.req.param();
  const user = c.get('user');

  // Allow any logged-in user to upload photos to shared trips
  if (!user) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const existing = await c.env.DB.prepare(
    'SELECT id FROM items WHERE id = ? AND trip_id = ?'
  ).bind(itemId, tripId).first();

  if (!existing) {
    return c.json({ error: 'Item not found' }, 404);
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
  const key = `photos/items/${itemId}.${ext}`;

  try {
    const body = await c.req.arrayBuffer();
    await c.env.COVERS.put(key, body, {
      httpMetadata: {
        contentType,
      },
    });

    const url = new URL(c.req.url);
    const photoUrl = `${url.origin}/api/photos/items/${itemId}.${ext}`;

    // Update item with photo URL and uploader info
    await c.env.DB.prepare(
      `UPDATE items SET
        photo_url = ?,
        photo_uploaded_by = ?,
        photo_uploaded_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE id = ?`
    ).bind(photoUrl, user?.id || null, itemId).run();

    return c.json({ photoUrl }, 201);
  } catch (error) {
    console.error('Failed to upload item photo:', error);
    return c.json({ error: 'Failed to upload image' }, 500);
  }
});

// Delete photo for an item
app.delete('/api/trips/:tripId/items/:itemId/photo', async (c) => {
  const { tripId, itemId } = c.req.param();
  const user = c.get('user');

  if (!user) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const item = await c.env.DB.prepare(
    'SELECT id, photo_url as photoUrl, photo_uploaded_by as photoUploadedBy FROM items WHERE id = ? AND trip_id = ?'
  ).bind(itemId, tripId).first<{ id: string; photoUrl: string | null; photoUploadedBy: string | null }>();

  if (!item) {
    return c.json({ error: 'Item not found' }, 404);
  }

  // Check if user is the photo uploader or the trip owner
  const isUploader = item.photoUploadedBy === user.id;
  const tripOwnerCheck = await checkTripOwnership(c.env.DB, tripId, user);
  const isTripOwner = tripOwnerCheck.ok;

  if (!isUploader && !isTripOwner) {
    return c.json({ error: 'Only the uploader or trip owner can delete this photo' }, 403);
  }

  if (item.photoUrl) {
    // Extract key from URL
    const urlParts = item.photoUrl.split('/api/photos/items/');
    if (urlParts[1]) {
      const key = `photos/items/${urlParts[1]}`;
      await c.env.COVERS.delete(key);
    }
  }

  // Clear photo URL in database
  await c.env.DB.prepare(
    'UPDATE items SET photo_url = NULL, photo_uploaded_by = NULL, photo_uploaded_at = NULL, updated_at = strftime(\'%Y-%m-%dT%H:%M:%fZ\',\'now\') WHERE id = ?'
  ).bind(itemId).run();

  return c.json({ ok: true });
});

// Get item photo
app.get('/api/photos/items/:key', async (c) => {
  const key = `photos/items/${c.req.param('key')}`;

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

// ============ Day Notes & Photos (その他) ============

// Update day notes and photos
app.put('/api/trips/:tripId/days/:dayId/notes', async (c) => {
  const { tripId, dayId } = c.req.param();
  const user = c.get('user');
  const body = await c.req.json<{ notes?: string; photos?: string[] }>();

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

  // Photos are stored as JSON array
  const photosJson = body.photos ? JSON.stringify(body.photos) : null;

  await c.env.DB.prepare(
    'UPDATE days SET notes = COALESCE(?, notes), photos = COALESCE(?, photos) WHERE id = ?'
  ).bind(body.notes ?? null, photosJson, dayId).run();

  const day = await c.env.DB.prepare(
    'SELECT id, date, sort, notes, photos FROM days WHERE id = ?'
  ).bind(dayId).first();

  return c.json({ day });
});

// Upload photo to day's "その他" section
app.post('/api/trips/:tripId/days/:dayId/photos', async (c) => {
  const { tripId, dayId } = c.req.param();
  const user = c.get('user');

  // Allow any logged-in user to upload photos to shared trips
  if (!user) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const existing = await c.env.DB.prepare(
    'SELECT id FROM days WHERE id = ? AND trip_id = ?'
  ).bind(dayId, tripId).first<{ id: string }>();

  if (!existing) {
    return c.json({ error: 'Day not found' }, 404);
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
  const photoId = generateId();
  const key = `photos/days/${dayId}/${photoId}.${ext}`;

  try {
    const body = await c.req.arrayBuffer();
    await c.env.COVERS.put(key, body, {
      httpMetadata: {
        contentType,
      },
    });

    const url = new URL(c.req.url);
    const photoUrl = `${url.origin}/api/photos/days/${dayId}/${photoId}.${ext}`;

    // Insert into day_photos table with uploader info
    await c.env.DB.prepare(
      `INSERT INTO day_photos (id, day_id, trip_id, photo_url, uploaded_by, uploaded_by_name)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(photoId, dayId, tripId, photoUrl, user.id, user.name || user.email || null).run();

    return c.json({ photoId, photoUrl }, 201);
  } catch (error) {
    console.error('Failed to upload day photo:', error);
    return c.json({ error: 'Failed to upload image' }, 500);
  }
});

// Delete a photo from day's "その他" section
app.delete('/api/trips/:tripId/days/:dayId/photos/:photoId', async (c) => {
  const { tripId, dayId, photoId } = c.req.param();
  const user = c.get('user');

  if (!user) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  // Get the photo to check ownership
  const photo = await c.env.DB.prepare(
    'SELECT id, photo_url, uploaded_by FROM day_photos WHERE id = ? AND day_id = ? AND trip_id = ?'
  ).bind(photoId, dayId, tripId).first<{ id: string; photo_url: string; uploaded_by: string | null }>();

  if (!photo) {
    // Try to check old format (in days.photos JSON array)
    const day = await c.env.DB.prepare(
      'SELECT id, photos FROM days WHERE id = ? AND trip_id = ?'
    ).bind(dayId, tripId).first<{ id: string; photos: string | null }>();

    if (day && day.photos) {
      const currentPhotos: string[] = JSON.parse(day.photos);
      const photoToDelete = currentPhotos.find(p => p.includes(photoId));

      if (photoToDelete) {
        // Only trip owner can delete old format photos
        const check = await checkTripOwnership(c.env.DB, tripId, user);
        if (!check.ok) {
          return c.json({ error: check.error }, check.status as 403 | 404);
        }

        // Extract key from URL and delete from R2
        const urlParts = photoToDelete.split('/api/photos/days/');
        if (urlParts[1]) {
          const key = `photos/days/${urlParts[1]}`;
          await c.env.COVERS.delete(key);
        }

        // Remove from array
        const newPhotos = currentPhotos.filter(p => !p.includes(photoId));
        await c.env.DB.prepare(
          'UPDATE days SET photos = ? WHERE id = ?'
        ).bind(JSON.stringify(newPhotos), dayId).run();

        return c.json({ ok: true });
      }
    }

    return c.json({ error: 'Photo not found' }, 404);
  }

  // Check if user is the uploader or the trip owner
  const isUploader = photo.uploaded_by === user.id;
  const tripOwnerCheck = await checkTripOwnership(c.env.DB, tripId, user);
  const isTripOwner = tripOwnerCheck.ok;

  if (!isUploader && !isTripOwner) {
    return c.json({ error: 'Only the uploader or trip owner can delete this photo' }, 403);
  }

  // Delete from R2
  const urlParts = photo.photo_url.split('/api/photos/days/');
  if (urlParts[1]) {
    const key = `photos/days/${urlParts[1]}`;
    await c.env.COVERS.delete(key);
  }

  // Delete from database
  await c.env.DB.prepare('DELETE FROM day_photos WHERE id = ?').bind(photoId).run();

  return c.json({ ok: true });
});

// Get day photo
app.get('/api/photos/days/:dayId/:key', async (c) => {
  const { dayId, key } = c.req.param();
  const fullKey = `photos/days/${dayId}/${key}`;

  const object = await c.env.COVERS.get(fullKey);
  if (!object) {
    return c.json({ error: 'Image not found' }, 404);
  }

  const headers = new Headers();
  headers.set('Content-Type', object.httpMetadata?.contentType || 'image/jpeg');
  headers.set('Cache-Control', 'public, max-age=31536000');
  headers.set('ETag', object.etag);

  return new Response(object.body, { headers });
});

// ============ Feedback ============

// Submit feedback (public endpoint)
app.post('/api/feedback', async (c) => {
  const body = await c.req.json<{ name?: string; message: string }>();

  if (!body.message?.trim()) {
    return c.json({ error: 'Message is required' }, 400);
  }

  const id = generateId();
  const name = body.name?.trim() || '匿名';

  await c.env.DB.prepare(
    'INSERT INTO feedback (id, name, message) VALUES (?, ?, ?)'
  ).bind(id, name, body.message.trim()).run();

  return c.json({ ok: true }, 201);
});

// Get all feedback as JSON (for GitHub export)
app.get('/api/feedback.json', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT id, name, message, created_at as createdAt FROM feedback ORDER BY created_at DESC'
  ).all();

  return c.json({ feedback: results }, 200, {
    'Cache-Control': 'public, max-age=60',
  });
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

  // Handle both JSON and FormData requests
  const contentType = c.req.header('Content-Type') || '';
  let destination: string;
  let startDate: string;
  let endDate: string;
  let style: TripStyle | undefined;
  let budget: number | undefined;
  let notes: string | undefined;
  let imageData: ArrayBuffer | null = null;

  if (contentType.includes('multipart/form-data')) {
    const formData = await c.req.formData();
    destination = formData.get('destination') as string || '';
    startDate = formData.get('startDate') as string || '';
    endDate = formData.get('endDate') as string || '';
    style = formData.get('style') as TripStyle | undefined;
    const budgetStr = formData.get('budget') as string;
    budget = budgetStr ? parseInt(budgetStr, 10) : undefined;
    notes = formData.get('notes') as string | undefined;

    const imageFile = formData.get('image') as File | null;
    if (imageFile && imageFile.size > 0) {
      if (imageFile.size > 5 * 1024 * 1024) {
        return c.json({ error: '画像ファイルは5MB以下にしてください' }, 400);
      }
      imageData = await imageFile.arrayBuffer();
    }
  } else {
    const body = await c.req.json<{
      destination: string;
      startDate: string;
      endDate: string;
      style?: TripStyle;
      budget?: number;
      notes?: string;
    }>();
    destination = body.destination;
    startDate = body.startDate;
    endDate = body.endDate;
    style = body.style;
    budget = body.budget;
    notes = body.notes;
  }

  if (!destination?.trim() || !startDate || !endDate) {
    return c.json({ error: '目的地と日程は必須です' }, 400);
  }

  // Calculate number of days
  const start = new Date(startDate);
  const end = new Date(endDate);
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

  const styleLabel = style ? styleLabels[style] : 'バランスの取れた';
  const budgetInfo = budget ? `予算は約${budget.toLocaleString()}円です。` : '';
  const notesInfo = notes ? `その他の要望: ${notes}` : '';

  // If image was provided, use vision model to extract information
  let imageContext = '';
  if (imageData) {
    try {
      // Use a vision model to describe the image
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const visionResponse = await (c.env.AI as any).run('@cf/llava-hf/llava-1.5-7b-hf', {
        image: [...new Uint8Array(imageData)],
        prompt: 'この画像は旅行に関するものです。画像に含まれる場所、観光スポット、イベント、食べ物、宿泊施設などの情報を日本語で詳しく説明してください。旅行プランに役立つ情報を抽出してください。',
        max_tokens: 512,
      });

      const visionText = typeof visionResponse === 'object' && 'description' in visionResponse
        ? (visionResponse as { description: string }).description
        : String(visionResponse);

      if (visionText && visionText.length > 10) {
        imageContext = `\n\n参考画像から読み取った情報:\n${visionText}`;
      }
    } catch (err) {
      console.error('Vision model error:', err);
      // Continue without image context
    }
  }

  const prompt = `あなたは旅行プランナーです。以下の条件で${destination}への旅行プランを作成してください。

条件:
- 目的地: ${destination}
- 日程: ${startDate} から ${endDate} (${dayCount}日間)
- 旅のスタイル: ${styleLabel}
${budgetInfo}
${notesInfo}${imageContext}

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
    ).bind(tripId, generatedTrip.title || `${destination}の旅`, startDate, endDate, theme, user?.id ?? null).run();

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

// Helper to check if request is from a crawler (for OGP)
function isCrawler(userAgent: string | undefined): boolean {
  if (!userAgent) return false;
  const crawlers = [
    'Twitterbot',
    'facebookexternalhit',
    'LinkedInBot',
    'Slackbot',
    'LINE',
    'Discordbot',
    'TelegramBot',
    'WhatsApp',
  ];
  return crawlers.some(bot => userAgent.includes(bot));
}

// Generate OGP HTML for shared trips
function generateOgpHtml(options: {
  title: string;
  description: string;
  url: string;
  imageUrl: string;
}): string {
  const { title, description, url, imageUrl } = options;
  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)} - 旅程</title>
  <meta name="description" content="${escapeHtml(description)}">

  <!-- Open Graph -->
  <meta property="og:type" content="website">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:url" content="${escapeHtml(url)}">
  <meta property="og:image" content="${escapeHtml(imageUrl)}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:site_name" content="旅程">

  <!-- Twitter Card -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeHtml(title)}">
  <meta name="twitter:description" content="${escapeHtml(description)}">
  <meta name="twitter:image" content="${escapeHtml(imageUrl)}">

  <!-- Redirect to SPA for browsers -->
  <meta http-equiv="refresh" content="0; url=${escapeHtml(url)}">
</head>
<body>
  <p>リダイレクト中... <a href="${escapeHtml(url)}">こちらをクリック</a></p>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Handle shared trip page with OGP for crawlers
app.get('/s/:token', async (c) => {
  const token = c.req.param('token');
  const userAgent = c.req.header('User-Agent');

  // If not a crawler, serve the SPA
  if (!isCrawler(userAgent)) {
    const url = new URL(c.req.url);
    url.pathname = '/index.html';
    return c.env.ASSETS.fetch(new Request(url.toString(), c.req.raw));
  }

  // For crawlers, return OGP HTML
  const share = await c.env.DB.prepare(
    'SELECT trip_id FROM share_tokens WHERE token = ?'
  ).bind(token).first<{ trip_id: string }>();

  if (!share) {
    // Return basic HTML for invalid token
    return new Response('Not found', { status: 404 });
  }

  const trip = await c.env.DB.prepare(
    'SELECT title, start_date as startDate, end_date as endDate FROM trips WHERE id = ?'
  ).bind(share.trip_id).first<{
    title: string;
    startDate: string | null;
    endDate: string | null;
  }>();

  if (!trip) {
    return new Response('Not found', { status: 404 });
  }

  // Format description
  let description = '旅程で作成された旅行プラン';
  if (trip.startDate && trip.endDate) {
    const start = new Date(trip.startDate);
    const end = new Date(trip.endDate);
    const formatDate = (d: Date) => `${d.getMonth() + 1}月${d.getDate()}日`;
    description = `${formatDate(start)} - ${formatDate(end)} の旅行プラン`;
  }

  const url = new URL(c.req.url);
  const pageUrl = url.toString();
  const imageUrl = `${url.origin}/api/shared/${token}/ogp.png`;

  const html = generateOgpHtml({
    title: trip.title,
    description,
    url: pageUrl,
    imageUrl,
  });

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
});

// SPA routes - serve index.html for client-side routing
const spaRoutes = ['/trips', '/trips/', '/login', '/contact'];

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
