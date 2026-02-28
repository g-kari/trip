/// <reference types="@cloudflare/workers-types" />
import { generateId } from './auth/session';
import type { User } from './auth/types';
import type { WeatherInfo } from './worker-types';

// ============ Safe JSON ============

// Helper to safely parse JSON without throwing
export function safeJsonParse(value: string | null | undefined): unknown {
  if (!value) return null;
  try { return JSON.parse(value); }
  catch { return null; }
}

// ============ Trip Data Enrichment ============

// Raw row types from D1 queries
interface RawDay { id: string; date: string; sort: number; notes: string | null; photos: string | null }
interface RawItem {
  id: string; dayId: string; title: string; area: string | null;
  timeStart: string | null; timeEnd: string | null; mapUrl: string | null;
  note: string | null; cost: number | null; costCategory: string | null; sort: number; photoUrl: string | null;
  photoUploadedBy: string | null; photoUploadedAt: string | null;
  checkedInAt: string | null; checkedInLocation: string | null;
}
interface RawDayPhoto {
  id: string; dayId: string; photoUrl: string;
  uploadedBy: string | null; uploadedByName: string | null; uploadedAt: string | null;
}
interface RawItemPhoto {
  id: string; itemId: string; photoUrl: string;
  uploadedBy: string | null; uploadedByName: string | null; uploadedAt: string | null;
}

interface PhotoEntry {
  id: string; photoUrl: string; uploadedBy: string | null;
  uploadedByName: string | null; uploadedAt: string | null;
}

// Fetch and enrich trip days/items/photos data (shared between trip view & shared trip endpoints)
export async function enrichTripData(db: D1Database, tripId: string) {
  const { results: days } = await db.prepare(
    'SELECT id, date, sort, notes, photos FROM days WHERE trip_id = ? ORDER BY sort ASC'
  ).bind(tripId).all<RawDay>();

  const { results: items } = await db.prepare(
    `SELECT id, day_id as dayId, title, area, time_start as timeStart, time_end as timeEnd,
     map_url as mapUrl, note, cost, cost_category as costCategory, sort, photo_url as photoUrl,
     photo_uploaded_by as photoUploadedBy, photo_uploaded_at as photoUploadedAt,
     checked_in_at as checkedInAt, checked_in_location as checkedInLocation
     FROM items WHERE trip_id = ? ORDER BY sort ASC`
  ).bind(tripId).all<RawItem>();

  const { results: dayPhotos } = await db.prepare(
    `SELECT id, day_id as dayId, photo_url as photoUrl, uploaded_by as uploadedBy,
     uploaded_by_name as uploadedByName, uploaded_at as uploadedAt
     FROM day_photos WHERE trip_id = ? ORDER BY uploaded_at ASC`
  ).bind(tripId).all<RawDayPhoto>();

  const { results: itemPhotos } = await db.prepare(
    `SELECT id, item_id as itemId, photo_url as photoUrl, uploaded_by as uploadedBy,
     uploaded_by_name as uploadedByName, uploaded_at as uploadedAt
     FROM item_photos WHERE trip_id = ? ORDER BY uploaded_at ASC`
  ).bind(tripId).all<RawItemPhoto>();

  // Get uploader names for items
  const uploaderIds = items.filter(i => i.photoUploadedBy).map(i => i.photoUploadedBy);
  const uniqueUploaderIds = [...new Set(uploaderIds)];
  const uploaderNames: Map<string, string> = new Map();

  if (uniqueUploaderIds.length > 0) {
    const placeholders = uniqueUploaderIds.map(() => '?').join(',');
    const { results: users } = await db.prepare(
      `SELECT id, name FROM users WHERE id IN (${placeholders})`
    ).bind(...uniqueUploaderIds).all<{ id: string; name: string | null }>();
    for (const u of users) {
      uploaderNames.set(u.id, u.name || '匿名');
    }
  }

  // Group item_photos by item_id
  const itemPhotosMap = new Map<string, PhotoEntry[]>();
  for (const ip of itemPhotos) {
    const arr = itemPhotosMap.get(ip.itemId) || [];
    arr.push({ id: ip.id, photoUrl: ip.photoUrl, uploadedBy: ip.uploadedBy, uploadedByName: ip.uploadedByName, uploadedAt: ip.uploadedAt });
    itemPhotosMap.set(ip.itemId, arr);
  }

  // Enrich items
  const enrichedItems = items.map((item) => ({
    ...item,
    photoUploadedByName: item.photoUploadedBy ? uploaderNames.get(item.photoUploadedBy) || null : null,
    checkedInLocation: safeJsonParse(item.checkedInLocation),
    photos: itemPhotosMap.get(item.id) || [],
  }));

  // Group day_photos by day_id
  const dayPhotosMap = new Map<string, PhotoEntry[]>();
  for (const photo of dayPhotos) {
    const existing = dayPhotosMap.get(photo.dayId) || [];
    existing.push({
      id: photo.id, photoUrl: photo.photoUrl, uploadedBy: photo.uploadedBy,
      uploadedByName: photo.uploadedByName, uploadedAt: photo.uploadedAt,
    });
    dayPhotosMap.set(photo.dayId, existing);
  }

  // Parse photos JSON for each day and merge with new day_photos
  const enrichedDays = days.map((day) => {
    const oldPhotos: string[] = (day.photos ? safeJsonParse(day.photos) : []) as string[];
    const oldPhotosFormatted: PhotoEntry[] = oldPhotos.map((url, i) => ({
      id: `legacy-${day.id}-${i}`, photoUrl: url,
      uploadedBy: null, uploadedByName: null, uploadedAt: null,
    }));
    const newPhotos = dayPhotosMap.get(day.id) || [];
    return { ...day, photos: [...oldPhotosFormatted, ...newPhotos] };
  });

  return { days: enrichedDays, items: enrichedItems };
}

// ============ Token Generation ============

// Helper to generate random token for share links (no modulo bias)
export function generateToken(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 24);
}

// ============ Trip History ============

export async function buildTripSnapshot(db: D1Database, tripId: string): Promise<string> {
  const trip = await db.prepare(
    `SELECT id, title, start_date, end_date, theme, cover_image_url, budget, color_label
     FROM trips WHERE id = ?`
  ).bind(tripId).first();

  const { results: days } = await db.prepare(
    'SELECT id, date, sort, notes FROM days WHERE trip_id = ? ORDER BY sort ASC'
  ).bind(tripId).all();

  const { results: items } = await db.prepare(
    `SELECT id, day_id, title, area, time_start, time_end, map_url, note, cost,
     cost_category, sort, photo_url FROM items WHERE trip_id = ? ORDER BY sort ASC`
  ).bind(tripId).all();

  return JSON.stringify({ trip, days, items });
}

export function buildChangeSummary(changes: Record<string, { old: unknown; new: unknown }>): string {
  const fieldNames: Record<string, string> = {
    title: 'タイトル', startDate: '開始日', endDate: '終了日',
    theme: 'テーマ', budget: '予算', colorLabel: 'カラーラベル',
    coverImageUrl: 'カバー画像',
  };
  const keys = Object.keys(changes);
  if (keys.length === 0) return '変更';
  if (keys.length === 1) {
    const field = fieldNames[keys[0]] || keys[0];
    return `${field}を変更`;
  }
  return `${keys.map(k => fieldNames[k] || k).join('、')}を変更`;
}

export async function recordTripHistory(
  db: D1Database,
  tripId: string,
  userId: string | null,
  userName: string | null,
  action: string,
  entityType: string,
  entityId: string | null,
  summary: string,
  changes: Record<string, { old: unknown; new: unknown }> | null,
  includeSnapshot: boolean = true
): Promise<void> {
  const id = generateId();
  let snapshot: string | null = null;

  if (includeSnapshot) {
    snapshot = await buildTripSnapshot(db, tripId);
  }

  await db.prepare(
    `INSERT INTO trip_history (id, trip_id, user_id, user_name, action, entity_type, entity_id, summary, changes, snapshot)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id, tripId, userId, userName, action, entityType, entityId,
    summary, changes ? JSON.stringify(changes) : null, snapshot
  ).run();

  // Trim old snapshots (keep latest 50 per trip)
  await db.prepare(
    `DELETE FROM trip_history
     WHERE trip_id = ? AND snapshot IS NOT NULL
     AND id NOT IN (
       SELECT id FROM trip_history
       WHERE trip_id = ? AND snapshot IS NOT NULL
       ORDER BY created_at DESC
       LIMIT 50
     )`
  ).bind(tripId, tripId).run().catch(() => {});
}

// ============ Permission Checks ============

// Helper to check trip ownership (owner-only operations)
export async function checkTripOwnership(
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
export async function checkCanEditTrip(
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

// Helper to check trip access (owner or collaborator with edit permission)
export async function checkTripEditAccess(
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

// ============ Data Export ============

// Helper function to build export data
export async function buildExportData(
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
export function convertToCSV(data: NonNullable<Awaited<ReturnType<typeof buildExportData>>>): string {
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

// ============ AI Credit System ============

export const AI_MONTHLY_CREDITS = 5;
export const AI_CREDIT_COSTS: Record<string, number> = { generate: 2, suggestions: 1, optimize: 1 };
export const AI_IP_DAILY_LIMIT = 10;

// Helper to get client IP
export function getClientIp(c: { req: { header: (name: string) => string | undefined } }): string {
  // Cloudflare provides the real IP in CF-Connecting-IP header
  return c.req.header('CF-Connecting-IP') ||
         c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() ||
         'unknown';
}

export async function checkAndDeductCredits(
  db: D1Database,
  userId: string,
  ip: string,
  featureType: string,
): Promise<{ ok: true; creditsRemaining: number } | { ok: false; error: string; status: number }> {
  const cost = AI_CREDIT_COSTS[featureType] || 1;

  // Get user's current credits
  const userData = await db.prepare(
    'SELECT ai_credits, credits_reset_at FROM users WHERE id = ?'
  ).bind(userId).first<{ ai_credits: number; credits_reset_at: string }>();

  if (!userData) return { ok: false, error: 'ユーザーが見つかりません', status: 404 };

  let currentCredits = userData.ai_credits;
  const resetAt = new Date(userData.credits_reset_at);
  const now = new Date();

  // Monthly reset check
  if (now.getUTCFullYear() > resetAt.getUTCFullYear() ||
      (now.getUTCFullYear() === resetAt.getUTCFullYear() && now.getUTCMonth() > resetAt.getUTCMonth())) {
    currentCredits = AI_MONTHLY_CREDITS;
    await db.prepare(
      "UPDATE users SET ai_credits = ?, credits_reset_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?"
    ).bind(AI_MONTHLY_CREDITS, userId).run();
  }

  // Credit check
  if (currentCredits < cost) {
    const nextReset = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    return {
      ok: false,
      error: `AIクレジットが不足しています（残り${currentCredits}、必要${cost}）。${nextReset.getUTCMonth() + 1}月${nextReset.getUTCDate()}日にリセットされます。`,
      status: 429,
    };
  }

  // IP daily limit (abuse prevention)
  const todayStart = now.toISOString().split('T')[0] + 'T00:00:00.000Z';
  const ipResult = await db.prepare(
    'SELECT COUNT(*) as count FROM ai_usage WHERE ip_address = ? AND created_at >= ?'
  ).bind(ip, todayStart).first<{ count: number }>();
  if ((ipResult?.count || 0) >= AI_IP_DAILY_LIMIT) {
    return { ok: false, error: 'このIPアドレスからの利用上限に達しました。', status: 429 };
  }

  // Deduct atomically (WHERE ensures no negative balance from concurrent requests)
  const deductResult = await db.prepare(
    'UPDATE users SET ai_credits = ai_credits - ? WHERE id = ? AND ai_credits >= ?'
  ).bind(cost, userId, cost).run();

  if (!deductResult.meta.changes || deductResult.meta.changes === 0) {
    return { ok: false, error: 'AIクレジットの消費に失敗しました。再度お試しください。', status: 429 };
  }

  // Record usage
  const usageId = generateId();
  await db.prepare(
    'INSERT INTO ai_usage (id, user_id, ip_address, credits_used, feature_type) VALUES (?, ?, ?, ?, ?)'
  ).bind(usageId, userId, ip, cost, featureType).run();

  return { ok: true, creditsRemaining: currentCredits - cost };
}

// ============ OGP / Crawler Helpers ============

// Helper to check if request is from a crawler (for OGP)
export function isCrawler(userAgent: string | undefined): boolean {
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
export function generateOgpHtml(options: {
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

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ============ Weather ============

export function getWeatherInfo(code: number): WeatherInfo {
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
