document.querySelectorAll('.delete-form').forEach((form) => {
  form.addEventListener('submit', (e) => {
    if (!confirm('Xóa công việc này?')) e.preventDefault();
  });
});
