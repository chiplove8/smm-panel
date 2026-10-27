# SMM Panel

Web SMM panel (bán dịch vụ tăng like/follow/view mạng xã hội) viết bằng Node.js 24 LTS, Express 5, EJS, Tailwind CSS v4 và SQLite (better-sqlite3).

## Tính năng

- Đăng ký / đăng nhập / đăng xuất (mật khẩu băm scrypt, session lưu SQLite, CSRF, giới hạn số lần thử)
- Đặt đơn: chọn danh mục → dịch vụ, nhập link + số lượng, tự tính tiền, trừ số dư
- Lịch sử đơn (lọc trạng thái, tìm kiếm, phân trang), bảng giá dịch vụ (tìm kiếm, lọc)
- Nạp tiền: tạo yêu cầu với mã nội dung chuyển khoản, admin duyệt; lịch sử biến động số dư
- Tài khoản: xem thông tin, đổi mật khẩu
- Admin: thống kê, cập nhật trạng thái đơn (hủy/partial tự hoàn tiền), quản lý dịch vụ & danh mục, duyệt nạp tiền, cộng/trừ tiền thành viên
- Giao diện responsive, trên di động padding tối thiểu, bảng chuyển thành dạng thẻ

## Yêu cầu

- Node.js 24 LTS (xem `.nvmrc`), npm >= 11

## Chạy dự án

```bash
npm install
npm run dev        # build CSS rồi chạy server với --watch
npm run watch:css  # (terminal khác) build lại CSS khi sửa giao diện
npm test
```

Mở http://localhost:3000. Lần đầu chạy (không phải production) sẽ tạo sẵn:

- Admin: `admin` / `admin123`
- User demo: `demo` / `demo123` (số dư 500.000đ)

## Biến môi trường

| Biến | Mô tả |
| --- | --- |
| `PORT` | Cổng server (mặc định 3000) |
| `NODE_ENV` | `production` để bật cookie secure, ẩn lỗi chi tiết |
| `SESSION_SECRET` | Bắt buộc khi production |
| `ADMIN_USERNAME`, `ADMIN_PASSWORD` | Tài khoản admin tạo lần đầu |
| `DB_PATH` | Đường dẫn file SQLite (mặc định `data/smm.db`) |
| `TRUST_PROXY` | Đặt `1` nếu chạy sau Nginx/Cloudflare |

## Cấu trúc

```
app.js              # khởi tạo Express, session, middleware, routes
src/db.js           # schema SQLite + dữ liệu mẫu
src/middleware.js   # CSRF, flash, auth, admin
src/helpers.js      # format tiền, trạng thái đơn...
routes/             # index (public), auth, user, admin
views/              # EJS: layouts (app, public), partials, user, admin, auth
src/styles/input.css → public/css/app.css (Tailwind)
public/js/app.js    # menu di động, tính tiền đơn hàng, lọc dịch vụ
test/               # test tích hợp (node:test)
```
