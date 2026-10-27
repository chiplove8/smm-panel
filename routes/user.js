const express = require('express');
const db = require('../src/db');
const { hashPassword, verifyPassword } = require('../src/password');
const { calcCharge, toInt, isValidUrl, formatVnd } = require('../src/helpers');

const router = express.Router();
const PAGE_SIZE = 20;

const q = {
  categories: db.prepare(`
    SELECT DISTINCT c.* FROM categories c JOIN services s ON s.category_id = c.id AND s.active = 1
    ORDER BY c.sort, c.id
  `),
  services: db.prepare('SELECT * FROM services WHERE active = 1 ORDER BY category_id, id'),
  service: db.prepare('SELECT * FROM services WHERE id = ? AND active = 1'),
  userStats: db.prepare(`
    SELECT COUNT(*) AS total,
           COALESCE(SUM(charge), 0) AS spent,
           COALESCE(SUM(status IN ('pending', 'processing', 'in_progress')), 0) AS running,
           COALESCE(SUM(status = 'completed'), 0) AS completed
    FROM orders WHERE user_id = ?
  `),
  balance: db.prepare('SELECT balance FROM users WHERE id = ?'),
  debit: db.prepare('UPDATE users SET balance = balance - ? WHERE id = ? AND balance >= ?'),
  insertOrder: db.prepare(
    'INSERT INTO orders (user_id, service_id, link, quantity, charge, remains) VALUES (?, ?, ?, ?, ?, ?)'
  ),
  insertTx: db.prepare(
    'INSERT INTO transactions (user_id, type, amount, balance_after, description) VALUES (?, ?, ?, ?, ?)'
  ),
  countOrders: db.prepare(`SELECT COUNT(*) AS count FROM orders WHERE user_id = @userId
    AND (@status IS NULL OR status = @status)
    AND (@search IS NULL OR link LIKE @search OR CAST(id AS TEXT) = @rawSearch)`),
  listOrders: db.prepare(`
    SELECT o.*, s.name AS service_name FROM orders o JOIN services s ON s.id = o.service_id
    WHERE o.user_id = @userId
      AND (@status IS NULL OR o.status = @status)
      AND (@search IS NULL OR o.link LIKE @search OR CAST(o.id AS TEXT) = @rawSearch)
    ORDER BY o.id DESC LIMIT @limit OFFSET @offset
  `),
  recentOrders: db.prepare(`
    SELECT o.*, s.name AS service_name FROM orders o JOIN services s ON s.id = o.service_id
    WHERE o.user_id = ? ORDER BY o.id DESC LIMIT 5
  `),
  deposits: db.prepare('SELECT * FROM deposits WHERE user_id = ? ORDER BY id DESC LIMIT 20'),
  pendingDeposits: db.prepare("SELECT COUNT(*) AS count FROM deposits WHERE user_id = ? AND status = 'pending'"),
  insertDeposit: db.prepare('INSERT INTO deposits (user_id, amount, method, reference) VALUES (?, ?, ?, ?)'),
  transactions: db.prepare('SELECT * FROM transactions WHERE user_id = ? ORDER BY id DESC LIMIT 30'),
  passwordHash: db.prepare('SELECT password_hash FROM users WHERE id = ?'),
  updatePassword: db.prepare('UPDATE users SET password_hash = ? WHERE id = ?'),
};

const placeOrder = db.transaction((userId, service, link, quantity) => {
  const charge = calcCharge(service.rate, quantity);
  const debited = q.debit.run(charge, userId, charge);
  if (debited.changes === 0) return { error: 'Số dư không đủ. Vui lòng nạp thêm tiền.' };
  const { lastInsertRowid } = q.insertOrder.run(userId, service.id, link, quantity, charge, quantity);
  const { balance } = q.balance.get(userId);
  q.insertTx.run(userId, 'order', -charge, balance, `Đơn #${lastInsertRowid} - ${service.name}`);
  return { orderId: Number(lastInsertRowid), charge };
});

function renderNewOrder(res, status, extra = {}) {
  const userId = res.locals.user.id;
  res.status(status).render('user/dashboard', {
    title: 'Đặt đơn mới',
    categories: q.categories.all(),
    services: q.services.all(),
    stats: q.userStats.get(userId),
    recentOrders: q.recentOrders.all(userId),
    error: null,
    values: {},
    ...extra,
  });
}

router.get('/dashboard', (req, res) => {
  renderNewOrder(res, 200, { values: { service_id: toInt(req.query.service) || '' } });
});

router.post('/orders', (req, res) => {
  const serviceId = toInt(req.body.service_id);
  const link = String(req.body.link || '').trim();
  const quantity = toInt(req.body.quantity);
  const values = { service_id: serviceId || '', link, quantity: Number.isNaN(quantity) ? '' : quantity };
  const service = Number.isNaN(serviceId) ? null : q.service.get(serviceId);

  let error = null;
  if (!service) error = 'Vui lòng chọn dịch vụ hợp lệ.';
  else if (!isValidUrl(link) || link.length > 500) error = 'Link không hợp lệ (phải bắt đầu bằng http:// hoặc https://).';
  else if (Number.isNaN(quantity) || quantity < service.min_qty || quantity > service.max_qty) {
    error = `Số lượng phải từ ${service.min_qty} đến ${service.max_qty}.`;
  } else {
    const result = placeOrder(req.user.id, service, link, quantity);
    if (result.error) error = result.error;
    else {
      req.flash('success', `Đặt đơn #${result.orderId} thành công. Đã trừ ${formatVnd(result.charge)}.`);
      return res.redirect('/orders');
    }
  }
  res.locals.user = { ...res.locals.user, ...q.balance.get(req.user.id) };
  renderNewOrder(res, 400, { error, values });
});

router.get('/orders', (req, res) => {
  const status = typeof req.query.status === 'string' && req.query.status ? req.query.status : null;
  const rawSearch = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const params = {
    userId: req.user.id,
    status,
    search: rawSearch ? `%${rawSearch}%` : null,
    rawSearch: rawSearch.replace(/^#/, ''),
  };
  const { count } = q.countOrders.get(params);
  const pages = Math.max(1, Math.ceil(count / PAGE_SIZE));
  const page = Math.min(Math.max(toInt(req.query.page) || 1, 1), pages);
  const orders = q.listOrders.all({ ...params, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE });
  res.render('user/orders', { title: 'Lịch sử đơn hàng', orders, page, pages, count, status, search: rawSearch });
});

const DEPOSIT_METHODS = {
  bank: 'Chuyển khoản ngân hàng',
  momo: 'Ví MoMo',
  card: 'Thẻ cào',
};

router.get('/funds', (req, res) => {
  res.render('user/funds', {
    title: 'Nạp tiền',
    methods: DEPOSIT_METHODS,
    deposits: q.deposits.all(req.user.id),
    transactions: q.transactions.all(req.user.id),
    error: null,
    values: {},
  });
});

router.post('/funds', (req, res) => {
  const amount = toInt(req.body.amount);
  const method = String(req.body.method || '');
  let error = null;
  if (!DEPOSIT_METHODS[method]) error = 'Vui lòng chọn phương thức nạp.';
  else if (Number.isNaN(amount) || amount < 10000 || amount > 100000000) error = 'Số tiền nạp từ 10.000đ đến 100.000.000đ.';
  else if (q.pendingDeposits.get(req.user.id).count >= 3) error = 'Bạn có quá nhiều yêu cầu đang chờ duyệt.';
  if (error) {
    return res.status(400).render('user/funds', {
      title: 'Nạp tiền',
      methods: DEPOSIT_METHODS,
      deposits: q.deposits.all(req.user.id),
      transactions: q.transactions.all(req.user.id),
      error,
      values: { amount: Number.isNaN(amount) ? '' : amount, method },
    });
  }
  const reference = `SMM${req.user.id}${Date.now().toString(36).toUpperCase()}`;
  q.insertDeposit.run(req.user.id, amount, method, reference);
  req.flash('success', `Đã tạo yêu cầu nạp ${formatVnd(amount)}. Nội dung chuyển khoản: ${reference}`);
  res.redirect('/funds');
});

router.get('/account', (req, res) => {
  res.render('user/account', { title: 'Tài khoản', error: null });
});

router.post('/account/password', async (req, res) => {
  const current = String(req.body.current || '');
  const password = String(req.body.password || '');
  const confirm = String(req.body.confirm || '');
  const { password_hash: hash } = q.passwordHash.get(req.user.id);
  let error = null;
  if (!(await verifyPassword(current, hash))) error = 'Mật khẩu hiện tại không đúng.';
  else if (password.length < 8 || password.length > 128) error = 'Mật khẩu mới phải từ 8 đến 128 ký tự.';
  else if (password !== confirm) error = 'Mật khẩu nhập lại không khớp.';
  if (error) return res.status(400).render('user/account', { title: 'Tài khoản', error });
  q.updatePassword.run(await hashPassword(password), req.user.id);
  req.flash('success', 'Đổi mật khẩu thành công.');
  res.redirect('/account');
});

module.exports = router;
module.exports.DEPOSIT_METHODS = DEPOSIT_METHODS;
