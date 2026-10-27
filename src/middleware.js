const crypto = require('crypto');
const db = require('./db');
const helpers = require('./helpers');

const getUser = db.prepare('SELECT id, username, email, balance, role, created_at FROM users WHERE id = ?');

function newToken() {
  return crypto.randomBytes(24).toString('hex');
}

function csrfProtection(req, res, next) {
  if (!req.session.csrfToken) req.session.csrfToken = newToken();
  res.locals.csrfToken = req.session.csrfToken;
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();

  const sent = Buffer.from(String(req.body?._csrf ?? ''));
  const expected = Buffer.from(req.session.csrfToken);
  if (sent.length === expected.length && crypto.timingSafeEqual(sent, expected)) return next();

  res.status(403).render('error', {
    title: 'Phiên không hợp lệ',
    message: 'Phiên làm việc đã hết hạn hoặc không hợp lệ. Vui lòng tải lại trang và thử lại.',
    layout: 'layouts/public',
  });
}

function loadUser(req, res, next) {
  res.locals.user = null;
  if (req.session.userId) {
    const user = getUser.get(req.session.userId);
    if (user) {
      req.user = user;
      res.locals.user = user;
    } else {
      delete req.session.userId;
    }
  }
  next();
}

function flash(req, res, next) {
  req.flash = (type, message) => {
    req.session.flash = [...(req.session.flash || []), { type, message }];
  };
  res.locals.flash = req.session.flash || [];
  delete req.session.flash;
  next();
}

function locals(req, res, next) {
  Object.assign(res.locals, helpers, { currentPath: req.path });
  next();
}

function requireAuth(req, res, next) {
  if (req.user) return next();
  req.session.returnTo = req.originalUrl;
  res.redirect('/login');
}

function requireGuest(req, res, next) {
  if (req.user) return res.redirect('/dashboard');
  next();
}

function requireAdmin(req, res, next) {
  if (req.user?.role === 'admin') return next();
  res.status(403).render('error', { title: 'Không có quyền', message: 'Bạn không có quyền truy cập trang này.' });
}

module.exports = { csrfProtection, loadUser, flash, locals, requireAuth, requireGuest, requireAdmin, newToken };
