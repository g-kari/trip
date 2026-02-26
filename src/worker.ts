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

// List all trips (for logged in user) with search and filter support
app.get('/api/trips', async (c) => {
  const user = c.get('user');
  const url = new URL(c.req.url);

  // Parse query parameters
  const q = url.searchParams.get('q')?.trim() || '';
  const theme = url.searchParams.get('theme') || '';
  const dateFrom = url.searchParams.get('dateFrom') || '';
  const dateTo = url.searchParams.get('dateTo') || '';
  const sort = url.searchParams.get('sort') || 'created_desc';
  const archived = url.searchParams.get('archived') || '0'; // '0' = active, '1' = archived, 'all' = all

  let query = 'SELECT id, title, start_date as startDate, end_date as endDate, theme, cover_image_url as coverImageUrl, budget, is_archived as isArchived, created_at as createdAt FROM trips';
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  // User filter (required)
  if (user) {
    conditions.push('user_id = ?');
    params.push(user.id);
  } else {
    conditions.push('user_id IS NULL');
  }

  // Archive filter
  if (archived === '0') {
    conditions.push('(is_archived = 0 OR is_archived IS NULL)');
  } else if (archived === '1') {
    conditions.push('is_archived = 1');
  }
  // 'all' shows everything, no filter needed

  // Title search (partial match, case-insensitive)
  if (q) {
    conditions.push('title LIKE ?');
    params.push(`%${q}%`);
  }

  // Theme filter
  if (theme === 'quiet' || theme === 'photo') {
    conditions.push('theme = ?');
    params.push(theme);
  }

  // Date range filter (using start_date for dateFrom, end_date for dateTo)
  if (dateFrom) {
    conditions.push('(start_date >= ? OR start_date IS NULL)');
    params.push(dateFrom);
  }
  if (dateTo) {
    conditions.push('(end_date <= ? OR end_date IS NULL)');
    params.push(dateTo);
  }

  // Build WHERE clause
  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ');
  }

  // Sort order
  switch (sort) {
    case 'created_asc':
      query += ' ORDER BY created_at ASC';
      break;
    case 'start_date_desc':
      query += ' ORDER BY start_date DESC NULLS LAST';
      break;
    case 'start_date_asc':
      query += ' ORDER BY start_date ASC NULLS LAST';
      break;
    case 'created_desc':
    default:
      query += ' ORDER BY created_at DESC';
      break;
  }

  const stmt = params.length > 0
    ? c.env.DB.prepare(query).bind(...params)
    : c.env.DB.prepare(query);

  const { results } = await stmt.all();
  return c.json({ trips: results });
});

// ============ Stats ============

// Get user stats (requires login)
app.get('/api/stats', async (c) => {
  const user = c.get('user');

  // Require login
  if (!user) {
    return c.json({ error: '統計にはログインが必要です' }, 401);
  }

  // Get total trips count
  const totalTripsResult = await c.env.DB.prepare(
    'SELECT COUNT(*) as count FROM trips WHERE user_id = ?'
  ).bind(user.id).first<{ count: number }>();
  const totalTrips = totalTripsResult?.count ?? 0;

  // Get total days count (sum of days per trip)
  const totalDaysResult = await c.env.DB.prepare(
    `SELECT COUNT(*) as count FROM days d
     INNER JOIN trips t ON d.trip_id = t.id
     WHERE t.user_id = ?`
  ).bind(user.id).first<{ count: number }>();
  const totalDays = totalDaysResult?.count ?? 0;

  // Get total cost (sum of all item costs)
  const totalCostResult = await c.env.DB.prepare(
    `SELECT COALESCE(SUM(i.cost), 0) as total FROM items i
     INNER JOIN trips t ON i.trip_id = t.id
     WHERE t.user_id = ?`
  ).bind(user.id).first<{ total: number }>();
  const totalCost = totalCostResult?.total ?? 0;

  // Get cost by category
  const { results: costByCategoryResults } = await c.env.DB.prepare(
    `SELECT i.cost_category as category, SUM(i.cost) as amount
     FROM items i
     INNER JOIN trips t ON i.trip_id = t.id
     WHERE t.user_id = ? AND i.cost IS NOT NULL AND i.cost_category IS NOT NULL
     GROUP BY i.cost_category
     ORDER BY amount DESC`
  ).bind(user.id).all<{ category: string; amount: number }>();
  const costByCategory = costByCategoryResults.map((r) => ({
    category: r.category,
    amount: r.amount,
  }));

  // Get trips by theme
  const { results: tripsByThemeResults } = await c.env.DB.prepare(
    `SELECT theme, COUNT(*) as count
     FROM trips
     WHERE user_id = ?
     GROUP BY theme`
  ).bind(user.id).all<{ theme: string | null; count: number }>();
  const tripsByTheme = tripsByThemeResults.map((r) => ({
    theme: r.theme ?? 'quiet',
    count: r.count,
  }));

  // Get trips by month (past 12 months)
  const { results: tripsByMonthResults } = await c.env.DB.prepare(
    `SELECT strftime('%Y-%m', start_date) as month, COUNT(*) as count
     FROM trips
     WHERE user_id = ? AND start_date IS NOT NULL
       AND start_date >= date('now', '-12 months')
     GROUP BY strftime('%Y-%m', start_date)
     ORDER BY month ASC`
  ).bind(user.id).all<{ month: string; count: number }>();
  const tripsByMonth = tripsByMonthResults.map((r) => ({
    month: r.month,
    count: r.count,
  }));

  // Calculate averages
  const averageCostPerTrip = totalTrips > 0 ? Math.round(totalCost / totalTrips) : 0;
  const averageDaysPerTrip = totalTrips > 0 ? Math.round((totalDays / totalTrips) * 10) / 10 : 0;

  return c.json({
    totalTrips,
    totalDays,
    totalCost,
    costByCategory,
    tripsByTheme,
    tripsByMonth,
    averageCostPerTrip,
    averageDaysPerTrip,
  });
});

// ============ Profile ============

// Get user profile
app.get('/api/profile', async (c) => {
  const user = c.get('user');

  if (!user) {
    return c.json({ error: 'ログインが必要です' }, 401);
  }

  // Get stats
  const totalTripsResult = await c.env.DB.prepare(
    'SELECT COUNT(*) as count FROM trips WHERE user_id = ?'
  ).bind(user.id).first<{ count: number }>();
  const totalTrips = totalTripsResult?.count ?? 0;

  const archivedTripsResult = await c.env.DB.prepare(
    'SELECT COUNT(*) as count FROM trips WHERE user_id = ? AND is_archived = 1'
  ).bind(user.id).first<{ count: number }>();
  const archivedTrips = archivedTripsResult?.count ?? 0;

  return c.json({
    profile: {
      id: user.id,
      name: user.name,
      email: user.email,
      avatarUrl: user.avatarUrl,
      provider: user.provider,
      createdAt: user.createdAt,
    },
    stats: {
      totalTrips,
      archivedTrips,
    },
  });
});

// Update user profile (display name)
app.put('/api/profile', async (c) => {
  const user = c.get('user');

  if (!user) {
    return c.json({ error: 'ログインが必要です' }, 401);
  }

  const body = await c.req.json<{ name?: string }>();

  if (body.name !== undefined) {
    const trimmedName = body.name.trim();
    if (trimmedName.length === 0) {
      return c.json({ error: '表示名を入力してください' }, 400);
    }
    if (trimmedName.length > 50) {
      return c.json({ error: '表示名は50文字以内で入力してください' }, 400);
    }

    await c.env.DB.prepare(
      `UPDATE users SET name = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`
    ).bind(trimmedName, user.id).run();
  }

  // Fetch updated user
  const updatedUser = await c.env.DB.prepare(
    `SELECT id, name, email, avatar_url as avatarUrl FROM users WHERE id = ?`
  ).bind(user.id).first<{ id: string; name: string | null; email: string | null; avatarUrl: string | null }>();

  return c.json({
    profile: updatedUser,
  });
});

// Delete user account
app.delete('/api/profile', async (c) => {
  const user = c.get('user');

  if (!user) {
    return c.json({ error: 'ログインが必要です' }, 401);
  }

  // Delete all user's data (cascade will handle trips, days, items, etc.)
  // First delete sessions
  await c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(user.id).run();

  // Delete trips (cascades to days, items, share_tokens, feedback)
  await c.env.DB.prepare('DELETE FROM trips WHERE user_id = ?').bind(user.id).run();

  // Delete user
  await c.env.DB.prepare('DELETE FROM users WHERE id = ?').bind(user.id).run();

  return c.json({ ok: true });
});

// Get single trip with days and items
app.get('/api/trips/:id', async (c) => {
  const id = c.req.param('id');
  const user = c.get('user');

  const trip = await c.env.DB.prepare(
    'SELECT id, title, start_date as startDate, end_date as endDate, theme, cover_image_url as coverImageUrl, budget, user_id as userId, created_at as createdAt, updated_at as updatedAt FROM trips WHERE id = ?'
  ).bind(id).first<{
    id: string;
    title: string;
    startDate: string | null;
    endDate: string | null;
    theme: string | null;
    coverImageUrl: string | null;
    budget: number | null;
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
     map_url as mapUrl, note, cost, cost_category as costCategory, sort, photo_url as photoUrl,
     photo_uploaded_by as photoUploadedBy, photo_uploaded_at as photoUploadedAt
     FROM items WHERE trip_id = ? ORDER BY sort ASC`
  ).bind(id).all<{
    id: string; dayId: string; title: string; area: string | null;
    timeStart: string | null; timeEnd: string | null; mapUrl: string | null;
    note: string | null; cost: number | null; costCategory: string | null; sort: number; photoUrl: string | null;
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
  const body = await c.req.json<{ title: string; startDate?: string; endDate?: string; theme?: string; coverImageUrl?: string; budget?: number }>();

  if (!body.title?.trim()) {
    return c.json({ error: 'Title is required' }, 400);
  }

  const id = generateId();
  const theme = body.theme === 'photo' ? 'photo' : 'quiet';

  await c.env.DB.prepare(
    'INSERT INTO trips (id, title, start_date, end_date, theme, cover_image_url, budget, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, body.title.trim(), body.startDate ?? null, body.endDate ?? null, theme, body.coverImageUrl ?? null, body.budget ?? null, user?.id ?? null).run();

  const trip = await c.env.DB.prepare(
    'SELECT id, title, start_date as startDate, end_date as endDate, theme, cover_image_url as coverImageUrl, budget, created_at as createdAt FROM trips WHERE id = ?'
  ).bind(id).first();

  return c.json({ trip }, 201);
});

// Update trip
app.put('/api/trips/:id', async (c) => {
  const id = c.req.param('id');
  const user = c.get('user');
  const body = await c.req.json<{ title?: string; startDate?: string; endDate?: string; theme?: string; coverImageUrl?: string; budget?: number | null }>();

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

  // Handle budget - allow explicit null to clear it
  const budgetValue = body.budget === null ? null : (body.budget ?? undefined);

  await c.env.DB.prepare(
    `UPDATE trips SET
      title = COALESCE(?, title),
      start_date = COALESCE(?, start_date),
      end_date = COALESCE(?, end_date),
      theme = COALESCE(?, theme),
      cover_image_url = COALESCE(?, cover_image_url),
      budget = CASE WHEN ?1 = 1 THEN ?2 ELSE COALESCE(?2, budget) END,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE id = ?`
  ).bind(
    body.title ?? null,
    body.startDate ?? null,
    body.endDate ?? null,
    theme,
    body.coverImageUrl ?? null,
    body.budget === null ? 1 : 0,
    budgetValue === undefined ? null : budgetValue,
    id
  ).run();

  const trip = await c.env.DB.prepare(
    'SELECT id, title, start_date as startDate, end_date as endDate, theme, cover_image_url as coverImageUrl, budget, created_at as createdAt, updated_at as updatedAt FROM trips WHERE id = ?'
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

// Toggle archive status
app.put('/api/trips/:id/archive', async (c) => {
  const id = c.req.param('id');
  const user = c.get('user');

  const existing = await c.env.DB.prepare(
    'SELECT id, user_id as userId, is_archived as isArchived FROM trips WHERE id = ?'
  ).bind(id).first<{ id: string; userId: string | null; isArchived: number | null }>();

  if (!existing) {
    return c.json({ error: 'Trip not found' }, 404);
  }

  // Check ownership
  if (existing.userId && (!user || existing.userId !== user.id)) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  // Toggle archive status
  const newArchiveStatus = existing.isArchived ? 0 : 1;

  await c.env.DB.prepare(
    `UPDATE trips SET is_archived = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`
  ).bind(newArchiveStatus, id).run();

  return c.json({ isArchived: newArchiveStatus === 1 });
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
    'SELECT id, title, start_date as startDate, end_date as endDate, theme, cover_image_url as coverImageUrl, budget, user_id as userId FROM trips WHERE id = ?'
  ).bind(id).first<{
    id: string;
    title: string;
    startDate: string | null;
    endDate: string | null;
    theme: string | null;
    coverImageUrl: string | null;
    budget: number | null;
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
    'INSERT INTO trips (id, title, start_date, end_date, theme, cover_image_url, budget, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(newTripId, newTitle, original.startDate, original.endDate, original.theme, original.coverImageUrl, original.budget, user.id).run();

  // Copy days (including notes and photos for owner's trips)
  const { results: days } = await c.env.DB.prepare(
    'SELECT id, date, sort, notes, photos FROM days WHERE trip_id = ? ORDER BY sort ASC'
  ).bind(id).all<{ id: string; date: string; sort: number; notes: string | null; photos: string | null }>();

  const dayIdMap = new Map<string, string>();

  for (const day of days) {
    const newDayId = generateId();
    dayIdMap.set(day.id, newDayId);

    // Only copy notes and photos if user is the owner of the original trip
    const notes = isOwner ? day.notes : null;
    const photos = isOwner ? day.photos : null;

    await c.env.DB.prepare(
      'INSERT INTO days (id, trip_id, date, sort, notes, photos) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(newDayId, newTripId, day.date, day.sort, notes, photos).run();
  }

  // Copy items (including photo_url for owner's trips)
  const { results: items } = await c.env.DB.prepare(
    'SELECT id, day_id, title, area, time_start, time_end, map_url, note, cost, cost_category, sort, photo_url FROM items WHERE trip_id = ? ORDER BY sort ASC'
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
    cost_category: string | null;
    sort: number;
    photo_url: string | null;
  }>();

  for (const item of items) {
    const newDayId = dayIdMap.get(item.day_id);
    if (!newDayId) continue;

    const newItemId = generateId();

    // Only copy photo_url if user is the owner of the original trip
    const photoUrl = isOwner ? item.photo_url : null;

    await c.env.DB.prepare(
      'INSERT INTO items (id, trip_id, day_id, title, area, time_start, time_end, map_url, note, cost, cost_category, sort, photo_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(newItemId, newTripId, newDayId, item.title, item.area, item.time_start, item.time_end, item.map_url, item.note, item.cost, item.cost_category, item.sort, photoUrl).run();
  }

  // Copy day_photos (only for owner's trips)
  if (isOwner) {
    const { results: dayPhotos } = await c.env.DB.prepare(
      'SELECT id, day_id, photo_url, uploaded_by, uploaded_by_name, uploaded_at FROM day_photos WHERE trip_id = ?'
    ).bind(id).all<{
      id: string;
      day_id: string;
      photo_url: string;
      uploaded_by: string | null;
      uploaded_by_name: string | null;
      uploaded_at: string | null;
    }>();

    for (const photo of dayPhotos) {
      const newDayId = dayIdMap.get(photo.day_id);
      if (!newDayId) continue;

      const newPhotoId = generateId();
      await c.env.DB.prepare(
        'INSERT INTO day_photos (id, trip_id, day_id, photo_url, uploaded_by, uploaded_by_name, uploaded_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).bind(newPhotoId, newTripId, newDayId, photo.photo_url, photo.uploaded_by, photo.uploaded_by_name, photo.uploaded_at).run();
    }
  }

  // Fetch the new trip
  const newTrip = await c.env.DB.prepare(
    'SELECT id, title, start_date as startDate, end_date as endDate, theme, cover_image_url as coverImageUrl, created_at as createdAt FROM trips WHERE id = ?'
  ).bind(newTripId).first();

  return c.json({ trip: newTrip, tripId: newTripId }, 201);
});

// ============ Days ============

// Helper to check trip ownership (owner-only operations)
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

// Helper to check if user can edit a trip (owner or collaborator with editor role)
async function checkCanEditTrip(
  db: D1Database,
  tripId: string,
  user: User | null
): Promise<{ ok: boolean; error?: string; status?: number; isOwner?: boolean }> {
  const trip = await db
    .prepare('SELECT id, user_id as userId FROM trips WHERE id = ?')
    .bind(tripId)
    .first<{ id: string; userId: string | null }>();

  if (!trip) {
    return { ok: false, error: 'Trip not found', status: 404 };
  }

  // Check if user is owner
  if (!trip.userId || (user && trip.userId === user.id)) {
    return { ok: true, isOwner: true };
  }

  if (!user) {
    return { ok: false, error: 'Forbidden', status: 403 };
  }

  // Check if user is a collaborator with edit permission
  const collaborator = await db
    .prepare('SELECT role FROM trip_collaborators WHERE trip_id = ? AND user_id = ?')
    .bind(tripId, user.id)
    .first<{ role: string }>();

  if (collaborator && collaborator.role === 'editor') {
    return { ok: true, isOwner: false };
  }

  return { ok: false, error: 'Forbidden', status: 403 };
}

// Create day
app.post('/api/trips/:tripId/days', async (c) => {
  const tripId = c.req.param('tripId');
  const user = c.get('user');
  const body = await c.req.json<{ date: string; sort?: number }>();

  const check = await checkCanEditTrip(c.env.DB, tripId, user);
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

  const check = await checkCanEditTrip(c.env.DB, tripId, user);
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

  const check = await checkCanEditTrip(c.env.DB, tripId, user);
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
    costCategory?: string;
    sort?: number;
  }>();

  const check = await checkCanEditTrip(c.env.DB, tripId, user);
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
    `INSERT INTO items (id, trip_id, day_id, title, area, time_start, time_end, map_url, note, cost, cost_category, sort)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id, tripId, body.dayId, body.title.trim(),
    body.area ?? null, body.timeStart ?? null, body.timeEnd ?? null,
    body.mapUrl ?? null, body.note ?? null, body.cost ?? null, body.costCategory ?? null, sort
  ).run();

  const item = await c.env.DB.prepare(
    'SELECT id, day_id as dayId, title, area, time_start as timeStart, time_end as timeEnd, map_url as mapUrl, note, cost, cost_category as costCategory, sort FROM items WHERE id = ?'
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
    costCategory?: string | null;
    sort?: number;
  }>();

  const check = await checkCanEditTrip(c.env.DB, tripId, user);
  if (!check.ok) {
    return c.json({ error: check.error }, check.status as 403 | 404);
  }

  const existing = await c.env.DB.prepare(
    'SELECT id FROM items WHERE id = ? AND trip_id = ?'
  ).bind(itemId, tripId).first();

  if (!existing) {
    return c.json({ error: 'Item not found' }, 404);
  }

  // Handle costCategory - allow explicit null to clear it
  const costCategoryValue = body.costCategory === null ? null : (body.costCategory ?? undefined);

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
      cost_category = CASE WHEN ?1 = 1 THEN ?2 ELSE COALESCE(?2, cost_category) END,
      sort = COALESCE(?, sort),
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE id = ?`
  ).bind(
    body.dayId ?? null, body.title ?? null, body.area ?? null,
    body.timeStart ?? null, body.timeEnd ?? null, body.mapUrl ?? null,
    body.note ?? null, body.cost ?? null,
    body.costCategory === null ? 1 : 0,
    costCategoryValue === undefined ? null : costCategoryValue,
    body.sort ?? null, itemId
  ).run();

  const item = await c.env.DB.prepare(
    'SELECT id, day_id as dayId, title, area, time_start as timeStart, time_end as timeEnd, map_url as mapUrl, note, cost, cost_category as costCategory, sort FROM items WHERE id = ?'
  ).bind(itemId).first();

  return c.json({ item });
});

// Delete item
app.delete('/api/trips/:tripId/items/:itemId', async (c) => {
  const { tripId, itemId } = c.req.param();
  const user = c.get('user');

  const check = await checkCanEditTrip(c.env.DB, tripId, user);
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

  const check = await checkCanEditTrip(c.env.DB, tripId, user);
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

// Move item to a different day (cross-day reorder)
app.put('/api/trips/:tripId/items/:itemId/reorder', async (c) => {
  const { tripId, itemId } = c.req.param();
  const user = c.get('user');
  const body = await c.req.json<{ newDayId: string; newSort: number }>();

  const check = await checkCanEditTrip(c.env.DB, tripId, user);
  if (!check.ok) {
    return c.json({ error: check.error }, check.status as 403 | 404);
  }

  // Verify item exists and belongs to this trip
  const item = await c.env.DB.prepare(
    'SELECT id, day_id FROM items WHERE id = ? AND trip_id = ?'
  ).bind(itemId, tripId).first<{ id: string; day_id: string }>();

  if (!item) {
    return c.json({ error: 'アイテムが見つかりません' }, 404);
  }

  // Verify target day exists and belongs to this trip
  const targetDay = await c.env.DB.prepare(
    'SELECT id FROM days WHERE id = ? AND trip_id = ?'
  ).bind(body.newDayId, tripId).first<{ id: string }>();

  if (!targetDay) {
    return c.json({ error: '移動先の日程が見つかりません' }, 404);
  }

  const oldDayId = item.day_id;
  const newDayId = body.newDayId;
  const newSort = body.newSort;

  // Move item to new day and set sort value
  await c.env.DB.prepare(
    `UPDATE items SET day_id = ?, sort = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
     WHERE id = ?`
  ).bind(newDayId, newSort, itemId).run();

  // Re-sort items in the old day (shift down items after the removed one)
  const { results: oldDayItems } = await c.env.DB.prepare(
    'SELECT id FROM items WHERE trip_id = ? AND day_id = ? ORDER BY sort ASC'
  ).bind(tripId, oldDayId).all<{ id: string }>();

  for (let i = 0; i < oldDayItems.length; i++) {
    await c.env.DB.prepare(
      'UPDATE items SET sort = ? WHERE id = ?'
    ).bind(i, oldDayItems[i].id).run();
  }

  // Re-sort items in the new day (shift up items after the inserted position)
  const { results: newDayItems } = await c.env.DB.prepare(
    'SELECT id FROM items WHERE trip_id = ? AND day_id = ? ORDER BY sort ASC'
  ).bind(tripId, newDayId).all<{ id: string }>();

  for (let i = 0; i < newDayItems.length; i++) {
    await c.env.DB.prepare(
      'UPDATE items SET sort = ? WHERE id = ?'
    ).bind(i, newDayItems[i].id).run();
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
    'SELECT id, title, start_date as startDate, end_date as endDate, theme, cover_image_url as coverImageUrl, budget, user_id as userId FROM trips WHERE id = ?'
  ).bind(share.trip_id).first<{
    id: string;
    title: string;
    startDate: string | null;
    endDate: string | null;
    theme: string | null;
    coverImageUrl: string | null;
    budget: number | null;
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
     map_url as mapUrl, note, cost, cost_category as costCategory, sort, photo_url as photoUrl,
     photo_uploaded_by as photoUploadedBy, photo_uploaded_at as photoUploadedAt
     FROM items WHERE trip_id = ? ORDER BY sort ASC`
  ).bind(share.trip_id).all<{
    id: string; dayId: string; title: string; area: string | null;
    timeStart: string | null; timeEnd: string | null; mapUrl: string | null;
    note: string | null; cost: number | null; costCategory: string | null; sort: number; photoUrl: string | null;
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

// ============ Collaborators ============

// Helper to check trip access (owner or collaborator with edit permission)
async function checkTripEditAccess(
  db: D1Database,
  tripId: string,
  user: User | null
): Promise<{ ok: boolean; error?: string; status?: number; isOwner?: boolean; role?: string }> {
  if (!user) {
    return { ok: false, error: 'ログインが必要です', status: 401 };
  }

  const trip = await db
    .prepare('SELECT id, user_id as userId FROM trips WHERE id = ?')
    .bind(tripId)
    .first<{ id: string; userId: string | null }>();

  if (!trip) {
    return { ok: false, error: 'Trip not found', status: 404 };
  }

  // Check if user is owner
  if (!trip.userId || trip.userId === user.id) {
    return { ok: true, isOwner: true, role: 'owner' };
  }

  // Check if user is a collaborator with edit permission
  const collaborator = await db
    .prepare('SELECT role FROM trip_collaborators WHERE trip_id = ? AND user_id = ?')
    .bind(tripId, user.id)
    .first<{ role: string }>();

  if (collaborator) {
    if (collaborator.role === 'editor') {
      return { ok: true, isOwner: false, role: 'editor' };
    }
    // Viewers can view but not edit
    return { ok: false, error: '編集権限がありません', status: 403, role: 'viewer' };
  }

  return { ok: false, error: 'Forbidden', status: 403 };
}

// Get collaborators for a trip
app.get('/api/trips/:tripId/collaborators', async (c) => {
  const tripId = c.req.param('tripId');
  const user = c.get('user');

  // Only owner can see full collaborator list
  const check = await checkTripOwnership(c.env.DB, tripId, user);
  if (!check.ok) {
    return c.json({ error: check.error }, check.status as 403 | 404);
  }

  // Get collaborators with user info
  const { results: collaborators } = await c.env.DB.prepare(`
    SELECT tc.id, tc.user_id as userId, tc.role, tc.created_at as createdAt,
           u.name as userName, u.email as userEmail, u.avatar_url as userAvatarUrl,
           ib.name as invitedByName
    FROM trip_collaborators tc
    LEFT JOIN users u ON tc.user_id = u.id
    LEFT JOIN users ib ON tc.invited_by = ib.id
    WHERE tc.trip_id = ?
    ORDER BY tc.created_at ASC
  `).bind(tripId).all<{
    id: string;
    userId: string;
    role: string;
    createdAt: string;
    userName: string | null;
    userEmail: string | null;
    userAvatarUrl: string | null;
    invitedByName: string | null;
  }>();

  // Get pending invites
  const { results: pendingInvites } = await c.env.DB.prepare(`
    SELECT ci.id, ci.email, ci.role, ci.token, ci.created_at as createdAt, ci.expires_at as expiresAt,
           u.name as invitedByName
    FROM collaborator_invites ci
    LEFT JOIN users u ON ci.invited_by = u.id
    WHERE ci.trip_id = ? AND ci.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now')
    ORDER BY ci.created_at ASC
  `).bind(tripId).all<{
    id: string;
    email: string;
    role: string;
    token: string;
    createdAt: string;
    expiresAt: string;
    invitedByName: string | null;
  }>();

  return c.json({ collaborators, pendingInvites });
});

// Add collaborator (by email - creates invite)
app.post('/api/trips/:tripId/collaborators', async (c) => {
  const tripId = c.req.param('tripId');
  const user = c.get('user');

  // Only owner can add collaborators
  const check = await checkTripOwnership(c.env.DB, tripId, user);
  if (!check.ok) {
    return c.json({ error: check.error }, check.status as 403 | 404);
  }

  const body = await c.req.json<{ email: string; role?: string }>();

  if (!body.email?.trim()) {
    return c.json({ error: 'メールアドレスを入力してください' }, 400);
  }

  const email = body.email.trim().toLowerCase();
  const role = body.role === 'viewer' ? 'viewer' : 'editor';

  // Check if user already has access (is owner)
  const trip = await c.env.DB.prepare(
    'SELECT user_id as userId FROM trips WHERE id = ?'
  ).bind(tripId).first<{ userId: string | null }>();

  // Check if the email belongs to an existing user
  const existingUser = await c.env.DB.prepare(
    'SELECT id, email FROM users WHERE email = ?'
  ).bind(email).first<{ id: string; email: string }>();

  if (existingUser) {
    // Check if they're the owner
    if (trip?.userId === existingUser.id) {
      return c.json({ error: 'オーナーを共同編集者として追加することはできません' }, 400);
    }

    // Check if already a collaborator
    const existingCollab = await c.env.DB.prepare(
      'SELECT id FROM trip_collaborators WHERE trip_id = ? AND user_id = ?'
    ).bind(tripId, existingUser.id).first();

    if (existingCollab) {
      return c.json({ error: 'このユーザーは既に共同編集者です' }, 400);
    }

    // Add them directly as a collaborator
    const id = generateId();
    await c.env.DB.prepare(`
      INSERT INTO trip_collaborators (id, trip_id, user_id, role, invited_by)
      VALUES (?, ?, ?, ?, ?)
    `).bind(id, tripId, existingUser.id, role, user!.id).run();

    return c.json({
      collaborator: {
        id,
        userId: existingUser.id,
        role,
        createdAt: new Date().toISOString(),
      },
      addedDirectly: true,
    }, 201);
  }

  // Check if invite already exists
  const existingInvite = await c.env.DB.prepare(
    'SELECT id FROM collaborator_invites WHERE trip_id = ? AND email = ? AND expires_at > strftime(\'%Y-%m-%dT%H:%M:%fZ\',\'now\')'
  ).bind(tripId, email).first();

  if (existingInvite) {
    return c.json({ error: 'このメールアドレスには既に招待を送信済みです' }, 400);
  }

  // Create an invite
  const id = generateId();
  const token = generateToken();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days

  await c.env.DB.prepare(`
    INSERT INTO collaborator_invites (id, trip_id, email, role, token, invited_by, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(id, tripId, email, role, token, user!.id, expiresAt).run();

  return c.json({
    invite: {
      id,
      email,
      role,
      token,
      expiresAt,
    },
    addedDirectly: false,
  }, 201);
});

// Accept collaborator invite
app.post('/api/collaborator-invites/:token/accept', async (c) => {
  const token = c.req.param('token');
  const user = c.get('user');

  if (!user) {
    return c.json({ error: 'ログインが必要です' }, 401);
  }

  // Get the invite
  const invite = await c.env.DB.prepare(`
    SELECT id, trip_id as tripId, email, role, expires_at as expiresAt, invited_by as invitedBy
    FROM collaborator_invites
    WHERE token = ?
  `).bind(token).first<{
    id: string;
    tripId: string;
    email: string;
    role: string;
    expiresAt: string;
    invitedBy: string;
  }>();

  if (!invite) {
    return c.json({ error: '招待リンクが無効です' }, 404);
  }

  // Check if expired
  if (new Date(invite.expiresAt) < new Date()) {
    return c.json({ error: '招待リンクの有効期限が切れています' }, 400);
  }

  // Check if already a collaborator
  const existingCollab = await c.env.DB.prepare(
    'SELECT id FROM trip_collaborators WHERE trip_id = ? AND user_id = ?'
  ).bind(invite.tripId, user.id).first();

  if (existingCollab) {
    // Delete the invite since user already has access
    await c.env.DB.prepare('DELETE FROM collaborator_invites WHERE id = ?').bind(invite.id).run();
    return c.json({ error: 'あなたは既にこの旅程の共同編集者です', tripId: invite.tripId }, 400);
  }

  // Check if user is the owner
  const trip = await c.env.DB.prepare(
    'SELECT user_id as userId, title FROM trips WHERE id = ?'
  ).bind(invite.tripId).first<{ userId: string | null; title: string }>();

  if (trip?.userId === user.id) {
    await c.env.DB.prepare('DELETE FROM collaborator_invites WHERE id = ?').bind(invite.id).run();
    return c.json({ error: 'あなたはこの旅程のオーナーです', tripId: invite.tripId }, 400);
  }

  // Add as collaborator
  const id = generateId();
  await c.env.DB.prepare(`
    INSERT INTO trip_collaborators (id, trip_id, user_id, role, invited_by)
    VALUES (?, ?, ?, ?, ?)
  `).bind(id, invite.tripId, user.id, invite.role, invite.invitedBy).run();

  // Delete the invite
  await c.env.DB.prepare('DELETE FROM collaborator_invites WHERE id = ?').bind(invite.id).run();

  return c.json({
    collaborator: {
      id,
      userId: user.id,
      role: invite.role,
      createdAt: new Date().toISOString(),
    },
    tripId: invite.tripId,
    tripTitle: trip?.title,
  });
});

// Remove collaborator
app.delete('/api/trips/:tripId/collaborators/:userId', async (c) => {
  const { tripId, userId } = c.req.param();
  const user = c.get('user');

  // Check if current user is owner or the collaborator themselves
  const trip = await c.env.DB.prepare(
    'SELECT user_id as userId FROM trips WHERE id = ?'
  ).bind(tripId).first<{ userId: string | null }>();

  if (!trip) {
    return c.json({ error: 'Trip not found' }, 404);
  }

  const isOwner = trip.userId && user && trip.userId === user.id;
  const isSelf = user && userId === user.id;

  if (!isOwner && !isSelf) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  await c.env.DB.prepare(
    'DELETE FROM trip_collaborators WHERE trip_id = ? AND user_id = ?'
  ).bind(tripId, userId).run();

  return c.json({ ok: true });
});

// Cancel pending invite
app.delete('/api/trips/:tripId/invites/:inviteId', async (c) => {
  const { tripId, inviteId } = c.req.param();
  const user = c.get('user');

  // Only owner can cancel invites
  const check = await checkTripOwnership(c.env.DB, tripId, user);
  if (!check.ok) {
    return c.json({ error: check.error }, check.status as 403 | 404);
  }

  await c.env.DB.prepare(
    'DELETE FROM collaborator_invites WHERE id = ? AND trip_id = ?'
  ).bind(inviteId, tripId).run();

  return c.json({ ok: true });
});

// Check for updates since a timestamp (for polling)
app.get('/api/trips/:tripId/updates', async (c) => {
  const tripId = c.req.param('tripId');
  const user = c.get('user');
  const url = new URL(c.req.url);
  const since = url.searchParams.get('since');

  // Check access (owner or collaborator)
  const access = await checkTripEditAccess(c.env.DB, tripId, user);
  if (!access.ok && access.role !== 'viewer') {
    return c.json({ error: access.error }, access.status as 401 | 403 | 404);
  }

  // Update active editor status
  if (user) {
    await c.env.DB.prepare(`
      INSERT INTO active_editors (id, trip_id, user_id, last_active_at)
      VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      ON CONFLICT(trip_id, user_id) DO UPDATE SET last_active_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
    `).bind(generateId(), tripId, user.id).run();

    // Clean up stale active editors (inactive for more than 30 seconds)
    await c.env.DB.prepare(`
      DELETE FROM active_editors
      WHERE trip_id = ? AND last_active_at < strftime('%Y-%m-%dT%H:%M:%fZ', datetime('now', '-30 seconds'))
    `).bind(tripId).run();
  }

  // Get trip's updated_at
  const trip = await c.env.DB.prepare(
    'SELECT updated_at as updatedAt FROM trips WHERE id = ?'
  ).bind(tripId).first<{ updatedAt: string }>();

  if (!trip) {
    return c.json({ error: 'Trip not found' }, 404);
  }

  // Get active editors
  const { results: activeEditors } = await c.env.DB.prepare(`
    SELECT ae.user_id as userId, ae.last_active_at as lastActiveAt,
           u.name as userName, u.avatar_url as avatarUrl
    FROM active_editors ae
    LEFT JOIN users u ON ae.user_id = u.id
    WHERE ae.trip_id = ?
  `).bind(tripId).all<{
    userId: string;
    lastActiveAt: string;
    userName: string | null;
    avatarUrl: string | null;
  }>();

  // Check if there are updates
  let hasUpdates = false;
  if (since) {
    const sinceDate = new Date(since);
    const updatedDate = new Date(trip.updatedAt);
    hasUpdates = updatedDate > sinceDate;
  }

  return c.json({
    hasUpdates,
    updatedAt: trip.updatedAt,
    activeEditors: activeEditors.filter(e => user && e.userId !== user.id), // Exclude current user
    currentUserRole: access.role,
  });
});

// Get trips shared with the current user (as collaborator)
app.get('/api/shared-with-me', async (c) => {
  const user = c.get('user');

  if (!user) {
    return c.json({ error: 'ログインが必要です' }, 401);
  }

  const { results: trips } = await c.env.DB.prepare(`
    SELECT t.id, t.title, t.start_date as startDate, t.end_date as endDate,
           t.theme, t.cover_image_url as coverImageUrl, t.created_at as createdAt,
           tc.role, u.name as ownerName, u.avatar_url as ownerAvatarUrl
    FROM trip_collaborators tc
    INNER JOIN trips t ON tc.trip_id = t.id
    LEFT JOIN users u ON t.user_id = u.id
    WHERE tc.user_id = ?
    ORDER BY t.created_at DESC
  `).bind(user.id).all<{
    id: string;
    title: string;
    startDate: string | null;
    endDate: string | null;
    theme: string | null;
    coverImageUrl: string | null;
    createdAt: string;
    role: string;
    ownerName: string | null;
    ownerAvatarUrl: string | null;
  }>();

  return c.json({ trips });
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

// ============ Data Export (JSON/CSV) ============

// Helper function to build export data
async function buildExportData(
  db: D1Database,
  tripId: string
): Promise<{
  trip: {
    title: string;
    startDate: string | null;
    endDate: string | null;
    theme: string | null;
    budget: number | null;
  };
  days: Array<{
    date: string;
    notes: string | null;
    items: Array<{
      title: string;
      area: string | null;
      timeStart: string | null;
      timeEnd: string | null;
      note: string | null;
      cost: number | null;
      costCategory: string | null;
    }>;
  }>;
  exportedAt: string;
} | null> {
  const trip = await db
    .prepare(
      'SELECT id, title, start_date as startDate, end_date as endDate, theme, budget FROM trips WHERE id = ?'
    )
    .bind(tripId)
    .first<{
      id: string;
      title: string;
      startDate: string | null;
      endDate: string | null;
      theme: string | null;
      budget: number | null;
    }>();

  if (!trip) {
    return null;
  }

  const { results: days } = await db
    .prepare('SELECT id, date, sort, notes FROM days WHERE trip_id = ? ORDER BY sort ASC')
    .bind(tripId)
    .all<{ id: string; date: string; sort: number; notes: string | null }>();

  const { results: items } = await db
    .prepare(
      `SELECT id, day_id as dayId, title, area, time_start as timeStart, time_end as timeEnd,
       note, cost, cost_category as costCategory, sort FROM items WHERE trip_id = ? ORDER BY sort ASC`
    )
    .bind(tripId)
    .all<{
      id: string;
      dayId: string;
      title: string;
      area: string | null;
      timeStart: string | null;
      timeEnd: string | null;
      note: string | null;
      cost: number | null;
      costCategory: string | null;
      sort: number;
    }>();

  // Group items by day
  const dayItems = new Map<string, typeof items>();
  for (const item of items) {
    const existing = dayItems.get(item.dayId) || [];
    existing.push(item);
    dayItems.set(item.dayId, existing);
  }

  return {
    trip: {
      title: trip.title,
      startDate: trip.startDate,
      endDate: trip.endDate,
      theme: trip.theme,
      budget: trip.budget,
    },
    days: days.map((day) => ({
      date: day.date,
      notes: day.notes,
      items: (dayItems.get(day.id) || []).map((item) => ({
        title: item.title,
        area: item.area,
        timeStart: item.timeStart,
        timeEnd: item.timeEnd,
        note: item.note,
        cost: item.cost,
        costCategory: item.costCategory,
      })),
    })),
    exportedAt: new Date().toISOString(),
  };
}

// Helper function to convert export data to CSV
function convertToCSV(data: NonNullable<Awaited<ReturnType<typeof buildExportData>>>): string {
  // UTF-8 BOM for Excel compatibility
  const BOM = '\uFEFF';

  // CSV header
  const header = ['日付', 'タイトル', 'エリア', '開始時刻', '終了時刻', 'メモ', '費用', 'カテゴリ'];

  const rows: string[][] = [];

  for (const day of data.days) {
    for (const item of day.items) {
      rows.push([
        day.date || '',
        item.title || '',
        item.area || '',
        item.timeStart || '',
        item.timeEnd || '',
        item.note || '',
        item.cost !== null ? String(item.cost) : '',
        item.costCategory || '',
      ]);
    }
  }

  // Escape CSV values
  const escapeCSV = (value: string): string => {
    if (value.includes(',') || value.includes('"') || value.includes('\n')) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  };

  const csvLines = [
    header.map(escapeCSV).join(','),
    ...rows.map((row) => row.map(escapeCSV).join(',')),
  ];

  return BOM + csvLines.join('\r\n');
}

// Export trip data (JSON or CSV) - owner only
app.get('/api/trips/:tripId/export', async (c) => {
  const tripId = c.req.param('tripId');
  const user = c.get('user');
  const format = c.req.query('format') || 'json';

  // Check ownership - owner only
  const check = await checkTripOwnership(c.env.DB, tripId, user);
  if (!check.ok) {
    return c.json({ error: check.error }, check.status as 403 | 404);
  }

  const data = await buildExportData(c.env.DB, tripId);
  if (!data) {
    return c.json({ error: 'Trip not found' }, 404);
  }

  if (format === 'csv') {
    const csv = convertToCSV(data);
    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(data.trip.title)}.csv"`,
        'Cache-Control': 'private, max-age=0',
      },
    });
  }

  // Default to JSON
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(data.trip.title)}.json"`,
      'Cache-Control': 'private, max-age=0',
    },
  });
});

// Import trip from JSON - requires login
app.post('/api/trips/import', async (c) => {
  const user = c.get('user');

  // Require login for import
  if (!user) {
    return c.json({ error: 'インポートにはログインが必要です' }, 401);
  }

  let data: unknown;
  try {
    data = await c.req.json();
  } catch {
    return c.json({ error: '無効なJSONファイルです' }, 400);
  }

  // Validate basic structure
  if (!data || typeof data !== 'object') {
    return c.json({ error: '無効なJSONファイルです' }, 400);
  }

  const importData = data as {
    trip?: {
      title?: unknown;
      startDate?: unknown;
      endDate?: unknown;
      theme?: unknown;
      budget?: unknown;
    };
    days?: Array<{
      date?: unknown;
      notes?: unknown;
      items?: Array<{
        title?: unknown;
        area?: unknown;
        timeStart?: unknown;
        timeEnd?: unknown;
        note?: unknown;
        cost?: unknown;
        costCategory?: unknown;
      }>;
    }>;
  };

  // Validate trip object
  if (!importData.trip || typeof importData.trip !== 'object') {
    return c.json({ error: '旅程データが見つかりません' }, 400);
  }

  // Validate title
  if (!importData.trip.title || typeof importData.trip.title !== 'string' || !importData.trip.title.trim()) {
    return c.json({ error: 'タイトルが必要です' }, 400);
  }

  // Validate days array
  if (!Array.isArray(importData.days)) {
    return c.json({ error: '日程データが見つかりません' }, 400);
  }

  // Validate date format (YYYY-MM-DD)
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

  const validateDate = (date: unknown): boolean => {
    if (date === null || date === undefined) return true;
    return typeof date === 'string' && dateRegex.test(date);
  };

  // Validate startDate and endDate format
  if (importData.trip.startDate && !validateDate(importData.trip.startDate)) {
    return c.json({ error: '開始日の形式が不正です（YYYY-MM-DD）' }, 400);
  }

  if (importData.trip.endDate && !validateDate(importData.trip.endDate)) {
    return c.json({ error: '終了日の形式が不正です（YYYY-MM-DD）' }, 400);
  }

  // Validate each day's date
  for (let i = 0; i < importData.days.length; i++) {
    const day = importData.days[i];
    if (!day || typeof day !== 'object') {
      return c.json({ error: `日程 ${i + 1} のデータが不正です` }, 400);
    }
    if (!day.date || !validateDate(day.date)) {
      return c.json({ error: `日程 ${i + 1} の日付が不正です（YYYY-MM-DD）` }, 400);
    }
  }

  // Create new trip with "(インポート)" suffix
  const tripId = generateId();
  const theme = importData.trip.theme === 'photo' ? 'photo' : 'quiet';
  const title = `${importData.trip.title}（インポート）`;

  await c.env.DB.prepare(
    'INSERT INTO trips (id, title, start_date, end_date, theme, budget, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(
    tripId,
    title,
    importData.trip.startDate || null,
    importData.trip.endDate || null,
    theme,
    typeof importData.trip.budget === 'number' ? importData.trip.budget : null,
    user.id
  ).run();

  // Create days and items
  for (let dayIndex = 0; dayIndex < importData.days.length; dayIndex++) {
    const day = importData.days[dayIndex];
    const dayId = generateId();
    const sort = dayIndex;

    await c.env.DB.prepare(
      'INSERT INTO days (id, trip_id, date, sort, notes) VALUES (?, ?, ?, ?, ?)'
    ).bind(
      dayId,
      tripId,
      day.date as string,
      sort,
      typeof day.notes === 'string' ? day.notes : null
    ).run();

    // Create items for this day
    if (Array.isArray(day.items)) {
      for (let itemIndex = 0; itemIndex < day.items.length; itemIndex++) {
        const item = day.items[itemIndex];
        if (!item || typeof item !== 'object') continue;

        const itemId = generateId();

        // Skip photo URLs (don't import photos from other users' R2 buckets)
        await c.env.DB.prepare(
          `INSERT INTO items (id, trip_id, day_id, title, area, time_start, time_end, note, cost, cost_category, sort)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          itemId,
          tripId,
          dayId,
          typeof item.title === 'string' ? item.title : '',
          typeof item.area === 'string' ? item.area : null,
          typeof item.timeStart === 'string' ? item.timeStart : null,
          typeof item.timeEnd === 'string' ? item.timeEnd : null,
          typeof item.note === 'string' ? item.note : null,
          typeof item.cost === 'number' ? item.cost : null,
          typeof item.costCategory === 'string' ? item.costCategory : null,
          itemIndex
        ).run();
      }
    }
  }

  return c.json({ tripId }, 201);
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

  const check = await checkCanEditTrip(c.env.DB, tripId, user);
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

// ============ Templates ============

// Get all public templates
app.get('/api/templates', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT id, title, start_date as startDate, end_date as endDate, theme, cover_image_url as coverImageUrl, template_uses as templateUses, created_at as createdAt
     FROM trips
     WHERE is_template = 1
     ORDER BY template_uses DESC, created_at DESC`
  ).all<{
    id: string;
    title: string;
    startDate: string | null;
    endDate: string | null;
    theme: string | null;
    coverImageUrl: string | null;
    templateUses: number;
    createdAt: string;
  }>();

  return c.json({ templates: results });
});

// Use a template (create a copy for the logged-in user)
app.post('/api/templates/:id/use', async (c) => {
  const templateId = c.req.param('id');
  const user = c.get('user');

  // Require login to use template
  if (!user) {
    return c.json({ error: 'テンプレートの利用にはログインが必要です' }, 401);
  }

  // Get the template
  const template = await c.env.DB.prepare(
    `SELECT id, title, start_date as startDate, end_date as endDate, theme, is_template as isTemplate
     FROM trips WHERE id = ? AND is_template = 1`
  ).bind(templateId).first<{
    id: string;
    title: string;
    startDate: string | null;
    endDate: string | null;
    theme: string | null;
    isTemplate: number;
  }>();

  if (!template) {
    return c.json({ error: 'テンプレートが見つかりません' }, 404);
  }

  // Create new trip from template
  const newTripId = generateId();

  await c.env.DB.prepare(
    `INSERT INTO trips (id, title, start_date, end_date, theme, user_id, is_template, template_uses)
     VALUES (?, ?, ?, ?, ?, ?, 0, 0)`
  ).bind(newTripId, template.title, template.startDate, template.endDate, template.theme, user.id).run();

  // Copy days
  const { results: days } = await c.env.DB.prepare(
    'SELECT id, date, sort, notes FROM days WHERE trip_id = ? ORDER BY sort ASC'
  ).bind(templateId).all<{ id: string; date: string; sort: number; notes: string | null }>();

  const dayIdMap = new Map<string, string>();

  for (const day of days) {
    const newDayId = generateId();
    dayIdMap.set(day.id, newDayId);

    await c.env.DB.prepare(
      'INSERT INTO days (id, trip_id, date, sort, notes) VALUES (?, ?, ?, ?, ?)'
    ).bind(newDayId, newTripId, day.date, day.sort, day.notes).run();
  }

  // Copy items (without photos)
  const { results: items } = await c.env.DB.prepare(
    `SELECT id, day_id, title, area, time_start, time_end, map_url, note, cost, sort
     FROM items WHERE trip_id = ? ORDER BY sort ASC`
  ).bind(templateId).all<{
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
      `INSERT INTO items (id, trip_id, day_id, title, area, time_start, time_end, map_url, note, cost, sort)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(newItemId, newTripId, newDayId, item.title, item.area, item.time_start, item.time_end, item.map_url, item.note, item.cost, item.sort).run();
  }

  // Increment template_uses
  await c.env.DB.prepare(
    'UPDATE trips SET template_uses = template_uses + 1 WHERE id = ?'
  ).bind(templateId).run();

  // Get the new trip
  const newTrip = await c.env.DB.prepare(
    'SELECT id, title, start_date as startDate, end_date as endDate, theme, created_at as createdAt FROM trips WHERE id = ?'
  ).bind(newTripId).first();

  return c.json({ trip: newTrip, tripId: newTripId }, 201);
});

// Toggle template status (owner only)
app.put('/api/trips/:id/template', async (c) => {
  const tripId = c.req.param('id');
  const user = c.get('user');
  const body = await c.req.json<{ isTemplate: boolean }>();

  const check = await checkTripOwnership(c.env.DB, tripId, user);
  if (!check.ok) {
    return c.json({ error: check.error }, check.status as 403 | 404);
  }

  await c.env.DB.prepare(
    'UPDATE trips SET is_template = ?, updated_at = strftime(\'%Y-%m-%dT%H:%M:%fZ\',\'now\') WHERE id = ?'
  ).bind(body.isTemplate ? 1 : 0, tripId).run();

  return c.json({ ok: true, isTemplate: body.isTemplate });
});

// Get template status for a trip
app.get('/api/trips/:id/template', async (c) => {
  const tripId = c.req.param('id');
  const user = c.get('user');

  const check = await checkTripOwnership(c.env.DB, tripId, user);
  if (!check.ok) {
    return c.json({ error: check.error }, check.status as 403 | 404);
  }

  const result = await c.env.DB.prepare(
    'SELECT is_template as isTemplate, template_uses as templateUses FROM trips WHERE id = ?'
  ).bind(tripId).first<{ isTemplate: number; templateUses: number }>();

  return c.json({
    isTemplate: result?.isTemplate === 1,
    templateUses: result?.templateUses || 0,
  });
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

// ============ Trip Feedback (Ratings & Reviews) ============

// Get trip feedback list with average rating
app.get('/api/trips/:tripId/feedback', async (c) => {
  const tripId = c.req.param('tripId');

  // Check if trip exists
  const trip = await c.env.DB.prepare(
    'SELECT id FROM trips WHERE id = ?'
  ).bind(tripId).first();

  if (!trip) {
    return c.json({ error: 'Trip not found' }, 404);
  }

  // Get all feedback for this trip
  const { results: feedbackList } = await c.env.DB.prepare(
    `SELECT id, user_id as userId, name, rating, comment, created_at as createdAt
     FROM trip_feedback
     WHERE trip_id = ?
     ORDER BY created_at DESC`
  ).bind(tripId).all<{
    id: string;
    userId: string | null;
    name: string;
    rating: number;
    comment: string | null;
    createdAt: string;
  }>();

  // Calculate average rating
  const totalRating = feedbackList.reduce((sum, fb) => sum + fb.rating, 0);
  const averageRating = feedbackList.length > 0 ? totalRating / feedbackList.length : 0;

  return c.json({
    feedback: feedbackList,
    stats: {
      count: feedbackList.length,
      averageRating: Math.round(averageRating * 10) / 10,
    },
  });
});

// Post feedback for a trip
app.post('/api/trips/:tripId/feedback', async (c) => {
  const tripId = c.req.param('tripId');
  const user = c.get('user');
  const body = await c.req.json<{
    name?: string;
    rating: number;
    comment?: string;
  }>();

  // Validate rating
  if (!body.rating || body.rating < 1 || body.rating > 5) {
    return c.json({ error: '評価は1〜5の間で指定してください' }, 400);
  }

  // Check if trip exists
  const trip = await c.env.DB.prepare(
    'SELECT id FROM trips WHERE id = ?'
  ).bind(tripId).first();

  if (!trip) {
    return c.json({ error: 'Trip not found' }, 404);
  }

  // For logged-in users, prevent duplicate feedback
  if (user) {
    const existing = await c.env.DB.prepare(
      'SELECT id FROM trip_feedback WHERE trip_id = ? AND user_id = ?'
    ).bind(tripId, user.id).first();

    if (existing) {
      return c.json({ error: '既にフィードバックを投稿しています' }, 409);
    }
  }

  const id = generateId();
  const name = user?.name || body.name?.trim() || '匿名';

  await c.env.DB.prepare(
    `INSERT INTO trip_feedback (id, trip_id, user_id, name, rating, comment)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(
    id,
    tripId,
    user?.id ?? null,
    name,
    body.rating,
    body.comment?.trim() ?? null
  ).run();

  const feedback = await c.env.DB.prepare(
    `SELECT id, user_id as userId, name, rating, comment, created_at as createdAt
     FROM trip_feedback WHERE id = ?`
  ).bind(id).first();

  return c.json({ feedback }, 201);
});

// Delete own feedback
app.delete('/api/feedback/:feedbackId', async (c) => {
  const feedbackId = c.req.param('feedbackId');
  const user = c.get('user');

  if (!user) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  // Get the feedback
  const feedback = await c.env.DB.prepare(
    'SELECT id, trip_id as tripId, user_id as userId FROM trip_feedback WHERE id = ?'
  ).bind(feedbackId).first<{ id: string; tripId: string; userId: string | null }>();

  if (!feedback) {
    return c.json({ error: 'Feedback not found' }, 404);
  }

  // Check if user is the feedback author or trip owner
  const isAuthor = feedback.userId === user.id;
  const tripOwnerCheck = await checkTripOwnership(c.env.DB, feedback.tripId, user);
  const isTripOwner = tripOwnerCheck.ok;

  if (!isAuthor && !isTripOwner) {
    return c.json({ error: 'フィードバックを削除する権限がありません' }, 403);
  }

  await c.env.DB.prepare('DELETE FROM trip_feedback WHERE id = ?').bind(feedbackId).run();

  return c.json({ ok: true });
});

// Get feedback for shared trip
app.get('/api/shared/:token/feedback', async (c) => {
  const token = c.req.param('token');

  const share = await c.env.DB.prepare(
    'SELECT trip_id FROM share_tokens WHERE token = ?'
  ).bind(token).first<{ trip_id: string }>();

  if (!share) {
    return c.json({ error: 'Invalid share link' }, 404);
  }

  const tripId = share.trip_id;

  // Get all feedback for this trip
  const { results: feedbackList } = await c.env.DB.prepare(
    `SELECT id, user_id as userId, name, rating, comment, created_at as createdAt
     FROM trip_feedback
     WHERE trip_id = ?
     ORDER BY created_at DESC`
  ).bind(tripId).all<{
    id: string;
    userId: string | null;
    name: string;
    rating: number;
    comment: string | null;
    createdAt: string;
  }>();

  // Calculate average rating
  const totalRating = feedbackList.reduce((sum, fb) => sum + fb.rating, 0);
  const averageRating = feedbackList.length > 0 ? totalRating / feedbackList.length : 0;

  return c.json({
    feedback: feedbackList,
    stats: {
      count: feedbackList.length,
      averageRating: Math.round(averageRating * 10) / 10,
    },
  });
});

// Post feedback for shared trip
app.post('/api/shared/:token/feedback', async (c) => {
  const token = c.req.param('token');
  const user = c.get('user');
  const body = await c.req.json<{
    name?: string;
    rating: number;
    comment?: string;
  }>();

  // Validate rating
  if (!body.rating || body.rating < 1 || body.rating > 5) {
    return c.json({ error: '評価は1〜5の間で指定してください' }, 400);
  }

  const share = await c.env.DB.prepare(
    'SELECT trip_id FROM share_tokens WHERE token = ?'
  ).bind(token).first<{ trip_id: string }>();

  if (!share) {
    return c.json({ error: 'Invalid share link' }, 404);
  }

  const tripId = share.trip_id;

  // For logged-in users, prevent duplicate feedback
  if (user) {
    const existing = await c.env.DB.prepare(
      'SELECT id FROM trip_feedback WHERE trip_id = ? AND user_id = ?'
    ).bind(tripId, user.id).first();

    if (existing) {
      return c.json({ error: '既にフィードバックを投稿しています' }, 409);
    }
  }

  const id = generateId();
  const name = user?.name || body.name?.trim() || '匿名';

  await c.env.DB.prepare(
    `INSERT INTO trip_feedback (id, trip_id, user_id, name, rating, comment)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(
    id,
    tripId,
    user?.id ?? null,
    name,
    body.rating,
    body.comment?.trim() ?? null
  ).run();

  const feedback = await c.env.DB.prepare(
    `SELECT id, user_id as userId, name, rating, comment, created_at as createdAt
     FROM trip_feedback WHERE id = ?`
  ).bind(id).first();

  return c.json({ feedback }, 201);
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
const spaRoutes = ['/trips', '/trips/', '/login', '/contact', '/invite'];

app.get('*', async (c) => {
  const url = new URL(c.req.url);
  const path = url.pathname;

  // Check if this is a SPA route that needs index.html
  const isSpaRoute = spaRoutes.some(route => path.startsWith(route)) ||
    path === '/' ||
    path.match(/^\/trips\/[^/]+$/) ||  // /trips/:id
    path.match(/^\/trips\/[^/]+\/edit$/) ||  // /trips/:id/edit
    path.match(/^\/invite\/[^/]+$/);  // /invite/:token

  if (isSpaRoute) {
    url.pathname = '/index.html';
    return c.env.ASSETS.fetch(new Request(url.toString(), c.req.raw));
  }

  // Serve static assets
  return c.env.ASSETS.fetch(c.req.raw);
});

export default app;
