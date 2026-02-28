import { Hono } from 'hono';
import type { AppEnv } from '../worker-types';
import { generateId } from '../auth/session';

const app = new Hono<AppEnv>();

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

    if (!trip?.user_id || trip.user_id === user.id) {
      hasAccess = true;
    } else {
      const collab = await c.env.DB.prepare(
        'SELECT id FROM trip_collaborators WHERE trip_id = ? AND user_id = ?'
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
    'SELECT id, trip_id, name, category, is_checked, sort, created_at, updated_at FROM packing_items WHERE trip_id = ? ORDER BY category, sort, created_at'
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

  let canEdit = !trip.user_id || trip.user_id === user.id;
  if (!canEdit) {
    const collab = await c.env.DB.prepare(
      "SELECT role FROM trip_collaborators WHERE trip_id = ? AND user_id = ? AND role IN ('owner', 'editor')"
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
    'SELECT id, trip_id, name, category, is_checked, sort, created_at, updated_at FROM packing_items WHERE id = ?'
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

  let canEdit = !trip.user_id || trip.user_id === user.id;
  if (!canEdit) {
    const collab = await c.env.DB.prepare(
      "SELECT role FROM trip_collaborators WHERE trip_id = ? AND user_id = ? AND role IN ('owner', 'editor')"
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
    'SELECT id, trip_id, name, category, is_checked, sort, created_at, updated_at FROM packing_items WHERE id = ?'
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

  let canEdit = !trip.user_id || trip.user_id === user.id;
  if (!canEdit) {
    const collab = await c.env.DB.prepare(
      "SELECT role FROM trip_collaborators WHERE trip_id = ? AND user_id = ? AND role IN ('owner', 'editor')"
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

  let canEdit = !trip.user_id || trip.user_id === user.id;
  if (!canEdit) {
    const collab = await c.env.DB.prepare(
      "SELECT role FROM trip_collaborators WHERE trip_id = ? AND user_id = ? AND role IN ('owner', 'editor')"
    ).bind(tripId, user.id).first();
    canEdit = !!collab;
  }

  if (!canEdit) return c.json({ error: 'Forbidden' }, 403);

  const body = await c.req.json<{ items: { id: string; sort: number; category?: string }[] }>();

  if (!Array.isArray(body.items) || body.items.length > 200) {
    return c.json({ error: 'Invalid or too many items (max 200)' }, 400);
  }

  const packingStatements = body.items.map((item) =>
    item.category !== undefined
      ? c.env.DB.prepare(
          'UPDATE packing_items SET sort = ?, category = ? WHERE id = ? AND trip_id = ?'
        ).bind(item.sort, item.category, item.id, tripId)
      : c.env.DB.prepare(
          'UPDATE packing_items SET sort = ? WHERE id = ? AND trip_id = ?'
        ).bind(item.sort, item.id, tripId)
  );
  await c.env.DB.batch(packingStatements);

  return c.json({ success: true });
});

export default app;
