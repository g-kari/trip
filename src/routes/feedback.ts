import { Hono } from 'hono';
import type { AppEnv } from '../worker-types';
import { generateId } from '../auth/session';
import { checkTripOwnership } from '../helpers';

const app = new Hono<AppEnv>();

// ============ Feedback ============

// Submit feedback (public endpoint, rate limited)
app.post('/api/feedback', async (c) => {
  const body = await c.req.json<{ name?: string; message: string }>();

  if (!body.message?.trim()) {
    return c.json({ error: 'Message is required' }, 400);
  }

  // Rate limit: max 10 feedback per day
  const todayStart = new Date().toISOString().split('T')[0] + 'T00:00:00.000Z';
  const dailyCount = await c.env.DB.prepare(
    'SELECT COUNT(*) as count FROM feedback WHERE created_at >= ?'
  ).bind(todayStart).first<{ count: number }>();
  if (dailyCount && dailyCount.count >= 50) {
    return c.json({ error: '本日のフィードバック上限に達しました' }, 429);
  }

  const id = generateId();
  const name = body.name?.trim() || '匿名';

  await c.env.DB.prepare(
    'INSERT INTO feedback (id, name, message) VALUES (?, ?, ?)'
  ).bind(id, name, body.message.trim()).run();

  return c.json({ ok: true }, 201);
});

// Get all feedback as JSON (requires auth)
app.get('/api/feedback.json', async (c) => {
  const user = c.get('user');
  if (!user) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const { results } = await c.env.DB.prepare(
    'SELECT id, name, message, created_at as createdAt FROM feedback ORDER BY created_at DESC'
  ).all();

  return c.json({ feedback: results });
});

// ============ Trip Feedback (Ratings & Reviews) ============

// Get trip feedback list with average rating
app.get('/api/trips/:tripId/feedback', async (c) => {
  const tripId = c.req.param('tripId');
  const user = c.get('user');

  // Check if trip exists and user has access
  const trip = await c.env.DB.prepare(
    'SELECT id, user_id as userId FROM trips WHERE id = ?'
  ).bind(tripId).first<{ id: string; userId: string | null }>();

  if (!trip) {
    return c.json({ error: 'Trip not found' }, 404);
  }

  // Require ownership, collaborator access, or legacy trip
  const isOwnerOrLegacy = !trip.userId || (user && trip.userId === user.id);
  let hasAccess = !!isOwnerOrLegacy;
  if (!hasAccess && user) {
    const collab = await c.env.DB.prepare(
      'SELECT id FROM trip_collaborators WHERE trip_id = ? AND user_id = ?'
    ).bind(tripId, user.id).first();
    hasAccess = !!collab;
  }
  if (!hasAccess) {
    return c.json({ error: 'Forbidden' }, 403);
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

  // Strip userId, replace with isCurrentUser flag
  const enriched = feedbackList.map(fb => ({
    id: fb.id,
    name: fb.name,
    rating: fb.rating,
    comment: fb.comment,
    createdAt: fb.createdAt,
    isCurrentUser: !!(user && fb.userId === user.id),
  }));

  // Calculate average rating
  const totalRating = feedbackList.reduce((sum, fb) => sum + fb.rating, 0);
  const averageRating = feedbackList.length > 0 ? totalRating / feedbackList.length : 0;

  return c.json({
    feedback: enriched,
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
  if (!body.rating || !Number.isInteger(body.rating) || body.rating < 1 || body.rating > 5) {
    return c.json({ error: '評価は1〜5の間で指定してください' }, 400);
  }

  // Check if trip exists
  const trip = await c.env.DB.prepare(
    'SELECT id, user_id as userId FROM trips WHERE id = ?'
  ).bind(tripId).first<{ id: string; userId: string | null }>();

  if (!trip) {
    return c.json({ error: 'Trip not found' }, 404);
  }

  // Check access: trip must be shared, legacy, or user is owner/collaborator
  const hasShareToken = await c.env.DB.prepare(
    'SELECT id FROM share_tokens WHERE trip_id = ? AND is_active = 1'
  ).bind(tripId).first();
  let hasAccess = !!hasShareToken || !trip.userId;
  if (!hasAccess && user) {
    hasAccess = trip.userId === user.id;
    if (!hasAccess) {
      const collab = await c.env.DB.prepare(
        'SELECT id FROM trip_collaborators WHERE trip_id = ? AND user_id = ?'
      ).bind(tripId, user.id).first();
      hasAccess = !!collab;
    }
  }
  if (!hasAccess) {
    return c.json({ error: 'アクセス権がありません' }, 403);
  }

  // For logged-in users, prevent duplicate feedback
  if (user) {
    const existing = await c.env.DB.prepare(
      'SELECT id FROM trip_feedback WHERE trip_id = ? AND user_id = ?'
    ).bind(tripId, user.id).first();

    if (existing) {
      return c.json({ error: '既にフィードバックを投稿しています' }, 409);
    }
  } else {
    // For anonymous users, limit to 5 per trip per day
    const todayStart = new Date().toISOString().split('T')[0] + 'T00:00:00.000Z';
    const anonCount = await c.env.DB.prepare(
      'SELECT COUNT(*) as count FROM trip_feedback WHERE trip_id = ? AND user_id IS NULL AND created_at >= ?'
    ).bind(tripId, todayStart).first<{ count: number }>();
    if (anonCount && anonCount.count >= 5) {
      return c.json({ error: '本日の匿名フィードバック上限に達しました' }, 429);
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
    'SELECT trip_id FROM share_tokens WHERE token = ? AND is_active = 1'
  ).bind(token).first<{ trip_id: string }>();

  if (!share) {
    return c.json({ error: 'Invalid share link' }, 404);
  }

  const tripId = share.trip_id;

  // Get all feedback for this trip
  const { results: feedbackList } = await c.env.DB.prepare(
    `SELECT id, name, rating, comment, created_at as createdAt
     FROM trip_feedback
     WHERE trip_id = ?
     ORDER BY created_at DESC`
  ).bind(tripId).all<{
    id: string;
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
  if (!body.rating || !Number.isInteger(body.rating) || body.rating < 1 || body.rating > 5) {
    return c.json({ error: '評価は1〜5の間で指定してください' }, 400);
  }

  const share = await c.env.DB.prepare(
    'SELECT trip_id FROM share_tokens WHERE token = ? AND is_active = 1'
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
  } else {
    // For anonymous users, limit to 5 per trip per day
    const todayStart = new Date().toISOString().split('T')[0] + 'T00:00:00.000Z';
    const anonCount = await c.env.DB.prepare(
      'SELECT COUNT(*) as count FROM trip_feedback WHERE trip_id = ? AND user_id IS NULL AND created_at >= ?'
    ).bind(tripId, todayStart).first<{ count: number }>();
    if (anonCount && anonCount.count >= 5) {
      return c.json({ error: '本日の匿名フィードバック上限に達しました' }, 429);
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

export default app;
