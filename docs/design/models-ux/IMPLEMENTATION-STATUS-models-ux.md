# Trạng thái thi công Models

**Audit bàn giao 2026-10-11:** quy trình review/source ở [README.md](README.md); commit và trạng thái xuất bản được ghi trong PR. Phát hiện `ModelChooser.tsx` dùng `dialog.showModal()` trái DESIGN.md; SPEC §10.3 đã sửa thành inline, implementation còn phải sửa và kiểm tra. Kết quả kiểm tra trước đó không chứng minh tuân thủ quy tắc này. Metadata nghiệp vụ vẫn có điều kiện theo ADR 0112; fixture không phải production capability.

**Baseline yêu cầu:** 2.0. **Ngày cập nhật:** 2026-10-11. **Phạm vi:** prototype local đã chạy được; tích hợp production chưa bắt đầu.

Yêu cầu chuẩn nằm ở [SPEC](./SPEC-models-ux.md); trình tự ở [PLAN](./PLAN-models-ux.md). Hướng dẫn chạy, mốc tương thích, capability và giới hạn ở [PROTOTYPE-HANDOFF](./PROTOTYPE-HANDOFF.md).

## 1. Các giai đoạn

| Giai đoạn | Trạng thái                             | Bằng chứng / phần còn lại                                                                                                                 |
| --------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Chuẩn bị  | Hoàn tất tài liệu baseline 2.0         | Giữ nguyên 118 AC; không biến yêu cầu thành nhật ký                                                                                       |
| P0        | Đã xác minh checkout và upstream       | HEAD bc5e774; code nền 69d6928; đối chiếu origin/main 6bb345e. Chưa chạy gate trên upstream mới                                           |
| P1        | Có fixture và state                    | 250/1.000 model; metadata khai báo; Zustand + URL; pure logic có test. Chưa đủ tất cả F01–F11                                             |
| P2        | Có danh sách và hồ sơ                  | Nhóm trước phân trang, 25 hàng, tìm toàn tập, bốn mục hồ sơ; schema/SQL/sample tải theo yêu cầu                                           |
| P3        | Có bảng/chọn hàng loạt                 | Chọn trang/tất cả, bỏ chọn kết quả/tất cả, hủy draft, giữ lựa chọn trong URL, bảng tập chọn, mở/thu nhánh                                 |
| P4        | Có sơ đồ Worker và giới hạn            | Lazy React Flow/ELK Worker, tối đa 12 node thử nghiệm, timeout/hủy, cache 8; camera trong Zustand. Chưa đo p95/đồ thị dày hoặc production |
| P5        | Bản local để review; nghiệm thu còn mở | Build thành công; checks tập trung và QA browser có bằng chứng. Full gate chưa xanh; xem handoff                                          |

## 2. Môi trường

- Windows, Bun 1.4.3, dependencies theo bun.lock hiện hữu; không nâng phiên bản thư viện.
- Lệnh: task dev:models-prototype. URL: http://127.0.0.1:5174/tenants/CASE-0042/models.
- Browser: Codex in-app browser; desktop khoảng 1.268 × 714; đã kiểm tra viewport 390 × 844, trả lại mặc định sau kiểm tra.
- Tenant và tài khoản đều tổng hợp; API production không được gọi. ProfileSource mới là seam fixture, chưa là adapter production.
- Book/TabRail/index.css/divisions giữ nguyên trong diff. Chưa có VRT chứng minh pixel equivalence mọi viewport/motion.

## 3. Bằng chứng thực thi

- Unit logic: phân lớp explicit; nguồn partial/complete; lọc giao nhau; tìm alias/tên/mô tả; giữ thứ tự nhóm trước phân trang; cycle/shared paths/raw root.
- Component: chọn toàn bộ qua nhiều trang; Hủy không làm mất tập đã áp dụng; tải lại URL khôi phục đủ 103 đối tượng gồm root; profile/Back giữ trang lọc; preview tiền chỉ tải theo yêu cầu.
- Browser: chọn 102 đối tượng rồi xem bảng 5 trang; reload vẫn giữ lựa chọn; trang cuối có đủ dữ liệu; hủy thay đổi draft không làm đổi bảng; schema/sample có currency; màn hình hẹp dùng bảng không mount canvas; tìm trên bộ 1.000 model.
- TypeScript, lint/rules và build đã chạy; kết quả final được ghi trong handoff. Full verify bị format CRLF, full test có lỗi ngoài phạm vi nhưng chưa chứng minh tất cả là lỗi baseline.
- Chưa tuyên bố hoàn tất 118 AC, chưa chứng minh quyền thật hoặc đã sửa độ trễ production.

## 4. Tài liệu

PLAN/SPEC/PROMPT vẫn là baseline 2.0. STATUS chỉ ghi kết quả có bằng chứng. Bản bàn giao được đồng bộ sang outputs của workspace; source chuẩn là docs/design/models-ux trong repo.

## 5. Ma trận kết quả nghiệm thu

Quy ước: `not-run` chưa chạy; `pass` có bằng chứng đạt; `fail` có lỗi; `not-applicable` phải ghi phạm vi/capability và fallback. Môi trường phải là fixture hoặc integrated. Trạng thái fixture pass không thay bằng integrated pass. Chỉ ghi đường dẫn test/log/screenshot không chứa PII; không chép lại yêu cầu trong bảng này.

| AC     | Trạng thái | Môi trường | Bằng chứng / lý do / việc cần sửa                                                       |
| ------ | ---------- | ---------- | --------------------------------------------------------------------------------------- |
| AC-01  | pass       | fixture    | Browser: mở List không dựng canvas; component và catalog tests.                         |
| AC-02  | pass       | fixture    | catalog.test.ts + browser: tìm int_invoice_balance trên bộ 1.000 model ngoài trang đầu. |
| AC-03  | not-run    | —          | Chưa nghiệm thu đầy đủ; xem phần 3 và handoff                                           |
| AC-04  | not-run    | —          | Chưa nghiệm thu đầy đủ; xem phần 3 và handoff                                           |
| AC-05  | not-run    | —          | Chưa nghiệm thu đầy đủ; xem phần 3 và handoff                                           |
| AC-06  | not-run    | —          | Chưa nghiệm thu đầy đủ; xem phần 3 và handoff                                           |
| AC-07  | not-run    | —          | Chưa nghiệm thu đầy đủ; xem phần 3 và handoff                                           |
| AC-08  | not-run    | —          | Chưa nghiệm thu đầy đủ; xem phần 3 và handoff                                           |
| AC-09  | not-run    | —          | Chưa nghiệm thu đầy đủ; xem phần 3 và handoff                                           |
| AC-10  | not-run    | —          | Chưa nghiệm thu đầy đủ; xem phần 3 và handoff                                           |
| AC-11  | not-run    | —          | Chưa nghiệm thu đầy đủ; xem phần 3 và handoff                                           |
| AC-12  | not-run    | —          | Chưa nghiệm thu đầy đủ; xem phần 3 và handoff                                           |
| AC-13  | not-run    | —          | Chưa nghiệm thu đầy đủ; xem phần 3 và handoff                                           |
| AC-14  | not-run    | —          | Chưa nghiệm thu đầy đủ; xem phần 3 và handoff                                           |
| AC-15  | not-run    | —          | Chưa nghiệm thu đầy đủ; xem phần 3 và handoff                                           |
| AC-16  | not-run    | —          | Chưa nghiệm thu đầy đủ; xem phần 3 và handoff                                           |
| AC-17  | not-run    | —          | Chưa nghiệm thu đầy đủ; xem phần 3 và handoff                                           |
| AC-18  | not-run    | —          | Chưa nghiệm thu đầy đủ; xem phần 3 và handoff                                           |
| AC-19  | not-run    | —          | Chưa nghiệm thu đầy đủ; xem phần 3 và handoff                                           |
| AC-20  | not-run    | —          | Chưa nghiệm thu đầy đủ; xem phần 3 và handoff                                           |
| AC-21  | not-run    | —          | Chưa nghiệm thu đầy đủ; xem phần 3 và handoff                                           |
| AC-22  | pass       | fixture    | Profile overview ghi chưa có bằng chứng SQL sync; không suy từ timestamp.               |
| AC-23  | not-run    | —          | Chưa nghiệm thu đầy đủ; xem phần 3 và handoff                                           |
| AC-24  | not-run    | —          | Chưa nghiệm thu đầy đủ; xem phần 3 và handoff                                           |
| AC-25  | not-run    | —          | Chưa nghiệm thu đầy đủ; xem phần 3 và handoff                                           |
| AC-26  | not-run    | —          | Chưa nghiệm thu đầy đủ; xem phần 3 và handoff                                           |
| AC-27  | not-run    | —          | Chưa nghiệm thu đầy đủ; xem phần 3 và handoff                                           |
| AC-28  | not-run    | —          | Chưa nghiệm thu đầy đủ; xem phần 3 và handoff                                           |
| AC-29  | not-run    | —          | Chưa nghiệm thu đầy đủ; xem phần 3 và handoff                                           |
| AC-30  | not-run    | —          | Chưa nghiệm thu đầy đủ; xem phần 3 và handoff                                           |
| AC-31  | not-run    | —          | Chưa nghiệm thu đầy đủ; xem phần 3 và handoff                                           |
| AC-32  | not-run    | —          | Chưa nghiệm thu đầy đủ; xem phần 3 và handoff                                           |
| AC-33  | not-run    | —          | Chưa nghiệm thu đầy đủ; xem phần 3 và handoff                                           |
| AC-34  | not-run    | —          | Chưa nghiệm thu đầy đủ; xem phần 3 và handoff                                           |
| AC-35  | not-run    | —          | Chưa nghiệm thu đầy đủ; xem phần 3 và handoff                                           |
| AC-36  | not-run    | —          | Chưa nghiệm thu đầy đủ; xem phần 3 và handoff                                           |
| AC-37  | not-run    | —          | Chưa nghiệm thu đầy đủ; xem phần 3 và handoff                                           |
| AC-38  | not-run    | —          | Chưa nghiệm thu đầy đủ; xem phần 3 và handoff                                           |
| AC-39  | not-run    | —          | Chưa nghiệm thu đầy đủ; xem phần 3 và handoff                                           |
| AC-40  | not-run    | —          | Chưa nghiệm thu đầy đủ; xem phần 3 và handoff                                           |
| AC-41  | not-run    | —          | Chưa nghiệm thu đầy đủ; xem phần 3 và handoff                                           |
| AC-42  | not-run    | —          | Chưa nghiệm thu đầy đủ; xem phần 3 và handoff                                           |
| AC-43  | pass       | fixture    | Browser: chỉ hai tab cấp cao, hồ sơ dùng chung bốn mục.                                 |
| AC-44  | not-run    | —          | Chưa nghiệm thu đầy đủ; xem phần 3 và handoff                                           |
| AC-45  | not-run    | —          | Chưa nghiệm thu đầy đủ; xem phần 3 và handoff                                           |
| AC-46  | not-run    | —          | Chưa nghiệm thu đầy đủ; xem phần 3 và handoff                                           |
| AC-47  | not-run    | —          | Chưa nghiệm thu đầy đủ; xem phần 3 và handoff                                           |
| AC-48  | pass       | fixture    | catalog.test.ts: legacy build aliases và ưu tiên status.                                |
| AC-49  | not-run    | —          | Chưa nghiệm thu đầy đủ; xem phần 3 và handoff                                           |
| AC-50  | not-run    | —          | Chưa nghiệm thu đầy đủ; xem phần 3 và handoff                                           |
| AC-51  | not-run    | —          | Chưa nghiệm thu đầy đủ; xem phần 3 và handoff                                           |
| AC-52  | not-run    | —          | Chưa nghiệm thu đầy đủ; xem phần 3 và handoff                                           |
| AC-53  | not-run    | —          | Chưa nghiệm thu đầy đủ; xem phần 3 và handoff                                           |
| AC-54  | not-run    | —          | Chưa nghiệm thu đầy đủ; xem phần 3 và handoff                                           |
| AC-55  | not-run    | —          | Chưa nghiệm thu đầy đủ; xem phần 3 và handoff                                           |
| AC-56  | not-run    | —          | Chưa nghiệm thu đầy đủ; xem phần 3 và handoff                                           |
| AC-57  | not-run    | —          | Chưa nghiệm thu đầy đủ; xem phần 3 và handoff                                           |
| AC-58  | not-run    | —          | Chưa nghiệm thu đầy đủ; xem phần 3 và handoff                                           |
| AC-59  | pass       | fixture    | Diff chỉ giữ trợ lý Book hiện hữu; không thêm AI vào Models.                            |
| AC-60  | not-run    | —          | Chưa nghiệm thu đầy đủ; xem phần 3 và handoff                                           |
| AC-61  | not-run    | —          | Chưa nghiệm thu đầy đủ; xem phần 3 và handoff                                           |
| AC-62  | not-run    | —          | Chưa nghiệm thu đầy đủ; xem phần 3 và handoff                                           |
| AC-63  | not-run    | —          | Chưa nghiệm thu đầy đủ; xem phần 3 và handoff                                           |
| AC-64  | not-run    | —          | Chưa nghiệm thu đầy đủ; xem phần 3 và handoff                                           |
| AC-65  | not-run    | —          | Chưa nghiệm thu đầy đủ; xem phần 3 và handoff                                           |
| AC-66  | not-run    | —          | Chưa nghiệm thu đầy đủ; xem phần 3 và handoff                                           |
| AC-67  | not-run    | —          | Chưa nghiệm thu đầy đủ; xem phần 3 và handoff                                           |
| AC-68  | not-run    | —          | Chưa nghiệm thu đầy đủ; xem phần 3 và handoff                                           |
| AC-69  | not-run    | —          | Chưa nghiệm thu đầy đủ; xem phần 3 và handoff                                           |
| AC-70  | not-run    | —          | Chưa nghiệm thu đầy đủ; xem phần 3 và handoff                                           |
| AC-71  | not-run    | —          | Chưa nghiệm thu đầy đủ; xem phần 3 và handoff                                           |
| AC-72  | not-run    | —          | Chưa nghiệm thu đầy đủ; xem phần 3 và handoff                                           |
| AC-73  | pass       | fixture    | Browser/catalog tests: tìm toàn bộ 1.000 model; List giới hạn 25 hàng.                  |
| AC-74  | not-run    | —          | Chưa nghiệm thu đầy đủ; xem phần 3 và handoff                                           |
| AC-75  | not-run    | —          | Chưa nghiệm thu đầy đủ; xem phần 3 và handoff                                           |
| AC-76  | not-run    | —          | Chưa nghiệm thu đầy đủ; xem phần 3 và handoff                                           |
| AC-77  | not-run    | —          | Chưa nghiệm thu đầy đủ; xem phần 3 và handoff                                           |
| AC-78  | not-run    | —          | Chưa nghiệm thu đầy đủ; xem phần 3 và handoff                                           |
| AC-79  | not-run    | —          | Chưa nghiệm thu đầy đủ; xem phần 3 và handoff                                           |
| AC-80  | not-run    | —          | Chưa nghiệm thu đầy đủ; xem phần 3 và handoff                                           |
| AC-81  | not-run    | —          | Chưa nghiệm thu đầy đủ; xem phần 3 và handoff                                           |
| AC-82  | not-run    | —          | Chưa nghiệm thu đầy đủ; xem phần 3 và handoff                                           |
| AC-83  | not-run    | —          | Chưa nghiệm thu đầy đủ; xem phần 3 và handoff                                           |
| AC-84  | not-run    | —          | Chưa nghiệm thu đầy đủ; xem phần 3 và handoff                                           |
| AC-85  | not-run    | —          | Chưa nghiệm thu đầy đủ; xem phần 3 và handoff                                           |
| AC-86  | not-run    | —          | Chưa nghiệm thu đầy đủ; xem phần 3 và handoff                                           |
| AC-87  | not-run    | —          | Chưa nghiệm thu đầy đủ; xem phần 3 và handoff                                           |
| AC-88  | not-run    | —          | Chưa nghiệm thu đầy đủ; xem phần 3 và handoff                                           |
| AC-89  | not-run    | —          | Chưa nghiệm thu đầy đủ; xem phần 3 và handoff                                           |
| AC-90  | not-run    | —          | Chưa nghiệm thu đầy đủ; xem phần 3 và handoff                                           |
| AC-91  | not-run    | —          | Chưa nghiệm thu đầy đủ; xem phần 3 và handoff                                           |
| AC-92  | not-run    | —          | Chưa nghiệm thu đầy đủ; xem phần 3 và handoff                                           |
| AC-93  | not-run    | —          | Chưa nghiệm thu đầy đủ; xem phần 3 và handoff                                           |
| AC-94  | not-run    | —          | Chưa nghiệm thu đầy đủ; xem phần 3 và handoff                                           |
| AC-95  | not-run    | —          | Chưa nghiệm thu đầy đủ; xem phần 3 và handoff                                           |
| AC-96  | not-run    | —          | Chưa nghiệm thu đầy đủ; xem phần 3 và handoff                                           |
| AC-97  | not-run    | —          | Chưa nghiệm thu đầy đủ; xem phần 3 và handoff                                           |
| AC-98  | not-run    | —          | Chưa nghiệm thu đầy đủ; xem phần 3 và handoff                                           |
| AC-99  | not-run    | —          | Chưa nghiệm thu đầy đủ; xem phần 3 và handoff                                           |
| AC-100 | not-run    | —          | Chưa nghiệm thu đầy đủ; xem phần 3 và handoff                                           |
| AC-101 | not-run    | —          | Chưa nghiệm thu đầy đủ; xem phần 3 và handoff                                           |
| AC-102 | not-run    | —          | Chưa nghiệm thu đầy đủ; xem phần 3 và handoff                                           |
| AC-103 | not-run    | —          | Chưa nghiệm thu đầy đủ; xem phần 3 và handoff                                           |
| AC-104 | not-run    | —          | Chưa nghiệm thu đầy đủ; xem phần 3 và handoff                                           |
| AC-105 | not-run    | —          | Chưa nghiệm thu đầy đủ; xem phần 3 và handoff                                           |
| AC-106 | not-run    | —          | Chưa nghiệm thu đầy đủ; xem phần 3 và handoff                                           |
| AC-107 | not-run    | —          | Chưa nghiệm thu đầy đủ; xem phần 3 và handoff                                           |
| AC-108 | not-run    | —          | Chưa nghiệm thu đầy đủ; xem phần 3 và handoff                                           |
| AC-109 | not-run    | —          | Chưa nghiệm thu đầy đủ; xem phần 3 và handoff                                           |
| AC-110 | not-run    | —          | Chưa nghiệm thu đầy đủ; xem phần 3 và handoff                                           |
| AC-111 | not-run    | —          | Chưa nghiệm thu đầy đủ; xem phần 3 và handoff                                           |
| AC-112 | not-run    | —          | Chưa nghiệm thu đầy đủ; xem phần 3 và handoff                                           |
| AC-113 | not-run    | —          | Chưa nghiệm thu đầy đủ; xem phần 3 và handoff                                           |
| AC-114 | not-run    | —          | Chưa nghiệm thu đầy đủ; xem phần 3 và handoff                                           |
| AC-115 | not-run    | —          | Chưa nghiệm thu đầy đủ; xem phần 3 và handoff                                           |
| AC-116 | not-run    | —          | Chưa nghiệm thu đầy đủ; xem phần 3 và handoff                                           |
| AC-117 | not-run    | —          | Chưa nghiệm thu đầy đủ; xem phần 3 và handoff                                           |
| AC-118 | not-run    | —          | Chưa nghiệm thu đầy đủ; xem phần 3 và handoff                                           |
