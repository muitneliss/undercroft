# Audit hiệu năng Models — 11/10/2026

**Kết quả:** đã tái hiện lỗi sắp xếp lineage bằng cấu trúc quan hệ đọc từ web thật và chính bundle ELK production. Có lỗi thuật toán cùng với việc chạy tác vụ nặng trên luồng giao diện. Chưa đo được thời gian truy vấn DB/network production; không quy mọi độ trễ cho frontend.

Không sửa ứng dụng, không Save/Build, không thay dữ liệu production. Thí nghiệm cục bộ nằm ngoài repository ứng dụng. Plan/spec được bổ sung yêu cầu hiệu năng; chưa thi công prototype.

## 1. Bằng chứng trực tiếp trên web

- Bản hiển thị: v1.73.0. Checkout đối chiếu: `69d69280390fbfbc07f5be8233e91d34687168fa`; chưa có bằng chứng deployment SHA. Remote HEAD mới hơn không được coi là bản đang chạy.
- Danh sách tải được **207/207 model** trong lần kiểm tra này. Điều đó không chứng minh cold load luôn nhanh.
- Dòng dữ liệu có **209 nút = 207 model + 2 bảng thô**, 0 phụ thuộc bị thiếu; 35 model có quan hệ chưa khai báo đầy đủ.
- Sơ đồ báo **“Không sắp được sơ đồ. Tên và đường dẫn bên dưới vẫn cho biết mỗi mô hình đọc gì.”** Dữ liệu tên/quan hệ đã xuất hiện, còn bước sắp xếp thất bại.
- Không có console error/warn được công cụ thu thập ở lần kiểm tra. Code giải thích điều này: lỗi layout bị catch và chuyển thành null, không ghi nguyên nhân.
- Đọc từng dòng “Đọc: …” trên DOM: **1.079 cạnh**, không có tên cha không giải được. Đây là quan hệ đã khai báo được UI công bố, không phải toàn bộ quan hệ nghiệp vụ.
- DOM mặc định có 1.053 phần tử khi graph lỗi; chọn một model có 1.332 phần tử. Chưa có React Flow canvas thành công trong trạng thái này, nên không thể đổ lỗi thất bại ban đầu cho pan/zoom hoặc SVG render.
- Một model đầu vào được kiểm tra có 1 upstream, 16 downstream trực tiếp, **105 downstream nhiều bước**. “Chỉ hiện nút liên quan” hiện mang nghĩa toàn bộ chuỗi, không phải một bước.

## 2. Cách tái hiện, giới hạn phép đo

1. Trích tên và danh sách cha từ DOM mà giao diện đã hiển thị; đổi sang ID số cục bộ, không lấy SQL, credentials hay dữ liệu hàng.
2. Giữ thứ tự raw/model, thứ tự model theo tên và thứ tự cạnh; kiểm tra 209 nút, 1.079 cạnh, 0 tên không khớp. FNV-1a trên JSON danh sách cha = `2149018691` khớp giữa browser và file replay.
3. Chạy hàm `lineageLayout.ts` ở checkout đối chiếu; chỉ bỏ import/type để chạy độc lập. Đồ thị này không có chu trình theo kiểm tra topo; prepass tạo **44 cột**, khoảng 8–19 ms trong các lần chạy.
4. Tải các bundle công khai thực tế từ trang: `index-BhzW86oD.js`, `Models-2yqgayHM.js`, `elk.bundled-DuMYUn7J.js`. Models bundle xác nhận đúng OPTIONS, `new Elk().layout(...)`, catch trả null như source audit.
5. Replay với elkjs 0.12.0 từ registry, rồi kiểm tra lại bằng chính bundle ELK production. Với bundle production, chỉ thay import hai helper đóng gói bằng định nghĩa tương đương đã đọc trong index; không đổi thuật toán ELK.
6. Chạy bằng Node 25.9.0 trên máy cục bộ. Timer 10 ms ghi khoảng ngắt event loop lớn nhất. **Các số dưới đây là thời gian replay cục bộ, không phải TTFB, INP, hay thời gian load đo trong trình duyệt production.** Mỗi biến thể bundle production chạy một lần; không phải p95 hoặc benchmark thống kê.

| Thí nghiệm với bundle production | Nút / cạnh | Kết quả | Thời gian layout | Khoảng ngắt event loop lớn nhất |
|---|---:|---|---:|---:|
| Cấu hình hiện tại, toàn bộ graph | 209 / 1.079 | `RangeError: Maximum call stack size exceeded` | 2.717 ms | 2.689 ms |
| Chỉ đổi node placement NETWORK_SIMPLEX → BRANDES_KOEPF | 209 / 1.079 | Thành công | 3.490 ms | 3.454 ms |
| Cấu hình hiện tại, một bước quanh model đã chọn; giữ cạnh giữa các nút trong scope | 18 / 36 | Thành công | 198 ms | 169 ms |
| Cấu hình hiện tại, toàn bộ chuỗi liên quan | 107 / 396 | Chưa trả kết quả; chủ động dừng tiến trình replay | >36 giây wall time | Không thu được kết quả timer cuối |

Đơn vị bảng là mili giây, dấu chấm phân cách hàng nghìn. Ví dụ 2.717 ms ≈ 2,72 giây.

Đối chứng elkjs registry: baseline thất bại khoảng 2,77 giây, đổi routing sang ORTHOGONAL vẫn lỗi, đổi layering sang NETWORK_SIMPLEX vẫn lỗi; đổi **node placement** sang BRANDES_KOEPF hoặc SIMPLE thì chạy xong. SIMPLE cho hình rộng khoảng 74.182 px; BRANDES_KOEPF khoảng 19.641 × 17.038 px. Vì vậy “chạy xong” chưa đồng nghĩa với dễ đọc hoặc responsive.

**Suy luận có bằng chứng mạnh:** với graph này, đường xử lý của node-placement NETWORK_SIMPLEX là điểm gây lỗi quan trọng. Chưa rút gọn được graph tối thiểu hoặc định danh issue upstream; không khẳng định mọi graph 209 nút đều hỏng, cũng không kết luận DB có vòng lặp. Stack lặp trong ELK là bằng chứng lỗi thực thi, không phải bằng chứng chu trình dbt.

## 3. Nguyên nhân theo thứ tự ưu tiên

### P0 — Lỗi layout và chặn giao diện

**A. Cấu hình layout hiện tại thất bại trên graph đang dùng.**

Nguồn: `apps/ui/src/lib/lineageArrange.ts:64–85,114–145`. Đã kiểm tra lại OPTIONS và catch bằng bundle production. Node placement mặc định NETWORK_SIMPLEX; cả graph lớn và scope liên quan đều không đáng tin cậy trong replay. Đổi placement là ứng viên sửa lỗi, chưa phải bản sửa được nghiệm thu.

**B. Không có Web Worker thật.**

`new Elk()` không truyền workerFactory/workerUrl. Constructor trong bundle dùng fake worker qua `setTimeout` khi không có factory. Promise/async chỉ trì hoãn lúc bắt đầu; tính toán vẫn chiếm cùng luồng. Đây là lý do tác vụ layout nặng có thể giữ cả giao diện chờ. Replay đo khoảng ngắt 2,7–3,5 giây; browser long-task profile chưa được thu.

**C. Không giới hạn công việc và không hủy layout cũ.**

Mặc định vẽ toàn graph. `related` lấy toàn bộ tổ tiên và hậu duệ, không chặn độ sâu/độ rộng. Không có timeout/cancel worker. Thí nghiệm 107 nút mất hơn 36 giây cho thấy giảm số nút đơn thuần không bảo đảm nhanh; cấu trúc cạnh và thuật toán cũng quan trọng.

**D. Nuốt lỗi khiến khó phân biệt chậm với hỏng.**

`catch { return null; }` mất loại lỗi và thời gian. Cần ghi lỗi an toàn cùng graph revision, node/edge count, scope, engine/options; không log SQL hoặc dữ liệu khách hàng.

### P1 — Công việc thừa và khả năng tái phát

- `ModelLineage.tsx:115`: luôn render `LineageTrace` với graph toàn bộ, kể cả khi canvas đã thu scope.
- `LineageTrace.tsx:82,213,264`: tự gọi layout cho danh sách, trace và levels; chưa chia sẻ kết quả. Khi chọn model, có thể có prepass của arrangement + Trace + Levels. Prepass replay khoảng 8–19 ms/lần: đáng cải thiện nhưng **không phải phần vài giây lớn nhất đã đo**.
- `lineageLayout.ts` và `lineage.ts`: nhiều `.filter` toàn bộ cạnh và `.find` toàn bộ nút. Dùng node map và adjacency map theo graph revision để tránh quét lặp.
- Mobile dùng CSS `display:none` để ẩn `.lineage-board`; component vẫn gọi useArrangement. Ẩn hình chưa loại bỏ công việc sắp xếp. Levels đóng/ẩn cũng vẫn được tính và mount.
- Cache arrangement dùng WeakMap theo object identity. Quay lại subset được tạo mới có thể sắp xếp lại; không kết luận mọi refetch đều mất cache vì query có structural sharing.
- React Flow được cấp toàn bộ drawn nodes/edges, không bật chỉ render phần nhìn thấy. Đây là rủi ro sau khi sửa layout, chưa có profile xác nhận là nút thắt hiện tại.
- Danh sách `.map(shown)` toàn bộ 207 hàng, chưa phân trang/virtualization. Quan sát tải thành công; chưa có bằng chứng riêng nó gây lag nghiêm trọng.

### P2 — API/database: có lãng phí trong source, chưa định lượng production

- `services/models.ts:187`: mỗi lần gọi lineage đọc toàn bộ models/macros rồi parse lại; chưa có cache theo revision.
- `repos/models.ts:40,55`: listModels đọc SQL, tests và columns đầy đủ; list service chỉ cần một phần rồi loại SQL trước khi trả browser. **Không nói nhầm rằng models.list gửi toàn bộ SQL xuống browser.**
- `services/models.ts:68` gọi models và last-build song song, không phải N+1 từng model.
- `repos/models.ts:178`: lastBuildPerModel JOIN lịch sử runs/run_step rồi DISTINCT ON để chọn mới nhất. Cần query plan/số hàng thực trước khi quyết định thêm index hoặc bảng tổng hợp; đã có index run_tenant_started trong migration.
- Direct-entry lineage: models.list chỉ bắt đầu khi LineageView mount sau lineage response; có request waterfall nếu cache lạnh. Models còn đợi tenants.get. Không tuyên bố mọi lần chuyển từ List đều gặp waterfall.
- Query defaults staleTime 5 giây, retry 1. Cần kiểm tra refetch thực tế; đây không phải poll mỗi 5 giây.

Chưa có network waterfall, transfer size của API, DB EXPLAIN, trace server hoặc browser CPU/INP profile. Bộ điều khiển browser hiện dùng không cung cấp các phép đo đó. Không đưa con số giả hoặc khẳng định server nhanh/chậm; frontend layout lỗi đã được tái hiện độc lập với API.

## 4. Trình tự sửa được đề xuất

1. **Chặn lỗi trước:** bổ sung đo và log an toàn; regression fixture tổng hợp tái hiện failure; thử placement thay thế/fallback. Không chỉ đổi một option rồi coi xong.
2. **Tách layout khỏi UI:** Worker thật; timeout và hủy được tác vụ nặng bằng terminate/recreate worker, không chỉ Promise.race; bỏ kết quả cũ khi đổi scope. Có giới hạn hàng đợi và cache bounded theo revision + scope + options.
3. **Giảm công việc theo nhu cầu:** chọn root/nhóm rồi một bước; kiểm soát fan-out; graph và bảng dùng cùng scope. Không âm thầm bỏ cạnh; hiển thị số còn ẩn và cho chọn nhánh. Bảng dùng được ngay khi graph đang chạy/lỗi.
4. **Chỉ tính/render chế độ đang dùng:** không khởi động ELK khi ở Danh sách, Bảng hoặc mobile không có canvas; chia sẻ adjacency/index; mở SQL/schema khi cần.
5. **Đo backend rồi tối ưu đúng chỗ:** timings riêng auth/tenant, DB model read, last-build, parse lineage, serialization/network. Projection nhẹ; cache revision nếu parse đáng kể; pagination khi payload/DOM thực cần. Không nâng server hoặc chuyển graph database theo suy đoán.
6. **Nghiệm thu trước chỉnh mỹ thuật:** cold/warm load, mở/đóng nhánh, đổi root nhanh, graph lỗi, mobile; dữ liệu tổng hợp 250–1.000 model với nhánh rộng, nhiều merge, chuỗi dài. Không dùng fixture chỉ 8 model để chứng minh hiệu năng.

Mục tiêu đề xuất: phản hồi thao tác ≤200 ms; main-thread layout không tạo long task >50 ms trên máy chuẩn; kết quả scope ban đầu ≤1 giây sau khi metadata có sẵn; layout quá 3 giây vẫn thao tác được và có fallback cùng scope. Các ngưỡng này là mục tiêu cần đo/hiệu chỉnh, không phải kết quả đã đạt.

## 5. Phạm vi bản lưu trong repository

Bản này lưu phương pháp, kết quả tổng hợp và giới hạn kiểm chứng. Harness, bundle tải về, kết quả thô và topology từ tenant thật chỉ nằm trong workspace audit riêng, không thuộc repository. Không thể chạy lại từ riêng commit tài liệu này. Khi triển khai, cần tạo regression graph tổng hợp mới để kiểm chứng công khai. Chưa sửa source ứng dụng; browser/server profiling end-to-end vẫn là bước xác minh tiếp theo.
