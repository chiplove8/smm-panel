(() => {
  const formatVnd = (n) => `${new Intl.NumberFormat('vi-VN').format(Math.round(n || 0))}đ`;

  const sidebar = document.getElementById('sidebar');
  const backdrop = document.getElementById('sidebar-backdrop');
  const toggleSidebar = (open) => {
    if (!sidebar) return;
    sidebar.classList.toggle('-translate-x-full', !open);
    backdrop?.classList.toggle('hidden', !open);
  };
  document.querySelectorAll('[data-sidebar-open]').forEach((el) => el.addEventListener('click', () => toggleSidebar(true)));
  document.querySelectorAll('[data-sidebar-close]').forEach((el) => el.addEventListener('click', () => toggleSidebar(false)));

  const menu = document.getElementById('public-menu');
  document.querySelector('[data-menu-toggle]')?.addEventListener('click', () => menu?.classList.toggle('hidden'));

  document.querySelectorAll('form[data-confirm]').forEach((form) => {
    form.addEventListener('submit', (e) => {
      if (!confirm(form.dataset.confirm)) e.preventDefault();
    });
  });

  document.querySelectorAll('[data-dismiss]').forEach((btn) => {
    btn.addEventListener('click', () => btn.closest('[data-flash]')?.remove());
  });

  document.querySelectorAll('[data-autosubmit]').forEach((el) => {
    el.addEventListener('change', () => el.form?.submit());
  });

  const orderForm = document.getElementById('order-form');
  if (orderForm) {
    const services = JSON.parse(document.getElementById('services-data').textContent);
    const categorySelect = document.getElementById('category');
    const serviceSelect = document.getElementById('service');
    const quantityInput = document.getElementById('quantity');
    const info = document.getElementById('service-info');
    const chargeEl = document.getElementById('charge');
    const field = (name) => info.querySelector(`[data-field="${name}"]`);

    const fillServices = (categoryId, selectedId) => {
      serviceSelect.innerHTML = '';
      services
        .filter((s) => String(s.category_id) === String(categoryId))
        .forEach((s) => {
          const opt = new Option(`#${s.id} - ${s.name} - ${formatVnd(s.rate)}/1000`, s.id);
          if (String(s.id) === String(selectedId)) opt.selected = true;
          serviceSelect.add(opt);
        });
    };

    const update = () => {
      const s = services.find((x) => String(x.id) === serviceSelect.value);
      if (!s) {
        info.classList.add('hidden');
        chargeEl.textContent = formatVnd(0);
        return;
      }
      info.classList.remove('hidden');
      field('description').textContent = s.description || 'Không có mô tả.';
      field('min').textContent = s.min_qty.toLocaleString('vi-VN');
      field('max').textContent = s.max_qty.toLocaleString('vi-VN');
      field('rate').textContent = formatVnd(s.rate);
      field('time').textContent = s.avg_time || '-';
      quantityInput.min = s.min_qty;
      quantityInput.max = s.max_qty;
      const qty = Number(quantityInput.value) || 0;
      chargeEl.textContent = formatVnd(Math.ceil((s.rate * qty) / 1000));
    };

    const initial = services.find((s) => String(s.id) === serviceSelect.value) || services[0];
    if (initial) {
      categorySelect.value = initial.category_id;
      fillServices(initial.category_id, initial.id);
    }
    categorySelect.addEventListener('change', () => {
      fillServices(categorySelect.value);
      update();
    });
    serviceSelect.addEventListener('change', update);
    quantityInput.addEventListener('input', update);
    update();
  }

  const filterInput = document.getElementById('service-filter');
  const filterCategory = document.getElementById('service-category');
  if (filterInput || filterCategory) {
    const apply = () => {
      const text = (filterInput?.value || '').toLowerCase().trim();
      const cat = filterCategory?.value || '';
      document.querySelectorAll('[data-service-row]').forEach((row) => {
        const ok = (!text || row.dataset.search.includes(text)) && (!cat || row.dataset.category === cat);
        row.classList.toggle('hidden', !ok);
      });
      document.querySelectorAll('[data-category-group]').forEach((group) => {
        group.classList.toggle('hidden', !group.querySelector('[data-service-row]:not(.hidden)'));
      });
    };
    filterInput?.addEventListener('input', apply);
    filterCategory?.addEventListener('change', apply);
  }
})();
