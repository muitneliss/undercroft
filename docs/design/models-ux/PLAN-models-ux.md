# Kế hoạch thi công Models

**Baseline:** 2.0 · 11/10/2026. **Loại tài liệu:** kế hoạch thực hiện, không phải báo cáo tiến độ.

## 1. Mục tiêu và tài liệu chuẩn

Hoàn thiện nội dung Models để người không chuyên tìm/hiểu dữ liệu dễ dàng, kỹ sư truy cập SQL/vận hành nhanh và lineage không làm treo giao diện khi có hàng trăm model. Giữ nguyên giao diện chung của ứng dụng.

| Tài liệu | Trách nhiệm |
|---|---|
| [SPEC-models-ux.md](./SPEC-models-ux.md) | Nguồn duy nhất cho hành vi sản phẩm, hợp đồng dữ liệu, lỗi, quyền và 118 acceptance case |
| PLAN này | Thứ tự công việc, phụ thuộc, đầu ra và điều kiện hoàn thành từng giai đoạn |
| [PROMPT-implement-models-ux.md](./PROMPT-implement-models-ux.md) | Lệnh giao việc cho agent triển khai prototype, có giới hạn quyền hành động |
| [IMPLEMENTATION-STATUS-models-ux.md](./IMPLEMENTATION-STATUS-models-ux.md) | Tiến độ, bằng chứng kiểm tra, sai khác và công việc còn lại |
| [README.md](./README.md) | Điểm vào review full source; chạy bản gốc, báo cáo có bằng chứng và đối chiếu phần tái sử dụng/thay đổi |
| Các AUDIT/FEASIBILITY/RESEARCH | Bằng chứng tham khảo theo thời điểm; không ghi đè SPEC hoặc tạo yêu cầu mới |

Đọc chỉ dẫn trực tiếp của người dùng và quy tắc repository trước. Nếu các tài liệu dự án mâu thuẫn về hành vi, dùng SPEC; ghi sai khác trong STATUS. Nếu SPEC xung đột với code/ADR về quyền hoặc tính đúng đắn dữ liệu, xác minh và dùng fallback đã quy định; không tự nới quyền hoặc bịa metadata. Không cần đọc lại toàn bộ hội thoại để thi công.

## 2. Phạm vi cố định

Trước bàn giao GitHub: đưa toàn bộ source/config/fixtures/tests/docs vào branch đọc được; tạo lại SOURCE-INVENTORY, chốt commit và kiểm tra remote có đủ file. Gắn link theo SHA trong PR, không dùng ZIP hoặc ảnh thay source. Người review chạy nguyên bản trước; tích hợp sau phải nêu phần tái sử dụng/adapter/viết lại và bằng chứng đối chiếu. Giữ source tại commit review kể cả khi maintainer chỉ muốn merge phần tích hợp.

Sai khác cần xử lý trước khi PR ready: picker hiện dùng modal trái `apps/ui/DESIGN.md`; chuyển inline theo SPEC §10.3. Metadata nghiệp vụ vẫn là capability có điều kiện theo ADR 0112, không tự hồi sinh context API. Xem README và STATUS để tách yêu cầu đích khỏi phần chưa làm.

- Giữ `Book`, `TabRail`, running header, bảy phân khu, font, màu, hiệu ứng, responsive và trợ lý chung. Chỉ thay children trong vùng Models. Nguồn chuẩn: SPEC §2.4.
- Đúng hai tab Danh sách / Dòng dữ liệu; một hồ sơ dùng chung với Hiểu dữ liệu / Dữ liệu / SQL & cấu hình / Vận hành.
- Danh sách nhóm theo lớp và metadata có bằng chứng; 25 model/trang, tìm/lọc toàn tập, một ID một hàng.
- Lineage theo root, mặc định hai phía một bước; mở/thu nhánh, chọn tất cả, Bảng quan hệ, tác động down/all/table và Hoàn tác. Chọn hết không có nghĩa phải vẽ hết.
- Sửa lỗi và chi phí layout; danh sách/bảng vẫn dùng được khi graph lỗi. Không tắt hiệu ứng chung để che tác vụ nặng.
- Không thêm nút AI, taxonomy editor, pipeline builder, bulk Build/Delete, dashboard chi phí hoặc tab cấp cao khác. Không thay editor, phạm vi Build, quyền hay bảo vệ draft.
- Không tự thêm report/column lineage; metadata/metrics nâng cao chỉ bật khi có nguồn, quyền và hợp đồng chính xác.

## 3. Hai chế độ triển khai

| Chế độ | Dữ liệu và khả năng | Điều kiện hoàn thành |
|---|---|---|
| Prototype local | 250 model tổng hợp; đủ normal/empty/loading/error/partial/unsupported/forbidden. Dùng shell/component thật, tương tác chính và điều hướng chạy được | Đạt AC UI/logic trên fixture, không còn nút giả trong luồng chính; có URL local, cách chạy và bằng chứng. Không tuyên bố backend/quyền/hiệu năng production đã đạt |
| Tích hợp dữ liệu thật | Adapter API/permission/revision hiện hữu hoặc phần bổ sung đúng hợp đồng | Đạt AC trên seam thực, kiểm thử server/quyền, đo hiệu năng và hồi quy shell; capability chưa hỗ trợ có fallback đúng |

Lệnh làm prototype chỉ cho phép chế độ thứ nhất. Không tự chuyển sang production, migration, merge/push hoặc deploy. Khi người dùng đã yêu cầu thi công prototype, tiếp tục công việc local được cho phép; không xin duyệt lại từng component hoặc quyết định kỹ thuật thường lệ. Phản hồi minh họa là đầu vào thiết kế, không tự thay thế lệnh thi công.

## 4. Trình tự thực hiện

### P0 — Kiểm tra checkout và dựng đường chuẩn

**Phụ thuộc:** có yêu cầu thi công tương ứng.

1. Đọc AGENTS/CLAUDE và rules theo đường dẫn; kiểm tra Git, giữ thay đổi ngoài nhiệm vụ. Xác minh route/component/API ở checkout sẽ sửa, không coi SHA audit cũ là production hiện tại.
2. Chạy ứng dụng qua Taskfile; ghi command/URL vào STATUS. Ghi baseline shell với tenant/tài khoản tổng hợp: desktop/mobile, VI/EN, hover/active và reduced motion.
3. Lập ma trận capability theo SPEC §4.7/§8/§9: field, nguồn, quyền, trạng thái hỗ trợ, fallback. Kiểm tra metadata theo ADR 0112; không tái tạo context bắt điền.
4. Ghi cấu hình máy/browser/viewport/network và kịch bản đo. Prototype không gọi production. Đo baseline nếu có thể; thiếu phép đo ghi rõ, không suy từ số model.

**Đầu ra:** STATUS có checkout, baseline, capability matrix, lệnh chạy và điều kiện đo.

### P1 — Hợp đồng state, adapter và fixture

**Phụ thuộc:** P0.

1. Tạo fixture tổng hợp 250 model, mở rộng bộ kiểm tra đến 1.000; bao phủ F01–F11 trong SPEC. Có fan-out 100, nhóm 58, merge/cycle, nguồn partial/complete rỗng, multi-assignment và raw root.
2. Tách fixture khỏi component qua adapter theo hợp đồng logic. Dùng schema/dependency hiện hữu; chỉ thêm package khi có lý do. Không hardcode nhóm theo tên/prefix.
3. State UI dùng Zustand, server data dùng tRPC cache. EntityRef/revision/cache identity đúng tenant/quyền. Tách root, node đang xem, scope, tập vẽ, draft lựa chọn và camera.
4. Logic grouping/count/pagination và scope/path dùng chung; kiểm thử nhiều đường đi, cycle, stale response, partial coverage. Không tạo thuật toán đếm riêng cho graph và bảng.

**Đầu ra:** adapter/fixture/state và logic có kiểm tra đúng nghĩa; không lấy CSS của minh họa thay design system.

### P2 — Danh sách và hồ sơ dùng chung

**Phụ thuộc:** P1.

1. Dựng M01 theo SPEC §3: lớp → nhóm → model; nhóm trước phân trang, thu/mở, tìm/lọc/sort, trạng thái cần chú ý và count đúng.
2. Dựng M02 theo §4: bốn mục, đủ/thiếu metadata, build lỗi còn dữ liệu cũ, preview theo yêu cầu, SQL chỉ đọc và lối tắt editor/journal.
3. Nối URL/back/forward và state phục hồi theo §2.2. Link tên là link thật; không lấy nút JS của minh họa làm chuẩn.
4. Dùng lại shell/token/formatter. Không fetch detail/SQL/schema cho mọi hàng và không khởi động layout ở List/hồ sơ.

**Đầu ra:** tìm → hồ sơ → quay lại hoạt động; chứng minh AC tương ứng trong SPEC §12.2, đặc biệt AC-91–108 và AC-113–118.

### P3 — Bảng quan hệ và chọn hàng loạt

**Phụ thuộc:** P1; dùng hồ sơ P2.

1. Dựng M04 picker tìm/lọc/phân trang; thiếu root thì không tự chọn model đầu và không chạy layout.
2. Dựng Bảng quan hệ cùng scope/count/path, đủ trạng thái tải/partial/lỗi/quyền. Xem tác động luôn down/all/table.
3. Bộ chọn có chọn trang/chọn tất cả/bỏ chọn/ngoài bộ lọc/Chỉ xem đã chọn; draft áp dụng một lần. Vượt ngân sách thì xem đủ tập chọn bằng bảng.
4. Nối Hủy/Escape/Back/Hoàn tác; một mốc state cho một lần áp dụng. Không build/delete từ bộ chọn.

**Đầu ra:** bảng độc lập engine; AC-75–90 có bằng chứng tương tác. Phần này phải hoàn thành trong prototype, không ghi chung là sẽ làm sau.

### P4 — Sơ đồ tập trung và hiệu năng

**Phụ thuộc:** P1/P3 và module scope dùng chung.

1. Tái hiện lỗi engine bằng fixture tổng hợp; sửa/fallback theo nguyên nhân. Thay thư viện chỉ khi có bằng chứng nền hiện hữu không đáp ứng.
2. Worker thật cho tác vụ nặng; timeout/hủy/stale result/cache bounded theo SPEC §14. List/Bảng/mobile không dùng canvas thì không chạy layout ẩn.
3. Chọn scope/tập vẽ trước layout; giới hạn cả node và cạnh. Hiệu chỉnh ngân sách tập trung theo phép đo, không lấy 9 node của minh họa làm giới hạn sản phẩm.
4. Mở/thu nhánh, panel, refocus, camera và dải vai trò mềm; giữ cạnh thật, node chung, root và count đúng.
5. Đo cold/warm, đổi root liên tục, fan-out/merge/chuỗi dài, lỗi/timeout; tách fetch/index/layout/render. Worker hoặc phân trang tự thân không chứng minh đã hết lag.

**Đầu ra:** AC-60–74 và phần hiệu năng AC-90 có số đo theo môi trường công bố. Mục tiêu: p95 thao tác ≤200 ms; scope chuẩn ≤1 giây sau metadata; layout không gây main-thread task >50 ms; job quá 3 giây ngắt và dùng bảng. Ngân sách end-to-end dựa trên baseline thật, không giả định 1 giây bao gồm API.

### P5 — Nghiệm thu và bàn giao local

**Phụ thuộc:** P2/P3/P4.

1. Chạy checks và gate repository qua Taskfile. Gate không chạy được phải ghi command/lỗi/phạm vi chưa xác minh; không đánh dấu pass.
2. So shell trước/sau và motion riêng theo SHELL-01–06; kiểm tra thêm phân khu ngoài Models để phát hiện CSS rò.
3. Kiểm tra keyboard/focus, mobile/zoom 200%, VI/EN, stale response, deep link và draft.
4. Ghi từng AC: pass/fail/not-run/not-applicable kèm bằng chứng; not-applicable phải có capability/phase và fallback. Không dùng nó để bỏ tương tác cốt lõi.
5. Bàn giao URL local, cách chạy, file thay đổi, ảnh/tương tác, kết quả checks, số đo và hạn chế. Không báo hoàn thành khi còn lỗi luồng chính hoặc shell bị đổi.

**Đầu ra:** prototype reviewable và STATUS kiểm chứng được. Người dùng duyệt prototype trước khi chuyển sang tích hợp dữ liệu thật.

## 5. Đợt tích hợp dữ liệu thật

Thực hiện khi được yêu cầu tích hợp; không tự động thuộc prototype.

| Đợt | Nội dung | Điều kiện bật |
|---|---|---|
| A — Nền có sẵn | List gọn, hồ sơ kỹ thuật tối thiểu, bảng quan hệ, sửa layout, lối tắt editor/journal | Adapter/capability đúng API thực; không chờ taxonomy để phát hành phần tối thiểu |
| B — Khám phá đầy đủ | Graph tập trung, chọn hàng loạt, grouping lớp/nghiệp vụ | Graph qua đo kiểm; assignment có nguồn/chủ sở hữu/revision. Thiếu metadata dùng fallback |
| C — Metadata và chỉ số | Nguồn nghiệp vụ, alias/grain, preview model ID, lastSuccessfulBuild/hash, test-model, freshness | Từng field có nguồn/quyền/version/kiểm thử; phần chưa hỗ trợ có nhãn đúng. Không phục dựng form context cũ |

Mỗi đợt qua P5 trên seam thật và AC áp dụng. Migration/release/rollback theo yêu cầu người dùng và quy tắc deployment; không ngầm deploy trong lúc làm UI.

## 6. Quy tắc duy trì tài liệu

- SPEC mô tả một thiết kế hiện hành; khi quyết định đổi, sửa trực tiếp yêu cầu và AC, không nối nhật ký phiên bản.
- PLAN giữ work package/phụ thuộc/đầu ra; không chép lại SPEC hoặc kết quả từng lượt.
- STATUS chứa tiến độ, phép đo, lỗi và bằng chứng. Audit giữ ngữ cảnh lịch sử, không tạo cổng phê duyệt mới.
- Không hứa hoàn hảo; hoàn thành phải chứng minh bằng hành vi/số đo/checks. Thiếu bằng chứng ghi chưa xác minh.
