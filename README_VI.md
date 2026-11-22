# Chiến Trường Online

Chơi nhiều người (tối đa 5 người) trên trình duyệt, đồng bộ theo kiểu lockstep tất định.

## Chạy
```
npm install
npm start          # mở http://localhost:3000
npm test           # kiểm tra lõi, hệ thống, và đồng bộ qua mạng (có kết nối lại)
npm run test:e2e   # kiểm tra trong trình duyệt thật (cần Python + Playwright + Chromium)
```

## Cách chơi
- Chọn quân bằng cách chạm; Shift để chọn nhiều; bật "Chọn vùng" rồi kéo để chọn vùng.
- Chạm đất hoặc thành địch, hoặc chuột phải để ra lệnh di chuyển.
- Đội hình: chọn từ 2 quân, rồi bấm Phalanx, Hình nêm hoặc Vuông rỗng. "Tách đội" để giải tán.
- Tư thế Tấn công hoặc Phòng thủ.
- Chạm thành của mình (khi không chọn quân) để sản xuất và xây tường (3 cấp).
- Tháp canh: bấm nút rồi chạm đất trên lãnh thổ của mình.
- Chiếm hết thành địch để thắng.
- Tải lại trang trong lúc chơi: trình duyệt tự kết nối lại và tiếp tục trận.

## Kiến trúc
- `core.js`: lõi mô phỏng tất định. Chỉ dùng số nguyên và phép tính IEEE cơ bản (+ - * / sqrt). Không dùng `Math.random`, thời gian thực hay hàm lượng giác trong mô phỏng.
- `lockstep.js`: mỗi máy gửi lệnh theo tick (không vượt quá DELAY+2 tick so với tick đã thực thi), nhận lệnh đã ghép và chạy mô phỏng. Gửi hash định kỳ để phát hiện lệch.
- `server.js`: ghép phòng, gom lệnh theo tick, phát bundle, lưu lịch sử để phục vụ kết nối lại. Không mô phỏng. Người không gửi lệnh trong 1,5 giây bị AI thay; quyết định này được phát cho mọi máy nên vẫn đồng bộ. Kết nối lại bằng token của phiên.
- `public/`: giao diện, sương mù và minimap (chỉ hiển thị).

## Đã có
Kinh tế, dân số và hao mòn quân, sản xuất, chỉ huy có giá tăng dần, chiếm thành và luật thủ đô, đội hình ba loại, aura chỉ huy, tháp canh, tường thành, tiếp tế, tinh thần và bỏ chạy, địa hình hoang dã (rừng/núi ngoài lãnh thổ mất máu), sông (hiển thị), sương mù, minimap, AI xây tường, kết nối lại sau khi rớt mạng.

## Hạn chế
- Các công thức tiếp tế, tinh thần và địa hình được suy ra từ đoạn mã HTML đã đọc, không sao chép từng dòng. Số liệu có thể lệch đôi chút so với bản HTML.
- Sông chỉ để hiển thị; quân đi qua sông như đi trên cầu (không bị chặn, không có hiệu ứng riêng).
- Bản đồ được sinh bằng nhiễu số nguyên nên không giống hệt bản HTML.
- AI đơn giản hơn bot của HTML: không lập đội hình và không xây tháp.
- Kết nối lại chỉ hoạt động khi phiên còn trên máy chủ; nếu trận đã kết thúc hoặc máy đã bị thay bằng AI thì người chơi quan sát nhưng không điều khiển được.
