# Điều tra trực tiếp Models — 10/10/2026

Bản đưa vào repository đã bỏ định danh tenant/model/macro và chi tiết cấu hình riêng; route có dấu hai chấm là mẫu tham số, không phải URL được ghi nguyên văn.

Nguồn: phiên web đã đăng nhập do người dùng cung cấp, tenant đã lược bỏ định danh, giao diện tiếng Việt, footer v1.73.0. Kiểm tra bằng trình duyệt; không Save, Build, tạo, xóa hay chỉnh dữ liệu production.

## 1. Các luồng đã kiểm tra

1. Mở `/tenants/:tenantId/models?view=lineage`.
2. Chọn một model đại diện và bấm Xem dòng dữ liệu; đọc panel, quan hệ và URL.
3. Bấm Chỉ hiện nút liên quan (`scope=related`): URL đổi, sau đó thao tác đọc trang bị timeout. Chưa xác định nguyên nhân ở ứng dụng hay công cụ điều khiển. Không coi đây là bằng chứng đã đo được hiệu năng hoặc xác định lỗi thuật toán.
4. Mở List trong tab kiểm tra riêng; tìm một model đại diện, xác nhận còn 1/205 kết quả.
5. Bấm tên model, đọc editor, thông tin phụ thuộc và cấu hình kiểm thử.
6. Mở liên kết lần chạy của model, đọc tóm tắt Nhật ký và bảng Các bước dbt.

## 2. Quan sát và hệ quả thiết kế

| Bằng chứng trực tiếp | Hệ quả cho plan |
|---|---|
| List hiển thị 205 model, tất cả dựng thành công ở thời điểm kiểm tra; ảnh người dùng gửi trước đó còn 2 model chưa dựng | Số liệu là snapshot, không cố định và không dùng ảnh cũ làm hiện trạng |
| Tìm kiếm tên hoạt động, URL có `q`; bộ lọc hiện dùng `build=failed/never/other/ok` | Giữ khả năng tìm kiếm và tương thích tham số cũ; không kết luận search lỗi từ ảnh |
| Năm khối trạng thái, biểu thức cộng, caption kết quả cùng lặp số lượng | Gộp thành tổng số và bộ lọc trạng thái gọn; không xóa khả năng lọc |
| Cột hiện tại: tên, kết quả dựng, run ID, số cột, SQL sửa lúc | Đưa run ID/số cột/SQL sửa lúc vào hồ sơ; thêm ngữ nghĩa và phạm vi có bằng chứng |
| Bấm tên dẫn tới `/models/:modelName`, một trang editor có Lưu/Dựng, cấu hình kiểm thử, xóa model | Tên mở hồ sơ đọc; giữ lối Sửa SQL trực tiếp theo quyền và route editor cũ |
| Form tạo model nằm cuối List | Thu về nút Tạo model mở luồng hiện hữu, không ép người tìm dữ liệu đi qua form |
| Lineage mặc định công bố 207 nút: 205 model, 2 bảng thô; 35 chưa khai báo, 0 phụ thuộc bị thiếu | Phân biệt thiếu khai báo và ref bị đứt; không biến 0 ref bị đứt thành quan hệ đầy đủ |
| Canvas báo Không sắp được sơ đồ; danh sách quan hệ văn bản vẫn có dữ liệu | Ưu tiên fallback có tìm/lọc theo model và sửa lỗi graph; không chỉ đổi mỹ thuật |
| Khi chọn model đại diện, trang ghi 105/207 nút liên quan, thượng nguồn 1 và hạ nguồn 103; danh sách Được đọc bởi có 16 tên trực tiếp | Gắn nhãn trực tiếp/qua nhiều bước, mặc định một bước, đếm distinct theo phạm vi; giữ đây là số được UI công bố, chưa kiểm chứng độc lập đồ thị |
| Panel model đại diện có 27 cột, SQL có thể mở, các danh sách quan hệ; phía dưới còn danh sách chuỗi và đường đi | Panel chỉ tóm tắt; SQL/schema dài chuyển về hồ sơ; graph và bảng là hai cách xem cùng phạm vi |
| Copy trang nói chỉ có ref/source kể cả macro, không có tài khoản nguồn và báo cáo | Không hứa end-to-end tới tài khoản nguồn/report; ghi phạm vi thu thập ngắn, dễ thấy |
| Model từ các nguồn nghiệp vụ khác nhau có quan hệ tới `raw.records` | Bảng lưu vật lý không đủ chứng minh nguồn nghiệp vụ; cần mapping qua ingestion/macro có bằng chứng |
| Editor model đại diện có comment giải thích mỗi dòng, tiền tệ, ngày; có tham chiếu tài liệu bên ngoài | Có thể dùng làm ứng viên metadata kèm nguồn để rà soát; chưa đọc tài liệu tham chiếu, không khẳng định nội dung đó đã xác thực hoặc khớp dữ liệu chạy |
| Editor có cấu hình not-null và unique | Cấu hình kiểm thử và kết quả kiểm thử là hai nhóm thông tin khác nhau |
| Nhật ký liên kết có tóm tắt 201 model, 716 kiểm thử, 0 không đạt và bảng bước dbt | Có nguồn kết quả vận hành để khảo sát adapter; không lấy tổng 716 áp cho từng model hay so ngang với tổng 205 hiện tại |
| `ref` qua macro của tenant xuất hiện trên trang | Quan hệ được khai báo không nhất thiết chỉ mang nghĩa truyền dữ liệu nghiệp vụ. Không tự ẩn model `chk_*` hoặc gán loại cạnh từ tên |

## 3. Giới hạn điều tra

- Đã kiểm tra UI của List, Lineage, một model đại diện và một run liên quan. Chưa kiểm tra mọi model, các role khác, mobile hoặc localhost trong lần này.
- Chưa đọc backend/code ở lần kiểm tra này; chưa biết nguyên nhân layout lỗi, shape API, khả năng preview độc lập hoặc hash phiên bản.
- Có lựa chọn bảng thô và link `model=raw.records` trong UI. Cần giữ tương thích; chưa nghiệm thu refocus bảng thô khi graph lỗi.
- Không xác nhận tên nghiệp vụ, lớp dữ liệu, grain, freshness, cost hay quyền cấp cột đã tồn tại dưới dạng metadata có cấu trúc.
- Không thực thi truy vấn dữ liệu mẫu và không thử các hành động ghi để điều tra UX.

## 4. Quyết định ưu tiên

P0: giữ khả năng đọc quan hệ khi layout lỗi, kiểm soát phạm vi và giữ link cũ.

P1: phân vai List/Lineage rõ; hồ sơ đọc dùng chung; lối tắt kỹ thuật; giảm lặp thông tin và giữ bằng chứng.

P2: metadata phân lớp/nghiệp vụ, tên dễ hiểu/grain, nguồn nghiệp vụ, preview, freshness và phiên bản SQL theo khả năng dữ liệu thực tế.

Các quyết định thiết kế mới được ghi trong PLAN/SPEC v1.2; đây là bản ghi quan sát, không phải cam kết ứng dụng đã được sửa.
