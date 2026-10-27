const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const expressLayouts = require('express-ejs-layouts');
const helmet = require('helmet');
const morgan = require('morgan');

const db = require('./src/db');
const SqliteStore = require('./src/session-store');
const { hashPassword } = require('./src/password');
const { csrfProtection, loadUser, flash, locals, requireAuth, requireAdmin } = require('./src/middleware');

const isProduction = process.env.NODE_ENV === 'production';
const PORT = process.env.PORT || 3000;

function sessionSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  if (isProduction) throw new Error('Thiếu biến môi trường SESSION_SECRET');
  const file = path.join(__dirname, 'data', '.session-secret');
  if (!fs.existsSync(file)) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  }
  return fs.readFileSync(file, 'utf8').trim();
}

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('layout', 'layouts/app');
app.set('trust proxy', process.env.TRUST_PROXY ? Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY : false);
app.disable('x-powered-by');

app.use(helmet());
if (process.env.NODE_ENV !== 'test') app.use(morgan(isProduction ? 'combined' : 'dev'));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: isProduction ? '7d' : 0 }));
app.use(express.urlencoded({ extended: false, limit: '20kb' }));
app.use(
  session({
    name: 'smm.sid',
    secret: sessionSecret(),
    store: new SqliteStore(db),
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: isProduction,
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  })
);
app.use(expressLayouts);
app.use(locals);
app.use(flash);
app.use(loadUser);
app.use(csrfProtection);

app.use('/', require('./routes/index'));
app.use('/', require('./routes/auth'));
app.use('/admin', requireAuth, requireAdmin, require('./routes/admin'));
app.use(['/dashboard', '/orders', '/funds', '/account'], requireAuth);
app.use('/', require('./routes/user'));

app.use((req, res) => {
  res.status(404).render('error', {
    title: 'Không tìm thấy trang',
    message: 'Trang bạn tìm không tồn tại.',
    layout: req.user ? 'layouts/app' : 'layouts/public',
  });
});

app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(500).render('error', {
    title: 'Lỗi máy chủ',
    message: isProduction ? 'Đã có lỗi xảy ra, vui lòng thử lại sau.' : err.message,
    layout: 'layouts/public',
  });
});

app.ready = db.seedUsers(hashPassword);

if (require.main === module) {
  app.ready.then(() => {
    const server = app.listen(PORT, () => {
      console.log(`SMM Panel đang chạy tại http://localhost:${PORT}`);
    });
    const shutdown = (signal) => {
      console.log(`Nhận ${signal}, đang tắt server...`);
      server.close(() => {
        db.close();
        process.exit(0);
      });
      setTimeout(() => process.exit(1), 10000).unref();
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  });
}

module.exports = app;
