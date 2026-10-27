# Express EJS App

Web app full-stack mẫu với Node.js, Express và EJS.

## Yêu cầu

- Node.js 24 LTS (xem `.nvmrc`; dùng `nvm use` nếu có nvm)
- npm >= 11

## Chạy dự án

```bash
npm install
npm run dev   # tự reload khi sửa code
# hoặc
npm start
npm test      # chạy test (node:test)
```

Mở http://localhost:3000 (đổi cổng bằng biến môi trường `PORT`).

## Cấu trúc

```
app.js            # khởi tạo Express, middleware, routes
routes/           # index (trang chủ, about, /api/health), todos (CRUD)
views/            # template EJS: layout, partials, các trang
public/           # file tĩnh: css, js
test/             # test tích hợp với node:test
```
