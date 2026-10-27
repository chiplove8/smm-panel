const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'smm.db');
if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  balance INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  platform TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS services (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL REFERENCES categories(id),
  name TEXT NOT NULL,
  rate INTEGER NOT NULL CHECK (rate > 0),
  min_qty INTEGER NOT NULL CHECK (min_qty > 0),
  max_qty INTEGER NOT NULL CHECK (max_qty >= min_qty),
  avg_time TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  service_id INTEGER NOT NULL REFERENCES services(id),
  link TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  charge INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  start_count INTEGER,
  remains INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id, id DESC);

CREATE TABLE IF NOT EXISTS deposits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  amount INTEGER NOT NULL CHECK (amount > 0),
  method TEXT NOT NULL,
  reference TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  type TEXT NOT NULL,
  amount INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_id, id DESC);
`);

const SEED_SERVICES = [
  ['Facebook - Like bài viết', 'facebook', [
    ['Like bài viết Việt Nam - tốc độ nhanh', 18000, 50, 50000, '0-2 giờ', 'Like từ tài khoản Việt Nam, bảo hành 30 ngày.'],
    ['Like bài viết Clone - giá rẻ', 9000, 100, 100000, '0-6 giờ', 'Like từ tài khoản clone, không bảo hành.'],
  ]],
  ['Facebook - Follow / Theo dõi', 'facebook', [
    ['Follow trang cá nhân Việt Nam', 35000, 100, 30000, '1-12 giờ', 'Theo dõi profile, bảo hành 30 ngày.'],
    ['Like + Follow Fanpage', 45000, 100, 50000, '1-24 giờ', 'Tăng like và follow fanpage, bảo hành 60 ngày.'],
  ]],
  ['TikTok', 'tiktok', [
    ['TikTok Follow - tài khoản thật', 60000, 100, 20000, '0-12 giờ', 'Follow từ tài khoản có avatar, tụt ít.'],
    ['TikTok Tim (Like) video', 12000, 100, 100000, '0-1 giờ', 'Tim video tốc độ cao.'],
    ['TikTok View video', 900, 1000, 10000000, '0-30 phút', 'View video, khởi chạy tức thì.'],
  ]],
  ['Instagram', 'instagram', [
    ['Instagram Follow quốc tế', 50000, 100, 50000, '0-6 giờ', 'Follow quốc tế, bảo hành 30 ngày.'],
    ['Instagram Like bài viết', 8000, 50, 50000, '0-1 giờ', 'Like bài viết, không bảo hành.'],
  ]],
  ['YouTube', 'youtube', [
    ['YouTube View - giữ chân 1-3 phút', 40000, 500, 1000000, '6-24 giờ', 'View có thời gian xem, an toàn kiếm tiền.'],
    ['YouTube Subscribe', 250000, 50, 10000, '1-3 ngày', 'Sub thật, bảo hành 30 ngày.'],
    ['YouTube Like video', 30000, 50, 50000, '0-12 giờ', 'Like video.'],
  ]],
  ['Telegram', 'telegram', [
    ['Telegram thành viên Channel/Group', 25000, 100, 100000, '0-6 giờ', 'Thành viên cho channel hoặc group public.'],
    ['Telegram View bài viết', 1500, 100, 1000000, '0-30 phút', 'View 1 bài viết mới nhất.'],
  ]],
];

function seedCatalog() {
  const { count } = db.prepare('SELECT COUNT(*) AS count FROM categories').get();
  if (count > 0) return;
  const insertCategory = db.prepare('INSERT INTO categories (name, platform, sort) VALUES (?, ?, ?)');
  const insertService = db.prepare(
    'INSERT INTO services (category_id, name, rate, min_qty, max_qty, avg_time, description) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  db.transaction(() => {
    SEED_SERVICES.forEach(([name, platform, services], index) => {
      const { lastInsertRowid } = insertCategory.run(name, platform, index);
      for (const s of services) insertService.run(lastInsertRowid, ...s);
    })
  })();
}

async function seedUsers(hashPassword) {
  const { count } = db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin'").get();
  if (count > 0) return;
  const isProduction = process.env.NODE_ENV === 'production';
  const adminUser = process.env.ADMIN_USERNAME || 'admin';
  let adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword) {
    adminPassword = isProduction ? crypto.randomBytes(9).toString('base64url') : 'admin123';
    if (process.env.NODE_ENV !== 'test') {
      console.log(`Đã tạo tài khoản admin: ${adminUser} / ${adminPassword} (hãy đổi mật khẩu ngay)`);
    }
  }
  const insert = db.prepare(
    'INSERT INTO users (username, email, password_hash, role, balance) VALUES (?, ?, ?, ?, ?)'
  );
  insert.run(adminUser, `${adminUser}@example.com`, await hashPassword(adminPassword), 'admin', 0);
  if (!isProduction) {
    insert.run('demo', 'demo@example.com', await hashPassword('demo123'), 'user', 500000);
  }
}

seedCatalog();

module.exports = db;
module.exports.seedUsers = seedUsers;
