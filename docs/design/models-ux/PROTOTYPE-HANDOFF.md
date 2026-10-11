# Models prototype — bàn giao local

**Review bắt đầu tại [README.md](README.md):** full source đọc trực tiếp trong Git, chạy đúng bản gốc trước khi đề xuất sửa. Xem [SOURCE-INVENTORY.md](SOURCE-INVENTORY.md) để kiểm kê; không dựng demo thay thế từ ảnh. Commit và trạng thái xuất bản được ghi trong PR.

**Sai khác đang mở:** `ModelChooser.tsx` dùng `dialog.showModal()` trái quy tắc no-modal; SPEC đã yêu cầu inline, code chưa sửa. Metadata nghiệp vụ trong fixture không chứng minh backend có hỗ trợ; ADR 0112 vẫn có hiệu lực. Chưa thể tuyên bố tương thích đầy đủ hoặc PR ready.

Ngày kiểm tra: 2026-10-11. Yêu cầu chuẩn vẫn là PLAN/SPEC baseline 2.0. Đây là hướng dẫn chạy và tích hợp, không thay spec và không tuyên bố mọi AC đã đạt.

## Chạy thử

Từ thư mục gốc repo:

```text
task dev:install
task dev:models-prototype
```

Mở `http://127.0.0.1:5174/tenants/CASE-0042/models`. Vite chỉ bind loopback. Bộ dữ liệu 250/1.000 model được chọn trên banner. Đây là dữ liệu tổng hợp, không phải tenant thật.

Các luồng nên duyệt:

1. Danh sách → Đầu vào: cột **Nguồn dữ liệu**. Biến đổi/Đầu ra: cột **Nghiệp vụ**. Chưa phân lớp: **Nhóm kỹ thuật**. Mỗi trang tối đa 25 model; nhóm theo metadata khai báo trước khi phân trang.
2. Tìm `int_invoice_balance` → mở tên model → bốn mục Hiểu dữ liệu, Dữ liệu, SQL & cấu hình, Vận hành. Mẫu dữ liệu chỉ tải sau khi bấm yêu cầu. Cả `int_invoice_balance` và `int_demo_011` có schema/SQL và bằng chứng vận hành giả lập; model chưa có chi tiết ghi thiếu dữ liệu.
3. Xem luồng → mặc định hai phía, một bước; sơ đồ chỉ vẽ một tập nhỏ. Chọn model để xem nhanh; mở/thu thêm nhánh, đổi hướng/số bước, Hoàn tác.
4. Hiện thêm model → chọn trang/chọn toàn bộ kết quả, bỏ chọn riêng kết quả hoặc bỏ hết, xem số chọn ngoài từ khóa. Tập lớn giữ nguyên qua phân trang và chuyển sang bảng. Không âm thầm cắt tập lựa chọn để vẽ.
5. Chọn toàn bộ tác động → bảng downstream toàn chuỗi đã biết. Back và URL lưu lớp/query/page/root/hướng/phạm vi/tập đã áp dụng. Màn hình dưới 768 px dùng bảng.

## Ranh giới với ứng dụng thật

### Hồ sơ kỹ thuật có thể duyệt

Mở `?view=detail&model=int_demo_011` hoặc `int_invoice_balance`. Chỉ hai model này có bộ bằng chứng kỹ thuật được viết rõ trong fixture, không tự sao chép số đo cho 250/1.000 model.

| Tab            | Nội dung đã minh họa                                                                                                      | Nguồn cần có khi tích hợp thật                                                       |
| -------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Hiểu dữ liệu   | Mục đích, grain, lưu ý 38 dòng thiếu mã khách hàng, owner, tóm tắt chất lượng và quan hệ                                  | Metadata có người khai báo + kết quả test gắn đúng model                             |
| Dữ liệu        | Khóa tổ hợp khai báo, schema và ý nghĩa cột, số hàng có thời điểm đo, sample theo yêu cầu                                 | Schema/catalog adapter + phép đo được cho phép + endpoint sample giới hạn            |
| SQL & cấu hình | SQL đã lưu, view, relation, môi trường; mở rộng file nguồn, unique ID, tags, contract, access và trạng thái đối chiếu SQL | SQL API + manifest/config tương thích phiên bản dbt đang chạy                        |
| Vận hành       | Build, quality, freshness độc lập; 4 test (3 pass, 1 warn/38 dòng); 3 lần chạy và chi tiết lỗi; thanh thời lượng          | Kết quả thực thi/test từng node, lịch sử được lưu theo model và run; freshness riêng |

Các trường còn thiếu được nói rõ: compiled SQL/query plan; so sánh SQL với lần build thành công; freshness; profiling cột và dữ liệu nhạy cảm; lịch chạy/SLA; warehouse cost/storage; Git commit và phiên bản runtime. Không hứa mọi trường đều đã có trong backend. Contract và access trong ví dụ là metadata dbt, không chứng minh quyền warehouse hay chất lượng dữ liệu. `rowCount` là số hàng relation được đo, không lấy từ `rows_affected`.

Chi tiết chỉ tải khi mở một hồ sơ; sample chỉ tải khi nhấn yêu cầu. Các panel mới không phát truy vấn theo từng hàng danh sách. Snapshot fixture dùng cache theo model; khi tích hợp phải thay bằng khóa tenant/quyền/revision theo SPEC. Bảng test và history là tập nhỏ cố định trong minh họa; production phải giới hạn/phân trang theo SPEC, không tải toàn bộ lịch sử.

Cơ sở ánh xạ nguồn: [dbt artifacts](https://docs.getdbt.com/reference/artifacts/dbt-artifacts) và [dbt project exploration](https://docs.getdbt.com/docs/explore/explore-projects). Đây là định hướng adapter, không phải bằng chứng checkout đã ingest các artifact này.

| Phần                                               | Nguồn prototype                                                         | Khi tích hợp                                                                                   |
| -------------------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Header, rail, font, màu, hiệu ứng                  | Import Book/TabRail/CSS đang có; không sửa các file này                 | Giữ shell của checkout đích, gồm quyền mới upstream                                            |
| Danh mục, mô tả, grain, phân lớp, nguồn, nghiệp vụ | `src/prototype/fixtures.ts`; explicit metadata                          | Adapter vào API được cấp quyền; không đoán từ tiền tố tên                                      |
| Schema, SQL, thời lượng, số dòng                   | `ProfileSource`; chi tiết ở chunk riêng                                 | tRPC/query cache theo tenant, quyền, revision; trạng thái thiếu/lỗi phải được giữ              |
| Preview                                            | Fixture được đọc khi yêu cầu; tiền là chuỗi và dùng formatMoney         | Endpoint giới hạn số dòng/timeout, kiểm tra quyền server                                       |
| Lineage                                            | Cạnh SQL khai báo trong fixture                                         | Giữ raw/missing/undeclared refs và coverage thật; không tự tuyên bố report hoặc column lineage |
| Tests, freshness, bản SQL đã build                 | Tests có fixture minh họa; freshness và SQL đã build chưa có bằng chứng | Chỉ bật trạng thái có dữ liệu đối chiếu thật                                                   |
| Build/Save/editor/journal                          | Không triển khai mutation trong prototype                               | Dùng luồng sẵn có, giữ bảo vệ draft và quyền                                                   |

Entry `apps/ui/prototype/index.html` và `vite.prototype.config.ts` tách khỏi route production. Transport chỉ trả tenant tổng hợp cho `tenants.get`; request khác bị từ chối. Middleware local chặn `/trpc`, `/api`, `/oauth`, `/mcp`. Không sao chép transport này vào ứng dụng thật. Không đổi `main.tsx`, `routeTable.tsx`, route Models cũ hay lockfile.

## Cấu trúc để Claude tiếp tục

- Component/logic dùng chung: `apps/ui/src/features/models-workspace/`.
- Fixture, bootstrap local: `apps/ui/src/prototype/`.
- UI state: bổ sung vào Zustand `apps/ui/src/store.ts`; trạng thái phạm vi áp dụng nằm trong URL.
- Bản dịch: bổ sung `modelsWorkspace` trong VI/EN; tiền/thời gian dùng formatter hiện hữu.
- Sơ đồ React Flow lazy-load; ELK chạy bằng worker thật qua `elk-api` + worker của package. Không dùng `elk.bundled` bên trong một worker tự tạo: bundle đó tự nhận môi trường worker, khiến constructor wrapper không hoạt động như trên main thread.
- Layout tối đa 12 node trong prototype, cache 8 kết quả, timeout 3 giây và terminate khi hủy; lỗi có Retry và Bảng vẫn dùng được. Mức 12 là giới hạn thử nghiệm, chưa phải ngân sách production được đo.
- Danh mục fixture được giữ trong bộ nhớ; giới hạn render không đồng nghĩa backend đã phân trang. Chưa chứng minh p95 hay đã sửa độ trễ production.

Lệnh kiểm tra:

```text
task ci:models-prototype
task ci:typecheck
task ci:lint-rules
task ci:test-one -- apps/ui/src/features/models-workspace apps/ui/src/i18n/i18n.test.tsx apps/ui/src/routes/Models.test.tsx
task build:ui
task build:models-prototype
```

`task ci:models-prototype` chỉ kiểm tra; `task ci:models-prototype-format` ghi định dạng cho phạm vi mới và tài liệu bàn giao.

## Mốc tương thích và kết quả

**Bản gửi review:** đã rebase lên main `deb49f74db6162ff697f4a8db9a5006e0ab7bac8` ngày 2026-10-11, không xung đột. Đã chạy lại `ci:models-prototype`, `ci:typecheck`, `build:models-prototype` và `ci:test-one` cho feature/i18n/Models: 36 pass, 0 fail. Có cảnh báo React `act(...)` trong bộ test Models và annotation của dependency khi build. Formatter của repo xử lý CRLF sau rebase; không đổi hành vi. Chưa chạy lại browser/VRT/full gate trên bản rebase. Các kết quả dưới đây ghi lại mốc kiểm tra trước đó, không thay thế nghiệm thu còn thiếu.

- Checkout thi công: HEAD `bc5e774ee8ab8dd1e5852d0eca38a4b49b9c2d9e`, code nền `69d69280390fbfbc07f5be8233e91d34687168fa`, v1.73.0.
- Đã fetch và đối chiếu `origin/main` tại `6bb345e09d51d498bb3476291b4431a39a190759`. Dependencies UI, store, formatter, Vite config và rules được đối chiếu không đổi. Book/TabRail upstream có thay đổi quyền; props Book đang dùng vẫn tương thích. Kiểm tra áp patch các file tracked bằng index tạm trên SHA upstream này đều clean; file mới không trùng đường dẫn upstream. Đã đồng bộ định nghĩa task install với upstream để tránh conflict. Chưa merge hoặc chạy toàn gate trên SHA upstream này.
- Build UI hiện hữu và build prototype đã thành công. Bộ test tập trung gồm 36 test Models/i18n đạt trong lần chạy cuối (36 pass, 0 fail). TypeScript, lint toàn repo, lint-rules và spec validation đạt.
- Full `ci:verify` qua typecheck/lint/lint-rules rồi dừng ở format CRLF trên checkout Windows (1.043 chẩn đoán). Chưa được đánh dấu gate xanh.
- Full `ci:test`: 2.203 pass, 5 skip, 57 fail, 2 errors trong 258 file. Có lỗi công cụ/process/symlink và timeout ở suite ngoài Models. Chưa so toàn bộ với một checkout baseline sạch, nên không quy tất cả lỗi về môi trường và không coi full suite đã đạt.
- Chưa chạy Docker integration/VRT. Chưa chứng minh tất cả 118 AC, quyền thật, dữ liệu thật hoặc hiệu năng production. STATUS ghi riêng bằng chứng fixture.

## Phần còn phải nghiệm thu trước tích hợp

API capability/revision/permission và các trạng thái partial/forbidden; lỗi tải có retry theo từng nguồn; đầy đủ F01–F11; ngữ cảnh camera/cuộn/focus qua mọi Back/Forward/đổi root; đường nối qua node ẩn; ngân sách cạnh cho đồ thị dày; export; tự động đo p95; visual regression của shell. Đây là các điều kiện nghiệm thu chưa được chứng minh, không phải tính năng được ngầm bỏ khỏi SPEC.

Không thay PLAN/SPEC thành nhật ký. Khi ghép vào bản mới, chỉ thay vùng Models bằng adapter production sau khi các điều kiện trên có bằng chứng; giữ nguyên Book/TabRail mới của repo.
