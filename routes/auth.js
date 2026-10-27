const express = require('express');
const rateLimit = require('express-rate-limit');
const db = require('../src/db');
const { hashPassword, verifyPassword } = require('../src/password');
const { requireGuest, newToken } = require('../src/middleware');

const router = express.Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: process.env.NODE_ENV === 'test' ? 1000 : 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (req, res) =>
    res.status(429).render(req.path.includes('register') ? 'auth/register' : 'auth/login', {
      title: 'Thử lại sau',
      layout: 'layouts/public',
      error: 'Bạn thử quá nhiều lần. Vui lòng đợi 15 phút rồi thử lại.',
      values: {},
    }),
});

const findByLogin = db.prepare('SELECT * FROM users WHERE username = ? OR email = ?');
const findExisting = db.prepare('SELECT username, email FROM users WHERE username = ? OR email = ?');
const insertUser = db.prepare('INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)');

const USERNAME_RE = /^[a-zA-Z0-9_]{3,30}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function startSession(req, userId, returnTo) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => {
      if (err) return reject(err);
      req.session.userId = userId;
      req.session.csrfToken = newToken();
      req.session.save((saveErr) => (saveErr ? reject(saveErr) : resolve(returnTo)));
    });
  });
}

function safeReturnTo(value) {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') ? value : '/dashboard';
}

router.get('/login', requireGuest, (req, res) => {
  res.render('auth/login', { title: 'Đăng nhập', layout: 'layouts/public', error: null, values: {} });
});

router.post('/login', requireGuest, authLimiter, async (req, res) => {
  const login = String(req.body.login || '').trim();
  const password = String(req.body.password || '');
  const user = login ? findByLogin.get(login, login) : null;
  const ok = user ? await verifyPassword(password, user.password_hash) : false;
  if (!ok) {
    return res.status(401).render('auth/login', {
      title: 'Đăng nhập',
      layout: 'layouts/public',
      error: 'Tên đăng nhập hoặc mật khẩu không đúng.',
      values: { login },
    });
  }
  const returnTo = safeReturnTo(req.session.returnTo);
  await startSession(req, user.id);
  res.redirect(returnTo);
});

router.get('/register', requireGuest, (req, res) => {
  res.render('auth/register', { title: 'Đăng ký', layout: 'layouts/public', error: null, values: {} });
});

router.post('/register', requireGuest, authLimiter, async (req, res) => {
  const username = String(req.body.username || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const confirm = String(req.body.confirm || '');
  const values = { username, email };

  let error = null;
  if (!USERNAME_RE.test(username)) error = 'Tên đăng nhập 3-30 ký tự, chỉ gồm chữ, số và dấu gạch dưới.';
  else if (!EMAIL_RE.test(email) || email.length > 254) error = 'Email không hợp lệ.';
  else if (password.length < 8 || password.length > 128) error = 'Mật khẩu phải từ 8 đến 128 ký tự.';
  else if (password !== confirm) error = 'Mật khẩu nhập lại không khớp.';
  else if (!req.body.terms) error = 'Bạn cần đồng ý với điều khoản dịch vụ.';
  else {
    const existing = findExisting.get(username, email);
    if (existing) {
      error = existing.username.toLowerCase() === username.toLowerCase()
        ? 'Tên đăng nhập đã được sử dụng.'
        : 'Email đã được sử dụng.';
    }
  }
  if (error) {
    return res.status(400).render('auth/register', { title: 'Đăng ký', layout: 'layouts/public', error, values });
  }

  const { lastInsertRowid } = insertUser.run(username, email, await hashPassword(password));
  await startSession(req, Number(lastInsertRowid));
  req.flash('success', 'Đăng ký thành công! Chào mừng bạn đến với SMM Panel.');
  res.redirect('/dashboard');
});

router.post('/logout', (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie('smm.sid');
    res.redirect('/');
  });
});

module.exports = router;
