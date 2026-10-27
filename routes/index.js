const express = require('express');
const db = require('../src/db');

const router = express.Router();

const listCategories = db.prepare('SELECT * FROM categories ORDER BY sort, id');
const listActiveServices = db.prepare(`
  SELECT s.*, c.name AS category_name, c.platform
  FROM services s JOIN categories c ON c.id = s.category_id
  WHERE s.active = 1
  ORDER BY c.sort, c.id, s.id
`);
const stats = db.prepare(`
  SELECT (SELECT COUNT(*) FROM users) AS users,
         (SELECT COUNT(*) FROM orders) AS orders,
         (SELECT COUNT(*) FROM services WHERE active = 1) AS services
`);

router.get('/', (req, res) => {
  if (req.user) return res.redirect('/dashboard');
  const services = listActiveServices.all();
  res.render('home', {
    title: 'SMM Panel - Dịch vụ mạng xã hội giá rẻ',
    layout: 'layouts/public',
    stats: stats.get(),
    platforms: [...new Set(listCategories.all().map((c) => c.platform))],
    featured: services.slice(0, 6),
  });
});

router.get('/services', (req, res) => {
  res.render('services', {
    title: 'Bảng giá dịch vụ',
    layout: req.user ? 'layouts/app' : 'layouts/public',
    categories: listCategories.all(),
    services: listActiveServices.all(),
  });
});

router.get('/terms', (req, res) => {
  res.render('terms', { title: 'Điều khoản dịch vụ', layout: req.user ? 'layouts/app' : 'layouts/public' });
});

router.get('/healthz', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

module.exports = router;
