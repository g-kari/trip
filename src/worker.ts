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
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
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
      avatarUrl: user.avatarUrl,
      isPremium: !!user.isPremium,
      freeSlots: user.freeSlots ?? 3,
      purchasedSlots: user.purchasedSlots ?? 0,
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
      // Create new user (email not stored for privacy)
      const userId = generateId();
      await c.env.DB.prepare(
        `INSERT INTO users (id, provider, provider_id, name, avatar_url)
         VALUES (?, ?, ?, ?, ?)`
      )
        .bind(
          userId,
          'google',
          googleUser.id,
          googleUser.name,
          googleUser.picture
        )
        .run();

      user = {
        id: userId,
        provider: 'google',
        providerId: googleUser.id,
        email: null,
        name: googleUser.name,
        avatarUrl: googleUser.picture,
        createdAt: new Date().toISOString(),
      };
    } else {
      // Update user info (email not stored)
      await c.env.DB.prepare(
        `UPDATE users SET name = ?, avatar_url = ?,
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE id = ?`
      )
        .bind(googleUser.name, googleUser.picture, user.id)
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
  const tag = url.searchParams.get('tag') || ''; // Tag filter

  let query = 'SELECT id, title, start_date as startDate, end_date as endDate, theme, cover_image_url as coverImageUrl, budget, is_archived as isArchived, pinned, created_at as createdAt FROM trips';
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
  if (theme === 'quiet' || theme === 'photo' || theme === 'retro') {
    conditions.push('theme = ?');
    params.push(theme);
  }

  // Tag filter
  if (tag) {
    conditions.push('id IN (SELECT trip_id FROM trip_tags WHERE tag = ?)');
    params.push(tag);
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

  // Sort order - pinned trips always first
  switch (sort) {
    case 'created_asc':
      query += ' ORDER BY pinned DESC, created_at ASC';
      break;
    case 'start_date_desc':
      query += ' ORDER BY pinned DESC, start_date DESC NULLS LAST';
      break;
    case 'start_date_asc':
      query += ' ORDER BY pinned DESC, start_date ASC NULLS LAST';
      break;
    case 'created_desc':
    default:
      query += ' ORDER BY pinned DESC, created_at DESC';
      break;
  }

  const stmt = params.length > 0
    ? c.env.DB.prepare(query).bind(...params)
    : c.env.DB.prepare(query);

  const { results } = await stmt.all<{
    id: string;
    title: string;
    startDate: string | null;
    endDate: string | null;
    theme: string | null;
    coverImageUrl: string | null;
    budget: number | null;
    isArchived: number | null;
    pinned: number | null;
    createdAt: string;
  }>();

  // Fetch tags for all trips
  if (results.length > 0) {
    const tripIds = results.map(r => r.id);
    const placeholders = tripIds.map(() => '?').join(',');
    const { results: allTags } = await c.env.DB.prepare(
      `SELECT trip_id as tripId, tag FROM trip_tags WHERE trip_id IN (${placeholders})`
    ).bind(...tripIds).all<{ tripId: string; tag: string }>();

    // Group tags by trip_id
    const tagsByTrip = new Map<string, string[]>();
    for (const t of allTags) {
      const existing = tagsByTrip.get(t.tripId) || [];
      existing.push(t.tag);
      tagsByTrip.set(t.tripId, existing);
    }

    // Add tags to each trip
    const tripsWithTags = results.map(trip => ({
      ...trip,
      tags: tagsByTrip.get(trip.id) || [],
    }));

    return c.json({ trips: tripsWithTags });
  }

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

  // Get unique visited areas
  const { results: areasResults } = await c.env.DB.prepare(
    `SELECT DISTINCT i.area
     FROM items i
     INNER JOIN trips t ON i.trip_id = t.id
     WHERE t.user_id = ? AND i.area IS NOT NULL AND i.area != ''
     ORDER BY i.area`
  ).bind(user.id).all<{ area: string }>();
  const visitedAreas = areasResults.map((r) => r.area);

  // Get total items count
  const totalItemsResult = await c.env.DB.prepare(
    `SELECT COUNT(*) as count FROM items i
     INNER JOIN trips t ON i.trip_id = t.id
     WHERE t.user_id = ?`
  ).bind(user.id).first<{ count: number }>();
  const totalItems = totalItemsResult?.count ?? 0;

  // Calculate averages
  const averageCostPerTrip = totalTrips > 0 ? Math.round(totalCost / totalTrips) : 0;
  const averageDaysPerTrip = totalTrips > 0 ? Math.round((totalDays / totalTrips) * 10) / 10 : 0;

  return c.json({
    totalTrips,
    totalDays,
    totalItems,
    totalCost,
    costByCategory,
    tripsByTheme,
    tripsByMonth,
    visitedAreas,
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
    `SELECT id, name, avatar_url as avatarUrl FROM users WHERE id = ?`
  ).bind(user.id).first<{ id: string; name: string | null; avatarUrl: string | null }>();

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
  const shareToken = c.req.query('token');

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

  // Check ownership
  const isOwner = !trip.userId || (user && trip.userId === user.id);

  // Check if user is a collaborator
  let isCollaborator = false;
  if (user && trip.userId && trip.userId !== user.id) {
    const collab = await c.env.DB.prepare(
      'SELECT id FROM trip_collaborators WHERE trip_id = ? AND user_id = ?'
    ).bind(id, user.id).first();
    isCollaborator = !!collab;
  }

  // Check if valid share token provided
  let hasValidShareToken = false;
  if (shareToken) {
    const tokenRecord = await c.env.DB.prepare(
      'SELECT id FROM share_tokens WHERE trip_id = ? AND token = ? AND is_active = 1'
    ).bind(id, shareToken).first();
    hasValidShareToken = !!tokenRecord;
  }

  // Authorization: must be owner, collaborator, or have valid share token
  // Legacy trips (no owner) are accessible to anyone
  if (trip.userId && !isOwner && !isCollaborator && !hasValidShareToken) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const { results: days } = await c.env.DB.prepare(
    'SELECT id, date, sort, notes, photos FROM days WHERE trip_id = ? ORDER BY sort ASC'
  ).bind(id).all<{ id: string; date: string; sort: number; notes: string | null; photos: string | null }>();

  const { results: items } = await c.env.DB.prepare(
    `SELECT id, day_id as dayId, title, area, time_start as timeStart, time_end as timeEnd,
     map_url as mapUrl, note, cost, cost_category as costCategory, sort, photo_url as photoUrl,
     photo_uploaded_by as photoUploadedBy, photo_uploaded_at as photoUploadedAt,
     checked_in_at as checkedInAt, checked_in_location as checkedInLocation
     FROM items WHERE trip_id = ? ORDER BY sort ASC`
  ).bind(id).all<{
    id: string; dayId: string; title: string; area: string | null;
    timeStart: string | null; timeEnd: string | null; mapUrl: string | null;
    note: string | null; cost: number | null; costCategory: string | null; sort: number; photoUrl: string | null;
    photoUploadedBy: string | null; photoUploadedAt: string | null;
    checkedInAt: string | null; checkedInLocation: string | null;
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
      `SELECT id, name FROM users WHERE id IN (${placeholders})`
    ).bind(...uniqueUploaderIds).all<{ id: string; name: string | null }>();
    for (const u of users) {
      uploaderNames.set(u.id, u.name || '匿名');
    }
  }

  // Enrich items with uploader names and parse check-in location
  const itemsWithUploaderNames = items.map((item) => ({
    ...item,
    photoUploadedByName: item.photoUploadedBy ? uploaderNames.get(item.photoUploadedBy) || null : null,
    checkedInLocation: item.checkedInLocation ? JSON.parse(item.checkedInLocation) : null,
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

  // Get tags for this trip
  const { results: tripTags } = await c.env.DB.prepare(
    'SELECT tag FROM trip_tags WHERE trip_id = ?'
  ).bind(id).all<{ tag: string }>();
  const tags = tripTags.map(t => t.tag);

  return c.json({
    trip: { ...trip, days: daysWithParsedPhotos, items: itemsWithUploaderNames, tags },
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

  // Check if user has remaining trip slots
  if (user) {
    const userData = await c.env.DB.prepare(
      'SELECT free_slots as freeSlots, purchased_slots as purchasedSlots FROM users WHERE id = ?'
    ).bind(user.id).first<{ freeSlots: number; purchasedSlots: number }>();

    if (userData) {
      const totalSlots = userData.freeSlots + userData.purchasedSlots;
      const usedSlots = await c.env.DB.prepare(
        'SELECT COUNT(*) as count FROM trips WHERE user_id = ? AND (is_archived = 0 OR is_archived IS NULL)'
      ).bind(user.id).first<{ count: number }>();

      if (usedSlots && usedSlots.count >= totalSlots) {
        return c.json({
          error: '旅程枠が不足しています。プロフィールページから追加の枠を購入してください。',
          code: 'SLOT_LIMIT_REACHED',
          remainingSlots: 0,
          totalSlots
        }, 403);
      }
    }
  }

  const id = generateId();
  const theme = body.theme === 'photo' ? 'photo' : body.theme === 'retro' ? 'retro' : 'quiet';

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
    ? (body.theme === 'photo' ? 'photo' : body.theme === 'retro' ? 'retro' : 'quiet')
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

// Toggle pin status
app.patch('/api/trips/:id/pin', async (c) => {
  const id = c.req.param('id');
  const user = c.get('user');

  const existing = await c.env.DB.prepare(
    'SELECT id, user_id as userId, pinned FROM trips WHERE id = ?'
  ).bind(id).first<{ id: string; userId: string | null; pinned: number | null }>();

  if (!existing) {
    return c.json({ error: '旅程が見つかりません' }, 404);
  }

  // Check ownership
  if (existing.userId && (!user || existing.userId !== user.id)) {
    return c.json({ error: 'アクセスが拒否されました' }, 403);
  }

  // Toggle pin status
  const newPinStatus = existing.pinned ? 0 : 1;

  await c.env.DB.prepare(
    `UPDATE trips SET pinned = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`
  ).bind(newPinStatus, id).run();

  return c.json({ pinned: newPinStatus === 1 });
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

// Bulk create days
app.post('/api/trips/:tripId/days/bulk', async (c) => {
  const tripId = c.req.param('tripId');
  const user = c.get('user');
  const body = await c.req.json<{ startDate: string; endDate: string }>();

  const check = await checkCanEditTrip(c.env.DB, tripId, user);
  if (!check.ok) {
    return c.json({ error: check.error }, check.status as 403 | 404);
  }

  if (!body.startDate || !body.endDate) {
    return c.json({ error: 'startDate and endDate are required' }, 400);
  }

  const start = new Date(body.startDate);
  const end = new Date(body.endDate);

  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return c.json({ error: 'Invalid date format' }, 400);
  }

  if (start > end) {
    return c.json({ error: 'startDate must be before or equal to endDate' }, 400);
  }

  // Calculate number of days
  const dayCount = Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;

  if (dayCount > 30) {
    return c.json({ error: '一度に追加できる日数は30日までです' }, 400);
  }

  // Get existing days to check for duplicates
  const existingDays = await c.env.DB.prepare(
    'SELECT date FROM days WHERE trip_id = ?'
  ).bind(tripId).all<{ date: string }>();
  const existingDates = new Set(existingDays.results?.map(d => d.date) || []);

  // Generate list of dates
  const datesToCreate: string[] = [];
  const current = new Date(start);
  while (current <= end) {
    const dateStr = current.toISOString().split('T')[0];
    if (!existingDates.has(dateStr)) {
      datesToCreate.push(dateStr);
    }
    current.setDate(current.getDate() + 1);
  }

  if (datesToCreate.length === 0) {
    return c.json({ error: '追加する日程がありません（すべて既存の日程です）', days: [] }, 200);
  }

  // Create all days
  const createdDays: Array<{ id: string; date: string; sort: number }> = [];
  const baseSort = Date.now();

  for (let i = 0; i < datesToCreate.length; i++) {
    const id = generateId();
    const sort = baseSort + i;
    const date = datesToCreate[i];

    await c.env.DB.prepare(
      'INSERT INTO days (id, trip_id, date, sort) VALUES (?, ?, ?, ?)'
    ).bind(id, tripId, date, sort).run();

    createdDays.push({ id, date, sort });
  }

  return c.json({ days: createdDays, skipped: dayCount - datesToCreate.length }, 201);
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

  // Handle costCategory - allow explicit null to clear it, or keep existing if undefined
  const shouldClearCostCategory = body.costCategory === null;
  const costCategoryValue = shouldClearCostCategory ? null : (body.costCategory ?? null);

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
      cost_category = CASE WHEN ? = 1 THEN ? ELSE COALESCE(?, cost_category) END,
      sort = COALESCE(?, sort),
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE id = ?`
  ).bind(
    body.dayId ?? null, body.title ?? null, body.area ?? null,
    body.timeStart ?? null, body.timeEnd ?? null, body.mapUrl ?? null,
    body.note ?? null, body.cost ?? null,
    shouldClearCostCategory ? 1 : 0, costCategoryValue, costCategoryValue,
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
     photo_uploaded_by as photoUploadedBy, photo_uploaded_at as photoUploadedAt,
     checked_in_at as checkedInAt, checked_in_location as checkedInLocation
     FROM items WHERE trip_id = ? ORDER BY sort ASC`
  ).bind(share.trip_id).all<{
    id: string; dayId: string; title: string; area: string | null;
    timeStart: string | null; timeEnd: string | null; mapUrl: string | null;
    note: string | null; cost: number | null; costCategory: string | null; sort: number; photoUrl: string | null;
    photoUploadedBy: string | null; photoUploadedAt: string | null;
    checkedInAt: string | null; checkedInLocation: string | null;
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
      `SELECT id, name FROM users WHERE id IN (${placeholders})`
    ).bind(...uniqueUploaderIds).all<{ id: string; name: string | null }>();
    for (const u of users) {
      uploaderNames.set(u.id, u.name || '匿名');
    }
  }

  // Enrich items with uploader names and parse check-in location
  const itemsWithUploaderNames = items.map((item) => ({
    ...item,
    photoUploadedByName: item.photoUploadedBy ? uploaderNames.get(item.photoUploadedBy) || null : null,
    checkedInLocation: item.checkedInLocation ? JSON.parse(item.checkedInLocation) : null,
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
    const ogpTheme = trip.theme === 'photo' ? 'photo' : trip.theme === 'retro' ? 'retro' : 'quiet';
    const png = await generateOgpImage({
      title: trip.title,
      dateRange,
      theme: ogpTheme as 'quiet' | 'photo' | 'retro',
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
           u.name as userName, u.avatar_url as userAvatarUrl,
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
    userAvatarUrl: string | null;
    invitedByName: string | null;
  }>();

  // Get pending invites (link-based, no email)
  const { results: pendingInvites } = await c.env.DB.prepare(`
    SELECT ci.id, ci.role, ci.token, ci.created_at as createdAt, ci.expires_at as expiresAt,
           u.name as invitedByName
    FROM collaborator_invites ci
    LEFT JOIN users u ON ci.invited_by = u.id
    WHERE ci.trip_id = ? AND ci.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now')
    ORDER BY ci.created_at ASC
  `).bind(tripId).all<{
    id: string;
    role: string;
    token: string;
    createdAt: string;
    expiresAt: string;
    invitedByName: string | null;
  }>();

  return c.json({ collaborators, pendingInvites });
});

// Create invite link (no email required)
app.post('/api/trips/:tripId/collaborators', async (c) => {
  const tripId = c.req.param('tripId');
  const user = c.get('user');

  // Only owner can add collaborators
  const check = await checkTripOwnership(c.env.DB, tripId, user);
  if (!check.ok) {
    return c.json({ error: check.error }, check.status as 403 | 404);
  }

  const body = await c.req.json<{ role?: string }>();
  const role = body.role === 'viewer' ? 'viewer' : 'editor';

  // Create an invite link (no email required)
  const id = generateId();
  const token = generateToken();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days

  await c.env.DB.prepare(`
    INSERT INTO collaborator_invites (id, trip_id, email, role, token, invited_by, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(id, tripId, '', role, token, user!.id, expiresAt).run();

  return c.json({
    invite: {
      id,
      role,
      token,
      expiresAt,
    },
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
    SELECT id, trip_id as tripId, role, expires_at as expiresAt, invited_by as invitedBy
    FROM collaborator_invites
    WHERE token = ?
  `).bind(token).first<{
    id: string;
    tripId: string;
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
  const theme = importData.trip.theme === 'photo' ? 'photo' : importData.trip.theme === 'retro' ? 'retro' : 'quiet';
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

// ============ Check-in (Travel Mode) ============

// Check-in to an item
app.post('/api/trips/:tripId/items/:itemId/checkin', async (c) => {
  const { tripId, itemId } = c.req.param();
  const user = c.get('user');
  const body = await c.req.json<{ location?: { lat: number; lng: number } }>().catch(() => ({ location: undefined }));

  // Check if user can edit the trip
  const check = await checkCanEditTrip(c.env.DB, tripId, user);
  if (!check.ok) {
    return c.json({ error: check.error }, check.status as 403 | 404);
  }

  // Verify item exists and belongs to this trip
  const item = await c.env.DB.prepare(
    'SELECT id, trip_id FROM items WHERE id = ? AND trip_id = ?'
  ).bind(itemId, tripId).first<{ id: string; trip_id: string }>();

  if (!item) {
    return c.json({ error: 'アイテムが見つかりません' }, 404);
  }

  // Get trip dates to verify we're within travel period
  const trip = await c.env.DB.prepare(
    'SELECT start_date as startDate, end_date as endDate FROM trips WHERE id = ?'
  ).bind(tripId).first<{ startDate: string | null; endDate: string | null }>();

  if (!trip || !trip.startDate || !trip.endDate) {
    return c.json({ error: '旅行の日程が設定されていません' }, 400);
  }

  // Check if current date is within trip dates (JST)
  const now = new Date();
  const jstOffset = 9 * 60 * 60 * 1000;
  const jstNow = new Date(now.getTime() + jstOffset + now.getTimezoneOffset() * 60 * 1000);
  const today = jstNow.toISOString().split('T')[0];

  if (today < trip.startDate || today > trip.endDate) {
    return c.json({ error: '旅行期間外です' }, 400);
  }

  // Store check-in time and optional location
  const checkedInAt = new Date().toISOString();
  const checkedInLocation = body.location ? JSON.stringify(body.location) : null;

  await c.env.DB.prepare(
    `UPDATE items SET
      checked_in_at = ?,
      checked_in_location = ?,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE id = ?`
  ).bind(checkedInAt, checkedInLocation, itemId).run();

  // Return updated item
  const updatedItem = await c.env.DB.prepare(
    `SELECT id, day_id as dayId, title, area, time_start as timeStart, time_end as timeEnd,
            map_url as mapUrl, note, cost, cost_category as costCategory, sort,
            photo_url as photoUrl, checked_in_at as checkedInAt, checked_in_location as checkedInLocation
     FROM items WHERE id = ?`
  ).bind(itemId).first();

  return c.json({ item: updatedItem });
});

// Remove check-in from an item
app.delete('/api/trips/:tripId/items/:itemId/checkin', async (c) => {
  const { tripId, itemId } = c.req.param();
  const user = c.get('user');

  // Check if user can edit the trip
  const check = await checkCanEditTrip(c.env.DB, tripId, user);
  if (!check.ok) {
    return c.json({ error: check.error }, check.status as 403 | 404);
  }

  // Verify item exists and belongs to this trip
  const item = await c.env.DB.prepare(
    'SELECT id FROM items WHERE id = ? AND trip_id = ?'
  ).bind(itemId, tripId).first<{ id: string }>();

  if (!item) {
    return c.json({ error: 'アイテムが見つかりません' }, 404);
  }

  // Clear check-in data
  await c.env.DB.prepare(
    `UPDATE items SET
      checked_in_at = NULL,
      checked_in_location = NULL,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE id = ?`
  ).bind(itemId).run();

  // Return updated item
  const updatedItem = await c.env.DB.prepare(
    `SELECT id, day_id as dayId, title, area, time_start as timeStart, time_end as timeEnd,
            map_url as mapUrl, note, cost, cost_category as costCategory, sort,
            photo_url as photoUrl, checked_in_at as checkedInAt, checked_in_location as checkedInLocation
     FROM items WHERE id = ?`
  ).bind(itemId).first();

  return c.json({ item: updatedItem });
});

// ============ Spot Suggestions (AI-powered) ============

// Get nearby spot suggestions for an item
app.post('/api/trips/:tripId/items/:itemId/suggestions', async (c) => {
  const { tripId, itemId } = c.req.param();
  const user = c.get('user');
  const ip = getClientIp(c);

  // Require login for AI spot suggestions
  if (!user) {
    return c.json({ error: '周辺スポット提案にはログインが必要です' }, 401);
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

  // Check if user can edit this trip (spot suggestions require edit access)
  const check = await checkCanEditTrip(c.env.DB, tripId, user);
  if (!check.ok) {
    return c.json({ error: check.error }, check.status as 403 | 404);
  }

  // Get item details
  const item = await c.env.DB.prepare(
    'SELECT id, title, area FROM items WHERE id = ? AND trip_id = ?'
  ).bind(itemId, tripId).first<{ id: string; title: string; area: string | null }>();

  if (!item) {
    return c.json({ error: 'Item not found' }, 404);
  }

  // Build prompt for AI
  const locationInfo = item.area ? `${item.title}（${item.area}）` : item.title;

  const prompt = `あなたは旅行アドバイザーです。「${locationInfo}」の近くにあるおすすめのスポットを3〜5件提案してください。

以下のJSON形式で出力してください。他の説明は不要です:
{
  "suggestions": [
    {
      "name": "スポット名",
      "area": "エリア名（例: 祇園、渋谷など。不明な場合はnull）",
      "description": "おすすめポイントや特徴（50文字程度）",
      "category": "restaurant|cafe|attraction|shop|other のいずれか",
      "estimatedCost": 推定費用（数値、円単位。無料や不明な場合はnull）
    }
  ]
}

以下の点に注意してください:
- 徒歩圏内または近くにある実在のスポットを提案
- レストラン、カフェ、観光スポット、ショップなど多様なカテゴリを含める
- 各スポットには具体的な説明を付ける
- 費用は入場料や食事代の目安`;

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await (c.env.AI as any).run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
      messages: [
        { role: 'user', content: prompt }
      ],
      max_tokens: 2048,
    });

    // Extract JSON from response
    const responseText = typeof response === 'object' && 'response' in response
      ? (response as { response: string }).response
      : String(response);

    // Try to parse JSON from the response
    let suggestionsData: { suggestions: Array<{
      name: string;
      area: string | null;
      description: string;
      category: 'restaurant' | 'cafe' | 'attraction' | 'shop' | 'other';
      estimatedCost: number | null;
    }> };

    try {
      // Find JSON in the response
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }
      suggestionsData = JSON.parse(jsonMatch[0]);
    } catch {
      console.error('Failed to parse AI response:', responseText);
      return c.json({ error: 'AIの応答を解析できませんでした' }, 500);
    }

    // Record AI usage
    const usageId = generateId();
    await c.env.DB.prepare(
      'INSERT INTO ai_usage (id, user_id, ip_address) VALUES (?, ?, ?)'
    ).bind(usageId, user.id, ip).run();

    // Calculate remaining uses
    const userRemaining = AI_DAILY_LIMIT_USER - userUsedToday - 1;
    const ipRemaining = AI_DAILY_LIMIT_IP - ipUsedToday - 1;
    const remaining = Math.min(userRemaining, ipRemaining);

    return c.json({
      suggestions: suggestionsData.suggestions || [],
      remaining,
    });
  } catch (error) {
    console.error('AI suggestion error:', error);
    return c.json({ error: '周辺スポットの提案に失敗しました' }, 500);
  }
});

// ============ Route Optimization (AI-powered) ============

// Type for optimized item
type OptimizedItem = {
  id: string;
  title: string;
  area: string | null;
  timeStart: string | null;
  reason: string;
};

// Optimize route for a day
app.post('/api/trips/:tripId/days/:dayId/optimize', async (c) => {
  const { tripId, dayId } = c.req.param();
  const user = c.get('user');
  const ip = getClientIp(c);

  // Require login for AI route optimization
  if (!user) {
    return c.json({ error: 'ルート最適化にはログインが必要です' }, 401);
  }

  const today = new Date().toISOString().split('T')[0];

  // Check user rate limit (shares limit with spot suggestions)
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

  // Check if user can edit this trip
  const check = await checkCanEditTrip(c.env.DB, tripId, user);
  if (!check.ok) {
    return c.json({ error: check.error }, check.status as 403 | 404);
  }

  // Verify day exists and belongs to this trip
  const day = await c.env.DB.prepare(
    'SELECT id, date FROM days WHERE id = ? AND trip_id = ?'
  ).bind(dayId, tripId).first<{ id: string; date: string }>();

  if (!day) {
    return c.json({ error: 'Day not found' }, 404);
  }

  // Get all items for this day
  const { results: items } = await c.env.DB.prepare(
    `SELECT id, title, area, time_start as timeStart, time_end as timeEnd, map_url as mapUrl, sort
     FROM items WHERE day_id = ? AND trip_id = ?
     ORDER BY sort ASC`
  ).bind(dayId, tripId).all<{
    id: string;
    title: string;
    area: string | null;
    timeStart: string | null;
    timeEnd: string | null;
    mapUrl: string | null;
    sort: number;
  }>();

  if (items.length < 2) {
    return c.json({
      error: 'ルート最適化には2つ以上のスポットが必要です',
    }, 400);
  }

  // Build item info for AI
  const itemsInfo = items.map((item, index) => {
    let locationHint = item.area || '';
    // Try to extract location from map_url
    if (item.mapUrl) {
      const match = item.mapUrl.match(/[?&]q=([^&]+)/);
      if (match) {
        locationHint = decodeURIComponent(match[1]) || locationHint;
      }
    }
    return {
      index: index + 1,
      id: item.id,
      title: item.title,
      area: item.area,
      locationHint,
      timeStart: item.timeStart,
      timeEnd: item.timeEnd,
      hasFixedTime: !!item.timeStart, // Items with time_start are considered fixed
    };
  });

  // Find items with fixed times that shouldn't be moved
  const fixedItems = itemsInfo.filter(item => item.hasFixedTime);

  const prompt = `あなたは旅行ルートの最適化エキスパートです。以下のスポットリストを、移動時間を最小化する効率的な順序に並び替えてください。

## 現在のスポット順序:
${itemsInfo.map(item => `${item.index}. ${item.title}${item.area ? ` (${item.area})` : ''}${item.timeStart ? ` [${item.timeStart}〜${item.timeEnd || ''}固定]` : ''}`).join('\n')}

## 制約条件:
${fixedItems.length > 0 ? `- 以下のスポットは時間が固定されているため、その時間帯に訪問できる位置に配置: ${fixedItems.map(i => i.title).join(', ')}` : '- 時間固定のスポットはありません'}
- 日本での移動（電車、徒歩）を想定
- 開店・閉店時間を考慮（一般的な営業時間を推測）

以下のJSON形式のみで出力してください。他の説明は不要です:
{
  "optimizedOrder": [
    {
      "id": "アイテムID",
      "title": "スポット名",
      "area": "エリア名またはnull",
      "timeStart": "推奨開始時刻（HH:MM形式）またはnull",
      "reason": "この順番にした理由（20文字程度）"
    }
  ],
  "totalSavings": "最適化による改善点（例: 約30分短縮）",
  "warnings": ["注意事項があれば配列で。なければ空配列"]
}

重要:
- optimizedOrderには全てのスポットを含めてください
- idは入力で与えられたものをそのまま使用
- 理由は簡潔に、日本語で`;

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await (c.env.AI as any).run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
      messages: [
        { role: 'user', content: prompt }
      ],
      max_tokens: 2048,
    });

    // Extract JSON from response
    const responseText = typeof response === 'object' && 'response' in response
      ? (response as { response: string }).response
      : String(response);

    // Try to parse JSON from the response
    let optimizationData: {
      optimizedOrder: OptimizedItem[];
      totalSavings: string;
      warnings: string[];
    };

    try {
      // Find JSON in the response
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }
      optimizationData = JSON.parse(jsonMatch[0]);
    } catch {
      console.error('Failed to parse AI response:', responseText);
      return c.json({ error: 'AIの応答を解析できませんでした' }, 500);
    }

    // Validate that all item IDs are present
    const returnedIds = new Set(optimizationData.optimizedOrder.map(item => item.id));
    const originalIds = new Set(items.map(item => item.id));

    // Check if returned IDs match original IDs
    const missingIds = [...originalIds].filter(id => !returnedIds.has(id));
    const extraIds = [...returnedIds].filter(id => !originalIds.has(id));

    if (missingIds.length > 0 || extraIds.length > 0) {
      // Try to fix by ensuring all original items are included
      const fixedOrder: OptimizedItem[] = [];
      const usedIds = new Set<string>();

      for (const optimizedItem of optimizationData.optimizedOrder) {
        if (originalIds.has(optimizedItem.id) && !usedIds.has(optimizedItem.id)) {
          fixedOrder.push(optimizedItem);
          usedIds.add(optimizedItem.id);
        }
      }

      // Add any missing items at the end
      for (const item of items) {
        if (!usedIds.has(item.id)) {
          fixedOrder.push({
            id: item.id,
            title: item.title,
            area: item.area,
            timeStart: item.timeStart,
            reason: '順序維持',
          });
        }
      }

      optimizationData.optimizedOrder = fixedOrder;
    }

    // Record AI usage
    const usageId = generateId();
    await c.env.DB.prepare(
      'INSERT INTO ai_usage (id, user_id, ip_address) VALUES (?, ?, ?)'
    ).bind(usageId, user.id, ip).run();

    // Calculate remaining uses
    const userRemaining = AI_DAILY_LIMIT_USER - userUsedToday - 1;
    const ipRemaining = AI_DAILY_LIMIT_IP - ipUsedToday - 1;
    const remaining = Math.min(userRemaining, ipRemaining);

    return c.json({
      originalOrder: items.map(item => ({
        id: item.id,
        title: item.title,
        area: item.area,
      })),
      optimizedOrder: optimizationData.optimizedOrder,
      totalSavings: optimizationData.totalSavings || '移動効率が向上します',
      warnings: optimizationData.warnings || [],
      remaining,
    });
  } catch (error) {
    console.error('AI optimization error:', error);
    return c.json({ error: 'ルートの最適化に失敗しました' }, 500);
  }
});

// Apply optimized route
app.post('/api/trips/:tripId/days/:dayId/apply-optimization', async (c) => {
  const { tripId, dayId } = c.req.param();
  const user = c.get('user');
  const body = await c.req.json<{ itemIds: string[] }>();

  // Check if user can edit this trip
  const check = await checkCanEditTrip(c.env.DB, tripId, user);
  if (!check.ok) {
    return c.json({ error: check.error }, check.status as 403 | 404);
  }

  // Verify day exists and belongs to this trip
  const day = await c.env.DB.prepare(
    'SELECT id FROM days WHERE id = ? AND trip_id = ?'
  ).bind(dayId, tripId).first<{ id: string }>();

  if (!day) {
    return c.json({ error: 'Day not found' }, 404);
  }

  if (!body.itemIds || !Array.isArray(body.itemIds) || body.itemIds.length === 0) {
    return c.json({ error: 'itemIds is required' }, 400);
  }

  // Verify all items exist and belong to this day
  const placeholders = body.itemIds.map(() => '?').join(',');
  const { results: existingItems } = await c.env.DB.prepare(
    `SELECT id FROM items WHERE id IN (${placeholders}) AND day_id = ? AND trip_id = ?`
  ).bind(...body.itemIds, dayId, tripId).all<{ id: string }>();

  const existingIds = new Set(existingItems.map(item => item.id));
  const invalidIds = body.itemIds.filter(id => !existingIds.has(id));

  if (invalidIds.length > 0) {
    return c.json({ error: `Invalid item IDs: ${invalidIds.join(', ')}` }, 400);
  }

  // Update sort order for each item
  const updates = body.itemIds.map((id, index) =>
    c.env.DB.prepare(
      'UPDATE items SET sort = ?, updated_at = strftime(\'%Y-%m-%dT%H:%M:%fZ\',\'now\') WHERE id = ?'
    ).bind(index, id)
  );

  await c.env.DB.batch(updates);

  // Return updated items
  const { results: updatedItems } = await c.env.DB.prepare(
    `SELECT id, day_id as dayId, title, area, time_start as timeStart, time_end as timeEnd,
            map_url as mapUrl, note, cost, cost_category as costCategory, sort
     FROM items WHERE day_id = ? AND trip_id = ?
     ORDER BY sort ASC`
  ).bind(dayId, tripId).all();

  return c.json({ items: updatedItems });
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

// ============ User Trip Templates ============

// Types for trip templates
type TripTemplateItem = {
  title: string;
  area?: string | null;
  time_start?: string | null;
  time_end?: string | null;
  cost?: number | null;
  note?: string | null;
  map_url?: string | null;
  cost_category?: string | null;
};

type TripTemplateDay = {
  day_offset: number;
  items: TripTemplateItem[];
};

// Get user's trip templates + public templates
app.get('/api/trip-templates', async (c) => {
  const user = c.get('user');
  if (!user) {
    return c.json({ error: 'ログインが必要です' }, 401);
  }

  // Get user's own templates and public templates from others
  const { results } = await c.env.DB.prepare(
    `SELECT id, user_id as userId, name, description, theme, days_data as daysData, is_public as isPublic, created_at as createdAt
     FROM trip_templates
     WHERE user_id = ? OR is_public = 1
     ORDER BY
       CASE WHEN user_id = ? THEN 0 ELSE 1 END,
       created_at DESC`
  ).bind(user.id, user.id).all<{
    id: string;
    userId: string;
    name: string;
    description: string | null;
    theme: string;
    daysData: string;
    isPublic: number;
    createdAt: string;
  }>();

  // Parse days_data JSON for each template
  const templates = results.map(t => ({
    id: t.id,
    name: t.name,
    description: t.description,
    theme: t.theme,
    daysData: JSON.parse(t.daysData || '[]') as TripTemplateDay[],
    isPublic: t.isPublic === 1,
    isOwn: t.userId === user.id,
    createdAt: t.createdAt,
  }));

  return c.json({ templates });
});

// Create trip template from existing trip
app.post('/api/trip-templates', async (c) => {
  const user = c.get('user');
  if (!user) {
    return c.json({ error: 'ログインが必要です' }, 401);
  }

  const body = await c.req.json<{
    tripId: string;
    name: string;
    description?: string;
    isPublic?: boolean;
  }>();

  if (!body.tripId || !body.name?.trim()) {
    return c.json({ error: '旅程IDとテンプレート名は必須です' }, 400);
  }

  // Get the trip
  const trip = await c.env.DB.prepare(
    `SELECT id, theme, user_id as userId FROM trips WHERE id = ?`
  ).bind(body.tripId).first<{ id: string; theme: string; userId: string | null }>();

  if (!trip) {
    return c.json({ error: '旅程が見つかりません' }, 404);
  }

  // Check ownership or collaborator access
  if (trip.userId !== user.id) {
    const collab = await c.env.DB.prepare(
      'SELECT id FROM trip_collaborators WHERE trip_id = ? AND user_id = ?'
    ).bind(body.tripId, user.id).first();
    if (!collab) {
      return c.json({ error: 'アクセスが拒否されました' }, 403);
    }
  }

  // Get days with items for this trip
  const { results: days } = await c.env.DB.prepare(
    'SELECT id, date, sort FROM days WHERE trip_id = ? ORDER BY sort ASC'
  ).bind(body.tripId).all<{ id: string; date: string; sort: number }>();

  const { results: items } = await c.env.DB.prepare(
    `SELECT day_id, title, area, time_start, time_end, map_url, note, cost, cost_category, sort
     FROM items WHERE trip_id = ? ORDER BY sort ASC`
  ).bind(body.tripId).all<{
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
  }>();

  // Build days_data JSON structure
  const daysData: TripTemplateDay[] = days.map((day, index) => {
    const dayItems = items
      .filter(item => item.day_id === day.id)
      .map(item => ({
        title: item.title,
        area: item.area,
        time_start: item.time_start,
        time_end: item.time_end,
        cost: item.cost,
        note: item.note,
        map_url: item.map_url,
        cost_category: item.cost_category,
      }));

    return {
      day_offset: index,
      items: dayItems,
    };
  });

  const templateId = generateId();

  await c.env.DB.prepare(
    `INSERT INTO trip_templates (id, user_id, name, description, theme, days_data, is_public)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    templateId,
    user.id,
    body.name.trim(),
    body.description?.trim() || null,
    trip.theme || 'quiet',
    JSON.stringify(daysData),
    body.isPublic ? 1 : 0
  ).run();

  return c.json({
    template: {
      id: templateId,
      name: body.name.trim(),
      description: body.description?.trim() || null,
      theme: trip.theme || 'quiet',
      daysData,
      isPublic: body.isPublic || false,
    }
  }, 201);
});

// Delete trip template
app.delete('/api/trip-templates/:id', async (c) => {
  const templateId = c.req.param('id');
  const user = c.get('user');

  if (!user) {
    return c.json({ error: 'ログインが必要です' }, 401);
  }

  const template = await c.env.DB.prepare(
    'SELECT id, user_id as userId FROM trip_templates WHERE id = ?'
  ).bind(templateId).first<{ id: string; userId: string }>();

  if (!template) {
    return c.json({ error: 'テンプレートが見つかりません' }, 404);
  }

  if (template.userId !== user.id) {
    return c.json({ error: 'アクセスが拒否されました' }, 403);
  }

  await c.env.DB.prepare('DELETE FROM trip_templates WHERE id = ?').bind(templateId).run();

  return c.json({ ok: true });
});

// Create trip from user's trip template
app.post('/api/trips/from-template/:templateId', async (c) => {
  const templateId = c.req.param('templateId');
  const user = c.get('user');

  if (!user) {
    return c.json({ error: 'ログインが必要です' }, 401);
  }

  // Check if user has remaining trip slots
  const userData = await c.env.DB.prepare(
    'SELECT free_slots as freeSlots, purchased_slots as purchasedSlots FROM users WHERE id = ?'
  ).bind(user.id).first<{ freeSlots: number; purchasedSlots: number }>();

  if (userData) {
    const totalSlots = userData.freeSlots + userData.purchasedSlots;
    const usedSlots = await c.env.DB.prepare(
      'SELECT COUNT(*) as count FROM trips WHERE user_id = ? AND (is_archived = 0 OR is_archived IS NULL)'
    ).bind(user.id).first<{ count: number }>();

    if (usedSlots && usedSlots.count >= totalSlots) {
      return c.json({
        error: '旅程枠が不足しています。プロフィールページから追加の枠を購入してください。',
        code: 'SLOT_LIMIT_REACHED',
        remainingSlots: 0,
        totalSlots
      }, 403);
    }
  }

  const body = await c.req.json<{
    title: string;
    startDate: string;
  }>();

  if (!body.title?.trim() || !body.startDate) {
    return c.json({ error: 'タイトルと開始日は必須です' }, 400);
  }

  // Get the template
  const template = await c.env.DB.prepare(
    `SELECT id, user_id as userId, name, theme, days_data as daysData
     FROM trip_templates WHERE id = ?`
  ).bind(templateId).first<{
    id: string;
    userId: string;
    name: string;
    theme: string;
    daysData: string;
  }>();

  if (!template) {
    return c.json({ error: 'テンプレートが見つかりません' }, 404);
  }

  // Only owner can use their templates
  if (template.userId !== user.id) {
    return c.json({ error: 'アクセスが拒否されました' }, 403);
  }

  const daysData = JSON.parse(template.daysData || '[]') as TripTemplateDay[];

  // Calculate end date based on number of days
  const startDate = new Date(body.startDate);
  const dayCount = daysData.length || 1;
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + dayCount - 1);
  const endDateStr = endDate.toISOString().split('T')[0];

  // Create new trip
  const tripId = generateId();

  await c.env.DB.prepare(
    `INSERT INTO trips (id, title, start_date, end_date, theme, user_id, is_template, template_uses)
     VALUES (?, ?, ?, ?, ?, ?, 0, 0)`
  ).bind(tripId, body.title.trim(), body.startDate, endDateStr, template.theme, user.id).run();

  // Create days and items
  for (let i = 0; i < daysData.length; i++) {
    const dayTemplate = daysData[i];
    const dayId = generateId();
    const dayDate = new Date(startDate);
    dayDate.setDate(dayDate.getDate() + (dayTemplate.day_offset ?? i));
    const dayDateStr = dayDate.toISOString().split('T')[0];

    await c.env.DB.prepare(
      'INSERT INTO days (id, trip_id, date, sort) VALUES (?, ?, ?, ?)'
    ).bind(dayId, tripId, dayDateStr, i).run();

    // Create items for this day
    for (let j = 0; j < (dayTemplate.items || []).length; j++) {
      const itemTemplate = dayTemplate.items[j];
      const itemId = generateId();

      await c.env.DB.prepare(
        `INSERT INTO items (id, trip_id, day_id, title, area, time_start, time_end, map_url, note, cost, cost_category, sort)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        itemId,
        tripId,
        dayId,
        itemTemplate.title,
        itemTemplate.area || null,
        itemTemplate.time_start || null,
        itemTemplate.time_end || null,
        itemTemplate.map_url || null,
        itemTemplate.note || null,
        itemTemplate.cost || null,
        itemTemplate.cost_category || null,
        j
      ).run();
    }
  }

  return c.json({ tripId }, 201);
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

  // Check if user has remaining trip slots
  const userData = await c.env.DB.prepare(
    'SELECT free_slots as freeSlots, purchased_slots as purchasedSlots FROM users WHERE id = ?'
  ).bind(user.id).first<{ freeSlots: number; purchasedSlots: number }>();

  if (userData) {
    const totalSlots = userData.freeSlots + userData.purchasedSlots;
    const usedSlots = await c.env.DB.prepare(
      'SELECT COUNT(*) as count FROM trips WHERE user_id = ? AND (is_archived = 0 OR is_archived IS NULL)'
    ).bind(user.id).first<{ count: number }>();

    if (usedSlots && usedSlots.count >= totalSlots) {
      return c.json({
        error: '旅程枠が不足しています。プロフィールページから追加の枠を購入してください。',
        code: 'SLOT_LIMIT_REACHED',
        remainingSlots: 0,
        totalSlots
      }, 403);
    }
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

// ============ Trip Members & Expense Splitting ============

// Get trip members
app.get('/api/trips/:tripId/members', async (c) => {
  const { tripId } = c.req.param();
  const user = c.get('user');

  // Check if user has access to this trip
  const trip = await c.env.DB.prepare(
    'SELECT id, user_id as userId FROM trips WHERE id = ?'
  ).bind(tripId).first<{ id: string; userId: string | null }>();

  if (!trip) {
    return c.json({ error: '旅行が見つかりません' }, 404);
  }

  // Allow access if owner or collaborator
  let hasAccess = !trip.userId || (user && trip.userId === user.id);
  if (!hasAccess && user) {
    const collab = await c.env.DB.prepare(
      'SELECT id FROM trip_collaborators WHERE trip_id = ? AND user_id = ?'
    ).bind(tripId, user.id).first();
    hasAccess = !!collab;
  }

  if (!hasAccess) {
    return c.json({ error: 'アクセス権がありません' }, 403);
  }

  const { results: members } = await c.env.DB.prepare(
    `SELECT id, trip_id as tripId, user_id as userId, name, created_at as createdAt
     FROM trip_members WHERE trip_id = ? ORDER BY created_at ASC`
  ).bind(tripId).all<{
    id: string;
    tripId: string;
    userId: string | null;
    name: string;
    createdAt: string;
  }>();

  return c.json({ members });
});

// Add trip member
app.post('/api/trips/:tripId/members', async (c) => {
  const { tripId } = c.req.param();
  const user = c.get('user');
  const body = await c.req.json<{ name: string; userId?: string }>();

  // Check ownership
  const check = await checkTripOwnership(c.env.DB, tripId, user);
  if (!check.ok) {
    return c.json({ error: check.error }, check.status as 403 | 404);
  }

  if (!body.name?.trim()) {
    return c.json({ error: 'メンバー名を入力してください' }, 400);
  }

  if (body.name.length > 50) {
    return c.json({ error: 'メンバー名は50文字以内で入力してください' }, 400);
  }

  // Check if userId already exists for this trip
  if (body.userId) {
    const existing = await c.env.DB.prepare(
      'SELECT id FROM trip_members WHERE trip_id = ? AND user_id = ?'
    ).bind(tripId, body.userId).first();
    if (existing) {
      return c.json({ error: 'このユーザーは既にメンバーに追加されています' }, 400);
    }
  }

  const id = generateId();

  await c.env.DB.prepare(
    'INSERT INTO trip_members (id, trip_id, user_id, name) VALUES (?, ?, ?, ?)'
  ).bind(id, tripId, body.userId ?? null, body.name.trim()).run();

  const member = await c.env.DB.prepare(
    `SELECT id, trip_id as tripId, user_id as userId, name, created_at as createdAt
     FROM trip_members WHERE id = ?`
  ).bind(id).first();

  return c.json({ member }, 201);
});

// Delete trip member
app.delete('/api/trips/:tripId/members/:memberId', async (c) => {
  const { tripId, memberId } = c.req.param();
  const user = c.get('user');

  // Check ownership
  const check = await checkTripOwnership(c.env.DB, tripId, user);
  if (!check.ok) {
    return c.json({ error: check.error }, check.status as 403 | 404);
  }

  // Check if member exists
  const member = await c.env.DB.prepare(
    'SELECT id FROM trip_members WHERE id = ? AND trip_id = ?'
  ).bind(memberId, tripId).first();

  if (!member) {
    return c.json({ error: 'メンバーが見つかりません' }, 404);
  }

  // Delete member (cascade will delete payments and splits)
  await c.env.DB.prepare('DELETE FROM trip_members WHERE id = ?').bind(memberId).run();

  return c.json({ ok: true });
});

// Update payment info for an item
app.put('/api/trips/:tripId/items/:itemId/payment', async (c) => {
  const { tripId, itemId } = c.req.param();
  const user = c.get('user');
  const body = await c.req.json<{
    payments?: { paidBy: string; amount: number }[];
    splits?: { memberId: string; shareType: 'equal' | 'percentage' | 'amount'; shareValue?: number }[];
  }>();

  // Check ownership or collaboration
  const trip = await c.env.DB.prepare(
    'SELECT id, user_id as userId FROM trips WHERE id = ?'
  ).bind(tripId).first<{ id: string; userId: string | null }>();

  if (!trip) {
    return c.json({ error: '旅行が見つかりません' }, 404);
  }

  let hasAccess = !trip.userId || (user && trip.userId === user.id);
  if (!hasAccess && user) {
    const collab = await c.env.DB.prepare(
      'SELECT id, role FROM trip_collaborators WHERE trip_id = ? AND user_id = ?'
    ).bind(tripId, user.id).first<{ id: string; role: string }>();
    hasAccess = collab?.role === 'editor';
  }

  if (!hasAccess) {
    return c.json({ error: 'アクセス権がありません' }, 403);
  }

  // Check if item exists
  const item = await c.env.DB.prepare(
    'SELECT id FROM items WHERE id = ? AND trip_id = ?'
  ).bind(itemId, tripId).first();

  if (!item) {
    return c.json({ error: 'アイテムが見つかりません' }, 404);
  }

  // Update payments
  if (body.payments !== undefined) {
    // Delete existing payments
    await c.env.DB.prepare('DELETE FROM expense_payments WHERE item_id = ?').bind(itemId).run();

    // Insert new payments
    for (const payment of body.payments) {
      if (payment.amount <= 0) continue;
      const paymentId = generateId();
      await c.env.DB.prepare(
        'INSERT INTO expense_payments (id, item_id, paid_by, amount) VALUES (?, ?, ?, ?)'
      ).bind(paymentId, itemId, payment.paidBy, payment.amount).run();
    }
  }

  // Update splits
  if (body.splits !== undefined) {
    // Delete existing splits
    await c.env.DB.prepare('DELETE FROM expense_splits WHERE item_id = ?').bind(itemId).run();

    // Insert new splits
    for (const split of body.splits) {
      const splitId = generateId();
      await c.env.DB.prepare(
        'INSERT INTO expense_splits (id, item_id, member_id, share_type, share_value) VALUES (?, ?, ?, ?, ?)'
      ).bind(splitId, itemId, split.memberId, split.shareType, split.shareValue ?? null).run();
    }
  }

  return c.json({ ok: true });
});

// Get expense info for an item
app.get('/api/trips/:tripId/items/:itemId/expense', async (c) => {
  const { tripId, itemId } = c.req.param();
  const user = c.get('user');

  // Check access
  const trip = await c.env.DB.prepare(
    'SELECT id, user_id as userId FROM trips WHERE id = ?'
  ).bind(tripId).first<{ id: string; userId: string | null }>();

  if (!trip) {
    return c.json({ error: '旅行が見つかりません' }, 404);
  }

  let hasAccess = !trip.userId || (user && trip.userId === user.id);
  if (!hasAccess && user) {
    const collab = await c.env.DB.prepare(
      'SELECT id FROM trip_collaborators WHERE trip_id = ? AND user_id = ?'
    ).bind(tripId, user.id).first();
    hasAccess = !!collab;
  }

  if (!hasAccess) {
    return c.json({ error: 'アクセス権がありません' }, 403);
  }

  // Get payments with member names
  const { results: payments } = await c.env.DB.prepare(
    `SELECT p.id, p.item_id as itemId, p.paid_by as paidBy, p.amount, p.created_at as createdAt,
            m.name as paidByName
     FROM expense_payments p
     LEFT JOIN trip_members m ON p.paid_by = m.id
     WHERE p.item_id = ?`
  ).bind(itemId).all<{
    id: string;
    itemId: string;
    paidBy: string;
    amount: number;
    createdAt: string;
    paidByName: string | null;
  }>();

  // Get splits with member names
  const { results: splits } = await c.env.DB.prepare(
    `SELECT s.id, s.item_id as itemId, s.member_id as memberId, s.share_type as shareType, s.share_value as shareValue,
            m.name as memberName
     FROM expense_splits s
     LEFT JOIN trip_members m ON s.member_id = m.id
     WHERE s.item_id = ?`
  ).bind(itemId).all<{
    id: string;
    itemId: string;
    memberId: string;
    shareType: string;
    shareValue: number | null;
    memberName: string | null;
  }>();

  return c.json({ payments, splits });
});

// Get settlement summary for a trip
app.get('/api/trips/:tripId/settlement', async (c) => {
  const { tripId } = c.req.param();
  const user = c.get('user');

  // Check access
  const trip = await c.env.DB.prepare(
    'SELECT id, user_id as userId FROM trips WHERE id = ?'
  ).bind(tripId).first<{ id: string; userId: string | null }>();

  if (!trip) {
    return c.json({ error: '旅行が見つかりません' }, 404);
  }

  let hasAccess = !trip.userId || (user && trip.userId === user.id);
  if (!hasAccess && user) {
    const collab = await c.env.DB.prepare(
      'SELECT id FROM trip_collaborators WHERE trip_id = ? AND user_id = ?'
    ).bind(tripId, user.id).first();
    hasAccess = !!collab;
  }

  // Also allow access via share token
  if (!hasAccess) {
    const shareToken = c.req.query('token');
    if (shareToken) {
      const share = await c.env.DB.prepare(
        'SELECT id FROM share_tokens WHERE token = ? AND trip_id = ?'
      ).bind(shareToken, tripId).first();
      hasAccess = !!share;
    }
  }

  if (!hasAccess) {
    return c.json({ error: 'アクセス権がありません' }, 403);
  }

  // Get all members
  const { results: members } = await c.env.DB.prepare(
    `SELECT id, trip_id as tripId, user_id as userId, name, created_at as createdAt
     FROM trip_members WHERE trip_id = ? ORDER BY created_at ASC`
  ).bind(tripId).all<{
    id: string;
    tripId: string;
    userId: string | null;
    name: string;
    createdAt: string;
  }>();

  if (members.length === 0) {
    return c.json({
      members: [],
      balances: [],
      settlements: [],
      totalExpenses: 0,
    });
  }

  // Get all payments for this trip
  const { results: allPayments } = await c.env.DB.prepare(
    `SELECT p.id, p.item_id as itemId, p.paid_by as paidBy, p.amount,
            i.cost, i.title
     FROM expense_payments p
     INNER JOIN items i ON p.item_id = i.id
     WHERE i.trip_id = ?`
  ).bind(tripId).all<{
    id: string;
    itemId: string;
    paidBy: string;
    amount: number;
    cost: number | null;
    title: string;
  }>();

  // Get all splits for this trip
  const { results: allSplits } = await c.env.DB.prepare(
    `SELECT s.id, s.item_id as itemId, s.member_id as memberId, s.share_type as shareType, s.share_value as shareValue,
            i.cost
     FROM expense_splits s
     INNER JOIN items i ON s.item_id = i.id
     WHERE i.trip_id = ?`
  ).bind(tripId).all<{
    id: string;
    itemId: string;
    memberId: string;
    shareType: string;
    shareValue: number | null;
    cost: number | null;
  }>();

  // Calculate total paid by each member
  const totalPaidByMember = new Map<string, number>();
  for (const payment of allPayments) {
    const current = totalPaidByMember.get(payment.paidBy) || 0;
    totalPaidByMember.set(payment.paidBy, current + payment.amount);
  }

  // Calculate total expenses
  const totalExpenses = allPayments.reduce((sum, p) => sum + p.amount, 0);

  // Group splits by item
  const splitsByItem = new Map<string, typeof allSplits>();
  for (const split of allSplits) {
    const existing = splitsByItem.get(split.itemId) || [];
    existing.push(split);
    splitsByItem.set(split.itemId, existing);
  }

  // Calculate what each member owes
  const totalOwedByMember = new Map<string, number>();

  // Get unique items that have payments
  const itemsWithPayments = new Set(allPayments.map(p => p.itemId));

  for (const itemId of itemsWithPayments) {
    // Get total for this item from payments
    const itemPayments = allPayments.filter(p => p.itemId === itemId);
    const itemTotal = itemPayments.reduce((sum, p) => sum + p.amount, 0);

    // Get splits for this item
    const itemSplits = splitsByItem.get(itemId) || [];

    if (itemSplits.length === 0) {
      // No splits defined - split equally among all members
      const sharePerMember = itemTotal / members.length;
      for (const member of members) {
        const current = totalOwedByMember.get(member.id) || 0;
        totalOwedByMember.set(member.id, current + sharePerMember);
      }
    } else {
      // Calculate based on split settings
      const equalSplits = itemSplits.filter(s => s.shareType === 'equal');
      const percentageSplits = itemSplits.filter(s => s.shareType === 'percentage');
      const amountSplits = itemSplits.filter(s => s.shareType === 'amount');

      // Fixed amounts first
      let remainingAmount = itemTotal;
      for (const split of amountSplits) {
        const amount = split.shareValue || 0;
        const current = totalOwedByMember.get(split.memberId) || 0;
        totalOwedByMember.set(split.memberId, current + amount);
        remainingAmount -= amount;
      }

      // Percentage splits
      for (const split of percentageSplits) {
        const percentage = split.shareValue || 0;
        const amount = (itemTotal * percentage) / 100;
        const current = totalOwedByMember.get(split.memberId) || 0;
        totalOwedByMember.set(split.memberId, current + amount);
        remainingAmount -= amount;
      }

      // Equal splits get the remaining amount
      if (equalSplits.length > 0 && remainingAmount > 0) {
        const sharePerMember = remainingAmount / equalSplits.length;
        for (const split of equalSplits) {
          const current = totalOwedByMember.get(split.memberId) || 0;
          totalOwedByMember.set(split.memberId, current + sharePerMember);
        }
      }
    }
  }

  // Calculate balances
  const balances = members.map(member => {
    const totalPaid = totalPaidByMember.get(member.id) || 0;
    const totalOwed = totalOwedByMember.get(member.id) || 0;
    return {
      memberId: member.id,
      memberName: member.name,
      totalPaid: Math.round(totalPaid),
      totalOwed: Math.round(totalOwed),
      balance: Math.round(totalPaid - totalOwed), // positive = is owed money
    };
  });

  // Calculate optimal settlements (minimize number of transactions)
  const settlements: { from: string; fromName: string; to: string; toName: string; amount: number }[] = [];

  // Separate debtors (negative balance) and creditors (positive balance)
  const debtors = balances.filter(b => b.balance < 0).map(b => ({ ...b }));
  const creditors = balances.filter(b => b.balance > 0).map(b => ({ ...b }));

  // Sort by amount (descending for both)
  debtors.sort((a, b) => a.balance - b.balance);
  creditors.sort((a, b) => b.balance - a.balance);

  // Match debtors with creditors
  let debtorIndex = 0;
  let creditorIndex = 0;

  while (debtorIndex < debtors.length && creditorIndex < creditors.length) {
    const debtor = debtors[debtorIndex];
    const creditor = creditors[creditorIndex];

    const debtAmount = Math.abs(debtor.balance);
    const creditAmount = creditor.balance;

    const settlementAmount = Math.min(debtAmount, creditAmount);

    if (settlementAmount > 0) {
      settlements.push({
        from: debtor.memberId,
        fromName: debtor.memberName,
        to: creditor.memberId,
        toName: creditor.memberName,
        amount: settlementAmount,
      });
    }

    debtor.balance += settlementAmount;
    creditor.balance -= settlementAmount;

    if (Math.abs(debtor.balance) < 1) {
      debtorIndex++;
    }
    if (creditor.balance < 1) {
      creditorIndex++;
    }
  }

  return c.json({
    members,
    balances,
    settlements,
    totalExpenses: Math.round(totalExpenses),
  });
});

// ============ Standalone Expenses ============

// Get all expenses for a trip (combined item-based and standalone)
app.get('/api/trips/:tripId/expenses', async (c) => {
  const { tripId } = c.req.param();
  const user = c.get('user');

  // Check access
  const trip = await c.env.DB.prepare(
    'SELECT id, user_id as userId FROM trips WHERE id = ?'
  ).bind(tripId).first<{ id: string; userId: string | null }>();

  if (!trip) {
    return c.json({ error: '旅行が見つかりません' }, 404);
  }

  let hasAccess = !trip.userId || (user && trip.userId === user.id);
  if (!hasAccess && user) {
    const collab = await c.env.DB.prepare(
      'SELECT id FROM trip_collaborators WHERE trip_id = ? AND user_id = ?'
    ).bind(tripId, user.id).first();
    hasAccess = !!collab;
  }

  if (!hasAccess) {
    const shareToken = c.req.query('token');
    if (shareToken) {
      const share = await c.env.DB.prepare(
        'SELECT id FROM share_tokens WHERE token = ? AND trip_id = ?'
      ).bind(shareToken, tripId).first();
      hasAccess = !!share;
    }
  }

  if (!hasAccess) {
    return c.json({ error: 'アクセス権がありません' }, 403);
  }

  // Get standalone expenses
  const { results: standaloneExpenses } = await c.env.DB.prepare(
    `SELECT e.id, e.trip_id as tripId, e.item_id as itemId, e.payer_id as payerId,
            e.amount, e.description, e.created_at as createdAt,
            m.name as payerName, i.title as itemTitle
     FROM standalone_expenses e
     LEFT JOIN trip_members m ON e.payer_id = m.id
     LEFT JOIN items i ON e.item_id = i.id
     WHERE e.trip_id = ?
     ORDER BY e.created_at DESC`
  ).bind(tripId).all<{
    id: string;
    tripId: string;
    itemId: string | null;
    payerId: string;
    amount: number;
    description: string | null;
    createdAt: string;
    payerName: string | null;
    itemTitle: string | null;
  }>();

  // Get splits for standalone expenses
  const expenseIds = standaloneExpenses.map(e => e.id);
  let expenseSplits: {
    id: string;
    expenseId: string;
    memberId: string;
    shareType: string;
    shareValue: number | null;
    memberName: string | null;
  }[] = [];

  if (expenseIds.length > 0) {
    const placeholders = expenseIds.map(() => '?').join(',');
    const { results } = await c.env.DB.prepare(
      `SELECT s.id, s.expense_id as expenseId, s.member_id as memberId,
              s.share_type as shareType, s.share_value as shareValue,
              m.name as memberName
       FROM standalone_expense_splits s
       LEFT JOIN trip_members m ON s.member_id = m.id
       WHERE s.expense_id IN (${placeholders})`
    ).bind(...expenseIds).all<{
      id: string;
      expenseId: string;
      memberId: string;
      shareType: string;
      shareValue: number | null;
      memberName: string | null;
    }>();
    expenseSplits = results;
  }

  // Attach splits to expenses
  const expensesWithSplits = standaloneExpenses.map(expense => ({
    ...expense,
    splits: expenseSplits.filter(s => s.expenseId === expense.id),
  }));

  return c.json({ expenses: expensesWithSplits });
});

// Add a standalone expense
app.post('/api/trips/:tripId/expenses', async (c) => {
  const { tripId } = c.req.param();
  const user = c.get('user');

  // Check access (must be owner or collaborator)
  const trip = await c.env.DB.prepare(
    'SELECT id, user_id as userId FROM trips WHERE id = ?'
  ).bind(tripId).first<{ id: string; userId: string | null }>();

  if (!trip) {
    return c.json({ error: '旅行が見つかりません' }, 404);
  }

  let hasAccess = !trip.userId || (user && trip.userId === user.id);
  if (!hasAccess && user) {
    const collab = await c.env.DB.prepare(
      'SELECT id FROM trip_collaborators WHERE trip_id = ? AND user_id = ?'
    ).bind(tripId, user.id).first();
    hasAccess = !!collab;
  }

  if (!hasAccess) {
    return c.json({ error: 'アクセス権がありません' }, 403);
  }

  const body = await c.req.json<{
    payerId: string;
    amount: number;
    description?: string;
    itemId?: string;
    splits?: { memberId: string; shareType: 'equal' | 'percentage' | 'amount'; shareValue?: number }[];
  }>();

  if (!body.payerId || typeof body.amount !== 'number' || body.amount <= 0) {
    return c.json({ error: '支払者と金額は必須です' }, 400);
  }

  // Verify payer is a member
  const payer = await c.env.DB.prepare(
    'SELECT id FROM trip_members WHERE id = ? AND trip_id = ?'
  ).bind(body.payerId, tripId).first();

  if (!payer) {
    return c.json({ error: '支払者が見つかりません' }, 400);
  }

  // Verify item belongs to trip if provided
  if (body.itemId) {
    const item = await c.env.DB.prepare(
      'SELECT id FROM items WHERE id = ? AND trip_id = ?'
    ).bind(body.itemId, tripId).first();

    if (!item) {
      return c.json({ error: 'アイテムが見つかりません' }, 400);
    }
  }

  const expenseId = crypto.randomUUID();

  // Insert expense
  await c.env.DB.prepare(
    `INSERT INTO standalone_expenses (id, trip_id, item_id, payer_id, amount, description)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(expenseId, tripId, body.itemId || null, body.payerId, body.amount, body.description || null).run();

  // Insert splits if provided
  if (body.splits && body.splits.length > 0) {
    for (const split of body.splits) {
      const splitId = crypto.randomUUID();
      await c.env.DB.prepare(
        `INSERT INTO standalone_expense_splits (id, expense_id, member_id, share_type, share_value)
         VALUES (?, ?, ?, ?, ?)`
      ).bind(splitId, expenseId, split.memberId, split.shareType, split.shareValue ?? null).run();
    }
  }

  // Fetch the created expense with payer name
  const expense = await c.env.DB.prepare(
    `SELECT e.id, e.trip_id as tripId, e.item_id as itemId, e.payer_id as payerId,
            e.amount, e.description, e.created_at as createdAt,
            m.name as payerName
     FROM standalone_expenses e
     LEFT JOIN trip_members m ON e.payer_id = m.id
     WHERE e.id = ?`
  ).bind(expenseId).first();

  return c.json({ expense }, 201);
});

// Update a standalone expense
app.put('/api/trips/:tripId/expenses/:expenseId', async (c) => {
  const { tripId, expenseId } = c.req.param();
  const user = c.get('user');

  // Check access
  const trip = await c.env.DB.prepare(
    'SELECT id, user_id as userId FROM trips WHERE id = ?'
  ).bind(tripId).first<{ id: string; userId: string | null }>();

  if (!trip) {
    return c.json({ error: '旅行が見つかりません' }, 404);
  }

  let hasAccess = !trip.userId || (user && trip.userId === user.id);
  if (!hasAccess && user) {
    const collab = await c.env.DB.prepare(
      'SELECT id FROM trip_collaborators WHERE trip_id = ? AND user_id = ?'
    ).bind(tripId, user.id).first();
    hasAccess = !!collab;
  }

  if (!hasAccess) {
    return c.json({ error: 'アクセス権がありません' }, 403);
  }

  // Verify expense exists and belongs to this trip
  const existing = await c.env.DB.prepare(
    'SELECT id FROM standalone_expenses WHERE id = ? AND trip_id = ?'
  ).bind(expenseId, tripId).first();

  if (!existing) {
    return c.json({ error: '費用が見つかりません' }, 404);
  }

  const body = await c.req.json<{
    payerId?: string;
    amount?: number;
    description?: string;
    itemId?: string | null;
    splits?: { memberId: string; shareType: 'equal' | 'percentage' | 'amount'; shareValue?: number }[];
  }>();

  // Build update query
  const updates: string[] = [];
  const values: (string | number | null)[] = [];

  if (body.payerId) {
    // Verify payer is a member
    const payer = await c.env.DB.prepare(
      'SELECT id FROM trip_members WHERE id = ? AND trip_id = ?'
    ).bind(body.payerId, tripId).first();
    if (!payer) {
      return c.json({ error: '支払者が見つかりません' }, 400);
    }
    updates.push('payer_id = ?');
    values.push(body.payerId);
  }

  if (typeof body.amount === 'number') {
    if (body.amount <= 0) {
      return c.json({ error: '金額は正の数である必要があります' }, 400);
    }
    updates.push('amount = ?');
    values.push(body.amount);
  }

  if (body.description !== undefined) {
    updates.push('description = ?');
    values.push(body.description || null);
  }

  if (body.itemId !== undefined) {
    if (body.itemId) {
      const item = await c.env.DB.prepare(
        'SELECT id FROM items WHERE id = ? AND trip_id = ?'
      ).bind(body.itemId, tripId).first();
      if (!item) {
        return c.json({ error: 'アイテムが見つかりません' }, 400);
      }
    }
    updates.push('item_id = ?');
    values.push(body.itemId || null);
  }

  if (updates.length > 0) {
    values.push(expenseId);
    await c.env.DB.prepare(
      `UPDATE standalone_expenses SET ${updates.join(', ')} WHERE id = ?`
    ).bind(...values).run();
  }

  // Update splits if provided
  if (body.splits !== undefined) {
    // Delete existing splits
    await c.env.DB.prepare(
      'DELETE FROM standalone_expense_splits WHERE expense_id = ?'
    ).bind(expenseId).run();

    // Insert new splits
    for (const split of body.splits) {
      const splitId = crypto.randomUUID();
      await c.env.DB.prepare(
        `INSERT INTO standalone_expense_splits (id, expense_id, member_id, share_type, share_value)
         VALUES (?, ?, ?, ?, ?)`
      ).bind(splitId, expenseId, split.memberId, split.shareType, split.shareValue ?? null).run();
    }
  }

  return c.json({ success: true });
});

// Delete a standalone expense
app.delete('/api/trips/:tripId/expenses/:expenseId', async (c) => {
  const { tripId, expenseId } = c.req.param();
  const user = c.get('user');

  // Check access
  const trip = await c.env.DB.prepare(
    'SELECT id, user_id as userId FROM trips WHERE id = ?'
  ).bind(tripId).first<{ id: string; userId: string | null }>();

  if (!trip) {
    return c.json({ error: '旅行が見つかりません' }, 404);
  }

  let hasAccess = !trip.userId || (user && trip.userId === user.id);
  if (!hasAccess && user) {
    const collab = await c.env.DB.prepare(
      'SELECT id FROM trip_collaborators WHERE trip_id = ? AND user_id = ?'
    ).bind(tripId, user.id).first();
    hasAccess = !!collab;
  }

  if (!hasAccess) {
    return c.json({ error: 'アクセス権がありません' }, 403);
  }

  // Verify expense exists
  const existing = await c.env.DB.prepare(
    'SELECT id FROM standalone_expenses WHERE id = ? AND trip_id = ?'
  ).bind(expenseId, tripId).first();

  if (!existing) {
    return c.json({ error: '費用が見つかりません' }, 404);
  }

  // Delete expense (cascade will delete splits)
  await c.env.DB.prepare(
    'DELETE FROM standalone_expenses WHERE id = ?'
  ).bind(expenseId).run();

  return c.json({ success: true });
});

// Get combined settlement (including standalone expenses)
app.get('/api/trips/:tripId/combined-settlement', async (c) => {
  const { tripId } = c.req.param();
  const user = c.get('user');

  // Check access
  const trip = await c.env.DB.prepare(
    'SELECT id, user_id as userId FROM trips WHERE id = ?'
  ).bind(tripId).first<{ id: string; userId: string | null }>();

  if (!trip) {
    return c.json({ error: '旅行が見つかりません' }, 404);
  }

  let hasAccess = !trip.userId || (user && trip.userId === user.id);
  if (!hasAccess && user) {
    const collab = await c.env.DB.prepare(
      'SELECT id FROM trip_collaborators WHERE trip_id = ? AND user_id = ?'
    ).bind(tripId, user.id).first();
    hasAccess = !!collab;
  }

  if (!hasAccess) {
    const shareToken = c.req.query('token');
    if (shareToken) {
      const share = await c.env.DB.prepare(
        'SELECT id FROM share_tokens WHERE token = ? AND trip_id = ?'
      ).bind(shareToken, tripId).first();
      hasAccess = !!share;
    }
  }

  if (!hasAccess) {
    return c.json({ error: 'アクセス権がありません' }, 403);
  }

  // Get all members
  const { results: members } = await c.env.DB.prepare(
    `SELECT id, trip_id as tripId, user_id as userId, name, created_at as createdAt
     FROM trip_members WHERE trip_id = ? ORDER BY created_at ASC`
  ).bind(tripId).all<{
    id: string;
    tripId: string;
    userId: string | null;
    name: string;
    createdAt: string;
  }>();

  if (members.length === 0) {
    return c.json({
      members: [],
      balances: [],
      settlements: [],
      totalExpenses: 0,
    });
  }

  // Get item-based payments
  const { results: itemPayments } = await c.env.DB.prepare(
    `SELECT p.id, p.item_id as itemId, p.paid_by as paidBy, p.amount,
            i.cost, i.title
     FROM expense_payments p
     INNER JOIN items i ON p.item_id = i.id
     WHERE i.trip_id = ?`
  ).bind(tripId).all<{
    id: string;
    itemId: string;
    paidBy: string;
    amount: number;
    cost: number | null;
    title: string;
  }>();

  // Get item-based splits
  const { results: itemSplits } = await c.env.DB.prepare(
    `SELECT s.id, s.item_id as itemId, s.member_id as memberId, s.share_type as shareType, s.share_value as shareValue,
            i.cost
     FROM expense_splits s
     INNER JOIN items i ON s.item_id = i.id
     WHERE i.trip_id = ?`
  ).bind(tripId).all<{
    id: string;
    itemId: string;
    memberId: string;
    shareType: string;
    shareValue: number | null;
    cost: number | null;
  }>();

  // Get standalone expenses
  const { results: standaloneExpenses } = await c.env.DB.prepare(
    `SELECT id, payer_id as payerId, amount, description
     FROM standalone_expenses WHERE trip_id = ?`
  ).bind(tripId).all<{
    id: string;
    payerId: string;
    amount: number;
    description: string | null;
  }>();

  // Get standalone expense splits
  const standaloneIds = standaloneExpenses.map(e => e.id);
  let standaloneSplits: {
    id: string;
    expenseId: string;
    memberId: string;
    shareType: string;
    shareValue: number | null;
  }[] = [];

  if (standaloneIds.length > 0) {
    const placeholders = standaloneIds.map(() => '?').join(',');
    const { results } = await c.env.DB.prepare(
      `SELECT id, expense_id as expenseId, member_id as memberId, share_type as shareType, share_value as shareValue
       FROM standalone_expense_splits WHERE expense_id IN (${placeholders})`
    ).bind(...standaloneIds).all<{
      id: string;
      expenseId: string;
      memberId: string;
      shareType: string;
      shareValue: number | null;
    }>();
    standaloneSplits = results;
  }

  // Calculate total paid by each member
  const totalPaidByMember = new Map<string, number>();

  // Item-based payments
  for (const payment of itemPayments) {
    const current = totalPaidByMember.get(payment.paidBy) || 0;
    totalPaidByMember.set(payment.paidBy, current + payment.amount);
  }

  // Standalone payments
  for (const expense of standaloneExpenses) {
    const current = totalPaidByMember.get(expense.payerId) || 0;
    totalPaidByMember.set(expense.payerId, current + expense.amount);
  }

  // Calculate total expenses
  const itemTotal = itemPayments.reduce((sum, p) => sum + p.amount, 0);
  const standaloneTotal = standaloneExpenses.reduce((sum, e) => sum + e.amount, 0);
  const totalExpenses = itemTotal + standaloneTotal;

  // Calculate what each member owes
  const totalOwedByMember = new Map<string, number>();

  // Process item-based expenses
  const splitsByItem = new Map<string, typeof itemSplits>();
  for (const split of itemSplits) {
    const existing = splitsByItem.get(split.itemId) || [];
    existing.push(split);
    splitsByItem.set(split.itemId, existing);
  }

  const itemsWithPayments = new Set(itemPayments.map(p => p.itemId));
  for (const itemId of itemsWithPayments) {
    const payments = itemPayments.filter(p => p.itemId === itemId);
    const itemAmount = payments.reduce((sum, p) => sum + p.amount, 0);
    const splits = splitsByItem.get(itemId) || [];

    if (splits.length === 0) {
      const sharePerMember = itemAmount / members.length;
      for (const member of members) {
        const current = totalOwedByMember.get(member.id) || 0;
        totalOwedByMember.set(member.id, current + sharePerMember);
      }
    } else {
      const equalSplits = splits.filter(s => s.shareType === 'equal');
      const percentageSplits = splits.filter(s => s.shareType === 'percentage');
      const amountSplits = splits.filter(s => s.shareType === 'amount');

      let remaining = itemAmount;
      for (const split of amountSplits) {
        const amount = split.shareValue || 0;
        const current = totalOwedByMember.get(split.memberId) || 0;
        totalOwedByMember.set(split.memberId, current + amount);
        remaining -= amount;
      }

      for (const split of percentageSplits) {
        const percentage = split.shareValue || 0;
        const amount = (itemAmount * percentage) / 100;
        const current = totalOwedByMember.get(split.memberId) || 0;
        totalOwedByMember.set(split.memberId, current + amount);
        remaining -= amount;
      }

      if (equalSplits.length > 0 && remaining > 0) {
        const sharePerMember = remaining / equalSplits.length;
        for (const split of equalSplits) {
          const current = totalOwedByMember.get(split.memberId) || 0;
          totalOwedByMember.set(split.memberId, current + sharePerMember);
        }
      }
    }
  }

  // Process standalone expenses
  const splitsByExpense = new Map<string, typeof standaloneSplits>();
  for (const split of standaloneSplits) {
    const existing = splitsByExpense.get(split.expenseId) || [];
    existing.push(split);
    splitsByExpense.set(split.expenseId, existing);
  }

  for (const expense of standaloneExpenses) {
    const splits = splitsByExpense.get(expense.id) || [];

    if (splits.length === 0) {
      // Default: split equally among all members
      const sharePerMember = expense.amount / members.length;
      for (const member of members) {
        const current = totalOwedByMember.get(member.id) || 0;
        totalOwedByMember.set(member.id, current + sharePerMember);
      }
    } else {
      const equalSplits = splits.filter(s => s.shareType === 'equal');
      const percentageSplits = splits.filter(s => s.shareType === 'percentage');
      const amountSplits = splits.filter(s => s.shareType === 'amount');

      let remaining = expense.amount;
      for (const split of amountSplits) {
        const amount = split.shareValue || 0;
        const current = totalOwedByMember.get(split.memberId) || 0;
        totalOwedByMember.set(split.memberId, current + amount);
        remaining -= amount;
      }

      for (const split of percentageSplits) {
        const percentage = split.shareValue || 0;
        const amount = (expense.amount * percentage) / 100;
        const current = totalOwedByMember.get(split.memberId) || 0;
        totalOwedByMember.set(split.memberId, current + amount);
        remaining -= amount;
      }

      if (equalSplits.length > 0 && remaining > 0) {
        const sharePerMember = remaining / equalSplits.length;
        for (const split of equalSplits) {
          const current = totalOwedByMember.get(split.memberId) || 0;
          totalOwedByMember.set(split.memberId, current + sharePerMember);
        }
      }
    }
  }

  // Calculate balances
  const balances = members.map(member => {
    const totalPaid = totalPaidByMember.get(member.id) || 0;
    const totalOwed = totalOwedByMember.get(member.id) || 0;
    return {
      memberId: member.id,
      memberName: member.name,
      totalPaid: Math.round(totalPaid),
      totalOwed: Math.round(totalOwed),
      balance: Math.round(totalPaid - totalOwed),
    };
  });

  // Calculate optimal settlements
  const settlements: { from: string; fromName: string; to: string; toName: string; amount: number }[] = [];
  const debtors = balances.filter(b => b.balance < 0).map(b => ({ ...b }));
  const creditors = balances.filter(b => b.balance > 0).map(b => ({ ...b }));

  debtors.sort((a, b) => a.balance - b.balance);
  creditors.sort((a, b) => b.balance - a.balance);

  let debtorIndex = 0;
  let creditorIndex = 0;

  while (debtorIndex < debtors.length && creditorIndex < creditors.length) {
    const debtor = debtors[debtorIndex];
    const creditor = creditors[creditorIndex];

    const debtAmount = Math.abs(debtor.balance);
    const creditAmount = creditor.balance;
    const settlementAmount = Math.min(debtAmount, creditAmount);

    if (settlementAmount > 0) {
      settlements.push({
        from: debtor.memberId,
        fromName: debtor.memberName,
        to: creditor.memberId,
        toName: creditor.memberName,
        amount: settlementAmount,
      });
    }

    debtor.balance += settlementAmount;
    creditor.balance -= settlementAmount;

    if (Math.abs(debtor.balance) < 1) debtorIndex++;
    if (creditor.balance < 1) creditorIndex++;
  }

  return c.json({
    members,
    balances,
    settlements,
    totalExpenses: Math.round(totalExpenses),
  });
});

// ============ Packing List ============

// Get packing items for a trip
app.get('/api/trips/:tripId/packing', async (c) => {
  const user = c.get('user');
  const tripId = c.req.param('tripId');

  // Check access (owner, collaborator, or share token)
  const shareToken = c.req.query('token');
  let hasAccess = false;

  if (user) {
    const trip = await c.env.DB.prepare(
      'SELECT user_id FROM trips WHERE id = ?'
    ).bind(tripId).first<{ user_id: string }>();

    if (trip?.user_id === user.id) {
      hasAccess = true;
    } else {
      const collab = await c.env.DB.prepare(
        'SELECT id FROM collaborators WHERE trip_id = ? AND user_id = ?'
      ).bind(tripId, user.id).first();
      if (collab) hasAccess = true;
    }
  }

  if (!hasAccess && shareToken) {
    const token = await c.env.DB.prepare(
      'SELECT id FROM share_tokens WHERE trip_id = ? AND token = ? AND is_active = 1'
    ).bind(tripId, shareToken).first();
    if (token) hasAccess = true;
  }

  if (!hasAccess) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const items = await c.env.DB.prepare(
    'SELECT * FROM packing_items WHERE trip_id = ? ORDER BY category, sort, created_at'
  ).bind(tripId).all();

  return c.json({ items: items.results });
});

// Add packing item
app.post('/api/trips/:tripId/packing', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'Unauthorized' }, 401);

  const tripId = c.req.param('tripId');

  // Check owner or editor access
  const trip = await c.env.DB.prepare(
    'SELECT user_id FROM trips WHERE id = ?'
  ).bind(tripId).first<{ user_id: string }>();

  if (!trip) return c.json({ error: 'Trip not found' }, 404);

  let canEdit = trip.user_id === user.id;
  if (!canEdit) {
    const collab = await c.env.DB.prepare(
      "SELECT role FROM collaborators WHERE trip_id = ? AND user_id = ? AND role IN ('owner', 'editor')"
    ).bind(tripId, user.id).first();
    canEdit = !!collab;
  }

  if (!canEdit) return c.json({ error: 'Forbidden' }, 403);

  const body = await c.req.json<{ name: string; category?: string }>();
  if (!body.name?.trim()) {
    return c.json({ error: 'Name is required' }, 400);
  }

  const id = generateId();
  const category = body.category?.trim() || 'その他';

  // Get max sort for this category
  const maxSort = await c.env.DB.prepare(
    'SELECT MAX(sort) as max_sort FROM packing_items WHERE trip_id = ? AND category = ?'
  ).bind(tripId, category).first<{ max_sort: number | null }>();

  const sort = (maxSort?.max_sort ?? -1) + 1;

  await c.env.DB.prepare(
    'INSERT INTO packing_items (id, trip_id, name, category, sort) VALUES (?, ?, ?, ?, ?)'
  ).bind(id, tripId, body.name.trim(), category, sort).run();

  const item = await c.env.DB.prepare(
    'SELECT * FROM packing_items WHERE id = ?'
  ).bind(id).first();

  return c.json({ item }, 201);
});

// Update packing item (toggle check, rename, change category)
app.patch('/api/trips/:tripId/packing/:itemId', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'Unauthorized' }, 401);

  const tripId = c.req.param('tripId');
  const itemId = c.req.param('itemId');

  // Check owner or editor access
  const trip = await c.env.DB.prepare(
    'SELECT user_id FROM trips WHERE id = ?'
  ).bind(tripId).first<{ user_id: string }>();

  if (!trip) return c.json({ error: 'Trip not found' }, 404);

  let canEdit = trip.user_id === user.id;
  if (!canEdit) {
    const collab = await c.env.DB.prepare(
      "SELECT role FROM collaborators WHERE trip_id = ? AND user_id = ? AND role IN ('owner', 'editor')"
    ).bind(tripId, user.id).first();
    canEdit = !!collab;
  }

  if (!canEdit) return c.json({ error: 'Forbidden' }, 403);

  const body = await c.req.json<{ name?: string; category?: string; is_checked?: boolean; sort?: number }>();

  const updates: string[] = [];
  const values: (string | number)[] = [];

  if (body.name !== undefined) {
    updates.push('name = ?');
    values.push(body.name.trim());
  }
  if (body.category !== undefined) {
    updates.push('category = ?');
    values.push(body.category.trim());
  }
  if (body.is_checked !== undefined) {
    updates.push('is_checked = ?');
    values.push(body.is_checked ? 1 : 0);
  }
  if (body.sort !== undefined) {
    updates.push('sort = ?');
    values.push(body.sort);
  }

  if (updates.length === 0) {
    return c.json({ error: 'No updates provided' }, 400);
  }

  updates.push("updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')");
  values.push(itemId, tripId);

  await c.env.DB.prepare(
    `UPDATE packing_items SET ${updates.join(', ')} WHERE id = ? AND trip_id = ?`
  ).bind(...values).run();

  const item = await c.env.DB.prepare(
    'SELECT * FROM packing_items WHERE id = ?'
  ).bind(itemId).first();

  return c.json({ item });
});

// Delete packing item
app.delete('/api/trips/:tripId/packing/:itemId', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'Unauthorized' }, 401);

  const tripId = c.req.param('tripId');
  const itemId = c.req.param('itemId');

  // Check owner or editor access
  const trip = await c.env.DB.prepare(
    'SELECT user_id FROM trips WHERE id = ?'
  ).bind(tripId).first<{ user_id: string }>();

  if (!trip) return c.json({ error: 'Trip not found' }, 404);

  let canEdit = trip.user_id === user.id;
  if (!canEdit) {
    const collab = await c.env.DB.prepare(
      "SELECT role FROM collaborators WHERE trip_id = ? AND user_id = ? AND role IN ('owner', 'editor')"
    ).bind(tripId, user.id).first();
    canEdit = !!collab;
  }

  if (!canEdit) return c.json({ error: 'Forbidden' }, 403);

  await c.env.DB.prepare(
    'DELETE FROM packing_items WHERE id = ? AND trip_id = ?'
  ).bind(itemId, tripId).run();

  return c.json({ success: true });
});

// Bulk update packing items (for reordering)
app.put('/api/trips/:tripId/packing/reorder', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'Unauthorized' }, 401);

  const tripId = c.req.param('tripId');

  // Check owner or editor access
  const trip = await c.env.DB.prepare(
    'SELECT user_id FROM trips WHERE id = ?'
  ).bind(tripId).first<{ user_id: string }>();

  if (!trip) return c.json({ error: 'Trip not found' }, 404);

  let canEdit = trip.user_id === user.id;
  if (!canEdit) {
    const collab = await c.env.DB.prepare(
      "SELECT role FROM collaborators WHERE trip_id = ? AND user_id = ? AND role IN ('owner', 'editor')"
    ).bind(tripId, user.id).first();
    canEdit = !!collab;
  }

  if (!canEdit) return c.json({ error: 'Forbidden' }, 403);

  const body = await c.req.json<{ items: { id: string; sort: number; category?: string }[] }>();

  for (const item of body.items) {
    if (item.category !== undefined) {
      await c.env.DB.prepare(
        'UPDATE packing_items SET sort = ?, category = ? WHERE id = ? AND trip_id = ?'
      ).bind(item.sort, item.category, item.id, tripId).run();
    } else {
      await c.env.DB.prepare(
        'UPDATE packing_items SET sort = ? WHERE id = ? AND trip_id = ?'
      ).bind(item.sort, item.id, tripId).run();
    }
  }

  return c.json({ success: true });
});

// ============ Item Templates ============

// Get user's item templates
app.get('/api/item-templates', async (c) => {
  const user = c.get('user');
  if (!user) {
    return c.json({ error: 'ログインが必要です' }, 401);
  }

  const { results } = await c.env.DB.prepare(
    `SELECT id, title, area, time_start as timeStart, time_end as timeEnd,
            map_url as mapUrl, note, cost, cost_category as costCategory,
            created_at as createdAt
     FROM item_templates
     WHERE user_id = ?
     ORDER BY created_at DESC`
  ).bind(user.id).all();

  return c.json({ templates: results });
});

// Create an item template
app.post('/api/item-templates', async (c) => {
  const user = c.get('user');
  if (!user) {
    return c.json({ error: 'ログインが必要です' }, 401);
  }

  const body = await c.req.json<{
    title: string;
    area?: string;
    timeStart?: string;
    timeEnd?: string;
    mapUrl?: string;
    note?: string;
    cost?: number;
    costCategory?: string;
  }>();

  if (!body.title?.trim()) {
    return c.json({ error: 'タイトルは必須です' }, 400);
  }

  const id = generateId();

  await c.env.DB.prepare(
    `INSERT INTO item_templates (id, user_id, title, area, time_start, time_end, map_url, note, cost, cost_category)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id, user.id, body.title.trim(),
    body.area ?? null, body.timeStart ?? null, body.timeEnd ?? null,
    body.mapUrl ?? null, body.note ?? null, body.cost ?? null, body.costCategory ?? null
  ).run();

  const template = await c.env.DB.prepare(
    `SELECT id, title, area, time_start as timeStart, time_end as timeEnd,
            map_url as mapUrl, note, cost, cost_category as costCategory,
            created_at as createdAt
     FROM item_templates WHERE id = ?`
  ).bind(id).first();

  return c.json({ template }, 201);
});

// Delete an item template
app.delete('/api/item-templates/:id', async (c) => {
  const user = c.get('user');
  if (!user) {
    return c.json({ error: 'ログインが必要です' }, 401);
  }

  const templateId = c.req.param('id');

  const existing = await c.env.DB.prepare(
    'SELECT id FROM item_templates WHERE id = ? AND user_id = ?'
  ).bind(templateId, user.id).first();

  if (!existing) {
    return c.json({ error: 'テンプレートが見つかりません' }, 404);
  }

  await c.env.DB.prepare(
    'DELETE FROM item_templates WHERE id = ?'
  ).bind(templateId).run();

  return c.json({ ok: true });
});

// ============ Trip Tags ============

// Predefined suggested tags
const SUGGESTED_TAGS = ['国内', '海外', '日帰り', '週末', '長期', '家族', '友人', '一人旅', 'ビジネス'];

// Get all unique tags used by the user (for suggestions)
app.get('/api/tags', async (c) => {
  const user = c.get('user');

  if (!user) {
    return c.json({ tags: [], suggestedTags: SUGGESTED_TAGS });
  }

  // Get all unique tags from user's trips
  const { results } = await c.env.DB.prepare(
    `SELECT DISTINCT tt.tag FROM trip_tags tt
     INNER JOIN trips t ON tt.trip_id = t.id
     WHERE t.user_id = ?
     ORDER BY tt.tag`
  ).bind(user.id).all<{ tag: string }>();

  const userTags = results.map(r => r.tag);

  return c.json({ tags: userTags, suggestedTags: SUGGESTED_TAGS });
});

// Get tags for a specific trip
app.get('/api/trips/:tripId/tags', async (c) => {
  const tripId = c.req.param('tripId');
  const user = c.get('user');

  // Check trip exists and user has access
  const trip = await c.env.DB.prepare(
    'SELECT id, user_id as userId FROM trips WHERE id = ?'
  ).bind(tripId).first<{ id: string; userId: string | null }>();

  if (!trip) {
    return c.json({ error: '旅程が見つかりません' }, 404);
  }

  // Check ownership or collaborator access
  if (trip.userId && (!user || trip.userId !== user.id)) {
    // Check if user is a collaborator
    if (user) {
      const collab = await c.env.DB.prepare(
        'SELECT id FROM trip_collaborators WHERE trip_id = ? AND user_id = ?'
      ).bind(tripId, user.id).first();
      if (!collab) {
        return c.json({ error: 'アクセスが拒否されました' }, 403);
      }
    } else {
      return c.json({ error: 'アクセスが拒否されました' }, 403);
    }
  }

  const { results } = await c.env.DB.prepare(
    'SELECT tag FROM trip_tags WHERE trip_id = ?'
  ).bind(tripId).all<{ tag: string }>();

  return c.json({ tags: results.map(r => r.tag), suggestedTags: SUGGESTED_TAGS });
});

// Add a tag to a trip
app.post('/api/trips/:tripId/tags', async (c) => {
  const tripId = c.req.param('tripId');
  const user = c.get('user');
  const body = await c.req.json<{ tag: string }>();

  if (!body.tag?.trim()) {
    return c.json({ error: 'タグは必須です' }, 400);
  }

  const tag = body.tag.trim();

  // Validate tag length
  if (tag.length > 20) {
    return c.json({ error: 'タグは20文字以内にしてください' }, 400);
  }

  // Check trip exists and user has access
  const trip = await c.env.DB.prepare(
    'SELECT id, user_id as userId FROM trips WHERE id = ?'
  ).bind(tripId).first<{ id: string; userId: string | null }>();

  if (!trip) {
    return c.json({ error: '旅程が見つかりません' }, 404);
  }

  // Check ownership or editor collaborator access
  if (trip.userId && (!user || trip.userId !== user.id)) {
    // Check if user is an editor collaborator
    if (user) {
      const collab = await c.env.DB.prepare(
        'SELECT id, role FROM trip_collaborators WHERE trip_id = ? AND user_id = ?'
      ).bind(tripId, user.id).first<{ id: string; role: string }>();
      if (!collab || collab.role !== 'editor') {
        return c.json({ error: 'アクセスが拒否されました' }, 403);
      }
    } else {
      return c.json({ error: 'アクセスが拒否されました' }, 403);
    }
  }

  // Check if tag already exists for this trip
  const existing = await c.env.DB.prepare(
    'SELECT id FROM trip_tags WHERE trip_id = ? AND tag = ?'
  ).bind(tripId, tag).first();

  if (existing) {
    return c.json({ error: 'このタグは既に追加されています' }, 400);
  }

  const id = generateId();
  await c.env.DB.prepare(
    'INSERT INTO trip_tags (id, trip_id, tag) VALUES (?, ?, ?)'
  ).bind(id, tripId, tag).run();

  // Return updated list of tags
  const { results } = await c.env.DB.prepare(
    'SELECT tag FROM trip_tags WHERE trip_id = ?'
  ).bind(tripId).all<{ tag: string }>();

  return c.json({ tags: results.map(r => r.tag) }, 201);
});

// Remove a tag from a trip
app.delete('/api/trips/:tripId/tags/:tag', async (c) => {
  const tripId = c.req.param('tripId');
  const tag = decodeURIComponent(c.req.param('tag'));
  const user = c.get('user');

  // Check trip exists and user has access
  const trip = await c.env.DB.prepare(
    'SELECT id, user_id as userId FROM trips WHERE id = ?'
  ).bind(tripId).first<{ id: string; userId: string | null }>();

  if (!trip) {
    return c.json({ error: '旅程が見つかりません' }, 404);
  }

  // Check ownership or editor collaborator access
  if (trip.userId && (!user || trip.userId !== user.id)) {
    // Check if user is an editor collaborator
    if (user) {
      const collab = await c.env.DB.prepare(
        'SELECT id, role FROM trip_collaborators WHERE trip_id = ? AND user_id = ?'
      ).bind(tripId, user.id).first<{ id: string; role: string }>();
      if (!collab || collab.role !== 'editor') {
        return c.json({ error: 'アクセスが拒否されました' }, 403);
      }
    } else {
      return c.json({ error: 'アクセスが拒否されました' }, 403);
    }
  }

  await c.env.DB.prepare(
    'DELETE FROM trip_tags WHERE trip_id = ? AND tag = ?'
  ).bind(tripId, tag).run();

  // Return updated list of tags
  const { results } = await c.env.DB.prepare(
    'SELECT tag FROM trip_tags WHERE trip_id = ?'
  ).bind(tripId).all<{ tag: string }>();

  return c.json({ tags: results.map(r => r.tag) });
});

// ============ Weather API ============

// Weather code descriptions and icons based on WMO codes
type WeatherInfo = {
  description: string;
  icon: string;
};

function getWeatherInfo(code: number): WeatherInfo {
  if (code === 0) return { description: '快晴', icon: 'clear' };
  if (code >= 1 && code <= 3) return { description: '晴れ時々曇り', icon: 'partly_cloudy' };
  if (code === 45 || code === 48) return { description: '霧', icon: 'fog' };
  if (code >= 51 && code <= 55) return { description: '霧雨', icon: 'drizzle' };
  if (code >= 56 && code <= 57) return { description: '凍結霧雨', icon: 'drizzle' };
  if (code >= 61 && code <= 65) return { description: '雨', icon: 'rain' };
  if (code >= 66 && code <= 67) return { description: '凍結雨', icon: 'rain' };
  if (code >= 71 && code <= 77) return { description: '雪', icon: 'snow' };
  if (code >= 80 && code <= 82) return { description: 'にわか雨', icon: 'showers' };
  if (code >= 85 && code <= 86) return { description: '雪嵐', icon: 'snow' };
  if (code >= 95 && code <= 99) return { description: '雷雨', icon: 'thunderstorm' };
  return { description: '不明', icon: 'unknown' };
}

// Get weather forecast for a specific location and date
app.get('/api/weather', async (c) => {
  const lat = c.req.query('lat');
  const lon = c.req.query('lon');
  const date = c.req.query('date');

  if (!lat || !lon || !date) {
    return c.json({ error: 'lat, lon, date parameters are required' }, 400);
  }

  const latitude = parseFloat(lat);
  const longitude = parseFloat(lon);

  if (isNaN(latitude) || isNaN(longitude)) {
    return c.json({ error: 'Invalid latitude or longitude' }, 400);
  }

  // Validate date format (YYYY-MM-DD)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return c.json({ error: 'Invalid date format. Use YYYY-MM-DD' }, 400);
  }

  try {
    // Calculate if date is within forecast range (past 7 days to future 7 days)
    const targetDate = new Date(date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    targetDate.setHours(0, 0, 0, 0);

    const diffDays = Math.floor((targetDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

    // Open-Meteo provides up to 16 days forecast
    if (diffDays < -7 || diffDays > 16) {
      return c.json({
        available: false,
        reason: 'Date is outside the available forecast range (past 7 days to future 16 days)'
      });
    }

    // Use Open-Meteo API
    const apiUrl = new URL('https://api.open-meteo.com/v1/forecast');
    apiUrl.searchParams.set('latitude', latitude.toString());
    apiUrl.searchParams.set('longitude', longitude.toString());
    apiUrl.searchParams.set('daily', 'weather_code,temperature_2m_max,temperature_2m_min');
    apiUrl.searchParams.set('timezone', 'Asia/Tokyo');
    apiUrl.searchParams.set('start_date', date);
    apiUrl.searchParams.set('end_date', date);

    // For past dates, use archive API
    if (diffDays < 0) {
      apiUrl.hostname = 'archive-api.open-meteo.com';
    }

    const response = await fetch(apiUrl.toString());

    if (!response.ok) {
      console.error('Open-Meteo API error:', response.status, await response.text());
      return c.json({ available: false, reason: 'Weather data not available' });
    }

    const data = await response.json() as {
      daily?: {
        weather_code?: number[];
        temperature_2m_max?: number[];
        temperature_2m_min?: number[];
      };
    };

    if (!data.daily || !data.daily.weather_code || data.daily.weather_code.length === 0) {
      return c.json({ available: false, reason: 'No weather data for this date' });
    }

    const weatherCode = data.daily.weather_code[0];
    const tempMax = data.daily.temperature_2m_max?.[0];
    const tempMin = data.daily.temperature_2m_min?.[0];
    const weatherInfo = getWeatherInfo(weatherCode);

    return c.json({
      available: true,
      date,
      weatherCode,
      description: weatherInfo.description,
      icon: weatherInfo.icon,
      temperatureMax: tempMax,
      temperatureMin: tempMin,
    });
  } catch (error) {
    console.error('Weather API error:', error);
    return c.json({ available: false, reason: 'Failed to fetch weather data' });
  }
});

// Geocode API - Convert location name to coordinates
app.get('/api/geocode', async (c) => {
  const query = c.req.query('q');

  if (!query) {
    return c.json({ error: 'q parameter is required' }, 400);
  }

  try {
    // Use Nominatim API for geocoding
    const apiUrl = new URL('https://nominatim.openstreetmap.org/search');
    apiUrl.searchParams.set('q', query);
    apiUrl.searchParams.set('format', 'json');
    apiUrl.searchParams.set('limit', '1');
    apiUrl.searchParams.set('accept-language', 'ja');

    const response = await fetch(apiUrl.toString(), {
      headers: {
        'User-Agent': 'TripItinerary/1.0'
      }
    });

    if (!response.ok) {
      console.error('Nominatim API error:', response.status);
      return c.json({ found: false, reason: 'Geocoding service error' });
    }

    const data = await response.json() as Array<{
      lat: string;
      lon: string;
      display_name: string;
    }>;

    if (!data || data.length === 0) {
      return c.json({ found: false, reason: 'Location not found' });
    }

    const result = data[0];
    return c.json({
      found: true,
      latitude: parseFloat(result.lat),
      longitude: parseFloat(result.lon),
      displayName: result.display_name,
    });
  } catch (error) {
    console.error('Geocode API error:', error);
    return c.json({ found: false, reason: 'Failed to geocode location' });
  }
});

// ============ Payment (Stripe) ============

// Price configuration
const TRIP_SLOT_PRICE = 100; // ¥100 per trip slot

// Create Stripe checkout session
app.post('/api/payment/checkout', async (c) => {
  const user = c.get('user');
  if (!user) {
    return c.json({ error: 'ログインが必要です' }, 401);
  }

  const body = await c.req.json<{ slots?: number }>();
  const slots = body.slots || 1;

  if (slots < 1 || slots > 10) {
    return c.json({ error: '購入枠数は1〜10の範囲で指定してください' }, 400);
  }

  const url = new URL(c.req.url);
  const origin = url.origin;

  try {
    // Create Stripe checkout session
    const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${c.env.STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        'payment_method_types[]': 'card',
        'line_items[0][price_data][currency]': 'jpy',
        'line_items[0][price_data][product_data][name]': `旅程枠 ${slots}枠`,
        'line_items[0][price_data][product_data][description]': '追加の旅程作成枠',
        'line_items[0][price_data][unit_amount]': String(TRIP_SLOT_PRICE),
        'line_items[0][quantity]': String(slots),
        'mode': 'payment',
        'success_url': `${origin}/profile?payment=success`,
        'cancel_url': `${origin}/profile?payment=cancelled`,
        'metadata[user_id]': user.id,
        'metadata[slots]': String(slots),
        'client_reference_id': user.id,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('Stripe checkout error:', error);
      return c.json({ error: '決済セッションの作成に失敗しました' }, 500);
    }

    const session = await response.json() as { id: string; url: string };
    return c.json({ sessionId: session.id, url: session.url });
  } catch (err) {
    console.error('Stripe checkout error:', err);
    return c.json({ error: '決済処理中にエラーが発生しました' }, 500);
  }
});

// Stripe webhook handler
app.post('/api/payment/webhook', async (c) => {
  const signature = c.req.header('stripe-signature');
  if (!signature) {
    return c.json({ error: 'Missing signature' }, 400);
  }

  const payload = await c.req.text();

  // Verify webhook signature
  try {
    const encoder = new TextEncoder();
    const timestampMatch = signature.match(/t=(\d+)/);
    const signatureMatch = signature.match(/v1=([a-f0-9]+)/);

    if (!timestampMatch || !signatureMatch) {
      return c.json({ error: 'Invalid signature format' }, 400);
    }

    const timestamp = timestampMatch[1];
    const expectedSignature = signatureMatch[1];

    // Create signed payload
    const signedPayload = `${timestamp}.${payload}`;
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(c.env.STRIPE_WEBHOOK_SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const signatureBytes = await crypto.subtle.sign(
      'HMAC',
      key,
      encoder.encode(signedPayload)
    );
    const computedSignature = Array.from(new Uint8Array(signatureBytes))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    if (computedSignature !== expectedSignature) {
      return c.json({ error: 'Invalid signature' }, 400);
    }

    // Check timestamp (within 5 minutes)
    const webhookTimestamp = parseInt(timestamp, 10);
    const currentTimestamp = Math.floor(Date.now() / 1000);
    if (Math.abs(currentTimestamp - webhookTimestamp) > 300) {
      return c.json({ error: 'Timestamp too old' }, 400);
    }
  } catch (err) {
    console.error('Webhook signature verification error:', err);
    return c.json({ error: 'Signature verification failed' }, 400);
  }

  // Parse event
  const event = JSON.parse(payload) as {
    type: string;
    data: {
      object: {
        id: string;
        metadata: { user_id: string; slots: string };
        amount_total: number;
        payment_status: string;
      };
    };
  };

  if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
    const session = event.data.object;

    if (session.payment_status === 'paid') {
      const userId = session.metadata.user_id;
      const slots = parseInt(session.metadata.slots, 10);
      const amount = session.amount_total;

      try {
        // Check if this payment was already processed (idempotency)
        const existing = await c.env.DB.prepare(
          'SELECT id FROM purchases WHERE payment_id = ?'
        ).bind(session.id).first();

        if (existing) {
          console.log(`Payment already processed: session=${session.id}`);
          return c.json({ received: true });
        }

        // Record purchase and update user in batch
        const purchaseId = crypto.randomUUID();
        await c.env.DB.batch([
          c.env.DB.prepare(
            `INSERT INTO purchases (id, user_id, amount, trip_slots, payment_method, payment_id)
             VALUES (?, ?, ?, ?, 'stripe', ?)`
          ).bind(purchaseId, userId, amount, slots, session.id),
          c.env.DB.prepare(
            `UPDATE users
             SET is_premium = 1,
                 purchased_slots = purchased_slots + ?
             WHERE id = ?`
          ).bind(slots, userId),
        ]);

        console.log(`Payment completed: user=${userId}, slots=${slots}, amount=${amount}`);
      } catch (err) {
        console.error('Failed to process payment:', err);
        return c.json({ error: 'Failed to process payment' }, 500);
      }
    }
  }

  return c.json({ received: true });
});

// Get user's slot info
app.get('/api/payment/slots', async (c) => {
  const user = c.get('user');
  if (!user) {
    return c.json({ error: 'ログインが必要です' }, 401);
  }

  // Count user's trips
  const tripCount = await c.env.DB.prepare(
    'SELECT COUNT(*) as count FROM trips WHERE user_id = ?'
  ).bind(user.id).first<{ count: number }>();

  const usedSlots = tripCount?.count ?? 0;
  const freeSlots = user.freeSlots ?? 3;
  const purchasedSlots = user.purchasedSlots ?? 0;
  const totalSlots = freeSlots + purchasedSlots;
  const remainingSlots = Math.max(0, totalSlots - usedSlots);

  return c.json({
    freeSlots,
    purchasedSlots,
    totalSlots,
    usedSlots,
    remainingSlots,
    isPremium: !!user.isPremium,
    pricePerSlot: TRIP_SLOT_PRICE,
  });
});

// Get purchase history
app.get('/api/payment/history', async (c) => {
  const user = c.get('user');
  if (!user) {
    return c.json({ error: 'ログインが必要です' }, 401);
  }

  const purchases = await c.env.DB.prepare(
    `SELECT id, amount, trip_slots as tripSlots, payment_method as paymentMethod,
            created_at as createdAt
     FROM purchases WHERE user_id = ? ORDER BY created_at DESC`
  ).bind(user.id).all();

  return c.json({ purchases: purchases.results });
});

// ============ Public Gallery ============

// Get public gallery list
app.get('/api/gallery', async (c) => {
  const url = new URL(c.req.url);
  const region = url.searchParams.get('region') || '';
  const minDays = parseInt(url.searchParams.get('minDays') || '0', 10);
  const maxDays = parseInt(url.searchParams.get('maxDays') || '0', 10);
  const sort = url.searchParams.get('sort') || 'likes'; // 'likes' or 'recent'
  const user = c.get('user');

  // Build query
  let query = `
    SELECT
      t.id,
      COALESCE(t.public_title, t.title) as title,
      t.start_date as startDate,
      t.end_date as endDate,
      t.theme,
      t.cover_image_url as coverImageUrl,
      t.like_count as likeCount,
      t.created_at as createdAt,
      (SELECT COUNT(*) FROM days WHERE trip_id = t.id) as dayCount
    FROM trips t
    WHERE t.is_public = 1
  `;
  const params: unknown[] = [];

  // Region filter (search in title or items.area)
  if (region) {
    query += ` AND (
      t.title LIKE ? OR t.public_title LIKE ? OR
      EXISTS (SELECT 1 FROM items WHERE trip_id = t.id AND area LIKE ?)
    )`;
    const regionPattern = `%${region}%`;
    params.push(regionPattern, regionPattern, regionPattern);
  }

  // Day count filter using subquery
  if (minDays > 0) {
    query += ` AND (SELECT COUNT(*) FROM days WHERE trip_id = t.id) >= ?`;
    params.push(minDays);
  }
  if (maxDays > 0) {
    query += ` AND (SELECT COUNT(*) FROM days WHERE trip_id = t.id) <= ?`;
    params.push(maxDays);
  }

  // Sort order
  if (sort === 'recent') {
    query += ` ORDER BY t.created_at DESC`;
  } else {
    query += ` ORDER BY t.like_count DESC, t.created_at DESC`;
  }

  query += ` LIMIT 50`;

  const { results } = await c.env.DB.prepare(query).bind(...params).all<{
    id: string;
    title: string;
    startDate: string | null;
    endDate: string | null;
    theme: string | null;
    coverImageUrl: string | null;
    likeCount: number;
    createdAt: string;
    dayCount: number;
  }>();

  // If user is logged in, check which trips they've liked/saved
  let likedIds: Set<string> = new Set();
  let savedIds: Set<string> = new Set();

  if (user && results.length > 0) {
    const tripIds = results.map(r => r.id);
    const placeholders = tripIds.map(() => '?').join(',');

    const { results: likes } = await c.env.DB.prepare(
      `SELECT trip_id FROM trip_likes WHERE user_id = ? AND trip_id IN (${placeholders})`
    ).bind(user.id, ...tripIds).all<{ trip_id: string }>();
    likedIds = new Set(likes.map(l => l.trip_id));

    const { results: saves } = await c.env.DB.prepare(
      `SELECT trip_id FROM trip_saves WHERE user_id = ? AND trip_id IN (${placeholders})`
    ).bind(user.id, ...tripIds).all<{ trip_id: string }>();
    savedIds = new Set(saves.map(s => s.trip_id));
  }

  const trips = results.map(trip => ({
    ...trip,
    isLiked: likedIds.has(trip.id),
    isSaved: savedIds.has(trip.id),
  }));

  return c.json({ trips });
});

// Get public gallery trip detail (anonymized)
app.get('/api/gallery/:id', async (c) => {
  const tripId = c.req.param('id');
  const user = c.get('user');

  const trip = await c.env.DB.prepare(
    `SELECT id, COALESCE(public_title, title) as title,
            start_date as startDate, end_date as endDate,
            theme, cover_image_url as coverImageUrl,
            like_count as likeCount, created_at as createdAt
     FROM trips WHERE id = ? AND is_public = 1`
  ).bind(tripId).first<{
    id: string;
    title: string;
    startDate: string | null;
    endDate: string | null;
    theme: string | null;
    coverImageUrl: string | null;
    likeCount: number;
    createdAt: string;
  }>();

  if (!trip) {
    return c.json({ error: 'Trip not found or not public' }, 404);
  }

  // Get days
  const { results: days } = await c.env.DB.prepare(
    'SELECT id, date, sort FROM days WHERE trip_id = ? ORDER BY sort ASC'
  ).bind(tripId).all<{ id: string; date: string; sort: number }>();

  // Get items (without private notes/comments)
  const { results: items } = await c.env.DB.prepare(
    `SELECT id, day_id as dayId, title, area, time_start as timeStart,
            time_end as timeEnd, map_url as mapUrl, cost, cost_category as costCategory, sort
     FROM items WHERE trip_id = ? ORDER BY sort ASC`
  ).bind(tripId).all<{
    id: string;
    dayId: string;
    title: string;
    area: string | null;
    timeStart: string | null;
    timeEnd: string | null;
    mapUrl: string | null;
    cost: number | null;
    costCategory: string | null;
    sort: number;
  }>();

  // Check if user has liked/saved this trip
  let isLiked = false;
  let isSaved = false;
  if (user) {
    const like = await c.env.DB.prepare(
      'SELECT id FROM trip_likes WHERE trip_id = ? AND user_id = ?'
    ).bind(tripId, user.id).first();
    isLiked = !!like;

    const save = await c.env.DB.prepare(
      'SELECT id FROM trip_saves WHERE trip_id = ? AND user_id = ?'
    ).bind(tripId, user.id).first();
    isSaved = !!save;
  }

  return c.json({
    trip: {
      ...trip,
      days: days.map(d => ({ ...d, notes: null, photos: [] })), // Exclude notes
      items: items.map(i => ({ ...i, note: null, photoUrl: null })), // Exclude notes and photos
      isLiked,
      isSaved,
    },
  });
});

// Publish/unpublish a trip to gallery
app.put('/api/trips/:id/publish', async (c) => {
  const tripId = c.req.param('id');
  const user = c.get('user');

  if (!user) {
    return c.json({ error: 'ログインが必要です' }, 401);
  }

  const body = await c.req.json<{
    isPublic: boolean;
    publicTitle?: string;
    excludeNotes?: boolean;
  }>();

  // Check ownership
  const ownerCheck = await checkTripOwnership(c.env.DB, tripId, user);
  if (!ownerCheck.ok) {
    return c.json({ error: ownerCheck.error }, (ownerCheck.status || 403) as 403);
  }

  await c.env.DB.prepare(
    `UPDATE trips SET
      is_public = ?,
      public_title = ?,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
     WHERE id = ?`
  ).bind(
    body.isPublic ? 1 : 0,
    body.publicTitle?.trim() || null,
    tripId
  ).run();

  return c.json({
    isPublic: body.isPublic,
    publicTitle: body.publicTitle || null,
  });
});

// Toggle like on a public trip
app.post('/api/gallery/:id/like', async (c) => {
  const tripId = c.req.param('id');
  const user = c.get('user');

  if (!user) {
    return c.json({ error: 'ログインが必要です' }, 401);
  }

  // Check if trip is public
  const trip = await c.env.DB.prepare(
    'SELECT id, like_count as likeCount FROM trips WHERE id = ? AND is_public = 1'
  ).bind(tripId).first<{ id: string; likeCount: number }>();

  if (!trip) {
    return c.json({ error: 'Trip not found or not public' }, 404);
  }

  // Check if already liked
  const existing = await c.env.DB.prepare(
    'SELECT id FROM trip_likes WHERE trip_id = ? AND user_id = ?'
  ).bind(tripId, user.id).first<{ id: string }>();

  if (existing) {
    // Unlike
    await c.env.DB.prepare('DELETE FROM trip_likes WHERE id = ?').bind(existing.id).run();
    await c.env.DB.prepare(
      'UPDATE trips SET like_count = like_count - 1 WHERE id = ?'
    ).bind(tripId).run();

    return c.json({ liked: false, likeCount: trip.likeCount - 1 });
  } else {
    // Like
    const likeId = generateId();
    await c.env.DB.prepare(
      'INSERT INTO trip_likes (id, trip_id, user_id) VALUES (?, ?, ?)'
    ).bind(likeId, tripId, user.id).run();
    await c.env.DB.prepare(
      'UPDATE trips SET like_count = like_count + 1 WHERE id = ?'
    ).bind(tripId).run();

    return c.json({ liked: true, likeCount: trip.likeCount + 1 });
  }
});

// Toggle save on a public trip
app.post('/api/gallery/:id/save', async (c) => {
  const tripId = c.req.param('id');
  const user = c.get('user');

  if (!user) {
    return c.json({ error: 'ログインが必要です' }, 401);
  }

  // Check if trip is public
  const trip = await c.env.DB.prepare(
    'SELECT id FROM trips WHERE id = ? AND is_public = 1'
  ).bind(tripId).first();

  if (!trip) {
    return c.json({ error: 'Trip not found or not public' }, 404);
  }

  // Check if already saved
  const existing = await c.env.DB.prepare(
    'SELECT id FROM trip_saves WHERE trip_id = ? AND user_id = ?'
  ).bind(tripId, user.id).first<{ id: string }>();

  if (existing) {
    // Unsave
    await c.env.DB.prepare('DELETE FROM trip_saves WHERE id = ?').bind(existing.id).run();
    return c.json({ saved: false });
  } else {
    // Save
    const saveId = generateId();
    await c.env.DB.prepare(
      'INSERT INTO trip_saves (id, trip_id, user_id) VALUES (?, ?, ?)'
    ).bind(saveId, tripId, user.id).run();
    return c.json({ saved: true });
  }
});

// Get user's saved trips
app.get('/api/gallery/saved', async (c) => {
  const user = c.get('user');

  if (!user) {
    return c.json({ error: 'ログインが必要です' }, 401);
  }

  const { results } = await c.env.DB.prepare(
    `SELECT
      t.id,
      COALESCE(t.public_title, t.title) as title,
      t.start_date as startDate,
      t.end_date as endDate,
      t.theme,
      t.cover_image_url as coverImageUrl,
      t.like_count as likeCount,
      s.created_at as savedAt,
      (SELECT COUNT(*) FROM days WHERE trip_id = t.id) as dayCount
    FROM trip_saves s
    JOIN trips t ON s.trip_id = t.id
    WHERE s.user_id = ? AND t.is_public = 1
    ORDER BY s.created_at DESC`
  ).bind(user.id).all<{
    id: string;
    title: string;
    startDate: string | null;
    endDate: string | null;
    theme: string | null;
    coverImageUrl: string | null;
    likeCount: number;
    savedAt: string;
    dayCount: number;
  }>();

  const trips = results.map(trip => ({
    ...trip,
    isLiked: false, // Will check below
    isSaved: true, // All saved trips are saved by definition
  }));

  // Check which trips are also liked
  if (trips.length > 0) {
    const tripIds = trips.map(t => t.id);
    const placeholders = tripIds.map(() => '?').join(',');
    const { results: likes } = await c.env.DB.prepare(
      `SELECT trip_id FROM trip_likes WHERE user_id = ? AND trip_id IN (${placeholders})`
    ).bind(user.id, ...tripIds).all<{ trip_id: string }>();
    const likedIds = new Set(likes.map(l => l.trip_id));

    for (const trip of trips) {
      trip.isLiked = likedIds.has(trip.id);
    }
  }

  return c.json({ trips });
});

// Use a public trip as template (create a copy)
app.post('/api/gallery/:id/use', async (c) => {
  const tripId = c.req.param('id');
  const user = c.get('user');

  if (!user) {
    return c.json({ error: 'ログインが必要です' }, 401);
  }

  // Check if user has remaining trip slots
  const userData = await c.env.DB.prepare(
    'SELECT free_slots as freeSlots, purchased_slots as purchasedSlots FROM users WHERE id = ?'
  ).bind(user.id).first<{ freeSlots: number; purchasedSlots: number }>();

  if (userData) {
    const totalSlots = userData.freeSlots + userData.purchasedSlots;
    const usedSlots = await c.env.DB.prepare(
      'SELECT COUNT(*) as count FROM trips WHERE user_id = ? AND (is_archived = 0 OR is_archived IS NULL)'
    ).bind(user.id).first<{ count: number }>();

    if (usedSlots && usedSlots.count >= totalSlots) {
      return c.json({
        error: '旅程枠が不足しています。プロフィールページから追加の枠を購入してください。',
        code: 'SLOT_LIMIT_REACHED',
      }, 403);
    }
  }

  // Get the public trip
  const sourceTripResult = await c.env.DB.prepare(
    `SELECT id, COALESCE(public_title, title) as title, theme,
            start_date as startDate, end_date as endDate
     FROM trips WHERE id = ? AND is_public = 1`
  ).bind(tripId).first<{
    id: string;
    title: string;
    theme: string | null;
    startDate: string | null;
    endDate: string | null;
  }>();

  if (!sourceTripResult) {
    return c.json({ error: '公開されている旅程が見つかりません' }, 404);
  }

  // Create new trip
  const newTripId = generateId();
  const newTitle = `${sourceTripResult.title}（コピー）`;

  await c.env.DB.prepare(
    `INSERT INTO trips (id, title, theme, start_date, end_date, user_id, is_template, template_uses)
     VALUES (?, ?, ?, ?, ?, ?, 0, 0)`
  ).bind(
    newTripId,
    newTitle,
    sourceTripResult.theme || 'quiet',
    sourceTripResult.startDate,
    sourceTripResult.endDate,
    user.id
  ).run();

  // Copy days
  const { results: days } = await c.env.DB.prepare(
    'SELECT id, date, sort FROM days WHERE trip_id = ? ORDER BY sort ASC'
  ).bind(tripId).all<{ id: string; date: string; sort: number }>();

  const dayIdMap = new Map<string, string>();

  for (const day of days) {
    const newDayId = generateId();
    dayIdMap.set(day.id, newDayId);

    await c.env.DB.prepare(
      'INSERT INTO days (id, trip_id, date, sort) VALUES (?, ?, ?, ?)'
    ).bind(newDayId, newTripId, day.date, day.sort).run();
  }

  // Copy items (without notes for privacy)
  const { results: items } = await c.env.DB.prepare(
    `SELECT day_id, title, area, time_start, time_end, map_url, cost, cost_category, sort
     FROM items WHERE trip_id = ? ORDER BY sort ASC`
  ).bind(tripId).all<{
    day_id: string;
    title: string;
    area: string | null;
    time_start: string | null;
    time_end: string | null;
    map_url: string | null;
    cost: number | null;
    cost_category: string | null;
    sort: number;
  }>();

  for (const item of items) {
    const newDayId = dayIdMap.get(item.day_id);
    if (!newDayId) continue;

    const newItemId = generateId();
    await c.env.DB.prepare(
      `INSERT INTO items (id, trip_id, day_id, title, area, time_start, time_end, map_url, cost, cost_category, sort)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      newItemId,
      newTripId,
      newDayId,
      item.title,
      item.area,
      item.time_start,
      item.time_end,
      item.map_url,
      item.cost,
      item.cost_category,
      item.sort
    ).run();
  }

  return c.json({ tripId: newTripId }, 201);
});

// Get trip's publish status
app.get('/api/trips/:id/publish', async (c) => {
  const tripId = c.req.param('id');
  const user = c.get('user');

  if (!user) {
    return c.json({ error: 'ログインが必要です' }, 401);
  }

  // Check ownership
  const ownerCheck = await checkTripOwnership(c.env.DB, tripId, user);
  if (!ownerCheck.ok) {
    return c.json({ error: ownerCheck.error }, (ownerCheck.status || 403) as 403);
  }

  const trip = await c.env.DB.prepare(
    'SELECT is_public as isPublic, public_title as publicTitle, like_count as likeCount FROM trips WHERE id = ?'
  ).bind(tripId).first<{ isPublic: number; publicTitle: string | null; likeCount: number }>();

  if (!trip) {
    return c.json({ error: 'Trip not found' }, 404);
  }

  return c.json({
    isPublic: !!trip.isPublic,
    publicTitle: trip.publicTitle,
    likeCount: trip.likeCount,
  });
});

// SPA routes - serve index.html for client-side routing
const spaRoutes = ['/trips', '/trips/', '/login', '/contact', '/invite', '/embed', '/profile', '/gallery', '/gallery/'];

app.get('*', async (c) => {
  const url = new URL(c.req.url);
  const path = url.pathname;

  // Check if this is a SPA route that needs index.html
  const isSpaRoute = spaRoutes.some(route => path.startsWith(route)) ||
    path === '/' ||
    path.match(/^\/trips\/[^/]+$/) ||  // /trips/:id
    path.match(/^\/trips\/[^/]+\/edit$/) ||  // /trips/:id/edit
    path.match(/^\/trips\/[^/]+\/album$/) ||  // /trips/:id/album
    path.match(/^\/invite\/[^/]+$/) ||  // /invite/:token
    path.match(/^\/embed\/[^/]+$/) ||  // /embed/:id
    path.match(/^\/gallery\/[^/]+$/);  // /gallery/:id

  if (isSpaRoute) {
    url.pathname = '/index.html';
    return c.env.ASSETS.fetch(new Request(url.toString(), c.req.raw));
  }

  // Serve static assets
  return c.env.ASSETS.fetch(c.req.raw);
});

export default app;
