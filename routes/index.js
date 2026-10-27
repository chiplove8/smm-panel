const express = require('express');

const router = express.Router();

router.get('/', (req, res) => {
  res.render('index', { title: 'Trang chủ' });
});

router.get('/about', (req, res) => {
  res.render('about', { title: 'Giới thiệu' });
});

router.get('/api/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

module.exports = router;
