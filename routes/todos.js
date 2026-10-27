const express = require('express');

const router = express.Router();

let nextId = 3;
const todos = [
  { id: 1, text: 'Học Express', done: true },
  { id: 2, text: 'Viết giao diện bằng EJS', done: false },
];

router.get('/', (req, res) => {
  res.render('todos', { title: 'Công việc', todos, error: null });
});

router.post('/', (req, res) => {
  const text = (req.body.text || '').trim();
  if (!text) {
    return res.status(400).render('todos', {
      title: 'Công việc',
      todos,
      error: 'Vui lòng nhập nội dung công việc.',
    });
  }
  todos.push({ id: nextId++, text, done: false });
  res.redirect('/todos');
});

router.post('/:id/toggle', (req, res) => {
  const todo = todos.find((t) => t.id === Number(req.params.id));
  if (todo) todo.done = !todo.done;
  res.redirect('/todos');
});

router.post('/:id/delete', (req, res) => {
  const index = todos.findIndex((t) => t.id === Number(req.params.id));
  if (index !== -1) todos.splice(index, 1);
  res.redirect('/todos');
});

module.exports = router;
