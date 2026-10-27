const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const app = require('../app');

let server;
let baseUrl;

before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

const post = (path, body) =>
  fetch(baseUrl + path, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  });

test('trang chủ và trang giới thiệu render OK', async () => {
  for (const path of ['/', '/about', '/todos']) {
    const res = await fetch(baseUrl + path);
    assert.equal(res.status, 200, path);
    assert.match(await res.text(), /<title>/);
  }
});

test('có header bảo mật từ helmet, không lộ x-powered-by', async () => {
  const res = await fetch(baseUrl + '/');
  assert.ok(res.headers.get('content-security-policy'));
  assert.equal(res.headers.get('x-powered-by'), null);
});

test('API health trả JSON', async () => {
  const res = await fetch(baseUrl + '/api/health');
  assert.equal(res.status, 200);
  assert.equal((await res.json()).status, 'ok');
});

test('thêm, đổi trạng thái và xóa todo', async () => {
  let res = await post('/todos', { text: 'Việc kiểm thử' });
  assert.equal(res.status, 302);
  let html = await (await fetch(baseUrl + '/todos')).text();
  const match = html.match(/\/todos\/(\d+)\/toggle"[\s\S]*?Việc kiểm thử/g);
  assert.ok(match);
  const id = match.at(-1).match(/\/todos\/(\d+)\/toggle/g).at(-1).match(/\d+/)[0];

  res = await post(`/todos/${id}/toggle`, {});
  assert.equal(res.status, 302);
  res = await post(`/todos/${id}/delete`, {});
  assert.equal(res.status, 302);
  html = await (await fetch(baseUrl + '/todos')).text();
  assert.doesNotMatch(html, /Việc kiểm thử/);
});

test('từ chối todo rỗng và escape HTML', async () => {
  let res = await post('/todos', { text: '   ' });
  assert.equal(res.status, 400);
  await post('/todos', { text: '<script>alert(1)</script>' });
  const html = await (await fetch(baseUrl + '/todos')).text();
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.match(html, /&lt;script&gt;/);
});

test('trang không tồn tại trả 404', async () => {
  const res = await fetch(baseUrl + '/khong-co');
  assert.equal(res.status, 404);
});
