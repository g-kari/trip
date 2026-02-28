import { Hono } from 'hono';
import type { AppEnv } from '../worker-types';
import {
  createSession,
  deleteSession,
  getSessionIdFromCookie,
  createSessionCookie,
  createLogoutCookie,
  generateId,
} from '../auth/session';
import {
  getGoogleAuthUrl,
  exchangeCodeForTokens as exchangeGoogleCodeForTokens,
  getGoogleUserInfo,
} from '../auth/google';
import {
  getLineAuthUrl,
  exchangeCodeForTokens as exchangeLineCodeForTokens,
  getLineUserInfo,
} from '../auth/line';
import type { User } from '../auth/types';
import { generateToken } from '../helpers';

const app = new Hono<AppEnv>();

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

  // Set state cookie for verification in callback
  const isSecure = url.protocol === 'https:';
  return new Response(null, {
    status: 302,
    headers: {
      Location: authUrl,
      'Set-Cookie': `oauth_state=${state}; Path=/; HttpOnly; SameSite=Lax${isSecure ? '; Secure' : ''}; Max-Age=600`,
    },
  });
});

// Google OAuth callback
app.get('/api/auth/google/callback', async (c) => {
  const url = new URL(c.req.url);
  const code = url.searchParams.get('code');
  const stateFromQuery = url.searchParams.get('state');

  if (!code) {
    return c.redirect('/login?error=no_code', 302);
  }

  // Verify CSRF state parameter
  const cookies = c.req.header('Cookie') || '';
  const stateMatch = cookies.match(/oauth_state=([^;]+)/);
  const stateFromCookie = stateMatch ? stateMatch[1] : null;
  if (!stateFromQuery || !stateFromCookie || stateFromQuery !== stateFromCookie) {
    return c.redirect('/login?error=state_mismatch', 302);
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

    // Redirect to trips page with session cookie (clear oauth_state)
    const headers = new Headers();
    headers.append('Location', '/trips');
    headers.append('Set-Cookie', createSessionCookie(session.id));
    headers.append('Set-Cookie', 'oauth_state=; Path=/; HttpOnly; Max-Age=0');
    return new Response(null, { status: 302, headers });
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

  // Set state cookie for verification in callback
  const isSecure = url.protocol === 'https:';
  return new Response(null, {
    status: 302,
    headers: {
      Location: authUrl,
      'Set-Cookie': `oauth_state=${state}; Path=/; HttpOnly; SameSite=Lax${isSecure ? '; Secure' : ''}; Max-Age=600`,
    },
  });
});

// LINE OAuth callback
app.get('/api/auth/line/callback', async (c) => {
  const url = new URL(c.req.url);
  const code = url.searchParams.get('code');
  const stateFromQuery = url.searchParams.get('state');

  if (!code) {
    return c.redirect('/login?error=no_code', 302);
  }

  // Verify CSRF state parameter
  const cookies = c.req.header('Cookie') || '';
  const stateMatch = cookies.match(/oauth_state=([^;]+)/);
  const stateFromCookie = stateMatch ? stateMatch[1] : null;
  if (!stateFromQuery || !stateFromCookie || stateFromQuery !== stateFromCookie) {
    return c.redirect('/login?error=state_mismatch', 302);
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

    // Redirect to trips page with session cookie (clear oauth_state)
    const headers = new Headers();
    headers.append('Location', '/trips');
    headers.append('Set-Cookie', createSessionCookie(session.id));
    headers.append('Set-Cookie', 'oauth_state=; Path=/; HttpOnly; Max-Age=0');
    return new Response(null, { status: 302, headers });
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

export default app;
