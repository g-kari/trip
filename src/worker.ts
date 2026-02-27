/// <reference types="@cloudflare/workers-types" />
import { Hono } from 'hono';
import {
  getUserBySession,
  getSessionIdFromCookie,
  generateId,
} from './auth/session';
import type { AppEnv } from './worker-types';
import type { OptimizedItem, TripStyle, GeneratedTrip } from './worker-types';
import {
  checkTripOwnership,
  checkCanEditTrip,
  buildTripSnapshot,
  buildChangeSummary,
  recordTripHistory,
  buildExportData,
  convertToCSV,
  getClientIp,
  checkAndDeductCredits,
  AI_MONTHLY_CREDITS,
  AI_CREDIT_COSTS,
  isCrawler,
  generateOgpHtml,
  getWeatherInfo,
} from './helpers';
import packingRoutes from './routes/packing';
import feedbackRoutes from './routes/feedback';
import templatesRoutes from './routes/templates';
import expensesRoutes from './routes/expenses';
import authRoutes from './routes/auth';
import sharingRoutes from './routes/sharing';

const app = new Hono<AppEnv>();

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

// Auth, Stats, Profile routes (extracted to ./routes/auth.ts)
app.route('/', authRoutes);

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
  const color = url.searchParams.get('color') || ''; // Color label filter

  let query = 'SELECT id, title, start_date as startDate, end_date as endDate, theme, cover_image_url as coverImageUrl, budget, color_label as colorLabel, is_archived as isArchived, pinned, created_at as createdAt FROM trips';
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
  if (theme === 'quiet' || theme === 'photo' || theme === 'retro' || theme === 'natural') {
    conditions.push('theme = ?');
    params.push(theme);
  }

  // Tag filter
  if (tag) {
    conditions.push('id IN (SELECT trip_id FROM trip_tags WHERE tag = ?)');
    params.push(tag);
  }

  // Color label filter
  const validColors = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'gray'];
  if (color && validColors.includes(color)) {
    conditions.push('color_label = ?');
    params.push(color);
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
    colorLabel: string | null;
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

// Get single trip with days and items
app.get('/api/trips/:id', async (c) => {
  const id = c.req.param('id');
  const user = c.get('user');
  const shareToken = c.req.query('token');

  const trip = await c.env.DB.prepare(
    'SELECT id, title, start_date as startDate, end_date as endDate, theme, cover_image_url as coverImageUrl, budget, color_label as colorLabel, user_id as userId, created_at as createdAt, updated_at as updatedAt FROM trips WHERE id = ?'
  ).bind(id).first<{
    id: string;
    title: string;
    startDate: string | null;
    endDate: string | null;
    theme: string | null;
    coverImageUrl: string | null;
    budget: number | null;
    colorLabel: string | null;
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

  // Get item_photos from the new table
  const { results: itemPhotos } = await c.env.DB.prepare(
    `SELECT id, item_id as itemId, photo_url as photoUrl, uploaded_by as uploadedBy,
     uploaded_by_name as uploadedByName, uploaded_at as uploadedAt
     FROM item_photos WHERE trip_id = ? ORDER BY uploaded_at ASC`
  ).bind(id).all<{
    id: string; itemId: string; photoUrl: string;
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

  // Group item_photos by item_id
  const itemPhotosMap = new Map<string, Array<{id: string; photoUrl: string; uploadedBy: string | null; uploadedByName: string | null; uploadedAt: string | null}>>();
  for (const ip of itemPhotos) {
    const arr = itemPhotosMap.get(ip.itemId) || [];
    arr.push({ id: ip.id, photoUrl: ip.photoUrl, uploadedBy: ip.uploadedBy, uploadedByName: ip.uploadedByName, uploadedAt: ip.uploadedAt });
    itemPhotosMap.set(ip.itemId, arr);
  }

  // Enrich items with uploader names and parse check-in location
  const itemsWithUploaderNames = items.map((item) => ({
    ...item,
    photoUploadedByName: item.photoUploadedBy ? uploaderNames.get(item.photoUploadedBy) || null : null,
    checkedInLocation: item.checkedInLocation ? JSON.parse(item.checkedInLocation) : null,
    photos: itemPhotosMap.get(item.id) || [],
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
  const theme = body.theme === 'photo' ? 'photo' : body.theme === 'retro' ? 'retro' : body.theme === 'natural' ? 'natural' : 'quiet';

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
  const body = await c.req.json<{ title?: string; startDate?: string; endDate?: string; theme?: string; coverImageUrl?: string; budget?: number | null; colorLabel?: string | null }>();

  const existing = await c.env.DB.prepare(
    'SELECT id, user_id as userId, title, start_date as startDate, end_date as endDate, theme, budget, color_label as colorLabel, cover_image_url as coverImageUrl FROM trips WHERE id = ?'
  ).bind(id).first<{ id: string; userId: string | null; title: string; startDate: string | null; endDate: string | null; theme: string; budget: number | null; colorLabel: string | null; coverImageUrl: string | null }>();

  if (!existing) {
    return c.json({ error: 'Trip not found' }, 404);
  }

  // Check ownership
  if (existing.userId && (!user || existing.userId !== user.id)) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  // Validate theme if provided
  const theme = body.theme !== undefined
    ? (body.theme === 'photo' ? 'photo' : body.theme === 'retro' ? 'retro' : body.theme === 'natural' ? 'natural' : 'quiet')
    : null;

  // Handle budget - allow explicit null to clear it
  const budgetValue = body.budget === null ? null : (body.budget ?? undefined);

  // Validate and handle color label - allow explicit null to clear it
  const validColorLabels = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'gray'];
  const colorLabelValue = body.colorLabel === null
    ? null
    : (body.colorLabel && validColorLabels.includes(body.colorLabel) ? body.colorLabel : undefined);

  await c.env.DB.prepare(
    `UPDATE trips SET
      title = COALESCE(?, title),
      start_date = COALESCE(?, start_date),
      end_date = COALESCE(?, end_date),
      theme = COALESCE(?, theme),
      cover_image_url = COALESCE(?, cover_image_url),
      budget = CASE WHEN ?1 = 1 THEN ?2 ELSE COALESCE(?2, budget) END,
      color_label = CASE WHEN ?3 = 1 THEN ?4 ELSE COALESCE(?4, color_label) END,
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
    body.colorLabel === null ? 1 : 0,
    colorLabelValue === undefined ? null : colorLabelValue,
    id
  ).run();

  // Record history with coalescing
  if (user) {
    const changes: Record<string, { old: unknown; new: unknown }> = {};
    if (body.title && body.title.trim() !== existing.title) {
      changes['title'] = { old: existing.title, new: body.title.trim() };
    }
    if (body.startDate !== undefined && body.startDate !== existing.startDate) {
      changes['startDate'] = { old: existing.startDate, new: body.startDate };
    }
    if (body.endDate !== undefined && body.endDate !== existing.endDate) {
      changes['endDate'] = { old: existing.endDate, new: body.endDate };
    }
    if (theme !== null && theme !== existing.theme) {
      changes['theme'] = { old: existing.theme, new: theme };
    }
    if (body.budget !== undefined) {
      const newBudget = body.budget === null ? null : body.budget;
      if (newBudget !== existing.budget) {
        changes['budget'] = { old: existing.budget, new: newBudget };
      }
    }
    if (body.colorLabel !== undefined) {
      const newLabel = body.colorLabel === null ? null : (colorLabelValue === undefined ? existing.colorLabel : colorLabelValue);
      if (newLabel !== existing.colorLabel) {
        changes['colorLabel'] = { old: existing.colorLabel, new: newLabel };
      }
    }

    if (Object.keys(changes).length > 0) {
      // Check for recent coalescable entry (within 60 seconds)
      const recentEntry = await c.env.DB.prepare(
        `SELECT id, changes FROM trip_history
         WHERE trip_id = ? AND user_id = ? AND action = 'trip.update'
         AND created_at > strftime('%Y-%m-%dT%H:%M:%fZ', datetime('now', '-60 seconds'))
         ORDER BY created_at DESC LIMIT 1`
      ).bind(id, user.id).first<{ id: string; changes: string | null }>();

      if (recentEntry) {
        const existingChanges: Record<string, { old: unknown; new: unknown }> = recentEntry.changes ? JSON.parse(recentEntry.changes) : {};
        for (const [key, val] of Object.entries(changes)) {
          if (existingChanges[key]) {
            existingChanges[key].new = val.new;
          } else {
            existingChanges[key] = val;
          }
        }
        // Remove entries where old === new (user reverted)
        for (const key of Object.keys(existingChanges)) {
          if (JSON.stringify(existingChanges[key].old) === JSON.stringify(existingChanges[key].new)) {
            delete existingChanges[key];
          }
        }
        if (Object.keys(existingChanges).length > 0) {
          const newSnapshot = await buildTripSnapshot(c.env.DB, id);
          await c.env.DB.prepare(
            `UPDATE trip_history SET changes = ?, snapshot = ?,
             summary = ?, created_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
             WHERE id = ?`
          ).bind(JSON.stringify(existingChanges), newSnapshot,
            buildChangeSummary(existingChanges), recentEntry.id).run();
        } else {
          await c.env.DB.prepare('DELETE FROM trip_history WHERE id = ?')
            .bind(recentEntry.id).run();
        }
      } else {
        await recordTripHistory(c.env.DB, id, user.id, user.name, 'trip.update',
          'trip', id, buildChangeSummary(changes), changes, true);
      }
    }
  }

  const trip = await c.env.DB.prepare(
    'SELECT id, title, start_date as startDate, end_date as endDate, theme, cover_image_url as coverImageUrl, budget, color_label as colorLabel, created_at as createdAt, updated_at as updatedAt FROM trips WHERE id = ?'
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
    'SELECT id, title, start_date as startDate, end_date as endDate, theme, cover_image_url as coverImageUrl, budget, color_label as colorLabel, user_id as userId FROM trips WHERE id = ?'
  ).bind(id).first<{
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
    'INSERT INTO trips (id, title, start_date, end_date, theme, cover_image_url, budget, color_label, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(newTripId, newTitle, original.startDate, original.endDate, original.theme, original.coverImageUrl, original.budget, original.colorLabel, user.id).run();

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

  if (user) {
    await recordTripHistory(c.env.DB, tripId, user.id, user.name, 'day.create',
      'day', id, `「${body.date}」の日程を追加`, null, true);
  }

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

  if (user && createdDays.length > 0) {
    await recordTripHistory(c.env.DB, tripId, user.id, user.name, 'days.generate',
      'trip', tripId, `${createdDays.length}日分の日程を一括追加`, null, true);
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
    'SELECT id, date FROM days WHERE id = ? AND trip_id = ?'
  ).bind(dayId, tripId).first<{ id: string; date: string }>();

  if (!existing) {
    return c.json({ error: 'Day not found' }, 404);
  }

  await c.env.DB.prepare('DELETE FROM days WHERE id = ?').bind(dayId).run();

  if (user) {
    await recordTripHistory(c.env.DB, tripId, user.id, user.name, 'day.delete',
      'day', dayId, `「${existing.date}」の日程を削除`, null, true);
  }

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

  if (user) {
    await recordTripHistory(c.env.DB, tripId, user.id, user.name, 'item.create',
      'item', id, `「${body.title.trim()}」を追加`, null, true);
  }

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
    'SELECT id, title, area, time_start as timeStart, time_end as timeEnd, map_url as mapUrl, note, cost, cost_category as costCategory FROM items WHERE id = ? AND trip_id = ?'
  ).bind(itemId, tripId).first<{ id: string; title: string; area: string | null; timeStart: string | null; timeEnd: string | null; mapUrl: string | null; note: string | null; cost: number | null; costCategory: string | null }>();

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

  if (user) {
    const itemChanges: Record<string, { old: unknown; new: unknown }> = {};
    if (body.title && body.title !== existing.title) itemChanges['title'] = { old: existing.title, new: body.title };
    if (body.area !== undefined && body.area !== existing.area) itemChanges['area'] = { old: existing.area, new: body.area };
    if (body.timeStart !== undefined && body.timeStart !== existing.timeStart) itemChanges['timeStart'] = { old: existing.timeStart, new: body.timeStart };
    if (body.timeEnd !== undefined && body.timeEnd !== existing.timeEnd) itemChanges['timeEnd'] = { old: existing.timeEnd, new: body.timeEnd };
    if (body.note !== undefined && body.note !== existing.note) itemChanges['note'] = { old: existing.note, new: body.note };
    if (body.cost !== undefined && body.cost !== existing.cost) itemChanges['cost'] = { old: existing.cost, new: body.cost };

    if (Object.keys(itemChanges).length > 0) {
      const itemTitle = body.title || existing.title;
      const recentEntry = await c.env.DB.prepare(
        `SELECT id, changes FROM trip_history
         WHERE trip_id = ? AND user_id = ? AND action = 'item.update' AND entity_id = ?
         AND created_at > strftime('%Y-%m-%dT%H:%M:%fZ', datetime('now', '-60 seconds'))
         ORDER BY created_at DESC LIMIT 1`
      ).bind(tripId, user.id, itemId).first<{ id: string; changes: string | null }>();

      if (recentEntry) {
        const prev: Record<string, { old: unknown; new: unknown }> = recentEntry.changes ? JSON.parse(recentEntry.changes) : {};
        for (const [key, val] of Object.entries(itemChanges)) {
          if (prev[key]) { prev[key].new = val.new; } else { prev[key] = val; }
        }
        for (const key of Object.keys(prev)) {
          if (JSON.stringify(prev[key].old) === JSON.stringify(prev[key].new)) delete prev[key];
        }
        if (Object.keys(prev).length > 0) {
          await c.env.DB.prepare(
            `UPDATE trip_history SET changes = ?, summary = ?, created_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`
          ).bind(JSON.stringify(prev), `「${itemTitle}」を更新`, recentEntry.id).run();
        } else {
          await c.env.DB.prepare('DELETE FROM trip_history WHERE id = ?').bind(recentEntry.id).run();
        }
      } else {
        await recordTripHistory(c.env.DB, tripId, user.id, user.name, 'item.update',
          'item', itemId, `「${itemTitle}」を更新`, itemChanges, false);
      }
    }
  }

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
    'SELECT id, title FROM items WHERE id = ? AND trip_id = ?'
  ).bind(itemId, tripId).first<{ id: string; title: string }>();

  if (!existing) {
    return c.json({ error: 'Item not found' }, 404);
  }

  await c.env.DB.prepare('DELETE FROM items WHERE id = ?').bind(itemId).run();

  if (user) {
    await recordTripHistory(c.env.DB, tripId, user.id, user.name, 'item.delete',
      'item', itemId, `「${existing.title}」を削除`, null, true);
  }

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

  if (user) {
    await recordTripHistory(c.env.DB, tripId, user.id, user.name, 'day.reorder',
      'day', dayId, '予定の順序を変更', null, true);
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

  if (user) {
    await recordTripHistory(c.env.DB, tripId, user.id, user.name, 'item.reorder',
      'item', itemId, '予定を別の日に移動', null, true);
  }

  return c.json({ ok: true });
});

// ============ Trip History ============

// Get trip history
app.get('/api/trips/:tripId/history', async (c) => {
  const tripId = c.req.param('tripId');
  const user = c.get('user');
  const url = new URL(c.req.url);
  const cursor = url.searchParams.get('cursor');
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '30'), 50);

  const check = await checkCanEditTrip(c.env.DB, tripId, user);
  if (!check.ok) {
    return c.json({ error: check.error }, check.status as 403 | 404);
  }

  let query = `SELECT id, user_id as userId, user_name as userName, action,
    entity_type as entityType, entity_id as entityId, summary, changes,
    CASE WHEN snapshot IS NOT NULL THEN 1 ELSE 0 END as hasSnapshot,
    created_at as createdAt
    FROM trip_history WHERE trip_id = ?`;
  const bindings: unknown[] = [tripId];

  if (cursor) {
    query += ' AND created_at < ?';
    bindings.push(cursor);
  }

  query += ' ORDER BY created_at DESC LIMIT ?';
  bindings.push(limit + 1);

  const stmt = c.env.DB.prepare(query);
  const { results } = bindings.length === 2
    ? await stmt.bind(bindings[0], bindings[1]).all()
    : await stmt.bind(bindings[0], bindings[1], bindings[2]).all();

  const hasMore = results.length > limit;
  const entries = results.slice(0, limit);

  return c.json({
    entries,
    hasMore,
    nextCursor: hasMore ? (entries[entries.length - 1] as Record<string, unknown>).createdAt : null,
  });
});

// Restore trip from history snapshot
app.post('/api/trips/:tripId/history/:historyId/restore', async (c) => {
  const { tripId, historyId } = c.req.param();
  const user = c.get('user');

  const check = await checkTripOwnership(c.env.DB, tripId, user);
  if (!check.ok) {
    return c.json({ error: check.error }, check.status as 403 | 404);
  }

  const entry = await c.env.DB.prepare(
    'SELECT snapshot, created_at as createdAt FROM trip_history WHERE id = ? AND trip_id = ?'
  ).bind(historyId, tripId).first<{ snapshot: string | null; createdAt: string }>();

  if (!entry || !entry.snapshot) {
    return c.json({ error: 'スナップショットが見つかりません' }, 404);
  }

  const snapshot = JSON.parse(entry.snapshot) as {
    trip: { title: string; start_date: string | null; end_date: string | null; theme: string; cover_image_url: string | null; budget: number | null; color_label: string | null };
    days: Array<{ id: string; date: string; sort: number; notes: string | null }>;
    items: Array<{ id: string; day_id: string; title: string; area: string | null; time_start: string | null; time_end: string | null; map_url: string | null; note: string | null; cost: number | null; cost_category: string | null; sort: number; photo_url: string | null }>;
  };

  // Record pre-restore state
  await recordTripHistory(c.env.DB, tripId, user!.id, user!.name,
    'trip.restore', 'trip', tripId,
    `${entry.createdAt.slice(0, 16).replace('T', ' ')}時点の状態に復元`,
    null, true);

  // Delete existing days and items (CASCADE handles items)
  await c.env.DB.prepare('DELETE FROM days WHERE trip_id = ?').bind(tripId).run();

  // Restore trip metadata
  const t = snapshot.trip;
  await c.env.DB.prepare(
    `UPDATE trips SET title = ?, start_date = ?, end_date = ?, theme = ?,
     cover_image_url = ?, budget = ?, color_label = ?,
     updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
     WHERE id = ?`
  ).bind(t.title, t.start_date, t.end_date, t.theme,
    t.cover_image_url, t.budget, t.color_label, tripId).run();

  // Restore days
  for (const day of snapshot.days) {
    await c.env.DB.prepare(
      'INSERT INTO days (id, trip_id, date, sort, notes) VALUES (?, ?, ?, ?, ?)'
    ).bind(day.id, tripId, day.date, day.sort, day.notes).run();
  }

  // Restore items
  for (const item of snapshot.items) {
    await c.env.DB.prepare(
      `INSERT INTO items (id, trip_id, day_id, title, area, time_start, time_end,
       map_url, note, cost, cost_category, sort, photo_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(item.id, tripId, item.day_id, item.title, item.area,
      item.time_start, item.time_end, item.map_url, item.note,
      item.cost, item.cost_category, item.sort, item.photo_url).run();
  }

  return c.json({ success: true });
});


// Share Tokens, Collaborators, Calendar Export routes (extracted to ./routes/sharing.ts)
app.route('/', sharingRoutes);

// ============ Data Export (JSON/CSV) ============

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
  const theme = importData.trip.theme === 'photo' ? 'photo' : importData.trip.theme === 'retro' ? 'retro' : importData.trip.theme === 'natural' ? 'natural' : 'quiet';
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

  const photoId = crypto.randomUUID();
  const ext = contentType.split('/')[1] || 'jpg';
  const key = `photos/items/${itemId}/${photoId}.${ext}`;

  try {
    const body = await c.req.arrayBuffer();
    await c.env.COVERS.put(key, body, {
      httpMetadata: {
        contentType,
      },
    });

    const url = new URL(c.req.url);
    const photoUrl = `${url.origin}/api/photos/items/${itemId}/${photoId}.${ext}`;

    // Insert into item_photos table
    await c.env.DB.prepare(
      `INSERT INTO item_photos (id, item_id, trip_id, photo_url, uploaded_by, uploaded_by_name, uploaded_at)
       VALUES (?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ','now'))`
    ).bind(photoId, itemId, tripId, photoUrl, user.id, user.name || user.email || null).run();

    // Update item with photo URL and uploader info (backward compatibility)
    await c.env.DB.prepare(
      `UPDATE items SET
        photo_url = ?,
        photo_uploaded_by = ?,
        photo_uploaded_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE id = ?`
    ).bind(photoUrl, user?.id || null, itemId).run();

    return c.json({ photoId, photoUrl }, 201);
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

    // Delete from item_photos
    await c.env.DB.prepare(
      'DELETE FROM item_photos WHERE item_id = ? AND photo_url = ?'
    ).bind(itemId, item.photoUrl).run();
  }

  // Set items.photo_url to latest remaining photo
  const latestPhoto = await c.env.DB.prepare(
    'SELECT photo_url FROM item_photos WHERE item_id = ? ORDER BY uploaded_at DESC LIMIT 1'
  ).bind(itemId).first<{ photo_url: string }>();

  await c.env.DB.prepare(
    'UPDATE items SET photo_url = ?, photo_uploaded_by = NULL, photo_uploaded_at = NULL, updated_at = strftime(\'%Y-%m-%dT%H:%M:%fZ\',\'now\') WHERE id = ?'
  ).bind(latestPhoto?.photo_url || null, itemId).run();

  return c.json({ ok: true });
});

// Delete a specific photo from item_photos
app.delete('/api/trips/:tripId/items/:itemId/photos/:photoId', async (c) => {
  const { tripId, itemId, photoId } = c.req.param();
  const user = c.get('user');
  if (!user) return c.json({ error: 'Unauthorized' }, 401);

  const check = await checkCanEditTrip(c.env.DB, tripId, user);
  if (!check.ok) return c.json({ error: check.error }, check.status as 403 | 404);

  const photo = await c.env.DB.prepare(
    'SELECT id, photo_url, uploaded_by FROM item_photos WHERE id = ? AND item_id = ?'
  ).bind(photoId, itemId).first<{ id: string; photo_url: string; uploaded_by: string | null }>();

  if (!photo) return c.json({ error: 'Photo not found' }, 404);

  // Only photo uploader or trip owner can delete
  const isOwner = check.isOwner;
  if (photo.uploaded_by !== user.id && !isOwner) {
    return c.json({ error: '削除権限がありません' }, 403);
  }

  // Delete from R2
  const urlParts = photo.photo_url.split('/api/photos/items/');
  if (urlParts[1]) {
    const key = `photos/items/${urlParts[1]}`;
    try { await c.env.COVERS.delete(key); } catch { /* ignore R2 errors */ }
  }

  // Delete from DB
  await c.env.DB.prepare('DELETE FROM item_photos WHERE id = ?').bind(photoId).run();

  // Update items.photo_url to latest remaining or null
  const latestPhoto = await c.env.DB.prepare(
    'SELECT photo_url FROM item_photos WHERE item_id = ? ORDER BY uploaded_at DESC LIMIT 1'
  ).bind(itemId).first<{ photo_url: string }>();

  await c.env.DB.prepare(
    'UPDATE items SET photo_url = ? WHERE id = ? AND trip_id = ?'
  ).bind(latestPhoto?.photo_url || null, itemId, tripId).run();

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

  // Check and deduct credits
  const creditCheck = await checkAndDeductCredits(c.env.DB, user.id, ip, 'suggestions');
  if (!creditCheck.ok) {
    return c.json({ error: creditCheck.error, limitReached: true, remaining: 0 }, creditCheck.status as 429);
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

    return c.json({
      suggestions: suggestionsData.suggestions || [],
      remaining: creditCheck.creditsRemaining,
      creditCost: AI_CREDIT_COSTS.suggestions,
    });
  } catch (error) {
    console.error('AI suggestion error:', error);
    return c.json({ error: '周辺スポットの提案に失敗しました' }, 500);
  }
});

// ============ Route Optimization (AI-powered) ============

// Optimize route for a day
app.post('/api/trips/:tripId/days/:dayId/optimize', async (c) => {
  const { tripId, dayId } = c.req.param();
  const user = c.get('user');
  const ip = getClientIp(c);

  // Require login for AI route optimization
  if (!user) {
    return c.json({ error: 'ルート最適化にはログインが必要です' }, 401);
  }

  // Check and deduct credits
  const creditCheck = await checkAndDeductCredits(c.env.DB, user.id, ip, 'optimize');
  if (!creditCheck.ok) {
    return c.json({ error: creditCheck.error, limitReached: true, remaining: 0 }, creditCheck.status as 429);
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
        try {
          locationHint = decodeURIComponent(match[1]) || locationHint;
        } catch {
          // Invalid percent-encoding, use as-is or fallback to area
          locationHint = match[1] || locationHint;
        }
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

    return c.json({
      originalOrder: items.map(item => ({
        id: item.id,
        title: item.title,
        area: item.area,
      })),
      optimizedOrder: optimizationData.optimizedOrder,
      totalSavings: optimizationData.totalSavings || '移動効率が向上します',
      warnings: optimizationData.warnings || [],
      remaining: creditCheck.creditsRemaining,
      creditCost: AI_CREDIT_COSTS.optimize,
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

  // Check for duplicates in itemIds
  const uniqueIds = new Set(body.itemIds);
  if (uniqueIds.size !== body.itemIds.length) {
    return c.json({ error: 'Duplicate item IDs are not allowed' }, 400);
  }

  // Get all items for this day to ensure complete permutation
  const { results: dayItems } = await c.env.DB.prepare(
    'SELECT id FROM items WHERE day_id = ? AND trip_id = ?'
  ).bind(dayId, tripId).all<{ id: string }>();

  const dayItemIds = new Set(dayItems.map(item => item.id));

  // Check that itemIds is exactly the same set as day's items
  if (body.itemIds.length !== dayItems.length) {
    return c.json({ error: 'itemIds must include all items for this day' }, 400);
  }

  const invalidIds = body.itemIds.filter(id => !dayItemIds.has(id));
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

// Get item photo (legacy single-photo format)
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

// Get item photo (multi-photo format)
app.get('/api/photos/items/:itemId/:key', async (c) => {
  const { itemId, key } = c.req.param();
  const fullKey = `photos/items/${itemId}/${key}`;

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

// Templates routes (extracted to ./routes/templates.ts)
app.route('/', templatesRoutes);

// Feedback routes (extracted to ./routes/feedback.ts)
app.route('/', feedbackRoutes);

// ============ AI Trip Generation ============

// Get AI credit info for a user
app.get('/api/ai/usage', async (c) => {
  const user = c.get('user');

  if (!user) {
    return c.json({
      credits: 0,
      maxCredits: AI_MONTHLY_CREDITS,
      costs: AI_CREDIT_COSTS,
      resetDate: null,
      loggedIn: false,
    });
  }

  const userData = await c.env.DB.prepare(
    'SELECT ai_credits, credits_reset_at FROM users WHERE id = ?'
  ).bind(user.id).first<{ ai_credits: number; credits_reset_at: string }>();

  let credits = userData?.ai_credits ?? AI_MONTHLY_CREDITS;
  const resetAt = userData?.credits_reset_at ? new Date(userData.credits_reset_at) : new Date();
  const now = new Date();

  // Monthly reset check
  if (now.getUTCFullYear() > resetAt.getUTCFullYear() ||
      (now.getUTCFullYear() === resetAt.getUTCFullYear() && now.getUTCMonth() > resetAt.getUTCMonth())) {
    credits = AI_MONTHLY_CREDITS;
    await c.env.DB.prepare(
      "UPDATE users SET ai_credits = ?, credits_reset_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?"
    ).bind(AI_MONTHLY_CREDITS, user.id).run();
  }

  const nextReset = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

  return c.json({
    credits,
    maxCredits: AI_MONTHLY_CREDITS,
    costs: AI_CREDIT_COSTS,
    resetDate: nextReset.toISOString().split('T')[0],
    loggedIn: true,
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

  // Check and deduct credits
  const creditCheck = await checkAndDeductCredits(c.env.DB, user.id, ip, 'generate');
  if (!creditCheck.ok) {
    return c.json({ error: creditCheck.error, limitReached: true, remaining: 0 }, creditCheck.status as 429);
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

    // Fetch the created trip
    const trip = await c.env.DB.prepare(
      'SELECT id, title, start_date as startDate, end_date as endDate, theme, created_at as createdAt FROM trips WHERE id = ?'
    ).bind(tripId).first();

    return c.json({ trip, tripId, remaining: creditCheck.creditsRemaining, creditCost: AI_CREDIT_COSTS.generate }, 201);
  } catch (error) {
    console.error('AI generation error:', error);
    return c.json({ error: 'AIによる旅程生成に失敗しました' }, 500);
  }
});

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

// Expenses/Settlement/Payment routes (extracted to ./routes/expenses.ts)
app.route('/', expensesRoutes);

// Packing routes (extracted to ./routes/packing.ts)
app.route('/', packingRoutes);

// Item templates are in ./routes/templates.ts

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


// SPA routes - serve index.html for client-side routing
const spaRoutes = ['/trips', '/trips/', '/login', '/contact', '/invite', '/profile'];

app.get('*', async (c) => {
  const url = new URL(c.req.url);
  const path = url.pathname;

  // Check if this is a SPA route that needs index.html
  const isSpaRoute = spaRoutes.some(route => path.startsWith(route)) ||
    path === '/' ||
    path.match(/^\/trips\/[^/]+$/) ||  // /trips/:id
    path.match(/^\/trips\/[^/]+\/edit$/) ||  // /trips/:id/edit
    path.match(/^\/trips\/[^/]+\/album$/) ||  // /trips/:id/album
    path.match(/^\/invite\/[^/]+$/);  // /invite/:token

  if (isSpaRoute) {
    url.pathname = '/index.html';
    return c.env.ASSETS.fetch(new Request(url.toString(), c.req.raw));
  }

  // Serve static assets
  return c.env.ASSETS.fetch(c.req.raw);
});

export default app;
