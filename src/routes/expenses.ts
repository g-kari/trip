import { Hono } from 'hono';
import type { AppEnv } from '../worker-types';
import { generateId } from '../auth/session';
import { checkTripOwnership } from '../helpers';

const app = new Hono<AppEnv>();

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
        'SELECT id FROM share_tokens WHERE token = ? AND trip_id = ? AND is_active = 1'
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
        'SELECT id FROM share_tokens WHERE token = ? AND trip_id = ? AND is_active = 1'
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
        'SELECT id FROM share_tokens WHERE token = ? AND trip_id = ? AND is_active = 1'
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

export default app;
