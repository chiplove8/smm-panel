const express = require('express');
const db = require('../src/db');
const { ORDER_STATUSES, FINAL_STATUSES, toInt, formatVnd } = require('../src/helpers');
const { DEPOSIT_METHODS } = require('./user');

const router = express.Router();

const q = {
  stats: db.prepare(`
    SELECT (SELECT COUNT(*) FROM users WHERE role = 'user') AS users,
           (SELECT COUNT(*) FROM orders) AS orders,
           (SELECT COALESCE(SUM(charge), 0) FROM orders WHERE status != 'canceled') AS revenue,
           (SELECT COUNT(*) FROM orders WHERE status IN ('pending', 'processing', 'in_progress')) AS running,
           (SELECT COUNT(*) FROM deposits WHERE status = 'pending') AS pendingDeposits
  `),
  orders: db.prepare(`
    SELECT o.*, s.name AS service_name, u.username FROM orders o
    JOIN services s ON s.id = o.service_id JOIN users u ON u.id = o.user_id
    WHERE (@status IS NULL OR o.status = @status)
    ORDER BY o.id DESC LIMIT 100
  `),
  order: db.prepare('SELECT * FROM orders WHERE id = ?'),
  updateOrder: db.prepare(
    "UPDATE orders SET status = ?, start_count = ?, remains = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
  ),
  credit: db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?'),
  debit: db.prepare('UPDATE users SET balance = balance - ? WHERE id = ? AND balance >= ?'),
  balance: db.prepare('SELECT balance FROM users WHERE id = ?'),
  insertTx: db.prepare(
    'INSERT INTO transactions (user_id, type, amount, balance_after, description) VALUES (?, ?, ?, ?, ?)'
  ),
  categories: db.prepare('SELECT * FROM categories ORDER BY sort, id'),
  services: db.prepare(`
    SELECT s.*, c.name AS category_name FROM services s JOIN categories c ON c.id = s.category_id
    ORDER BY c.sort, c.id, s.id
  `),
  service: db.prepare('SELECT * FROM services WHERE id = ?'),
  insertService: db.prepare(`INSERT INTO services (category_id, name, rate, min_qty, max_qty, avg_time, description, active)
    VALUES (@category_id, @name, @rate, @min_qty, @max_qty, @avg_time, @description, @active)`),
  updateService: db.prepare(`UPDATE services SET category_id = @category_id, name = @name, rate = @rate,
    min_qty = @min_qty, max_qty = @max_qty, avg_time = @avg_time, description = @description, active = @active
    WHERE id = @id`),
  category: db.prepare('SELECT id FROM categories WHERE id = ?'),
  insertCategory: db.prepare('INSERT INTO categories (name, platform, sort) VALUES (?, ?, (SELECT COALESCE(MAX(sort), 0) + 1 FROM categories))'),
  users: db.prepare(`
    SELECT u.*, (SELECT COUNT(*) FROM orders o WHERE o.user_id = u.id) AS order_count
    FROM users u ORDER BY u.id DESC LIMIT 200
  `),
  user: db.prepare('SELECT * FROM users WHERE id = ?'),
  deposits: db.prepare(`
    SELECT d.*, u.username FROM deposits d JOIN users u ON u.id = d.user_id
    ORDER BY d.status = 'pending' DESC, d.id DESC LIMIT 100
  `),
  deposit: db.prepare('SELECT * FROM deposits WHERE id = ?'),
  setDepositStatus: db.prepare("UPDATE deposits SET status = ? WHERE id = ? AND status = 'pending'"),
};

function adjustBalance(userId, amount, type, description) {
  const result = amount >= 0 ? q.credit.run(amount, userId) : q.debit.run(-amount, userId, -amount);
  if (result.changes === 0) return false;
  q.insertTx.run(userId, type, amount, q.balance.get(userId).balance, description);
  return true;
}

const updateOrderStatus = db.transaction((order, status, startCount, remains) => {
  if (FINAL_STATUSES.includes(order.status)) return 'Đơn đã ở trạng thái cuối, không thể thay đổi.';
  let refund = 0;
  if (status === 'canceled') {
    refund = order.charge;
    remains = order.quantity;
  } else if (status === 'partial') {
    if (Number.isNaN(remains) || remains <= 0 || remains >= order.quantity) {
      return 'Hoàn một phần cần số lượng còn lại (remains) lớn hơn 0 và nhỏ hơn số lượng đặt.';
    }
    refund = Math.floor((order.charge * remains) / order.quantity);
  } else if (status === 'completed') {
    remains = 0;
  } else if (Number.isNaN(remains)) {
    remains = order.remains;
  }
  q.updateOrder.run(status, Number.isNaN(startCount) ? order.start_count : startCount, remains, order.id);
  if (refund > 0) adjustBalance(order.user_id, refund, 'refund', `Hoàn tiền đơn #${order.id}`);
  return null;
});

const reviewDeposit = db.transaction((deposit, approve) => {
  const changed = q.setDepositStatus.run(approve ? 'approved' : 'rejected', deposit.id).changes;
  if (!changed) return false;
  if (approve) adjustBalance(deposit.user_id, deposit.amount, 'deposit', `Nạp tiền ${deposit.reference}`);
  return true;
});

router.get('/', (req, res) => {
  res.render('admin/index', {
    title: 'Quản trị',
    stats: q.stats.get(),
    orders: q.orders.all({ status: null }).slice(0, 8),
  });
});

router.get('/orders', (req, res) => {
  const status = ORDER_STATUSES[req.query.status] ? req.query.status : null;
  res.render('admin/orders', { title: 'Quản lý đơn hàng', orders: q.orders.all({ status }), status });
});

router.post('/orders/:id', (req, res) => {
  const order = q.order.get(toInt(req.params.id));
  const status = String(req.body.status || '');
  if (!order || !ORDER_STATUSES[status]) {
    req.flash('error', 'Dữ liệu không hợp lệ.');
  } else {
    const error = updateOrderStatus(order, status, toInt(req.body.start_count), toInt(req.body.remains));
    req.flash(error ? 'error' : 'success', error || `Đã cập nhật đơn #${order.id}.`);
  }
  res.redirect(req.get('Referrer')?.includes('/admin') ? req.get('Referrer') : '/admin/orders');
});

function parseService(body) {
  const data = {
    category_id: toInt(body.category_id),
    name: String(body.name || '').trim(),
    rate: toInt(body.rate),
    min_qty: toInt(body.min_qty),
    max_qty: toInt(body.max_qty),
    avg_time: String(body.avg_time || '').trim().slice(0, 50),
    description: String(body.description || '').trim().slice(0, 1000),
    active: body.active ? 1 : 0,
  };
  let error = null;
  if (!q.category.get(data.category_id)) error = 'Danh mục không hợp lệ.';
  else if (!data.name || data.name.length > 200) error = 'Tên dịch vụ không hợp lệ.';
  else if (!(data.rate > 0)) error = 'Giá phải lớn hơn 0.';
  else if (!(data.min_qty > 0) || !(data.max_qty >= data.min_qty)) error = 'Min/Max không hợp lệ.';
  return { data, error };
}

router.get('/services', (req, res) => {
  const edit = req.query.edit ? q.service.get(toInt(req.query.edit)) : null;
  res.render('admin/services', {
    title: 'Quản lý dịch vụ',
    categories: q.categories.all(),
    services: q.services.all(),
    edit,
  });
});

router.post('/services', (req, res) => {
  const { data, error } = parseService(req.body);
  if (error) req.flash('error', error);
  else {
    q.insertService.run(data);
    req.flash('success', `Đã thêm dịch vụ "${data.name}".`);
  }
  res.redirect('/admin/services');
});

router.post('/services/:id', (req, res) => {
  const service = q.service.get(toInt(req.params.id));
  const { data, error } = parseService(req.body);
  if (!service) req.flash('error', 'Không tìm thấy dịch vụ.');
  else if (error) req.flash('error', error);
  else {
    q.updateService.run({ ...data, id: service.id });
    req.flash('success', `Đã cập nhật dịch vụ #${service.id}.`);
  }
  res.redirect('/admin/services');
});

router.post('/categories', (req, res) => {
  const name = String(req.body.name || '').trim();
  const platform = String(req.body.platform || '').trim().toLowerCase();
  if (!name || name.length > 100 || !/^[a-z0-9_-]{2,30}$/.test(platform)) req.flash('error', 'Danh mục không hợp lệ.');
  else {
    q.insertCategory.run(name, platform);
    req.flash('success', `Đã thêm danh mục "${name}".`);
  }
  res.redirect('/admin/services');
});

router.get('/users', (req, res) => {
  res.render('admin/users', { title: 'Quản lý thành viên', users: q.users.all() });
});

router.post('/users/:id/balance', (req, res) => {
  const user = q.user.get(toInt(req.params.id));
  const amount = toInt(req.body.amount);
  const note = String(req.body.note || '').trim().slice(0, 200);
  if (!user || Number.isNaN(amount) || amount === 0) req.flash('error', 'Số tiền không hợp lệ.');
  else {
    const ok = db.transaction(() => adjustBalance(user.id, amount, 'admin', note || 'Admin điều chỉnh số dư'))();
    req.flash(ok ? 'success' : 'error', ok
      ? `Đã ${amount > 0 ? 'cộng' : 'trừ'} ${formatVnd(Math.abs(amount))} cho ${user.username}.`
      : 'Số dư của thành viên không đủ để trừ.');
  }
  res.redirect('/admin/users');
});

router.get('/deposits', (req, res) => {
  res.render('admin/deposits', { title: 'Duyệt nạp tiền', deposits: q.deposits.all(), methods: DEPOSIT_METHODS });
});

router.post('/deposits/:id', (req, res) => {
  const deposit = q.deposit.get(toInt(req.params.id));
  const approve = req.body.action === 'approve';
  if (!deposit || !reviewDeposit(deposit, approve)) req.flash('error', 'Yêu cầu không tồn tại hoặc đã được xử lý.');
  else req.flash('success', `Đã ${approve ? 'duyệt' : 'từ chối'} yêu cầu nạp #${deposit.id}.`);
  res.redirect('/admin/deposits');
});

module.exports = router;
