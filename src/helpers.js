const ORDER_STATUSES = {
  pending: { label: 'Chờ xử lý', badge: 'bg-amber-100 text-amber-800' },
  processing: { label: 'Đang xử lý', badge: 'bg-sky-100 text-sky-800' },
  in_progress: { label: 'Đang chạy', badge: 'bg-indigo-100 text-indigo-800' },
  completed: { label: 'Hoàn thành', badge: 'bg-emerald-100 text-emerald-800' },
  partial: { label: 'Hoàn một phần', badge: 'bg-orange-100 text-orange-800' },
  canceled: { label: 'Đã hủy', badge: 'bg-rose-100 text-rose-800' },
};

const FINAL_STATUSES = ['completed', 'partial', 'canceled'];

const DEPOSIT_STATUSES = {
  pending: { label: 'Chờ duyệt', badge: 'bg-amber-100 text-amber-800' },
  approved: { label: 'Đã duyệt', badge: 'bg-emerald-100 text-emerald-800' },
  rejected: { label: 'Từ chối', badge: 'bg-rose-100 text-rose-800' },
};

const TRANSACTION_TYPES = {
  deposit: 'Nạp tiền',
  order: 'Đặt đơn',
  refund: 'Hoàn tiền',
  admin: 'Admin điều chỉnh',
};

const vndFormatter = new Intl.NumberFormat('vi-VN');

function formatVnd(amount) {
  return `${vndFormatter.format(Math.round(amount || 0))}đ`;
}

function formatNumber(n) {
  return vndFormatter.format(n || 0);
}

function formatDate(value) {
  if (!value) return '';
  const date = new Date(`${value.replace(' ', 'T')}Z`);
  return date.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false });
}

function calcCharge(rate, quantity) {
  return Math.ceil((rate * quantity) / 1000);
}

function toInt(value) {
  const n = Number.parseInt(String(value ?? '').replace(/[.,\s]/g, ''), 10);
  return Number.isSafeInteger(n) ? n : NaN;
}

function isValidUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

module.exports = {
  ORDER_STATUSES,
  FINAL_STATUSES,
  DEPOSIT_STATUSES,
  TRANSACTION_TYPES,
  formatVnd,
  formatNumber,
  formatDate,
  calcCharge,
  toInt,
  isValidUrl,
};
