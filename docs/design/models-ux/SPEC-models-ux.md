# Đặc tả sản phẩm và tương tác — Undercroft Models

**Phiên bản:** 1.3 · 11/10/2026 — bổ sung hợp đồng hiệu năng
**Trạng thái:** Đặc tả mục tiêu để thiết kế, triển khai và nghiệm thu; chưa xác nhận ứng dụng hiện tại đáp ứng các hợp đồng bên dưới.
**Tài liệu liên quan:** [Plan triển khai](./PLAN-models-ux.md).

**Audit mới:** [AUDIT-models-performance-2026-10-11.md](./AUDIT-models-performance-2026-10-11.md). Có lỗi layout tái hiện bằng bundle production và công việc nặng chạy cùng luồng UI; chưa đo latency backend. Phần 14 dưới đây bổ sung yêu cầu, không xác nhận ứng dụng đã đáp ứng. Số liệu snapshot 10/10 ở phần cũ giữ nguyên ngữ cảnh lịch sử.

**Ranh giới đã xác minh bằng code:** xem [FEASIBILITY-models-repo.md](./FEASIBILITY-models-repo.md), commit `69d6928` / v1.73.0. Các schema dưới đây vẫn là mục tiêu. Hiện có `bi.schema` (tên/kiểu cột), `models.check`, `runs.get.steps`; chưa có model metadata nghiệp vụ (đã gỡ theo ADR 0112), hash SQL bản build, lastSuccessfulBuild riêng hoặc models.preview theo ID. Không triển khai các trạng thái current/incomplete/needs_review của business context cũ. AI ngoài qua MCP/CLI và trợ lý trong web có bề mặt công cụ khác nhau; không giả định trợ lý web được Save/Build.

**Thay đổi 1.2:** phân bổ lại thông tin giữa đúng hai tab Danh sách/Dòng dữ liệu sau [điều tra trực tiếp v1.73.0](./AUDIT-models-live-2026-10-10.md). Thêm hồ sơ dùng chung, lối tắt kỹ thuật, triển khai theo khả năng metadata, tương thích URL production và raw-table root. Giữ các hợp đồng scope/count/quyền của v1.1 nếu không được sửa bên dưới.

## 1. Mục tiêu và phạm vi

### 1.1. Quyết định sản phẩm

Models là không gian làm việc theo luồng **tìm model → hiểu model → xem quan hệ → kiểm tra tác động**.

- **Danh sách** là tab mặc định để tìm model và kiểm tra sơ bộ; **Dòng dữ liệu** là tab quan hệ. Chỉ có hai tab cấp cao.
- **Chọn phạm vi** ngay trên danh sách: Đầu vào / Xử lý / Đầu ra, kết hợp nghiệp vụ, nguồn và trạng thái. Không yêu cầu biết tên model trước.
- **Hồ sơ** là trang đọc dùng chung của model, thuộc khu vực Danh sách; không phải tab cấp cao thứ ba. Nếu mở từ Lineage có đường trở về đúng graph trước đó.
- **Quan hệ** nằm trong tab Dòng dữ liệu, tập trung quanh một model hoặc bảng thô được hỗ trợ; sơ đồ/bảng là hai cách xem cùng phạm vi.
- **Editor** giữ hành vi sửa SQL, bản nháp và build hiện hữu. Có Sửa SQL trực tiếp từ hàng hoặc hồ sơ theo quyền. Nhật ký vẫn là nơi đọc run/log đầy đủ; không xây bản sao trong Models.

Không đặt danh sách, ma trận family × source, graph và hồ sơ đầy đủ cạnh nhau. Panel trong graph chỉ là bản xem nhanh của hồ sơ.

**Quyết định đã chốt với người dùng:** không có nút AI, chat AI, hành động “Nhờ AI sửa/kiểm tra” hoặc luồng chuyển ngữ cảnh sang AI trong List, Lineage và hồ sơ. Trợ lý chung hiện có của ứng dụng nằm ngoài phạm vi thay đổi; MCP/CLI của agent ngoài giữ nguyên.

### 1.2. Phạm vi v1

| Bắt buộc | Có khi nguồn dữ liệu hỗ trợ | Ngoài phạm vi |
|---|---|---|
| Tìm model, lọc lần chạy, hồ sơ tối thiểu và fallback metadata thiếu | Phân lớp/nghiệp vụ/nguồn có bằng chứng, tên dễ hiểu và grain | Hệ thống quản trị domain/data product đầy đủ |
| Hồ sơ với dữ liệu hiện có | Preview dữ liệu độc lập | Lineage mức cột |
| Lineage tập trung và mở nhánh | So SQL đã lưu với SQL đã build | Điểm health tổng hợp |
| Bảng quan hệ/tác động | Thống kê report phụ thuộc | Tự suy luận mô tả nghiệp vụ |
| URL, Back/Forward, quyền và lỗi | Kiểm tra chất lượng/độ mới | Saved views chia sẻ, ghim đồng bộ |

Triển khai theo ba đợt A/B/C trong Plan v1.2. Đợt A không bị chặn bởi taxonomy/preview/freshness. Tính năng ở cột giữa có trạng thái chưa hỗ trợ được quy định rõ. Không tạo dữ liệu giả để hoàn thiện giao diện. Nếu bật tính năng thì phải đáp ứng đầy đủ hợp đồng và tiêu chí của tính năng đó.

### 1.3. Thuật ngữ

| Thuật ngữ | Nghĩa trong spec |
|---|---|
| Đối tượng trung tâm (root) | Model hoặc bảng hồ thô được hỗ trợ, xác định phạm vi quan hệ; chữ model trong các hợp đồng duyệt cũ được hiểu là root khi áp dụng cho bảng thô |
| Node đang xem | Đối tượng đang mở trong panel; có thể khác model trung tâm |
| Upstream / Đầu vào | Đối tượng cung cấp dữ liệu trực tiếp hoặc gián tiếp cho model |
| Downstream / Nơi sử dụng | Đối tượng dùng dữ liệu trực tiếp hoặc gián tiếp từ model |
| Một cấp | Đi qua một cạnh phụ thuộc, không dựa vào tên family |
| Phạm vi quan hệ | Tập đối tượng/cạnh đã được đưa vào truy vấn khám phá |
| Đang hiển thị | Phần của phạm vi quan hệ đang được vẽ; có thể nhỏ hơn phạm vi |
| Tác động | Khả năng bị ảnh hưởng theo quan hệ; không đồng nghĩa đã lỗi |
| Dữ liệu hiện có | Kết quả đã được tạo và còn đọc được; có thể từ lần build thành công trước |
| Lớp vai trò | Vai trò của model trong xử lý dữ liệu: input/transform/output; độc lập với vị trí upstream/downstream so với một root |
| Nghiệp vụ | Chủ đề sử dụng đã khai báo, ví dụ Tài chính; một model có thể có nhiều giá trị |
| Nguồn gốc | Upstream đã xác nhận qua nhiều cấp; nguồn nghiệp vụ và bảng thô vật lý có loại/ID riêng, không suy nguồn nghiệp vụ từ nơi lưu kết quả |

## 2. Kiến trúc màn hình và điều hướng

### 2.1. Các màn hình

| ID | Màn hình | Điểm vào | Hành động chính |
|---|---|---|---|
| M01 | Danh sách Models | Menu Models | Tìm, lọc, mở hồ sơ |
| M02 | Hồ sơ model | Tên model trong danh sách | Đọc, xem quan hệ, mở SQL |
| M03 | Quan hệ model | Nút Xem quan hệ, deep link | Khám phá graph hoặc bảng |
| M04 | Chọn đối tượng trung tâm | Link lineage chưa có root | Tìm model hoặc bảng thô để bắt đầu |
| E01 | Editor hiện hữu | Mở/Sửa SQL | Giữ nghiệp vụ editor hiện tại |

M02 là trang trong vùng nội dung, không phải drawer. M03 có panel xem nhanh; nội dung dài mở sang M02. M01 không mở panel chỉ vì click vào khoảng trống của một hàng.

### 2.2. Hợp đồng URL mục tiêu

Các tham số mới dưới đây là đề xuất cho phiên bản này; adapter phải tương thích tham số và route thực tế sau khi đọc repository.

Base: `/tenants/:tenantId/models`

| Trường | Giá trị | Mặc định / hành vi |
|---|---|---|
| `view` | `list`, `detail`, `lineage` | `list` |
| `model` | ID model/root có adapter tương thích tên cũ, gồm raw.records | Thiếu trong detail/lineage → M04; detail chỉ dành cho model |
| `tab` | `overview`, `data`, `sql` | `overview`; chỉ dùng trong detail |
| `q` | Chuỗi tìm kiếm | Rỗng |
| `layer` | `input`, `transform`, `output`, `unclassified` | Bỏ tham số = Tất cả lớp |
| `domain` | ID nghiệp vụ hoặc giá trị dành riêng `unclassified` | Bỏ tham số = Mọi nghiệp vụ |
| `source` | ID nguồn hoặc giá trị dành riêng `unknown` | Bỏ tham số = Mọi nguồn; unknown = nguồn gốc chưa xác định đầy đủ |
| `fam` | Family hợp lệ | Không lọc |
| `status` | Mã trạng thái build chuẩn hóa | Không lọc |
| `sort` | `name_asc`, `name_desc`, `build_desc` | `name_asc` |
| `mode` | `graph`, `table` | `graph`; chỉ dùng trong lineage |
| `dir` | `up`, `down`, `both` | `both` |
| `depth` | `1`, `2`, `3`, `all` | `1`; `all` là toàn bộ quan hệ reachable của model trung tâm |

Ví dụ mục tiêu: `?view=lineage&model=<id>&mode=graph&dir=both&depth=1`.

Ví dụ lọc danh sách: `?view=list&layer=output&domain=<finance-id>&source=<xero-id>`. Domain/source dùng ID ổn định, có namespace tách biệt giá trị dành riêng, không dùng nhãn dịch. Mỗi trường chỉ chọn một giá trị trong v1.

Quy tắc:

- Link cũ `?view=lineage&fam=mart` mở M04, lọc danh sách chọn theo family; không tự chọn model đầu tiên.
- `layer/domain/source/fam/status/q` trong lineage chỉ là ngữ cảnh danh sách/bộ chọn model trung tâm; **không cắt dependency khỏi graph hoặc bảng tác động**. Phạm vi quan hệ do root/hướng/độ sâu/nhánh quyết định.
- Link editor cũ tiếp tục hoạt động. Không đổi route editor trong phạm vi spec này.
- Adapter giữ link production `build=ok/failed/never/other`: ok → success, failed/never tương ứng; other giữ nhóm trạng thái legacy sau khi kiểm tra code, không tự coi là failed. Nếu status chuẩn mới và build cùng có thì status ưu tiên; thay filter xóa alias cũ bằng replace. Không nới kết quả âm thầm nếu chưa giải được nhóm other.
- Link `scope=related` cũ có root tương đương toàn chuỗi đã biết: both/all; hướng/độ sâu chuẩn mới nếu có sẽ ưu tiên. Link thường có root nhưng không scope vẫn mặc định một bước. Kiểm tra route thực trước khi viết adapter.
- Giữ `model=raw.records` và raw.documents với EntityRef.kind riêng. Chúng không phải tài khoản nguồn hoặc model giả, không có nút Sửa SQL/Build.
- Sort legacy tiếp tục có adapter theo giá trị URL xác minh từ code; không suy giá trị từ nhãn Cần chú ý trước. Link mới vẫn mặc định name_asc.
- List → Lineage từ hàng/hồ sơ đặt đúng root; từ tab List chưa chọn root mở M04, không tự chọn kết quả đầu. Tab trở lại List khôi phục query/page/scroll; quay về Lineage trong cùng session khôi phục root/scope/camera đã xem. URL explicit ưu tiên session; deep link không có root không tự nhận root từ phiên khác.
- Tham số enum không hợp lệ về mặc định và được chuẩn hóa bằng replace, không tạo vòng lặp redirect.
- ID domain/source không thể resolve không được âm thầm xóa để mở rộng kết quả. Hiện “Bộ lọc không còn khả dụng” cùng nút Bỏ bộ lọc đó; không tiết lộ đối tượng ngoài quyền.
- Model không tồn tại/không thể truy cập hiển thị trạng thái không mở được; không chuyển sang model khác.
- Chuyển model, màn hình, tab, hướng và độ sâu tạo history entry. Gõ tìm kiếm, chọn node, pan/zoom không tạo history entry cho từng thao tác.
- Lưu scroll, camera, node đang xem, nhánh đã mở và trang danh sách trong trạng thái điều hướng theo tenant/model. Back/Forward phục hồi được.
- Lớp và các bộ lọc danh sách đi cùng URL tới hồ sơ/quan hệ để quay lại; chúng không ngăn mở một model hợp lệ qua deep link dù model không khớp bộ lọc danh sách đã lưu.
- Link chia sẻ v1 khôi phục **model và phạm vi cơ sở** theo URL. Nhánh mở thủ công và camera không thuộc link chia sẻ; nút có nhãn “Sao chép liên kết model và phạm vi”.
- Return URL từ editor chỉ cho phép đường dẫn nội bộ cùng tenant; không nhận URL ngoài ứng dụng.

### 2.3. Phân bổ thông tin và nguồn dùng chung

| Nơi | Nội dung chính | Đưa vào chi tiết |
|---|---|---|
| List | Tìm kiếm, lớp, phạm vi nghiệp vụ, tên thân thiện/kỹ thuật, lần chạy | Run ID, số cột, SQL sửa lúc, nguồn đầy đủ, chất lượng chi tiết |
| Hồ sơ | Mục đích/grain, tình trạng tách biệt, dữ liệu, SQL | Cấu hình cập nhật, version, kỹ thuật nâng cao theo khả năng |
| Lineage | Đường đi, phạm vi, trực tiếp/gián tiếp, bằng chứng và ảnh hưởng | Schema/SQL dài chuyển về cùng hồ sơ; log chuyển Nhật ký |

Mọi nơi dùng cùng EntityRef và adapter metadata/status. Không tạo hồ sơ độc lập trong graph. Không thêm tab AI, Impact, SQL hoặc Operations ngang cấp List/Lineage. Tên tab tiếng Việt giữ Danh sách / Dòng dữ liệu như production; tiếng Anh List / Lineage. Ngôn ngữ đời thường đi trước, thuật ngữ kỹ thuật vẫn có trong phần giải thích.

## 3. M01 — Danh sách Models

### 3.1. Bố cục

```text
Mô hình dữ liệu · N                              [Tạo model]
[Danh sách] [Dòng dữ liệu]
[Tìm tên hoặc mô tả — theo khả năng thực tế…                ]
[Tất cả lớp] [Đầu vào] [Xử lý] [Đầu ra]   [Chưa phân loại]
[Nghiệp vụ] [Bộ lọc (N): Nguồn / Lần chạy / Family] [Sắp xếp]
Điều kiện đang bật · N kết quả                   [Xóa bộ lọc]
Model / tên kỹ thuật / mô tả ngắn | Lớp | Lần chạy gần nhất | ⋯
…
                             1–50 trên N     [Trước] [Sau]
```

Số liệu trong wireframe là minh họa bố cục, không phải dữ liệu cố định.

### 3.2. Các thành phần

| ID | Thành phần | Quy tắc |
|---|---|---|
| LIST-01 | Tiêu đề và tổng số | Tổng số trong tenant theo quyền. Khi lọc, thêm “N kết quả”; không thay tổng tenant bằng số trang |
| LIST-02 | Tạo model | Hiện khi có quyền; đi vào luồng tạo hiện hữu |
| LIST-03 | Tìm kiếm | Chuỗi đã trim, không phân biệt hoa/thường, tìm chuỗi con trong tên kỹ thuật và alias được hỗ trợ; thêm mô tả nếu được hỗ trợ |
| LIST-04 | Bộ lọc | Nghiệp vụ ở hàng chính khi hỗ trợ; Nguồn/Lần chạy/Family trong Bộ lọc (N); AND giữa các chiều. Điều kiện active luôn thành chip ngoài popup |
| LIST-05 | Chọn lớp | Tất cả lớp / Đầu vào / Xử lý / Đầu ra; có lựa chọn Chưa phân loại. Chọn lớp không xóa các bộ lọc khác |
| LIST-06 | Tên model | Link tới M02. displayName đã xác nhận là dòng chính, tên kỹ thuật dòng phụ luôn đọc được; thiếu alias dùng tên kỹ thuật, không lặp hai tên giống nhau. Mô tả ngắn khi có |
| LIST-07 | Phạm vi | Cột Lớp dùng assignment đã xác nhận. Nghiệp vụ là dòng phụ khi có; nguồn không chiếm cột mặc định, mở trong hồ sơ. Nguồn đầy đủ hiển thị tối đa 2 tên rồi +N trong phần metadata |
| LIST-08 | Build gần nhất | Nhãn trạng thái + thời gian có nghĩa; chi tiết timestamp theo mục 7 |
| LIST-09 | Lối tắt hàng | Xem dòng dữ liệu, Xem SQL, Sửa SQL, Mở lần chạy theo quyền/khả năng. Sửa SQL là link trực tiếp tới editor, có thể đặt cạnh menu trên desktop; không thêm Build nhanh |
| LIST-10 | Dòng phạm vi | Hiện vai trò, nghiệp vụ, nguồn và mọi điều kiện đang bật, kể cả Family trong Bộ lọc thêm; count là kết quả giao các điều kiện |
| LIST-11 | Xóa bộ lọc | Xóa q/layer/domain/source/fam/status, về trang đầu; giữ sort. Tất cả lớp chỉ bỏ layer; Tất cả trạng thái chỉ bỏ status |

Bỏ dãy năm thẻ thống kê và phép cộng. Tổng tenant + số kết quả đủ cho mặc định; bộ lọc lần chạy giữ đầy đủ trạng thái. Không thay bằng năm thẻ KPI khác. Tạo model mở luồng hiện hữu từ nút, không đặt form thường trực cuối danh sách.

Metadata chưa hỗ trợ không ngăn List hoạt động: có ghi chú phân loại chưa có, control không khả dụng không làm người dùng tưởng đang lọc được. Nếu assignment hỗ trợ nhưng còn thiếu thì có nhóm Chưa phân loại. Control có điều kiện active từ URL không được âm thầm ẩn hoặc bỏ điều kiện.

Tên mặc định sắp tăng dần; tên bằng nhau dùng ID làm khóa phụ. `build_desc` dùng thời điểm bắt đầu lần chạy gần nhất; model chưa có lần chạy nằm cuối. Mỗi trang mặc định 50 hàng; sử dụng cursor nếu backend hiện hữu dùng cursor.

### 3.3. Phân loại, bộ lọc và số lượng

**DISC-01 — Vai trò:** mỗi model có đúng một vai trò đã xác nhận hoặc chưa phân loại.

| Mã | Nhãn chính | Diễn đạt phụ | Cơ sở |
|---|---|---|---|
| input | Đầu vào | Chuẩn hóa từng nguồn | Metadata/config được rà soát |
| transform | Xử lý | Ghép và tính toán | Metadata/config được rà soát |
| output | Đầu ra | Phục vụ báo cáo, phân tích hoặc ứng dụng | Metadata/config được rà soát |
| unclassified | Chưa phân loại | Chưa xác định vai trò | Chưa có gán lớp đáng tin cậy |

- `stg/int/mart` chỉ là ví dụ quy ước của bản minh họa. Prefix có thể giúp đề xuất mapping khi rà soát, không tự trở thành phân loại chính thức.
- Không phân lớp bằng graph rank: một input có thể nằm ở downstream của model khác. Vai trò và quan hệ là hai khái niệm riêng.
- Không tự gán Bronze/Silver/Gold. Medallion không thuộc bộ chọn v1; nếu dùng sau này phải có mapping được xác nhận. Không biến source/raw thành model để điền ô Bronze.
- Chưa phân loại là lựa chọn nhỏ cạnh nhóm lớp; hiện khi có kết quả, đang được chọn hoặc chưa biết count. Count bằng 0 có thể ẩn nếu không đang chọn. Không bỏ model chưa phân loại khỏi Tất cả lớp.

**DISC-02 — Nghiệp vụ:** dùng danh mục ID/nhãn và assignment có bằng chứng; một model có thể thuộc nhiều nghiệp vụ. Chọn một nghiệp vụ khớp model có chứa ID đó, không tạo bản sao hàng. Chưa có assignment xác nhận → nhóm Chưa phân loại. Lỗi tải metadata tạm thời là lỗi tải, không tự chuyển thành chưa phân loại.

**DISC-03 — Nguồn dữ liệu:** lọc theo nguồn gốc upstream ở mọi cấp trong snapshot có bằng chứng, không chỉ nguồn trực tiếp. Phân biệt nguồn nghiệp vụ/tài khoản ingestion với bảng thô vật lý. Production hiện có raw.records/raw.documents; cạnh tới raw.records không chứng minh Xero hay HubSpot. Nguồn nghiệp vụ cần mapping ingestion/macro đã rà soát; nếu chỉ hỗ trợ quan hệ vật lý, nhãn là Bảng thô và không hiển thị danh mục Xero/HubSpot giả. Một filter source dùng một loại danh mục công bố rõ theo capability, không trộn ID bảng thô với ID tài khoản nguồn. Ví dụ model dùng Xero và HubSpot sẽ khớp khi chọn từng nguồn; chỉ hiển thị một lần trong kết quả. Không suy nguồn từ tên model.

- Phân biệt nguồn chưa xác định đầy đủ với tập nguồn đã xác nhận rỗng. Tập rỗng + coverage complete → “Không có nguồn upstream được ghi nhận”.
- Coverage partial/unknown/unsupported → “Chưa xác định đầy đủ”; vẫn hiện các nguồn đã biết. Bộ lọc nguồn `unknown` bao gồm các model này, kể cả đã biết một phần nguồn.
- Khi lọc Xero trên coverage partial, chỉ liệt kê những model đã xác nhận dùng Xero và báo “Kết quả nguồn gốc có thể chưa đầy đủ”. Không xem không khớp là bằng chứng không liên quan.

**DISC-04 — Tổ hợp:** mỗi control chọn một giá trị hoặc tất cả; các control kết hợp AND. Metadata nguồn/nghiệp vụ dạng nhiều giá trị dùng phép contains cho giá trị được chọn. Không bắt người dùng chọn theo thứ tự; có thể bắt đầu từ nghiệp vụ hoặc nguồn. Giữ các lựa chọn dù tổ hợp cho 0 kết quả, kèm Xóa bộ lọc; không tự bỏ lọc.

**DISC-05 — Count:**

- Tổng cạnh tiêu đề = số model duy nhất trong tenant theo quyền, độc lập với bộ lọc.
- Count trên từng nút vai trò = tập model khớp q/domain/source/fam/status, **chưa áp dụng layer**, rồi chia theo vai trò. Tất cả lớp bao gồm Chưa phân loại.
- Count dòng phạm vi = kết quả sau toàn bộ điều kiện, trước phân trang; không đếm theo số hàng trang hiện tại.
- Khi count đầy đủ, tổng các vai trò bao gồm Chưa phân loại bằng Tất cả lớp. Không cộng count các nguồn/nghiệp vụ vì một model có thể thuộc nhiều nhóm.
- Count chưa biết hiển thị “—”; count lower_bound có nhãn “Ít nhất N”. Exact count của quan hệ nguồn đã biết không có nghĩa coverage nguồn gốc đã đầy đủ; vẫn giữ thông báo DISC-03.
- Count cập nhật cùng filter revision với kết quả; không ghép count từ query cũ với bảng mới.

### 3.4. Tìm kiếm và tải dữ liệu

- Debounce 250 ms; Enter gửi ngay. Thay bộ lọc/sort/search đưa về trang đầu.
- Kết quả bao phủ toàn dataset theo quyền. Client-side chỉ hợp lệ khi đã tải đầy đủ dataset và có bằng chứng complete.
- Hủy hoặc bỏ qua response cũ khi query/tenant thay đổi; response cũ không được ghi đè kết quả mới.
- Khi cập nhật tìm kiếm, giữ kết quả trước trong vùng đang tải và ghi “Đang cập nhật”; không trình bày chúng như kết quả của query mới.
- Placeholder là “Tìm theo tên model…”; chỉ đổi thành “Tìm theo tên hoặc mô tả…” nếu thực sự hỗ trợ cả hai.
- Nếu không biết tổng chính xác, dùng “Đã tải N model” và “Tải thêm”; không hiển thị tổng giả.
- Không gọi N truy vấn lineage riêng cho N hàng để suy nguồn ngay trong render. Tái sử dụng snapshot đầy đủ hoặc chỉ mục nguồn gốc/batch từ backend có coverage rõ ràng.

### 3.5. Trạng thái đặc biệt

| Trạng thái | Nội dung | Hành động |
|---|---|---|
| Tải lần đầu | Skeleton hàng, giữ header | Không hiện empty state |
| Tenant chưa có model | “Chưa có model” | Tạo model nếu có quyền |
| Lọc không có kết quả | “Không tìm thấy model phù hợp” | Xóa bộ lọc |
| API lỗi | “Không tải được danh sách model” | Thử lại; giữ toàn bộ điều kiện tìm/lọc |
| Thiếu quyền đọc | “Bạn không có quyền xem Models” | Không phát request dữ liệu bổ sung |

## 4. M02 — Hồ sơ model

### 4.1. Phần đầu trang

Breadcrumb Models → tên model; tên thân thiện nếu đã xác nhận, tên kỹ thuật luôn hiện; mục đích, lớp và lần chạy gần nhất. Family/nghiệp vụ/nguồn ở Tổng quan, dùng cùng provenance với List. Hành động: **Xem dòng dữ liệu**, **Sửa SQL** theo quyền; đường **Xem SQL** đọc vẫn có. Nếu đến từ Lineage có Quay lại dòng dữ liệu khôi phục đúng root/scope/camera; hồ sơ không thành tab cấp cao thứ ba.

“Xem SQL” chọn mục SQL chỉ đọc; “Sửa SQL” đi thẳng editor theo quyền từ hàng/hồ sơ/panel. Không bắt kỹ sư đi qua mục SQL chỉ đọc trước khi vào editor, không dùng một nhãn cho hai hành vi.

### 4.2. Tổng quan

Thứ tự các khối:

1. **Mục đích:** mô tả hoặc “Chưa có mô tả”.
2. **Mỗi dòng đại diện cho:** metadata grain hoặc “Chưa được mô tả”. Không suy ra từ khóa chính hoặc tên model.
3. **Tình trạng:** lần chạy gần nhất; dữ liệu hiện có từ lần thành công nào nếu biết; SQL thay đổi nếu so được.
4. **Quan hệ trực tiếp:** đầu vào và nơi sử dụng đã xác nhận. Mỗi phía tối đa 5 tên rồi “Xem quan hệ”; đếm chỉ khi có đủ bằng chứng. Trong khối Nơi sử dụng có nút phụ “Xem tác động” đi tới bảng downstream theo mục 6.1.

Sau grain có đơn vị/tiền tệ/múi giờ và quy tắc nghiệp vụ nếu có bằng chứng. Ba nhãn Lần chạy / Độ mới / Kiểm tra dữ liệu độc lập, không dùng badge Healthy tổng hợp. Không hỗ trợ thì ghi ngắn Chưa có thông tin trong khối tình trạng, không nhân thành nhiều thẻ rỗng.

Run ID, thời lượng, timestamp và tóm tắt lỗi nằm trong khối vận hành mở rộng; Mở lần chạy dẫn tới Nhật ký hiện hữu. Tóm tắt theo model phải gắn đúng model ID và run, không lấy tổng kiểm thử của run làm kết quả model. Nếu chưa ánh xạ được thì chỉ link Nhật ký và nói chưa có kết quả riêng model.

### 4.3. Dữ liệu

- Schema hiển thị tên cột, kiểu, mô tả, nullable, khóa và quan hệ khi có; có tìm cột. Phân biệt khai báo constraint, database enforcement và kết quả test, không coi chúng tương đương.
- Tái sử dụng `bi.schema` hiện có cho tên/kiểu của relation đọc được; model API riêng chỉ giữ tên cột lần build thành công. Nullable, khóa, mô tả và relationship schema chưa có trong response schema hiện tại, không tự điền từ tên cột.
- Ghi nguồn schema: định nghĩa hiện lưu hoặc dữ liệu đã tạo. Nếu không biết, ghi “Chưa xác định phiên bản schema”.
- Preview là phần riêng với nút **Xem dữ liệu mẫu**. Không tự chạy query chỉ vì mở hồ sơ/tab.
- Khi bật preview: tối đa 50 hàng, chỉ đọc, có giới hạn thời gian phía server. Mục tiêu mặc định timeout 10 giây; dùng giới hạn hiện hành nếu chặt hơn và công bố trong cấu hình.
- Preview đọc relation mà server resolve từ model ID; không nhận tên bảng hoặc SQL tùy ý từ trình duyệt.
- Hiển thị “Tối đa 50 dòng mẫu”; không gọi là toàn bộ dữ liệu. Không cam kết thứ tự nếu query không có thứ tự xác định.
- NULL phân biệt với chuỗi rỗng; nội dung ô là text, không thực thi HTML. Giá trị dài có xem đầy đủ/copy theo quyền.
- Dữ liệu cũ vẫn còn sau build lỗi được ghi “Dữ liệu từ lần build thành công trước”; nếu không xác định được thì ghi nguồn phiên bản chưa biết.
- Preview chưa hỗ trợ → “Chưa hỗ trợ xem dữ liệu mẫu tại đây”. Chưa có relation → “Chưa có dữ liệu để xem”. Không có quyền → thông báo quyền, không nút build thay thế.

### 4.4. SQL

- Hiển thị SQL đã lưu, chỉ đọc, có copy nếu chính sách hiện tại cho phép xem SQL.
- Ghi rõ đây là SQL đã lưu, không phải bản nháp hoặc bằng chứng dữ liệu đã được build từ chính phiên bản đó.
- Sửa SQL và Build tiếp tục thuộc editor hiện hữu. Rời editor vẫn bảo vệ thay đổi chưa lưu.
- Có thể tái sử dụng `models.check` để hiện lỗi/cảnh báo và phần chưa xác minh trước khi chạy. Đây là kiểm tra tĩnh, không phải chứng nhận compile thành công, đúng nghiệp vụ hoặc tests đạt.
- Chưa bổ sung thao tác sửa mô tả/grain nếu backend không có luồng lưu và quyền tương ứng.

### 4.5. Metadata chuyên sâu

- Comment SQL có thể cung cấp ứng viên mô tả/grain/quy tắc kèm file/phiên bản nguồn. Chưa rà soát thì ghi Trích từ comment SQL, chưa xác nhận; không tự coi thành ngữ nghĩa chuẩn hoặc bằng chứng dữ liệu đúng.
- Trong Tổng quan/SQL có khối kỹ thuật mở dần cho relation/môi trường, materialization, khóa cập nhật, watermark, xử lý xóa/đến muộn, lưu lịch sử nếu adapter hỗ trợ. Không thêm tab con cho từng trường.
- Hiệu năng/chi phí/owner/quyền dẫn về nguồn quản trị hoặc đo hiện có; số đo có thời điểm và phạm vi. Không đặt dashboard chi phí, quyền hoặc feature store mới vào phạm vi này.
- Metadata có cấu trúc và provenance dùng chung giữa các màn hình theo quyền. Không thêm UI, endpoint hoặc connector phục vụ chuyển ngữ cảnh sang AI trong phạm vi thiết kế này.

## 5. M03/M04 — Quan hệ tập trung

### 5.1. Bố cục

```text
Mô hình dữ liệu
[Danh sách] [Dòng dữ liệu]
<Đối tượng trung tâm>                         [Mở hồ sơ] [⋯]

[Chọn đối tượng…] [Lấy từ đâu | Hai phía | Được dùng ở đâu] [1 bước]
[Sơ đồ | Bảng quan hệ]        Phạm vi: …        Nguồn quan hệ: …

┌────────────────────────────────────┬─────────────────────┐
│                                    │ Node đang xem       │
│  Đầu vào → Model gốc → Nơi sử dụng   │ Loại / trạng thái   │
│                                    │ Xem chi tiết         │
│                                    │ Lấy làm trung tâm*  │
│ [+] [−] [Vừa khung] [Về trung tâm]   │                     │
└────────────────────────────────────┴─────────────────────┘
```

`*` Giữ khả năng lấy model và bảng hồ thô đã được production hỗ trợ làm trung tâm. Raw root có loại riêng, không có editor/build. Tài khoản nguồn/report chỉ refocus khi capability thực sự hỗ trợ; không suy từ khả năng raw root. Các hợp đồng scope/count áp dụng cả hai loại root.

M04 có lời nhắc Chọn model hoặc bảng thô để xem dòng dữ liệu, bộ chọn có tìm kiếm, phân biệt loại; lọc lớp/nghiệp vụ cho model nếu hỗ trợ. Không dùng dropdown 207 lựa chọn không có tìm, graph trống hoặc mặc định toàn hệ thống. Raw selection giữ link production, không bị gán lớp của model.

### 5.2. Phạm vi và độ sâu

**REL-01.** Cạnh có hướng `nguồn dữ liệu → đối tượng sử dụng`. Upstream đi ngược cạnh; downstream đi thuận cạnh.

**REL-02.** Phạm vi cơ sở là hợp của các node reachable theo hướng đã chọn trong tối đa D cạnh. Mặc định D=1 và cả hai phía. Root luôn hiện và không tính vào số đối tượng liên quan.

**REL-03.** Độ sâu toàn bộ là toàn bộ reachable của root theo hướng chọn, không phải mọi model trong tenant. Giới hạn vận hành hoặc dữ liệu thiếu phải được trả về thành trạng thái truncated/partial.

**REL-04.** Một node có nhiều đường đi vẫn chỉ là một đối tượng. Số cấp là đường đi ngắn nhất theo từng hướng trong tập quan hệ đã biết. Có cycle thì một đối tượng có thể có vai trò cả upstream/downstream; không cộng hai lần vào tổng distinct.

**REL-05.** Bộ lọc danh sách gồm layer/domain/source/fam/status/q chỉ giới hạn bộ chọn trung tâm, không giới hạn duyệt quan hệ. Bộ lọc loại đối tượng trong bảng quan hệ, nếu có, lọc kết quả trình bày sau khi duyệt; không cắt mất đường nối đi qua loại khác.

### 5.3. Hai hành động mở rộng khác nhau

| Hành động | Thay đổi gì | Ảnh hưởng tới bảng/số lượng |
|---|---|---|
| “Hiện thêm N” | Vẽ thêm node đã nằm trong phạm vi nhưng đang thu gọn | Không đổi phạm vi hay tổng |
| “Mở tiếp nhánh” | Thêm một cấp hàng xóm của node đó theo hướng của nhánh | Mở rộng phạm vi chung; bảng và tổng cập nhật |

Nhánh mở thủ công là hợp bổ sung vào phạm vi cơ sở. Thanh phạm vi ghi ví dụ **“1 cấp + 2 nhánh mở rộng”**. Có nút “Đặt lại phạm vi”. Thay root, hướng hoặc preset độ sâu xóa các nhánh bổ sung và tính lại phạm vi cơ sở.

Mỗi lần mở tiếp một node chỉ bổ sung hàng xóm trực tiếp chưa có trong phạm vi; sau đó mở tiếp từ node mới. Duyệt có visited set; không chạy đệ quy vô hạn khi có cycle.

Trong v1, nhánh thủ công được giữ trong history/session nhưng không nằm trong link chia sẻ. Không gắn nhãn “sao chép chính xác sơ đồ hiện tại” cho chức năng chia sẻ.

### 5.4. Giới hạn hiển thị ban đầu

Đây là giá trị thiết kế để kiểm tra trên fixture, không phải ngưỡng hiệu năng đã đo:

- Tối đa **20 node thật** trong lần vẽ đầu, bao gồm root; tối đa 8 hàng xóm mỗi phía ở bước đầu.
- Dành phần còn lại cho node đang xem/đường đang được làm nổi bật nếu có. Không tự nhét mọi node mới vào canvas chỉ vì dữ liệu đã tải về.
- Sắp hàng xóm ổn định theo loại rồi tên và ID. Không thay thứ tự chỉ vì status được refresh.
- Có nhóm thu gọn tại nhánh tương ứng. Biết số chính xác → “Hiện thêm N”; chưa biết → “Tải thêm”.
- Mỗi lần yêu cầu hiện thêm tối đa 10 node; nếu dùng giới hạn server thấp hơn thì theo server.
- Tổng trong bảng là tổng phạm vi, không phải số node đang vẽ. Ví dụ: “Đang vẽ 17/43 đối tượng trong phạm vi”. Root được loại khỏi cả tử và mẫu của câu này.

Các ngưỡng là cấu hình tập trung, được hiệu chỉnh khi nghiệm thu nhưng không thay đổi ý nghĩa phạm vi.

### 5.5. Hành vi lựa chọn và camera

| Sự kiện | Hành vi bắt buộc |
|---|---|
| Vào graph lần đầu | Root nhận dấu trung tâm; fit phạm vi đang vẽ một lần; panel đóng |
| Click node | Chọn node, mở panel; không layout lại, không auto-fit |
| Click nền/Escape | Bỏ lựa chọn, đóng panel; không đổi root/phạm vi |
| Lấy làm trung tâm | Root mới; reset hướng=cả hai, depth=1, nhánh và camera; tạo history entry |
| Mở nhánh | Giữ tọa độ trên màn hình của root bằng bù camera sau layout; không auto-fit toàn graph |
| Vừa khung | Fit các node thật đang hiển thị theo yêu cầu người dùng |
| Về trung tâm | Pan tới root, giữ zoom hiện tại |
| Chuyển sang bảng rồi quay lại | Giữ phạm vi, lựa chọn và camera |
| Refresh dữ liệu | Giữ root/camera; node không còn tồn tại thì đóng panel và báo ngắn |

Hover chỉ tăng độ nổi bật của quan hệ trực tiếp/tooltip; không fetch preview hay thay lựa chọn. Node có tên thân thiện/kỹ thuật, icon loại và nhãn lỗi/đang chạy/chưa rõ nếu cần; thành công không cần thêm badge xanh trên mọi node. Không có SQL/schema đầy đủ, không mã hóa loại bằng kích thước. Vai trò lớp không ép thứ hạng layout; bằng chứng dependency không được suy từ prefix chk_/stg_/gold_.

### 5.6. Panel xem nhanh

Tên dễ hiểu/kỹ thuật, loại, mục đích/grain ngắn nếu có, lần chạy nếu là model, quan hệ trực tiếp và cảnh báo bằng chứng liên quan. Có Xem hồ sơ, Xem/Sửa SQL, Mở lần chạy và Lấy làm trung tâm theo capability. Không trình bày count toàn chuỗi cạnh danh sách trực tiếp mà thiếu nhãn phân biệt.

- Panel không chứa editor, danh sách mọi cột, bảng sample hoặc trace lặp lại graph. Quan hệ trực tiếp tối đa 5 mỗi phía, phần còn lại mở Bảng quan hệ đúng hướng/phạm vi. Link Cột/SQL mở đúng mục của hồ sơ dùng chung.
- Node thiếu metadata có nhãn “Chưa có đủ thông tin”; chỉ hiển thị thông tin mà backend cho phép.
- Không render tên/ID của đối tượng bị hạn chế nếu backend không cho phép công bố.
- Không thêm nút Lấy làm trung tâm cho chính root.

### 5.7. Toàn hệ thống và ma trận nâng cao

Nếu phiên bản đang triển khai đã có các chế độ này, giữ dưới menu Nâng cao với nhãn rõ. Không xây mới chỉ để đáp ứng spec v1. Chế độ toàn hệ thống có giới hạn/phân trang và fallback riêng; không được khiến luồng lineage tập trung phụ thuộc vào việc layout toàn tenant.

## 6. Bảng quan hệ và tác động

### 6.1. Tên gọi và phạm vi

Control chuyển cách xem dùng **Sơ đồ / Bảng quan hệ**, tránh nhầm với tab Danh sách cấp cao. Không đặt danh sách quan hệ toàn tenant nối dài dưới graph. Tiêu đề bên trong bảng đổi theo hướng để không gọi upstream là đối tượng bị ảnh hưởng:

| Hướng | Tiêu đề |
|---|---|
| Đầu vào | Các đối tượng cung cấp dữ liệu |
| Nơi sử dụng | Các đối tượng có thể bị ảnh hưởng |
| Hai phía | Quan hệ của model; có cột Vai trò |

Nút tắt **Xem tác động** từ hồ sơ đặt `dir=down`, `mode=table`, giữ root và depth hiện tại nếu đang trong lineage; từ hồ sơ mặc định depth=all để phục vụ kiểm tra downstream đầy đủ. Loading/giới hạn thu thập vẫn phải thể hiện rõ. Nút Xem quan hệ thông thường mở both/depth=1/graph.

### 6.2. Cột và thao tác

| Cột | Nội dung |
|---|---|
| Đối tượng | Tên và mô tả ngắn nếu có; click mở panel |
| Loại | Source, Model, Report hoặc loại được hỗ trợ |
| Vai trò | Đầu vào, Nơi sử dụng, hoặc Cả hai; ẩn nếu một hướng |
| Khoảng cách | Trực tiếp (1 cấp), Gián tiếp (N cấp); cả hai hướng có hai giá trị nếu cần |
| Trạng thái | Build gần nhất của chính đối tượng nếu có; không sao chép lỗi từ root |
| Đường phụ thuộc | Mở một đường ngắn nhất đã biết giữa root và đối tượng |

- Mỗi ID xuất hiện một lần. Sort mặc định theo khoảng cách nhỏ nhất, rồi loại, tên, ID.
- Khi phạm vi được mở thêm bằng nhánh, bảng chỉ hiện các node trong hợp phạm vi đó; không tự mở toàn bộ các nhánh khác ở cùng độ sâu.
- Có bộ lọc loại và tìm tên trong tập kết quả. Chúng chỉ lọc hàng kết quả, không thay root hay cắt đường duyệt.
- Header phân biệt “N kết quả khớp bộ lọc bảng” và “M đối tượng trong phạm vi”; xóa bộ lọc bảng trả về M.
- Phân trang 50 hàng; tổng áp dụng toàn tập trong phạm vi, không chỉ trang đang tải.
- Không có đường đã xác minh thì không dựng chuỗi bằng suy luận. Thông báo “Chưa có đủ quan hệ để hiển thị đường đi”.
- Nếu có nhiều đường, hiển thị một đường ngắn nhất theo thứ tự ID ổn định và nhãn “Một đường phụ thuộc đã biết”; không tự liệt kê mọi đường có thể gây bùng nổ số lượng.

### 6.3. Số lượng và tính đầy đủ

- Count root bị loại khỏi tổng liên quan. Node đóng vai trò cả hai phía được tính một lần trong tổng distinct; không cộng số hai phía để suy ra tổng.
- Count tính trên ID có kiểu đối tượng và tenant, không dùng riêng tên.
- Hoàn chỉnh trong phạm vi quyền + phạm vi quan hệ được yêu cầu → có thể ghi số chính xác.
- Partial/truncated → “Đã tìm thấy N đối tượng; kết quả chưa đầy đủ”.
- Report chưa được thu thập → “Chưa có dữ liệu đầy đủ về quan hệ tới report”; không dùng “0 report bị ảnh hưởng”.
- Tổng downstream chỉ được gọi là toàn bộ khi depth=all, thu thập kết thúc thành công và coverage tương ứng đầy đủ trong phạm vi quyền.

## 7. Trạng thái, bằng chứng và nội dung hiển thị

### 7.1. Lần chạy gần nhất và dữ liệu hiện có

Hai bản ghi riêng: `latestAttempt` mô tả lần chạy gần nhất; `lastSuccessfulBuild` mô tả lần thành công gần nhất. Không dùng chúng thay thế cho nhau.

| Trạng thái chuẩn hóa | Nhãn UI | Thời gian kèm theo |
|---|---|---|
| queued | Đang chờ | Thời điểm vào hàng đợi nếu có |
| running | Đang chạy | Thời điểm bắt đầu |
| success | Build thành công | Thời điểm kết thúc |
| failed | Build lỗi | Thời điểm kết thúc; mở được lỗi theo quyền |
| skipped | Đã bỏ qua | Thời điểm sự kiện nếu có; không coi là thành công |
| cancelled | Đã hủy | Thời điểm hủy nếu có |
| never | Chưa build | Chỉ dùng khi backend xác nhận chưa có lần chạy |
| unknown | Chưa rõ trạng thái | Không bịa thời gian |

Adapter chỉ map từ trạng thái thực tế có ý nghĩa tương ứng; mã không nhận diện → unknown và diagnostic nội bộ. Không ép mọi mã ngoài success thành failed.

UI hiển thị thời gian tương đối, hover/focus thấy timestamp tuyệt đối và timezone. Dùng timezone người dùng/ứng dụng hiện hành; không mặc định timezone từ tên tenant. Nếu thiếu thời gian kết thúc thì không lấy thời gian sửa SQL thay vào.

### 7.2. SQL đã lưu và SQL đã build

| Bằng chứng | Trạng thái |
|---|---|
| Chưa từng build thành công được xác nhận | Chưa có bản build thành công |
| Hash SQL đã lưu bằng hash SQL của lần build thành công gần nhất | SQL khớp bản đã build |
| Hai hash so sánh được và khác nhau | SQL đã thay đổi, chưa có bản build thành công tương ứng |
| Thiếu hash hoặc khác phiên bản thuật toán hash | Chưa xác định SQL có khớp bản đã build |

- Bằng chứng hash chỉ khẳng định về nội dung SQL đã lưu; không chứng minh nguồn dữ liệu, macro hay cấu hình khác không đổi.
- Hash có version; tạo cùng thuật toán trên cùng biểu diễn SQL. Lần build ghi hash của SQL thực sự được dùng.
- Một lần build thất bại không cập nhật `lastSuccessfulBuild`.
- Bản nháp chưa lưu là trạng thái riêng trong editor, không làm hồ sơ người khác hiển thị SQL đã lưu thay đổi.

### 7.3. Độ mới và kiểm tra chất lượng

Cấu hình test trong editor chỉ cho biết kiểm tra được yêu cầu, không phải kết quả đã chạy. Kết quả từ Nhật ký cần ánh xạ đúng model/run/test. Một run lịch gồm nhiều model không thay đổi phạm vi Build một model trong editor. Không suy độ mới từ tuổi của lần build. Chỉ hiện “Quá hạn cập nhật” khi có thời điểm dữ liệu và policy/ngưỡng xác định. Kết quả test cần tên/lần chạy/thời điểm; thiếu kiểm tra là “Chưa có kết quả kiểm tra”, không phải đạt.

### 7.4. Ngữ cảnh lineage

Luôn có câu ngắn về phạm vi bằng chứng: model/bảng thô đã khai báo; tài khoản nguồn/report chưa thu thập nếu đúng. Phân biệt upstream chưa khai báo với ref trỏ tới model không còn. Chi tiết ref/source/macro nằm trong phần mở rộng; không giấu toàn bộ giới hạn coverage trong tooltip. Thanh thông tin ghi **“Quan hệ theo SQL đã lưu”**, **“Quan hệ theo bản đã build”** hoặc **“Chưa xác định phiên bản quan hệ”**, theo dữ liệu trả về. Nếu có timestamp thu thập, cho xem timestamp đó.

Phiên bản SQL/metadata thay đổi trong khi đang xem: báo “Quan hệ đã thay đổi — Tải lại”. Không âm thầm ghép trang/nhánh từ hai snapshot mà vẫn công bố số chính xác.

## 8. Hợp đồng dữ liệu ở ranh giới UI

Đây là **schema logic mục tiêu**, không khẳng định các field/endpoint đã có trong repository. Ưu tiên adapter chuẩn hóa API hiện hữu; thêm backend khi bằng chứng không thể lấy chính xác từ nguồn hiện có. Không yêu cầu REST hay GraphQL mới.

### 8.1. Các bản ghi

| Bản ghi | Field và ý nghĩa |
|---|---|
| EntityRef | `tenantId`, `kind`, `id`; khóa duy nhất cho cache/count; `name` không phải ID |
| ModelSummary | `ref`, `name`, `displayName?` có provenance, `family?`, `description?`, `classification`, `originSources`, `latestAttempt`, `capabilities` |
| Classification | `role: input/transform/output/unclassified`, `businessDomainIds[]`, trạng thái assignment, provenance (metadata/config được rà soát), `revision`; không dùng prefix làm bằng chứng tự động |
| SourceRegistryEntry | ID có namespace theo originKind, tên hiển thị và platform nếu là nguồn nghiệp vụ; hai connection Xero có ID khác nhau, nhãn phải phân biệt được |
| OriginSources | `originKind: physical_raw/business_source`, registry theo kind và `sourceIds[]` gồm nguồn upstream đã xác nhận; `coverage: complete/partial/unknown/unsupported`, `snapshotId?`, `collectedAt?`, `basis`; tập rỗng không tự mang nghĩa không có nguồn |
| DiscoveryFacets | `filterRevision`, role counts không áp dụng layer, tổng tenant, tổng sau lọc và accuracy riêng; danh mục nghiệp vụ/nguồn theo quyền; coverage nguồn gốc |
| ModelDetail | ModelSummary + `semanticMetadata?` có nguồn/revision/trạng thái xác nhận, `technicalMetadata?` theo capability, `freshness?`, `qualityResults?` theo model/run, `grain?`, `savedSql?`, `savedSqlHash?`, `hashVersion?`, `lastSuccessfulBuild?`, schema/provenance nếu có |
| BuildAttempt | `status`, `runId?`, `queuedAt?`, `startedAt?`, `endedAt?`, lỗi an toàn để hiển thị nếu được phép |
| SuccessfulBuild | `runId`, `completedAt?`, `sqlHash?`, `hashVersion?`, relation đọc được nếu backend xác nhận |
| LineageNode | `ref`, `label`, metadata được phép, `resolvable`, capability mở chi tiết/refocus |
| LineageEdge | `from`, `to`, loại quan hệ phụ thuộc, bằng chứng/nguồn nếu có; hướng nguồn → nơi dùng |
| LineageSnapshot | `snapshotId` hoặc revision tương đương, root có EntityRef.kind, nodes/edges hoặc cursor, basis, `collectedAt?`, coverage, completeness, truncationReason? |
| Count | `value`, `accuracy: exact/lower_bound/unknown`, phạm vi áp dụng |
| PreviewResult | cột/kiểu, rows, giới hạn áp dụng, `truncated`, thời điểm đọc, phiên bản dữ liệu nếu biết |

Field optional phải có trạng thái lý do ở mức response/UI: thiếu metadata, chưa hỗ trợ, không có quyền hoặc chưa tải. Một giá trị null đơn độc không đủ để kết luận “không có”.

### 8.2. Coverage và completeness

- `coverage.modelDependencies` và `coverage.reportDependencies`: `complete`, `partial`, `unknown`, `unsupported`.
- Coverage mô tả chất lượng nguồn quan hệ; `completeness` mô tả việc tải hết phạm vi yêu cầu ở snapshot đó.
- Ví dụ: API tải xong tất cả edges đã biết nhưng chưa ingest report → completeness complete, report coverage unsupported. Không công bố “toàn bộ tác động” cho report.
- “Complete” luôn giới hạn trong tenant và quyền của người dùng. Không tiết lộ số đối tượng bị ẩn nếu policy không cho phép.
- Dữ liệu chưa biết nguồn/coverage mặc định unknown, không complete.

### 8.3. Các thao tác đọc

| Thao tác logic | Input tối thiểu | Output/yêu cầu |
|---|---|---|
| listModels | tenant, q, layer, domainId/sentinel, sourceId/sentinel, family, status, sort, page/cursor | items, pagination, DiscoveryFacets hoặc batch tương đương, count accuracy, khả năng tìm mô tả |
| getModel | tenant, model ID | detail, capabilities, provenance |
| readLineage | tenant, root, hướng/phạm vi nếu server hỗ trợ | snapshot nhất quán và coverage |
| readMoreLineage | snapshot, nhánh/cursor | cùng snapshot; nếu stale trả lỗi rõ và yêu cầu tải lại |
| readSchema | tenant, model ID | schema và nguồn phiên bản |
| previewModel | tenant, model ID, row limit không vượt max | readonly preview, timeout, quyền theo server |

Nếu API hiện tại trả toàn bộ graph hợp lệ, client có thể tính scope/impact bằng một bộ logic dùng chung. Nếu API chỉ trả một phần, không được tính tổng exact từ phần đó. Không bắt buộc thêm readMoreLineage khi đã tải graph đầy đủ.

### 8.4. Lỗi và request bất đồng bộ

- Nhóm lỗi chuẩn hóa: `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND_OR_INACCESSIBLE`, `TIMEOUT`, `UNAVAILABLE`, `INVALID_SCOPE`, `STALE_SNAPSHOT`.
- Client không phân biệt không tồn tại với không có quyền nếu server chủ ý che giấu sự tồn tại.
- Đổi tenant/root/query phải hủy hoặc loại response cũ bằng request identity.
- Cache key chứa tenant, identity/quyền liên quan, entity và query. Logout, đổi tài khoản hoặc mất quyền phải loại dữ liệu không còn được phép.
- Cache/query identity của danh sách và facets gồm q/layer/domain/source/fam/status/sort và revision classification/origin khi có; count không dùng dữ liệu khác revision với kết quả.
- Thử lại request đọc được phép; không tự retry build như tác dụng phụ của refresh UI.
- Layout chạy sau khi container có kích thước hợp lệ. Bỏ kết quả layout cũ nếu snapshot hoặc root đã đổi.
- Graph có error boundary cục bộ; lỗi graph không làm sập header, hồ sơ hoặc bảng.

## 9. Quyền và an toàn thao tác

Không thêm hoặc nới vai trò trong bản thiết kế này. Ánh xạ capability từ quyền thực tế của hệ thống.

| Capability logic | Tác động UI | Kiểm tra phía server |
|---|---|---|
| readModel | Xem danh sách/hồ sơ | Tenant + quyền model |
| readSql | Hiện SQL/copy theo chính sách | Không gửi SQL nếu thiếu quyền |
| readLineage | Xem quan hệ | Lọc node/edge/metadata theo chính sách |
| previewData | Hiện nút preview | Quyền dữ liệu và relation cùng tenant |
| editModel/createModel | Hiện hành động sửa/tạo | Duy trì chính sách hiện hữu |
| buildModel | Editor cho phép build | Duy trì phạm vi build một model và quyền hiện hữu |

- Ẩn hành động không được cấp quyền; disable chỉ dùng cho điều kiện tạm thời như đang xử lý hoặc bản nháp chưa lưu, kèm lý do.
- Không đưa source/report không được phép vào tooltip, DOM, count hoặc log phía client.
- Không log nội dung preview, SQL hay dữ liệu nhạy cảm trong event UX. Thông tin chẩn đoán dùng mã lỗi và ID phù hợp chính sách hiện hành.

## 10. Layout, responsive và bàn phím

### 10.1. Kích thước mục tiêu

Tái sử dụng token của ứng dụng; giá trị dưới là kích thước mục tiêu khi chưa có token tương ứng.

| Thành phần | Quy định |
|---|---|
| Nhịp khoảng cách | Bội số 4 px; gap thông thường 8/12/16/24 |
| Nội dung desktop | Padding 24 px; màn hình hẹp 16 px |
| Hàng danh sách | Khoảng 56 px; tăng chiều cao nếu nội dung/font scale cần |
| Body | 14 px; tên/heading theo hierarchy hiện hữu, không giảm chữ để nhét graph |
| Node graph | Rộng mục tiêu 224 px, cao tự tăng; tên tối đa hai dòng, có xem đầy đủ |
| Panel desktop | Rộng 360 px khi vùng nội dung khả dụng ≥ 1.000 px |
| Graph viewport | Dùng phần chiều cao còn lại; tối thiểu 400 px nếu màn hình cho phép |

### 10.2. Responsive

- Vùng nội dung dưới 1.000 px: panel chuyển overlay có nút đóng; không ép canvas còn một dải hẹp.
- Viewport dưới 768 px: bộ chọn vai trò xuống dòng, Chưa phân loại vẫn truy cập được; Bộ lọc mở dạng sheet có nút đóng. Ưu tiên tên và lần chạy, lớp vào dòng phụ; chip điều kiện active luôn thấy. Không nhét thêm cột nguồn/nghiệp vụ trên màn hình hẹp.
- Toolbar xuống dòng theo nhóm, không tạo cuộn ngang toàn trang. Preview table/graph có vùng cuộn riêng.
- Trên màn hình hẹp, giữ mode trong URL; không tự đổi graph thành bảng. Gợi ý “Xem dạng danh sách” nếu graph khó đọc.

### 10.3. Bàn phím và thông tin hỗ trợ

- Thứ tự focus theo thứ tự đọc. Mọi nút icon có accessible name; trạng thái có chữ.
- Link tên model là link thật, hỗ trợ mở tab mới.
- Modal panel có focus trap và trả focus khi đóng. Panel desktop không modal thì không trap focus.
- Escape đóng overlay/menu trước, rồi panel; không xóa model trung tâm.
- Có đường đi bàn phím tới nút chuyển Bảng quan hệ; không bắt buộc người dùng bàn phím duyệt mọi node graph mới đọc được quan hệ.
- Cập nhật kết quả tìm kiếm/count thông báo qua vùng live nhẹ; không đọc lại toàn bảng.
- Respect reduced motion; không dùng animation để báo trạng thái duy nhất.

## 11. Ma trận lỗi và microcopy

| Mã | Điều kiện | Thông báo | Phục hồi |
|---|---|---|---|
| UX-E01 | Không tải được model | Không tải được thông tin model | Thử lại / Về Models |
| UX-E02 | Model không mở được | Model không tồn tại hoặc bạn không có quyền truy cập | Về Models |
| UX-E03 | API quan hệ lỗi | Không tải được quan hệ của model | Thử lại; không giả bảng đầy đủ |
| UX-E04 | Layout lỗi, dữ liệu hợp lệ | Không hiển thị được sơ đồ. Bạn vẫn có thể xem bảng quan hệ | Xem bảng quan hệ / Thử lại sơ đồ |
| UX-E05 | Coverage partial | Quan hệ đã thu thập chưa đầy đủ | Xem phần đã biết và nguồn dữ liệu |
| UX-E06 | Preview timeout | Truy vấn dữ liệu mẫu vượt thời gian cho phép | Thử lại; không tự build |
| UX-E07 | Không có dữ liệu để preview | Model chưa có dữ liệu có thể đọc | Xem trạng thái build |
| UX-E08 | Snapshot đổi | Quan hệ đã thay đổi kể từ khi mở màn hình | Tải lại phạm vi |
| UX-E09 | Không có quan hệ, coverage complete | Không có quan hệ trong phạm vi đã chọn | Đổi hướng/độ sâu |
| UX-E10 | Không có edges nhưng coverage unknown | Chưa có đủ thông tin về quan hệ | Xem thông tin nguồn; không dùng UX-E09 |

Thông báo lỗi không hiển thị stack trace hoặc câu SQL có dữ liệu nhạy cảm. Chi tiết kỹ thuật nằm trong diagnostic theo quyền hiện hữu.

## 12. Tiêu chí nghiệm thu có thể kiểm tra

### 12.1. Fixture bắt buộc

- **F01 — Cơ bản:** `S → A → B → R`, root A; S là source, A/B là model, R là report; coverage đầy đủ.
- **F02 — Hình thoi:** `A → B → D`, `A → C → D`, `D → R`; root A.
- **F03 — Cycle:** `A → B → C → A`; fixture kiểm tra phòng thủ, không khẳng định dữ liệu production có cycle.
- **F04 — Fan-out:** A có 50 downstream trực tiếp; tất cả ID khác nhau.
- **F05 — Quy mô:** ít nhất 205 model và 2 bảng thô cộng các source/report cần cho luồng thực tế.
- **F06 — Thiếu bằng chứng:** model edges có, report coverage unsupported; thêm trường hợp toàn bộ coverage unknown.
- **F07 — Trạng thái:** thành công trước, lần gần nhất lỗi, SQL hash đổi; thêm never/unknown/đang chạy.
- **F08 — Quyền và bất đồng bộ:** đối tượng không được phép, đổi tenant, response cũ về muộn, snapshot đổi.
- **F09 — Phân lớp:** 6 model A–F. A=input/Tài chính/Xero/failed; B=transform/[Tài chính,Bán hàng]/[Xero,HubSpot]; C=output/Tài chính/Xero; D=output/Bán hàng/HubSpot; E=unclassified/chưa gán nghiệp vụ/nguồn unknown; F=output/Tài chính/tập nguồn rỗng đã xác nhận complete. B–F build success. Các nguồn đã biết của A–D có coverage complete.
- **F10 — Nguồn chưa đầy đủ:** biến thể F09 trong đó B chỉ xác nhận Xero và coverage partial; không kết luận B không dùng HubSpot. Bổ sung nguồn đi qua hai model trung gian và ID bộ lọc không còn resolve được.

### 12.2. Acceptance cases

| ID | Given / When | Then |
|---|---|---|
| AC-01 | Mở Models không có query | Vào M01, sort tên tăng dần, không tự render graph |
| AC-02 | Tìm tên tồn tại ngoài trang 1 | Vẫn tìm được; kết quả không chỉ lọc trang hiện tại |
| AC-03 | Đổi query nhanh, response cũ về sau | Chỉ kết quả query hiện tại được hiển thị |
| AC-04 | Đang lọc lớp/nghiệp vụ/nguồn/q/fam, chọn Trạng thái → Build lỗi | Chỉ thay status=failed; Tất cả trạng thái chỉ xóa status, không bỏ các điều kiện khác |
| AC-05 | Mở hồ sơ từ trang có filter rồi Back | Khôi phục filter, trang và vị trí cuộn |
| AC-06 | Mở link cũ lineage chỉ có fam | M04 hiển thị picker đã lọc, không tự chọn root |
| AC-07 | F01, root A, both/depth=1 | Phạm vi liên quan là S và B; R chưa nằm trong phạm vi |
| AC-08 | F01, chọn Mở tiếp nhánh ở B hướng down | R được thêm vào cả graph scope và bảng; nhãn phạm vi thể hiện nhánh bổ sung |
| AC-09 | F01, click B | Panel B mở; root vẫn A; camera/zoom không tự thay đổi |
| AC-10 | F01, lấy B làm trung tâm | Root B; both/depth=1; history mới; Back khôi phục root A và scope trước |
| AC-11 | F04, mở graph mặc định | Graph thu gọn đúng giới hạn; bảng có 50 downstream; số lượng không lấy từ node đang vẽ |
| AC-12 | F04, Hiện thêm N | Phạm vi/count không đổi; chỉ số node được vẽ tăng |
| AC-13 | F02, down/depth=all | B,C,D,R mỗi đối tượng một hàng; tổng=4; D không bị đếm hai lần |
| AC-14 | F03, both/depth=all | Duyệt kết thúc; root bị loại khỏi count; B/C có vai trò cả hai; tổng distinct=2 |
| AC-15 | Mở đường tới D trong F02 | Hiện một đường có edges hợp lệ và nhãn một đường đã biết |
| AC-16 | Đổi graph/table | Root, hướng và scope giữ nguyên; quay lại graph giữ camera |
| AC-17 | Mở root từ danh sách đã lọc lớp/nghiệp vụ/nguồn/family; một dependency không khớp các điều kiện đó | Dependency vẫn có trong graph/bảng quan hệ nếu thuộc scope; bộ lọc danh sách không cắt đường duyệt |
| AC-18 | F06, không có report edges | Hiện coverage chưa hỗ trợ, không nói không có report bị ảnh hưởng |
| AC-19 | Graph layout ném lỗi nhưng edges hợp lệ | Header vẫn dùng được; chuyển bảng thành công |
| AC-20 | API lineage lỗi trước khi có dữ liệu | Hiện lỗi tải; không hiển thị bảng rỗng như một kết quả thành công |
| AC-21 | F07, latestAttempt=failed, còn bản build cũ | Hiện build lỗi; nếu preview được thì ghi dữ liệu từ bản thành công trước |
| AC-22 | Không có hash so sánh hoặc hash version khác | SQL sync=unknown; không suy từ timestamp |
| AC-23 | Nhấn Xem dữ liệu mẫu khi được cấp quyền | Chỉ có request đọc có giới hạn; không phát build |
| AC-24 | Thiếu preview/edit/build capability | Không có hành động khả dụng giả; server từ chối request trái quyền |
| AC-25 | F08, đổi tenant khi request cũ đang chạy | Không có dữ liệu/camera/selection của tenant cũ rò sang tenant mới |
| AC-26 | F08, snapshot đổi khi mở nhánh | Yêu cầu tải lại; không ghép edges rồi công bố tổng exact |
| AC-27 | Mở URL model không truy cập được | Trạng thái không mở được; không chọn model khác thay thế |
| AC-28 | Điều khiển bằng bàn phím | Tìm, lọc, mở hồ sơ, chuyển bảng, mở/đóng panel và quay lại được |
| AC-29 | Viewport hẹp và chữ phóng to | Không mất nút chính hoặc dữ liệu do chiều cao cố định; panel có thể đóng |
| AC-30 | Editor có draft chưa lưu | Giữ cơ chế bảo vệ hiện tại; hồ sơ không trình bày draft như SQL đã lưu |
| AC-31 | F09, chưa lọc | Tổng 6; vai trò input=1, transform=1, output=3, unclassified=1; tổng các vai trò bằng Tất cả lớp |
| AC-32 | F09, output + Tài chính + Xero | Chỉ C xuất hiện; E không được tự suy lớp và F không bị gán Xero |
| AC-33 | F09, domain=Tài chính và source=Xero rồi chọn output | Count vai trò vẫn là input=1, transform=1, output=1, unclassified=0, Tất cả lớp=3; bảng chỉ C, không lấy count từ trang hiện tại |
| AC-34 | F09, layer=transform rồi lần lượt chọn Xero, HubSpot | Cả hai lần đều thấy B đúng một hàng; không cộng trùng model nhiều nguồn |
| AC-35 | F09, layer=transform rồi lần lượt chọn Tài chính, Bán hàng | Cả hai lần đều thấy B đúng một hàng; assignment nghiệp vụ nhiều giá trị được giữ |
| AC-36 | F09, chọn Chưa phân loại theo vai trò | E vẫn tìm và mở được; Tất cả lớp không loại E |
| AC-37 | F09/F10, source=unknown | E khớp; B khớp thêm trong F10; F không khớp vì tập nguồn rỗng đã được xác nhận complete |
| AC-38 | F10, nguồn đi qua hai model trung gian; lọc nguồn đó | Model đích vẫn khớp nhờ nguồn upstream nhiều cấp; không chỉ kiểm tra input trực tiếp |
| AC-39 | Đang có nhiều bộ lọc rồi chọn Tất cả lớp / Xóa bộ lọc | Tất cả lớp chỉ bỏ layer; Xóa bộ lọc bỏ q/layer/domain/source/fam/status, giữ sort và về trang đầu |
| AC-40 | Mở deep link có layer/domain/source, vào hồ sơ rồi Back | Khôi phục đúng phạm vi, count, trang và scroll; không biến nguồn thành family |
| AC-41 | Đổi lớp/nguồn nhanh; facets cũ về muộn hoặc count chưa biết | Không trộn revision cũ/mới; chưa biết hiện “—”, không giả 0/exact |
| AC-42 | ID bộ lọc không còn resolve hoặc tổ hợp bộ lọc có 0 kết quả | Hiện thông báo tương ứng và cách bỏ lọc; không âm thầm nới điều kiện hoặc tự chọn model khác |
| AC-43 | Mở List/Lineage/hồ sơ | Chỉ hai tab cấp cao; hồ sơ dùng chung; không có dashboard hoặc hồ sơ riêng cho graph |
| AC-44 | Từ List bấm tên / Sửa SQL theo quyền | Tên mở hồ sơ đọc; Sửa SQL đi trực tiếp editor một thao tác; không phát build/preview tự động |
| AC-45 | Có alias đã xác nhận / không có alias | Tên kỹ thuật vẫn hiện và tìm được; không tự dịch hoặc nhân hai dòng giống nhau |
| AC-46 | Filter nguồn/lần chạy/family nằm trong Bộ lọc và đang active | Chip bên ngoài luôn thấy; xóa chip cập nhật URL/count; thu popup không bỏ filter |
| AC-47 | Phân lớp/nghiệp vụ chưa hỗ trợ | List tối thiểu dùng được; không tạo metadata giả; phân biệt unsupported với assignment unclassified |
| AC-48 | Link production build=ok/failed/never/other | Adapter giữ đúng tập kết quả legacy; other không bị ép thành failed; status chuẩn nếu có ưu tiên rõ |
| AC-49 | Link cũ root + scope=related | Phục hồi both/all đã biết, không âm thầm giới hạn một bước; vẫn xử lý partial/fallback |
| AC-50 | Link model=raw.records | Mở root bảng thô cùng scope/count; không hiển thị editor/build của model; không nhầm tài khoản nguồn |
| AC-51 | Hai model đều đọc raw.records, chưa có mapping ingestion | Không tự gán cả hai cùng Xero hoặc HubSpot; nguồn nghiệp vụ chưa xác định |
| AC-52 | Run có 716 tests, editor model có các test cấu hình | Không hiển thị model đạt 716/716; chỉ nhận kết quả ánh xạ đúng model/run, thiếu thì link Nhật ký |
| AC-53 | Comment SQL có grain nhưng chưa rà soát | Gắn nhãn nguồn/chưa xác nhận nếu hiển thị; không tự công bố metadata đã duyệt |
| AC-54 | Root có 16 trực tiếp, 103 downstream nhiều bước | Nhãn từng count nói rõ phạm vi; panel không trải 103 tên; thao tác toàn bộ tác động mở down/all/table |
| AC-55 | Chọn node có 27 cột | Panel vẫn gọn, cột/SQL mở hồ sơ tương ứng; không render mọi cột hoặc editor trong graph |
| AC-56 | Từ graph mở hồ sơ rồi Quay lại dòng dữ liệu | Giữ root/selection/scope/camera; bộ lọc List không cắt dependency |
| AC-57 | Layout lỗi, dữ liệu root hợp lệ | Bảng quan hệ theo root truy cập được, không bắt đọc danh sách toàn tenant; lỗi fetch không giả bảng đầy đủ |
| AC-58 | Có ref qua macro hoặc tên chk_* | Không tự bỏ cạnh/control model hoặc gán kiểm thử đạt từ tên; hiện bằng chứng được cung cấp |
| AC-59 | Kiểm tra List, Lineage, hồ sơ và menu hành động | Không có nút AI/chat AI/Nhờ AI sửa hoặc luồng chuyển ngữ cảnh sang AI; không xóa hoặc thay đổi trợ lý chung hiện có |

### 12.3. Mục tiêu phản hồi và đo kiểm

Các con số sau là mục tiêu triển khai, chưa phải kết quả đo ứng dụng:

- Click node mở panel có dữ liệu đã tải: mục tiêu p95 dưới 100 ms, không gọi layout toàn graph.
- Với fixture F05 đã tải dữ liệu, tính scope và render phạm vi ban đầu: mục tiêu p95 dưới 1 giây trên máy nghiệm thu được ghi cấu hình.
- Trong lúc fetch/layout dài, trạng thái loading phải hiện; không khóa điều hướng hoặc nút chuyển bảng.
- Preview phải kết thúc thành công hoặc trả timeout theo giới hạn công bố; không treo spinner vô hạn.
- Báo cáo tách network, xử lý graph và render; không dùng một số tổng để che nguyên nhân chậm.

Nếu chưa đạt, ghi lại fixture, máy, số lần đo và nguyên nhân; hiệu chỉnh trước phát hành hoặc ghi giới hạn được chấp nhận rõ ràng.

### 12.4. Nghiệm thu mức dễ hiểu

Thử định tính với cả người không chuyên và kỹ sư theo Plan §9. Đo tìm đúng model, hiểu grain, phân biệt build/freshness/quality, phân biệt trực tiếp/toàn chuỗi, thoát graph lỗi và vào editor nhanh. Mục tiêu và cỡ nhóm thử chưa phải kết quả đã đo; ghi câu trả lời sai/mức trợ giúp cùng thời gian, không chỉ kiểm tra click được.

## 13. Đầu ra bàn giao và ranh giới triển khai

### 13.1. Thiết kế

- M01: bộ chọn vai trò; nghiệp vụ ở hàng chính khi hỗ trợ, nguồn/trạng thái/Family trong Bộ lọc; trường hợp chưa phân loại, nhiều nguồn, nguồn chưa đầy đủ, tổ hợp không kết quả, count chưa biết và lỗi.
- M02: metadata đủ/thiếu, latest build lỗi, dữ liệu từ bản cũ, preview không có quyền.
- M03: root với một cấp, panel mở, fan-out thu gọn, nhánh mở rộng, bảng tác động, lỗi graph.
- M04: chưa chọn model/bảng thô; bản desktop và màn hình hẹp của luồng chính.
- Dùng cùng token/component, không thiết kế riêng một hệ màu cho từng màn hình.

### 13.2. Engineering

- Adapter dữ liệu và capability được ghi rõ; không giả định schema mục tiêu đã tồn tại.
- Classification/nguồn gốc có bằng chứng, loại nguồn vật lý/nghiệp vụ và revision; dùng metadata có sẵn hoặc config được rà soát. Không tự áp metadata giả lập của prototype lên production, không thêm hệ quản trị taxonomy đầy đủ trong v1.
- Một module tính scope/count/path dùng chung graph và table; renderer không quyết định count nghiệp vụ.
- Tách state root/selection/scope/camera; chuẩn hóa query tại một nơi.
- Kiểm thử logic quan hệ và các luồng AC quan trọng; chạy checks bắt buộc của repository.
- Chứng minh giữ nguyên quyền, link editor, bảo vệ draft và phạm vi build.

### 13.3. Các xác minh trước khi viết code

| Cần xác minh | Quyết định mặc định nếu chưa hỗ trợ |
|---|---|
| Branch/checkpoint thực tế của production và prototype | Chỉ áp dụng lên checkout đã xác định; không trộn hai bản |
| Route/param và ID model hiện có | Adapter tương thích; giữ link cũ |
| Nguồn family và vai trò | Family giữ nguyên; vai trò lấy assignment xác nhận hoặc unclassified; không tự map prefix sang Bronze/Silver/Gold |
| Danh mục và gán nghiệp vụ | Dùng metadata/config đã rà soát; chưa có thì Chưa phân loại, không suy từ tên |
| Nguồn gốc nhiều cấp/nhiều nguồn | Tính từ snapshot/chỉ mục lineage có coverage; thiếu bằng chứng thì unknown/partial; không chỉ gán nguồn trực tiếp |
| Độ đầy đủ của quan hệ/report | Coverage unknown/unsupported và copy tương ứng |
| Quyền đọc SQL/preview | Giữ chính sách hiện hữu; không suy quyền từ việc thấy model |
| API preview độc lập | Hiển thị chưa hỗ trợ hoặc bổ sung theo hợp đồng mục 4/8 trước khi bật |
| Hash SQL của build thành công | SQL sync unknown tới khi có bằng chứng so sánh |
| Layout engine và nguyên nhân lỗi | Tái sử dụng trước, sửa dựa trên chẩn đoán |

Các mục này là xác minh kỹ thuật theo plan, không phải yêu cầu người dùng tự chọn chi tiết triển khai. Tính năng thiếu bằng chứng phải dùng fallback đã quy định; thay đổi ảnh hưởng quyền, ý nghĩa dữ liệu hoặc phạm vi sản phẩm phải được ghi thành quyết định rõ ràng trước khi phát hành.

## 14. Hợp đồng hiệu năng và phục hồi — bổ sung v1.3

### 14.1. Phân biệt dữ liệu, phạm vi và hình vẽ

- `graphRevision` nhận diện snapshot quan hệ; trạng thái build đổi không tự làm đổi layout nếu topology/geometry không đổi.
- Scope được xác định trước layout: root, hướng, độ sâu, các nhánh được mở; node/edge ẩn có số lượng và đường truy cập rõ ràng. Phân lớp vai trò không thay thế scope hoặc giới hạn fan-out.
- Index đầy đủ có thể ở client nếu phép đo payload cho phép; không bắt buộc server pagination chỉ vì vượt 200 model. DOM/render và công việc layout vẫn phải giới hạn độc lập.
- Bảng và sơ đồ cùng snapshot/scope. Bảng có phân trang hoặc virtualization với điều hướng bàn phím; không dựng một bản danh sách toàn tenant ẩn bên cạnh canvas.
- Với URL legacy all/related, giữ semantic scope; nếu vượt ngân sách vẽ, dùng bảng cùng scope và ghi rõ cần thu phạm vi để vẽ. Không giả vờ đã hiển thị toàn bộ cạnh.

### 14.2. Vòng đời layout

- Worker thật cho tác vụ nặng; việc dùng async/Promise không đủ. Không khởi động layout ở List, chế độ Bảng hoặc viewport không dùng graph.
- Job có request ID, graph revision, scope/options key. Đổi scope loại kết quả cũ; hủy tác vụ đang chạy bằng cơ chế ngắt worker khi cần, không chỉ ngừng chờ Promise.
- Không tạo hàng đợi vô hạn khi người dùng đổi root nhanh. Cache có giới hạn dung lượng/số entry; nội dung và scope quyết định cache, không chỉ object identity.
- Highlight/selection không thay scope thì không chạy lại layout; mở nhánh cố giữ vị trí/ngữ cảnh trước đó nếu khả thi, không dùng fit-all gây nhảy liên tục.
- Các trạng thái độc lập: đang lấy dữ liệu, đang bố trí sơ đồ, sẵn sàng, lỗi layout, quá thời gian. Khi layout lỗi/quá hạn, dữ liệu hợp lệ vẫn mở được ở Bảng cùng scope; lỗi API không giả fallback đầy đủ.
- Ghi timing parse/index/layout/render và loại lỗi an toàn; tránh log SQL, tên khách hàng và dữ liệu hàng.

### 14.3. Ngưỡng kiểm tra đề xuất

Các ngưỡng sau là mục tiêu thiết kế chưa nghiệm thu. Trước triển khai chốt máy tham chiếu, browser, viewport, network profile và bộ graph; báo cold/warm riêng. Không dùng một lần replay Node làm p95 browser.

- Phản hồi thao tác thông thường ≤200 ms; đo trong browser qua nhiều lượt, mục tiêu p95 của kịch bản kiểm tra.
- Sơ đồ scope ban đầu sẵn sàng ≤1 giây sau khi metadata đã có, trên bộ scope chuẩn đã chốt.
- Không có long task main thread >50 ms do layout; đo riêng chuyển dữ liệu/index/render vì Worker không tự giải quyết những phần này.
- Job layout quá 3 giây chuyển trạng thái quá hạn, ngắt được công việc và cho dùng Bảng; UI không bị khóa trong thời gian chờ.
- Tải trang/API end-to-end có ngân sách riêng sau đo baseline; không trộn với thời gian layout hoặc hứa đạt 1 giây cho toàn bộ cold load.

### 14.4. Acceptance criteria bổ sung

| ID | Tình huống | Kết quả bắt buộc |
|---|---|---|
| AC-60 | Layout engine gặp lỗi stack hoặc exception | Hiện lỗi layout riêng, log an toàn có nguyên nhân, Bảng cùng scope vẫn dùng được; không spinner vô hạn |
| AC-61 | Graph nhiều cạnh và layout chạy lâu | Tìm kiếm/đổi tab vẫn responsive; layout chạy Worker thật, timeout hủy được tác vụ |
| AC-62 | Đổi root A → B → C nhanh | Chỉ kết quả C được nhận; không backlog vô hạn; không ghi layout A lên scope C |
| AC-63 | Mở List/Bảng hoặc mobile không có canvas | Không khởi động ELK, không âm thầm mount graph ẩn để tính toàn bộ |
| AC-64 | Cùng scope chỉ chọn node khác | Highlight/detail đổi mà không tính lại layout; cache invalidation đúng khi topology thay đổi |
| AC-65 | Root có rất nhiều hàng xóm trực tiếp | Có cách chọn nhóm/nhánh và số còn ẩn; không tự xổ toàn bộ hoặc âm thầm bỏ cạnh |
| AC-66 | Legacy scope=related hoặc toàn bộ tác động có phạm vi lớn | Giữ đúng tập quan hệ và count; Bảng hữu dụng, graph thông báo phạm vi vẽ; không giả một bước là toàn bộ |
| AC-67 | Nghiệm thu với 250–1.000 model tổng hợp | Đo cold/warm, nhánh rộng/merge/chuỗi dài, lỗi/timeout/đổi root; lưu browser và API timings riêng, không dùng demo 8 model để kết luận đạt |

Các AC này bổ sung AC-01–59. Regression fixture công khai phải tổng hợp mới; không commit topology hoặc SQL trích từ tenant thật.
