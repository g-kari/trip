import { Hono } from 'hono';
import type { AppEnv } from '../worker-types';
import { generateId } from '../auth/session';
import {
  generateToken,
  checkTripOwnership,
  checkTripEditAccess,
  enrichTripData,
} from '../helpers';
import { generateOgpImage } from '../ogp';

const app = new Hono<AppEnv>();

// ============ Share Tokens ============

// Create share token for a trip
app.post('/api/trips/:tripId/share', async (c) => {
  const tripId = c.req.param('tripId');
  const user = c.get('user');

  const check = await checkTripOwnership(c.env.DB, tripId, user);
  if (!check.ok) {
    return c.json({ error: check.error }, check.status as 403 | 404);
  }

  // Check if active share token already exists
  const existing = await c.env.DB.prepare(
    'SELECT token FROM share_tokens WHERE trip_id = ? AND is_active = 1'
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
    'SELECT trip_id FROM share_tokens WHERE token = ? AND is_active = 1'
  ).bind(token).first<{ trip_id: string }>();

  if (!share) {
    return c.json({ error: 'Invalid share link' }, 404);
  }

  const trip = await c.env.DB.prepare(
    'SELECT id, title, start_date as startDate, end_date as endDate, theme, cover_image_url as coverImageUrl, budget, color_label as colorLabel, user_id as userId FROM trips WHERE id = ?'
  ).bind(share.trip_id).first<{
    id: string;
    title: string;
    startDate: string | null;
    endDate: string | null;
    theme: string | null;
    coverImageUrl: string | null;
    budget: number | null;
    colorLabel: string | null;
    userId: string | null;
  }>();

  if (!trip) {
    return c.json({ error: 'Trip not found' }, 404);
  }

  const user = c.get('user');
  const isOwner = !!(user && trip.userId && trip.userId === user.id);

  const { days: daysWithParsedPhotos, items: itemsWithUploaderNames } = await enrichTripData(c.env.DB, share.trip_id);

  // Remove userId from the response to not expose internal user ID
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { userId: _unusedUserId, ...tripWithoutUserId } = trip;
  return c.json({ trip: { ...tripWithoutUserId, days: daysWithParsedPhotos, items: itemsWithUploaderNames }, isOwner });
});

// OGP image for shared trip
app.get('/api/shared/:token/ogp.png', async (c) => {
  const token = c.req.param('token');

  const share = await c.env.DB.prepare(
    'SELECT trip_id FROM share_tokens WHERE token = ? AND is_active = 1'
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

  // Format date range and day count
  let dateRange: string | undefined;
  let dayCount: number | undefined;
  if (trip.startDate && trip.endDate) {
    const start = new Date(trip.startDate);
    const end = new Date(trip.endDate);
    dayCount = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    const formatDate = (d: Date) =>
      `${d.getMonth() + 1}/${d.getDate()}`;
    dateRange = `${formatDate(start)} - ${formatDate(end)}`;
  }

  // Fetch areas for the subtitle
  const { results: areas } = await c.env.DB.prepare(
    `SELECT DISTINCT i.area FROM items i
     JOIN days d ON i.day_id = d.id
     WHERE d.trip_id = ? AND i.area IS NOT NULL AND i.area != ''
     LIMIT 4`
  ).bind(share.trip_id).all<{ area: string }>();
  const subtitle = areas.length > 0 ? areas.map(a => a.area).join(' / ') : undefined;

  try {
    const ogpTheme = trip.theme === 'photo' ? 'photo' : trip.theme === 'retro' ? 'retro' : trip.theme === 'natural' ? 'natural' : 'quiet';
    const png = await generateOgpImage({
      title: trip.title,
      dateRange,
      dayCount,
      subtitle,
      theme: ogpTheme as 'quiet' | 'photo' | 'retro' | 'natural',
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
    const { buildTripIcs } = await import('../ics');
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
        'Content-Disposition': `attachment; filename="trip.ics"; filename*=UTF-8''${encodeURIComponent(trip.title)}.ics`,
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
    'SELECT trip_id FROM share_tokens WHERE token = ? AND is_active = 1'
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
    const { buildTripIcs } = await import('../ics');
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
        'Content-Disposition': `attachment; filename="trip.ics"; filename*=UTF-8''${encodeURIComponent(trip.title)}.ics`,
        'Cache-Control': 'private, max-age=0',
      },
    });
  } catch (error) {
    console.error('ICS generation error:', error);
    return c.json({ error: 'Failed to generate calendar file' }, 500);
  }
});

export default app;
