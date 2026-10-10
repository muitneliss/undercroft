# Plan hoàn thiện Models — phân bổ thông tin giữa List và Lineage

Phiên bản: **1.3 · 11/10/2026 — bổ sung cổng hiệu năng sau audit**
Trạng thái: Kế hoạch triển khai, chưa thay đổi ứng dụng.
Đồng bộ: [SPEC v1.3](./SPEC-models-ux.md). Bằng chứng: [Điều tra web đã đăng nhập](./AUDIT-models-live-2026-10-10.md), [Audit hiệu năng](./AUDIT-models-performance-2026-10-11.md).

**Ưu tiên mới trước thi công giao diện:** xử lý lỗi layout và luồng xử lý, không chỉ giảm rối bằng phân lớp. Audit web mới có 207 model + 2 raw, 1.079 cạnh. Replay bằng bundle production: cấu hình hiện tại tràn stack khoảng 2,72 giây; placement thay thế chạy được nhưng chiếm event loop khoảng 3,45 giây. Đây là số đo cục bộ, chưa phải thời gian load browser/API. Các số 205 model/103 downstream trong phần audit cũ và fixture bên dưới là snapshot lịch sử, không phải số hiện tại.

### Cổng hiệu năng bắt buộc của v1.3

1. **Chẩn đoán:** lưu lỗi có nguyên nhân và timing từng giai đoạn; tiếp tục đo API/DB/browser trước khi kết luận end-to-end. Source có lãng phí backend nhưng chưa có bằng chứng thời gian production.
2. **Layout an toàn:** regression graph tổng hợp; đánh giá sửa/fallback placement; Worker thật, timeout, hủy tác vụ cũ, loại kết quả stale. Đổi thuật toán đơn lẻ chưa đủ.
3. **Giới hạn công việc thực:** mặc định scope cục bộ; kiểm soát cả độ sâu, độ rộng và cạnh. Khi chuyển sang Bảng hoặc không hiển thị canvas, không khởi động layout. Ẩn bằng CSS không đạt yêu cầu.
4. **Hiển thị độc lập:** tìm kiếm, danh sách và bảng quan hệ dùng được khi layout đang chạy hoặc lỗi. Graph/Bảng cùng scope; scope lớn vẫn truy cập bằng bảng có phân trang/virtualization và tổng số rõ ràng.
5. **Tránh tính lại:** index quan hệ theo revision; cache layout bounded theo revision/scope/options; không layout lại khi chỉ chọn/highlight node trong cùng phạm vi. Chỉ tải detail SQL/schema khi mở.
6. **Nghiệm thu:** kiểm tra cold/warm load, root đổi liên tiếp, lỗi/timeout và mobile bằng 250–1.000 model tổng hợp; có nhánh rộng, merge dày và chuỗi dài. Mục tiêu đề xuất: phản hồi ≤200 ms; scope ban đầu ≤1 giây sau metadata; tác vụ layout không chặn main thread >50 ms; quá 3 giây vẫn thao tác và fallback được. Cố định máy/network đo trước khi dùng làm tiêu chí phát hành.

Legacy `scope=related` vẫn giữ ý nghĩa toàn bộ chuỗi như spec; có thể vào bảng trước và yêu cầu thu phạm vi để vẽ, không âm thầm đổi dữ liệu sang một bước. Nhóm Đầu vào/Biến đổi/Đầu ra không được làm mất cạnh vượt lớp.

Bổ sung này khóa yêu cầu hiệu năng, chưa duyệt bố cục prototype mới và chưa sửa ứng dụng. Không thêm nút AI; giữ hai tab cấp cao.

**Đối chiếu code bổ sung:** main `69d6928`, v1.73.0; xem [ma trận khả thi](./FEASIBILITY-models-repo.md). `bi.schema` và `models.check` đã có, nên ưu tiên tái sử dụng. Lớp/nghiệp vụ/alias/grain không có trong model API; business context đã bị gỡ có chủ đích theo ADR 0112. Những mục metadata bên dưới là phần phát triển mới, không phải dữ liệu sẵn có. Không hồi sinh form bắt điền/duyệt context và cảnh báo thiếu trên mọi model. Preview model ID, lastSuccessfulBuild, hash SQL và ánh xạ test-model còn cần nối/bổ sung hợp đồng; trợ lý trong web không có Save/Build, khác agent ngoài qua MCP/CLI.

## 1. Quyết định thiết kế

**Hai tab, một hồ sơ model dùng chung:**

- **Danh sách (List):** tìm đúng model, hiểu sơ bộ mục đích và nhận biết tình trạng.
- **Dòng dữ liệu (Lineage):** hiểu model đọc từ đâu, được dùng ở đâu và thay đổi có thể ảnh hưởng tới gì.
- **Hồ sơ:** trang chi tiết bên trong khu vực Models, không thành tab cấp cao thứ ba. Dùng cùng metadata dù mở từ List hay Lineage.
- **Editor và Nhật ký:** giữ công việc chuyên biệt hiện có; có lối tắt trực tiếp cho kỹ sư.

“Thân thiện với người low-code” nghĩa là dễ đọc, dễ hiểu và dễ kiểm chứng. Không thêm wizard tạo pipeline, form cấu hình dài hay chatbot riêng vào mỗi tab. AI có thể thực hiện thay đổi; UI giúp người dùng hiểu và kiểm tra kết quả.

**Quyết định đã chốt với người dùng:** không thiết kế nút AI, chat AI, hành động “Nhờ AI sửa/kiểm tra” hoặc luồng chuyển ngữ cảnh sang AI trong List, Lineage và hồ sơ model. Trợ lý chung hiện có của ứng dụng không thuộc phạm vi thay đổi này; khả năng agent ngoài qua MCP/CLI không bị thay đổi.

## 2. Những gì web thật làm thay đổi quyết định

| Quan sát ngày 10/10/2026, v1.73.0 | Quyết định |
|---|---|
| List đang có 205 model; tìm tên ra đúng 1/205 | Giữ tìm kiếm; không coi ảnh cũ là bằng chứng search lỗi |
| Kết quả dựng, run ID, số cột, SQL sửa lúc chiếm bảng chính | Đưa thông tin điều tra vào hồ sơ; danh sách ưu tiên định danh, phạm vi và kết quả chạy |
| Bấm tên vào editor; ý nghĩa dữ liệu nằm trong comment SQL | Tên mở hồ sơ đọc; giữ Sửa SQL một thao tác từ hàng theo quyền |
| Lineage báo 207 nút và Không sắp được sơ đồ | Sửa lỗi/fallback trước khi trang trí; không khẳng định nguyên nhân là số node |
| Chọn invoice vẫn công bố 103 nút hạ nguồn và nhiều khối văn bản | Mặc định một bước; mở thêm có chủ đích; phân biệt trực tiếp và nhiều bước |
| Lineage chỉ bao phủ khai báo model và bảng thô; có 35 trường hợp chưa khai báo | Giới hạn bằng chứng là thông tin chính của Lineage, không chôn trong tài liệu |
| Nhật ký đã có bước dbt và kết quả kiểm thử | Models lấy tóm tắt đúng model/run, link về Nhật ký; không xây lại trang vận hành |
| Cả Xero/HubSpot đi qua raw.records | Tách bảng thô khỏi nguồn nghiệp vụ, không suy nguồn chỉ từ cạnh tới raw.records |

Sau thao tác scope=related, đọc trang bị timeout. Đây là điểm cần tái hiện bằng instrumentation, chưa phải kết luận về lỗi ứng dụng. Số 205/207/103 là số UI hiển thị trong phiên audit, không phải hằng số thiết kế.

## 3. Bản đồ phân bổ thông tin

| Thông tin | List | Hồ sơ dùng chung | Lineage |
|---|---|---|---|
| Tên dễ hiểu + tên kỹ thuật | Chính; tên dễ hiểu chỉ khi được xác nhận | Đầy đủ, có copy ID | Hai dòng trên node, không lặp tên nếu giống nhau |
| Mục đích/nghiệp vụ | Mô tả ngắn khi có; lọc nghiệp vụ | Giải thích đầy đủ, chủ sở hữu nếu biết | Panel node; không chèn mọi mô tả vào canvas |
| Lớp Đầu vào/Xử lý/Đầu ra | Bộ chọn phạm vi chính | Metadata có nguồn | Nhãn phụ trong panel; không dùng làm cột layout bắt buộc |
| Grain, đơn vị, tiền tệ, múi giờ | Không thêm cột | Nổi bật ở Tổng quan | Grain của node đang chọn nếu có |
| Kết quả chạy | Trạng thái + thời điểm đúng nghĩa | Lần thử gần nhất và bản thành công còn dùng được | Trên node chỉ nhấn lỗi/đang chạy/chưa rõ; chi tiết trong panel |
| Độ mới/chất lượng | Không thêm hai cột mặc định; cảnh báo cụ thể nếu được hỗ trợ | Hai khối riêng, có bằng chứng và thời điểm | Chỉ dấu liên quan khi điều tra; không lan nhãn lỗi sang downstream |
| Schema, khóa, kiểu dữ liệu, dữ liệu mẫu | Đưa vào hồ sơ | Mục Dữ liệu; sample theo quyền | Link mở đúng mục; không liệt kê toàn bộ cột trong panel |
| SQL và phiên bản | Lối tắt Sửa SQL theo quyền | Mục SQL, thông tin bản lưu/bản build | Lối tắt; không editor cạnh graph |
| Run ID, log, lỗi, thời lượng | Mở nhật ký từ trạng thái/menu | Tóm tắt vận hành và link Nhật ký | Link trong panel khi cần |
| Đầu vào và nơi sử dụng trực tiếp | Nút Xem dòng dữ liệu | Tóm tắt tối đa 5 mỗi phía | Nội dung chính, default một bước |
| Phụ thuộc nhiều bước/ảnh hưởng | Không thêm cột tổng đếm | Nút Xem tác động | Sơ đồ/bảng cùng phạm vi; đường đi và count rõ ràng |
| Coverage, nguồn và phiên bản lineage | Chỉ cạnh lọc nguồn nếu cần | Tóm tắt khi quan hệ chưa đủ | Luôn có câu ngắn; mở được giải thích bằng chứng |
| Cách cập nhật, lưu lịch sử, materialization | Không cột mặc định | Khối kỹ thuật mở dần khi có metadata | Không trên canvas |
| Hiệu năng/chi phí/quyền/owner | Không biến thành dashboard rộng | Dẫn tới nguồn đo/quản trị hiện có; chỉ bổ sung khi hỗ trợ | Không dựng dashboard thứ hai |

Các thông tin có một nguồn dữ liệu chuẩn; bản tóm tắt ở nơi khác phải cùng ID, phiên bản và ý nghĩa. Không tạo hai hồ sơ riêng cho hai tab.

## 4. List — tìm trước, kiểm tra sau

```text
Mô hình dữ liệu · N model                         [Tạo model]
[Danh sách] [Dòng dữ liệu]

[Tìm tên hoặc mô tả — theo khả năng thực tế…]
[Tất cả lớp] [Đầu vào] [Xử lý] [Đầu ra] [Chưa phân loại]
[Nghiệp vụ ▾] [Bộ lọc (N): nguồn / lần chạy / family]  [Sắp xếp]
Các điều kiện đang bật · N kết quả                    [Xóa lọc]

Model / tên kỹ thuật / mô tả ngắn | Lớp | Lần chạy gần nhất | ⋯
```

- Tên thân thiện chỉ thay vị trí ưu tiên khi đã xác nhận; tên kỹ thuật vẫn luôn đọc được. Thiếu alias thì dùng tên kỹ thuật, không tự dịch đoán.
- Nghiệp vụ xuất hiện một cách ở phạm vi lọc hoặc dòng phụ, không tạo thêm nhiều cột. Nguồn vật lý/nguồn nghiệp vụ ở bộ lọc và hồ sơ, không mặc định chiếm cột bảng.
- Bỏ dãy năm thẻ lớn và phép cộng. Giữ tổng tenant + số kết quả; trạng thái vẫn lọc được trong Bộ lọc. Không thêm tab Cần chú ý hoặc chỉ số health tổng hợp.
- Chưa build không tự coi là lỗi. Cột thời gian là thời điểm của lần chạy, không lấy thời điểm sửa SQL thay vào.
- Menu hàng có Xem dòng dữ liệu, Xem SQL, Sửa SQL, Mở lần chạy theo quyền/khả năng. Sửa SQL đi thẳng editor; không bắt kỹ sư qua hồ sơ rồi tab SQL.
- Tên mở hồ sơ đọc, không tự kích hoạt SQL editor hoặc preview query.
- Form tạo model thu vào nút Tạo model, tái sử dụng luồng và quyền hiện hữu.
- Khi metadata phân lớp/nghiệp vụ chưa hỗ trợ, công bố ngắn tình trạng chưa phân loại; giữ tìm theo tên và kết quả chạy dùng được. Không chặn bản phát hành gọn vì chờ đủ taxonomy.
- Khi bộ lọc có trong URL nhưng control đang thu gọn, luôn hiện chip; không ẩn điều kiện đang áp dụng.

Phân lớp là metadata có nguồn. Đầu vào/Xử lý/Đầu ra là mặc định; Bronze/Silver/Gold chỉ sau khi xác nhận mapping, không tự map stg/int/mart. Nghiệp vụ và nguồn có thể nhiều giá trị; mỗi control chọn một giá trị ở v1, kết hợp AND. Count lớp loại bỏ riêng điều kiện layer, áp các điều kiện khác; count distinct trên dataset theo quyền, trước phân trang.

## 5. Hồ sơ model — hiểu nhanh, mở sâu khi cần

Đầu trang: tên dễ hiểu/tên kỹ thuật, một câu mục đích, lớp và kết quả chạy; nút Xem dòng dữ liệu và Sửa SQL theo quyền. Có đường về đúng ngữ cảnh trước đó.

Chỉ ba mục con:

1. **Tổng quan:** mục đích → mỗi dòng là gì → đơn vị/quy tắc nghiệp vụ → ba thông tin riêng về lần chạy, độ mới, kiểm tra → đầu vào/nơi sử dụng trực tiếp. Nhật ký chi tiết là liên kết, không sao chép toàn bộ run nhiều model.
2. **Dữ liệu:** cột, kiểu, nullable, khóa/quan hệ đã khai báo và mức kiểm chứng; tìm cột; preview độc lập nếu API hỗ trợ. Số cột ở đây, không chiếm List hay panel graph.
3. **SQL:** bản lưu và bằng chứng so với bản đã build; mở editor; khối kỹ thuật mở dần cho cách cập nhật/materialization/cấu hình khi có dữ liệu xác thực.

Cấu hình kiểm thử không phải kết quả đạt. Tổng kiểm thử của run không phải tổng kiểm thử model. Comment SQL có thể làm ứng viên mô tả/grain có provenance để rà soát; không tự xuất bản thành định nghĩa nghiệp vụ đã xác nhận.

Trường cốt lõi thiếu (mục đích/grain/chất lượng) có nhãn chưa có ngắn gọn. Không dựng hàng chục thẻ trống cho các khả năng chưa hỗ trợ như cost, SCD, column lineage. Không suy freshness từ tuổi lần build, SQL-sync từ timestamp, hay grain từ tên/khóa.

## 6. Lineage — xem đường đi và tác động

```text
Mô hình dữ liệu
[Danh sách] [Dòng dữ liệu]

[Chọn đối tượng trung tâm…]                [Mở hồ sơ]
[Lấy từ đâu | Hai phía | Được dùng ở đâu]   [1 bước ▾]
[Sơ đồ | Bảng quan hệ]      [Xem toàn bộ tác động]
Phạm vi: … · Quan hệ theo SQL đã lưu · Độ đầy đủ: …

Đầu vào → Đối tượng trung tâm → Nơi sử dụng   | Panel khi chọn
```

- Vào chưa có root: bộ chọn có tìm kiếm và phạm vi lớp/nghiệp vụ khi hỗ trợ; không mặc định layout toàn tenant. Giữ khả năng tìm bảng thô đang có trong production, với loại đối tượng riêng.
- Giữ nghĩa gốc của dữ liệu: “Đọc từ / Được dùng bởi”. “Có thể bị ảnh hưởng” chỉ ở chế độ downstream; không gọi upstream là ảnh hưởng.
- Mặc định hai phía một bước. Chọn node chỉ mở panel; nút Lấy làm trung tâm mới đổi root. Không fit/zoom lại khi chọn.
- Node chỉ tên dễ hiểu + kỹ thuật, loại và trạng thái đáng chú ý. Không nhét 27 cột, SQL, grain và timestamp trên mọi node.
- Panel: tên, mục đích/grain ngắn, kết quả chạy, quan hệ trực tiếp và bằng chứng cảnh báo; link Hồ sơ/SQL/Nhật ký. Các danh sách dài nằm ở Bảng quan hệ.
- Phân biệt rõ hai thao tác: Hiện thêm N (chỉ vẽ thêm trong scope) và Mở tiếp nhánh (mở rộng scope). Graph/table dùng chung một logic duyệt/count/path.
- Bảng quan hệ nằm ngay trong tab, không đặt một danh sách toàn tenant kéo dài bên dưới graph. Có tìm tên, loại, trực tiếp/gián tiếp và một đường phụ thuộc đã biết.
- Xem toàn bộ tác động đặt down/all/table, tự hiển thị partial nếu chưa đủ dữ liệu; không ép vẽ hàng trăm node trước khi trả lời.
- Dòng bằng chứng ngắn luôn thấy, ví dụ “Theo khai báo SQL · Chưa có quan hệ tới báo cáo”; diễn giải ref/source/macro trong phần mở rộng. Thiếu khai báo và ref bị đứt là hai cảnh báo khác nhau.
- Không tự ẩn chk_*, coi mọi cạnh là luồng giá trị nghiệp vụ hoặc gán loại cạnh từ tên. Khi chưa có loại dependency, dùng nhãn trung tính và bằng chứng ref/source/macro.
- Graph lỗi: bảng theo root vẫn dùng được nếu dữ liệu hợp lệ, nút Thử lại sơ đồ rõ ràng. Lỗi dữ liệu thì báo lỗi, không giả bảng đầy đủ.
- Các số trực tiếp/toàn chuỗi/đang vẽ đều có nhãn phạm vi. Không cộng node trùng nhiều đường đi, không đếm root vào số liên quan.

## 7. Điều hướng và khả năng tương thích

- Đúng hai tab cấp cao, không thêm tab Hồ sơ, SQL, Tác động hoặc AI ngang cấp.
- Hồ sơ thuộc Danh sách nhưng có Quay lại dòng dữ liệu nếu đến từ graph; giữ root, selected node, scope, camera và scroll trong session. Đổi tenant xóa ngữ cảnh không còn hợp lệ.
- Từ hàng/hồ sơ sang Lineage dùng đúng model đó. Từ List chưa chọn model thì mở bộ chọn; không tự chọn kết quả đầu.
- Chuyển hai tab giữ bộ lọc danh sách. Bộ lọc List chỉ giới hạn picker, không cắt dependency của root.
- Kiểm tra tương thích các URL đã quan sát: `q`, `build=failed/never/other/ok`, `view=lineage`, `model`, `scope=related`; thêm link prototype `fam`. Mapping old scope=related phải giữ nghĩa toàn chuỗi đã biết; không âm thầm đổi về một bước.
- Giữ link root bảng thô `model=raw.records`, tên có dấu chấm và editor `/models/:name`; dùng adapter ID có loại để tránh xung đột.
- Build một model vẫn chỉ build phạm vi hiện hữu; bản nháp và quyền giữ nguyên. Không suy rằng một run theo lịch gồm nhiều model là thao tác Build của editor.

## 8. Triển khai theo ba đợt có giá trị độc lập

### Đợt A — Đọc và điều tra được bằng dữ liệu hiện có

- Audit checkout/API/quyền; chẩn đoán layout bằng fixture, logs và instrumentation.
- Gọn List, giữ tìm/lọc/sort và URL cũ; thêm hồ sơ đọc tối thiểu từ metadata hiện có, giữ lối tắt editor/journal.
- Dùng `bi.schema` cho tên/kiểu cột và `models.check` cho kiểm tra SQL chưa chạy; không tạo bộ đọc schema hay bộ kiểm tra SQL thứ hai.
- Bảng quan hệ theo root, phạm vi/count/bằng chứng; fallback không phụ thuộc layout thành công.
- Không đợi taxonomy, preview, freshness hoặc cost hoàn chỉnh mới phát hành đợt A.

### Đợt B — Lineage tập trung và khám phá theo lớp

- Graph một bước, mở nhánh, panel gọn, bảng đồng bộ, điều hướng hai tab.
- Xác minh nơi lưu metadata/version, người chịu trách nhiệm; tạo mapping lớp/nghiệp vụ cho nhóm model đại diện, rà soát trước khi áp dụng.
- ADR 0112 đã gỡ business context: mapping lớp/nghiệp vụ là quyết định mới có phạm vi tối thiểu, không tự coi bảng context cũ hay API setContext còn tồn tại. Có thể tách phần này khỏi bản phát hành graph nếu chưa chốt nguồn duy trì.
- Prefix/comment/AI chỉ tạo ứng viên; metadata chưa xác nhận giữ unclassified. Có revision và luồng cập nhật bằng config/API hiện hữu, không thêm màn quản trị taxonomy mới.
- Bật bộ lọc lớp/nghiệp vụ khi adapter có dữ liệu; mapping thiếu vẫn hiển thị Chưa phân loại.

### Đợt C — Bổ sung theo bằng chứng và nhu cầu

- Nguồn nghiệp vụ qua ingestion/macro mapping; alias, grain, ngữ nghĩa cột được rà soát.
- Kết quả kiểm thử theo model/run từ Nhật ký; preview độc lập; hash SQL; freshness có định nghĩa/ngưỡng.
- Hiệu năng, cập nhật/lịch sử và owner/quyền nếu nguồn dữ liệu hỗ trợ. Không xây mới hệ quan sát, feature store, cost dashboard hay cơ chế chuyển ngữ cảnh sang AI trong đợt này.
- Report lineage và column lineage là phần riêng sau khi có nguồn quan hệ đáng tin cậy.

## 9. Nghiệm thu

### Chức năng và dữ liệu

- Tìm model ngoài trang đầu; count không từ riêng trang hiện tại; request cũ không ghi đè query mới.
- Graph và bảng cùng root/scope; có cycle, fan-out, missing-ref, undeclared upstream, raw root và partial coverage.
- Fixture ít nhất 205 model + 2 raw nodes; thêm trường hợp 103 downstream, 16 trực tiếp để phân biệt scope. Đây là fixture lấy cảm hứng từ audit, không hardcode production.
- API preview không build; SQL và dữ liệu mẫu đúng quyền; bản nháp không mất; link editor/journal cũ tiếp tục mở.
- Không gộp kết quả build/freshness/quality, không biến cấu hình test thành kết quả test hoặc tổng run thành kết quả từng model.
- Tái sử dụng module dữ liệu, scope và component hồ sơ; chạy checks bắt buộc của repository khi triển khai. Bản sửa tài liệu hiện tại chỉ kiểm tra tính nhất quán, không tuyên bố ứng dụng đã pass.

### Thử với người dùng

Thử cùng tác vụ với người không chuyên data và kỹ sư; gợi ý 3 người mỗi nhóm cho vòng định tính đầu, không coi là nghiên cứu thống kê.

| Tác vụ | Dấu hiệu đạt |
|---|---|
| Chưa biết tên nhưng biết nghiệp vụ | Tìm đúng nhóm/model mà không đọc SQL |
| Hiểu invoice model | Nói được mỗi dòng là gì và giới hạn tiền tệ nếu metadata có; nhận biết nếu chưa xác nhận |
| Kiểm tra dữ liệu dùng được chưa | Phân biệt chạy thành công, độ mới và kiểm thử |
| Tìm nguồn và nơi sử dụng | Phân biệt raw table với tài khoản nguồn, trực tiếp với nhiều bước |
| Sửa SQL đã biết model | Từ hàng mở editor một thao tác theo quyền |
| Graph lỗi | Vẫn đọc được quan hệ theo root mà không dò danh sách toàn tenant |
| Đổi tab rồi quay lại | Không mất bộ lọc, root và ngữ cảnh điều tra |

Ghi thời gian, số lần đi nhầm, câu trả lời sai và mức trợ giúp trước/sau. Mục tiêu vòng thử: ít nhất 5/6 người hoàn tất các tác vụ tìm/hiểu/truy nguyên không cần hướng dẫn thao tác; không ai kết luận build xanh = dữ liệu chắc chắn đúng/mới sau khi đọc hồ sơ. Nếu không đạt, sửa ngôn ngữ/phân bổ rồi thử lại; đây là mục tiêu chưa đo.

## 10. Không làm trong vòng này

- Không thêm các tab cấp cao hoặc tách chế độ Người mới/Chuyên gia.
- Không hiển thị đồng thời mọi bộ lọc, ma trận, graph, schema và SQL.
- Không đổi toàn bộ branding/design system, không thay thư viện graph trước khi chẩn đoán.
- Không xây visual pipeline builder, AI chat mới, health score tổng hợp hoặc phân loại tự động được coi là sự thật.
- Không xây lại Nhật ký/Báo cáo/Nguồn dữ liệu trong Models.

Cơ sở tham khảo của v1.1 vẫn dùng: dbt Catalog, Atlan, DataHub, Dagster, OpenMetadata. Quyết định v1.2 được điều chỉnh theo web trực tiếp và nhu cầu người dùng; không gán toàn bộ chức năng các sản phẩm tham khảo cho Undercroft.
