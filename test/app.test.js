const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
process.env.DB_PATH = ':memory:';
process.env.SESSION_SECRET = 'test-secret';

const app = require('../app');
const db = require('../src/db');

let server;
let baseUrl;

before(async () => {
  await app.ready;
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

function client() {
  let cookie = '';
  const request = async (path, options = {}) => {
    const res = await fetch(baseUrl + path, {
      redirect: 'manual',
      ...options,
      headers: { ...(options.headers || {}), ...(cookie ? { cookie } : {}) },
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    return res;
  };
  const csrf = async (path) => {
    const html = await (await request(path)).text();
    return html.match(/name="_csrf" value="([^"]+)"/)?.[1];
  };
  const post = async (path, body, csrfFrom = path) => {
    const token = await csrf(csrfFrom);
    return request(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ _csrf: token, ...body }),
    });
  };
  return { request, post, csrf };
}

const balanceOf = (username) => db.prepare('SELECT balance FROM users WHERE username = ?').get(username).balance;

test('trang công khai render OK, có header bảo mật', async () => {
  for (const path of ['/', '/services', '/login', '/register', '/terms']) {
    const res = await fetch(baseUrl + path);
    assert.equal(res.status, 200, path);
  }
  const res = await fetch(baseUrl + '/');
  assert.ok(res.headers.get('content-security-policy'));
  assert.equal(res.headers.get('x-powered-by'), null);
});

test('trang cần đăng nhập chuyển hướng về /login', async () => {
  for (const path of ['/dashboard', '/orders', '/funds', '/account', '/admin']) {
    const res = await fetch(baseUrl + path, { redirect: 'manual' });
    assert.equal(res.status, 302, path);
    assert.equal(res.headers.get('location'), '/login');
  }
});

test('POST không có CSRF token bị chặn', async () => {
  const res = await fetch(baseUrl + '/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'login=demo&password=demo123',
  });
  assert.equal(res.status, 403);
});

test('đăng ký: validate và chống trùng', async () => {
  const c = client();
  let res = await c.post('/register', { username: 'ab', email: 'x@y.com', password: '12345678', confirm: '12345678', terms: '1' });
  assert.equal(res.status, 400);
  res = await c.post('/register', { username: 'newuser', email: 'new@example.com', password: '12345678', confirm: '87654321', terms: '1' });
  assert.equal(res.status, 400);
  res = await c.post('/register', { username: 'demo', email: 'other@example.com', password: '12345678', confirm: '12345678', terms: '1' });
  assert.equal(res.status, 400);
  assert.match(await res.text(), /Tên đăng nhập đã được sử dụng/);
});

test('đăng ký thành công, đăng xuất, đăng nhập lại', async () => {
  const c = client();
  let res = await c.post('/register', { username: 'alice', email: 'alice@example.com', password: 'secret123', confirm: 'secret123', terms: '1' });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/dashboard');
  res = await c.request('/dashboard');
  assert.equal(res.status, 200);
  assert.match(await res.text(), /alice/);

  res = await c.post('/logout', {}, '/dashboard');
  assert.equal(res.status, 302);
  res = await c.request('/dashboard');
  assert.equal(res.status, 302);

  res = await c.post('/login', { login: 'alice', password: 'sai-mat-khau' });
  assert.equal(res.status, 401);
  res = await c.post('/login', { login: 'ALICE@example.com', password: 'secret123' });
  assert.equal(res.status, 302);
  assert.equal((await c.request('/orders')).status, 200);
});

test('đặt đơn trừ tiền, validate số lượng và số dư', async () => {
  const c = client();
  await c.post('/login', { login: 'demo', password: 'demo123' });
  const service = db.prepare('SELECT * FROM services WHERE active = 1 ORDER BY id LIMIT 1').get();
  const before = balanceOf('demo');

  let res = await c.post('/orders', { service_id: service.id, link: 'https://facebook.com/p/1', quantity: service.min_qty - 1 }, '/dashboard');
  assert.equal(res.status, 400);
  res = await c.post('/orders', { service_id: service.id, link: 'javascript:alert(1)', quantity: service.min_qty }, '/dashboard');
  assert.equal(res.status, 400);

  const qty = 1000;
  res = await c.post('/orders', { service_id: service.id, link: 'https://facebook.com/p/1', quantity: qty }, '/dashboard');
  assert.equal(res.status, 302);
  assert.equal(balanceOf('demo'), before - Math.ceil((service.rate * qty) / 1000));

  const expensive = db.prepare('SELECT * FROM services ORDER BY rate DESC LIMIT 1').get();
  res = await c.post('/orders', { service_id: expensive.id, link: 'https://youtube.com/c/x', quantity: expensive.max_qty }, '/dashboard');
  assert.equal(res.status, 400);
  assert.match(await res.text(), /Số dư không đủ/);
});

test('user thường không vào được admin', async () => {
  const c = client();
  await c.post('/login', { login: 'demo', password: 'demo123' });
  assert.equal((await c.request('/admin')).status, 403);
});

test('admin: duyệt nạp tiền, hủy đơn hoàn tiền, cộng tiền', async () => {
  const user = client();
  await user.post('/login', { login: 'demo', password: 'demo123' });
  let res = await user.post('/funds', { method: 'bank', amount: '100000' });
  assert.equal(res.status, 302);

  const admin = client();
  res = await admin.post('/login', { login: 'admin', password: 'admin123' });
  assert.equal(res.status, 302);
  assert.equal((await admin.request('/admin')).status, 200);

  const deposit = db.prepare("SELECT * FROM deposits WHERE status = 'pending' ORDER BY id DESC").get();
  let before = balanceOf('demo');
  res = await admin.post(`/admin/deposits/${deposit.id}`, { action: 'approve' }, '/admin/deposits');
  assert.equal(res.status, 302);
  assert.equal(balanceOf('demo'), before + 100000);
  await admin.post(`/admin/deposits/${deposit.id}`, { action: 'approve' }, '/admin/deposits');
  assert.equal(balanceOf('demo'), before + 100000, 'không duyệt 2 lần');

  const order = db.prepare("SELECT * FROM orders WHERE status = 'pending' ORDER BY id DESC").get();
  before = balanceOf('demo');
  await admin.post(`/admin/orders/${order.id}`, { status: 'canceled' }, '/admin/orders');
  assert.equal(balanceOf('demo'), before + order.charge);
  await admin.post(`/admin/orders/${order.id}`, { status: 'completed' }, '/admin/orders');
  assert.equal(db.prepare('SELECT status FROM orders WHERE id = ?').get(order.id).status, 'canceled');

  const demoId = db.prepare("SELECT id FROM users WHERE username = 'demo'").get().id;
  before = balanceOf('demo');
  await admin.post(`/admin/users/${demoId}/balance`, { amount: '-5000', note: 'test' }, '/admin/users');
  assert.equal(balanceOf('demo'), before - 5000);
});

test('escape HTML trong link đơn hàng', async () => {
  const c = client();
  await c.post('/login', { login: 'demo', password: 'demo123' });
  const service = db.prepare('SELECT * FROM services WHERE active = 1 ORDER BY rate LIMIT 1').get();
  await c.post('/orders', { service_id: service.id, link: 'https://x.com/"><script>alert(1)</script>', quantity: service.min_qty }, '/dashboard');
  const html = await (await c.request('/orders')).text();
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
});

test('trang không tồn tại trả 404', async () => {
  assert.equal((await fetch(baseUrl + '/khong-co')).status, 404);
});
