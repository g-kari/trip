import { Hono } from 'hono';
import type { AppEnv } from '../worker-types';
import { generateId } from '../auth/session';
import { checkTripOwnership, safeJsonParse } from '../helpers';

const app = new Hono<AppEnv>();

// ============ Templates ============

// Get all public templates
app.get('/api/templates', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT id, title, start_date as startDate, end_date as endDate, theme, cover_image_url as coverImageUrl, template_uses as templateUses, created_at as createdAt
     FROM trips
     WHERE is_template = 1
     ORDER BY template_uses DESC, created_at DESC LIMIT 100`
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
    daysData: (safeJsonParse(t.daysData) || []) as TripTemplateDay[],
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

  // Limit public templates per user
  if (body.isPublic) {
    const publicCount = await c.env.DB.prepare(
      'SELECT COUNT(*) as count FROM trip_templates WHERE user_id = ? AND is_public = 1'
    ).bind(user.id).first<{ count: number }>();
    if (publicCount && publicCount.count >= 5) {
      return c.json({ error: '公開テンプレートは5件までです' }, 400);
    }
  }

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
    `SELECT id, user_id as userId, name, theme, days_data as daysData, is_public as isPublic
     FROM trip_templates WHERE id = ?`
  ).bind(templateId).first<{
    id: string;
    userId: string;
    name: string;
    theme: string;
    daysData: string;
    isPublic: number;
  }>();

  if (!template) {
    return c.json({ error: 'テンプレートが見つかりません' }, 404);
  }

  // Owner can use their own templates; others can only use public ones
  if (template.userId !== user.id && !template.isPublic) {
    return c.json({ error: 'アクセスが拒否されました' }, 403);
  }

  const rawDaysData = safeJsonParse(template.daysData);
  const daysData: TripTemplateDay[] = Array.isArray(rawDaysData)
    ? rawDaysData.filter((d): d is TripTemplateDay => d && Array.isArray(d.items))
    : [];

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

export default app;
