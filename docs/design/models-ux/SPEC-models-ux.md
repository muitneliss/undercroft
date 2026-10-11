# Đặc tả thi công Models

**Baseline:** 2.0 · 11/10/2026. **Loại tài liệu:** hợp đồng sản phẩm hiện hành.

Tài liệu này mô tả một trạng thái đích duy nhất. Mọi yêu cầu bên dưới có hiệu lực đồng thời; không cần đọc lịch sử hội thoại, phiên bản cũ hoặc audit để suy ra thiết kế cuối. Các con số trong ví dụ là fixture, không phải dữ liệu production.

- **Hành vi và nghiệm thu:** SPEC này; toàn bộ AC-01–118 ở §12.2.
- **Thứ tự thực hiện:** [PLAN-models-ux.md](./PLAN-models-ux.md).
- **Lệnh giao thi công:** [PROMPT-implement-models-ux.md](./PROMPT-implement-models-ux.md).
- **Tiến độ và bằng chứng:** [IMPLEMENTATION-STATUS-models-ux.md](./IMPLEMENTATION-STATUS-models-ux.md); không đánh dấu hoàn thành ngay trong yêu cầu.
- **Bàn giao source để review:** [README.md](./README.md); đọc/chạy nguyên bản, đối chiếu hành vi và ghi rõ mọi phần cần tái triển khai.

Bắt buộc là hành vi phải thực hiện trong phạm vi được giao. Có điều kiện là chỉ bật khi có capability/nguồn/quyền tương ứng; khi thiếu phải dùng fallback quy định. Ngoài phạm vi là không tự xây thêm. Schema logic là hợp đồng đích, không phải khẳng định field/endpoint đã tồn tại. Tham chiếu code trong tài liệu phải được đối chiếu với checkout thực trước khi sửa; audit là bằng chứng lịch sử, không có quyền thay đổi yêu cầu.

## 1. Mục tiêu và phạm vi

### 1.1. Quyết định sản phẩm

Models là không gian làm việc theo luồng **tìm model → hiểu model → xem quan hệ → kiểm tra tác động**.

- **Danh sách** là tab mặc định để tìm model và kiểm tra sơ bộ; **Dòng dữ liệu** là tab quan hệ. Chỉ có hai tab cấp cao.
- **Chọn phạm vi** ngay trên danh sách: Đầu vào / Biến đổi / Đầu ra, kết hợp nghiệp vụ, nguồn và trạng thái. Không yêu cầu biết tên model trước.
- **Hồ sơ** là trang đọc dùng chung của model, thuộc khu vực Danh sách; không phải tab cấp cao thứ ba. Nếu mở từ Lineage có đường trở về đúng graph trước đó.
- **Quan hệ** nằm trong tab Dòng dữ liệu, tập trung quanh một model hoặc bảng thô được hỗ trợ; sơ đồ/bảng là hai cách xem cùng phạm vi.
- **Editor** giữ hành vi sửa SQL, bản nháp và build hiện hữu. Có Sửa SQL trực tiếp từ hàng hoặc hồ sơ theo quyền. Nhật ký vẫn là nơi đọc run/log đầy đủ; không xây bản sao trong Models.

Không đặt danh sách, ma trận family × source, graph và hồ sơ đầy đủ cạnh nhau. Panel trong graph chỉ là bản xem nhanh của hồ sơ.

**Ràng buộc:** không có nút AI, chat AI, hành động “Nhờ AI sửa/kiểm tra” hoặc luồng chuyển ngữ cảnh sang AI trong List, Lineage và hồ sơ. Trợ lý chung hiện có của ứng dụng nằm ngoài phạm vi thay đổi; MCP/CLI của agent ngoài giữ nguyên.

### 1.2. Phạm vi triển khai

| Bắt buộc | Có khi nguồn dữ liệu hỗ trợ | Ngoài phạm vi |
|---|---|---|
| Tìm model, lọc lần chạy, hồ sơ tối thiểu và fallback metadata thiếu | Phân lớp/nghiệp vụ/nguồn có bằng chứng, tên dễ hiểu và grain | Hệ thống quản trị domain/data product đầy đủ |
| Hồ sơ với dữ liệu hiện có | Preview dữ liệu độc lập | Lineage mức cột |
| Lineage tập trung và mở nhánh | So SQL đã lưu với SQL đã build | Điểm health tổng hợp |
| Bảng quan hệ/tác động | Thống kê report phụ thuộc | Tự suy luận mô tả nghiệp vụ |
| URL, Back/Forward, quyền và lỗi | Kiểm tra chất lượng/độ mới | Saved views chia sẻ, ghim đồng bộ |

Prototype local dùng fixture tổng hợp và thực hiện P0–P5 trong PLAN; fixture không được trình bày như dữ liệu thật. Tích hợp dữ liệu thật chia ba đợt A/B/C; đợt A không bị chặn bởi taxonomy/preview/freshness. Tính năng có điều kiện phải dùng trạng thái chưa hỗ trợ khi thiếu capability. Không tạo dữ liệu giả trong bản tích hợp để lấp khoảng trống. Khi bật tính năng phải đáp ứng đầy đủ hợp đồng và AC của tính năng đó.

### 1.3. Thuật ngữ

| Thuật ngữ | Nghĩa trong spec |
|---|---|
| Đối tượng trung tâm (root) | Model hoặc bảng hồ thô được hỗ trợ, xác định phạm vi quan hệ; chữ model trong các hợp đồng duyệt cũ được hiểu là root khi áp dụng cho bảng thô |
| Node đang xem | Đối tượng đang mở trong panel; có thể khác model trung tâm |
| Upstream / Phía trước | Đối tượng cung cấp dữ liệu trực tiếp hoặc gián tiếp cho trung tâm; khác lớp vai trò Đầu vào |
| Downstream / Phía sau (nơi sử dụng) | Đối tượng dùng dữ liệu trực tiếp hoặc gián tiếp từ trung tâm; có thể thuộc bất kỳ lớp vai trò nào |
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

Các tham số dưới đây là hợp đồng URL mục tiêu; adapter phải giữ tương thích các route/alias hiện hữu sau khi đối chiếu repository. Không tự đổi tên tham số theo từng component.

Base: `/tenants/:tenantId/models`

| Trường | Giá trị | Mặc định / hành vi |
|---|---|---|
| `view` | `list`, `detail`, `lineage` | `list` |
| `model` | ID model/root có adapter tương thích tên cũ, gồm raw.records | Thiếu trong detail/lineage → M04; detail chỉ dành cho model |
| `tab` | `overview`, `data`, `sql`, `operations` | `overview`; chỉ dùng trong detail; nhãn tương ứng Hiểu dữ liệu, Dữ liệu, SQL & cấu hình, Vận hành |
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
| List | Tìm kiếm, lớp, cột nhóm theo lớp, tên thân thiện/kỹ thuật; chỉ dấu lỗi/chờ/chạy hoặc trạng thái phục vụ lọc/sort | Run ID, số cột, SQL sửa lúc, nguồn đầy đủ, chất lượng chi tiết; không có cột lần chạy thường trực |
| Hồ sơ | Mục đích/grain, tình trạng tách biệt, dữ liệu, SQL | Cấu hình cập nhật, version, kỹ thuật nâng cao theo khả năng |
| Lineage | Đường đi, phạm vi, trực tiếp/gián tiếp, bằng chứng và ảnh hưởng | Schema/SQL dài chuyển về cùng hồ sơ; log chuyển Nhật ký |

Mọi nơi dùng cùng EntityRef và adapter metadata/status. Không tạo hồ sơ độc lập trong graph. Không thêm tab AI, Impact, SQL hoặc Operations ngang cấp List/Lineage. Tên tab tiếng Việt giữ Danh sách / Dòng dữ liệu như production; tiếng Anh List / Lineage. Ngôn ngữ đời thường đi trước, thuật ngữ kỹ thuật vẫn có trong phần giải thích.

### 2.4. Giữ nguyên thanh menu và header

Shell hiện hữu là chuẩn hình thức và chuyển động cần bảo toàn. Ảnh tĩnh chỉ tham chiếu hình thức; hành vi chuyển động lấy từ component/CSS và được kiểm tra trực tiếp. Không chép tenant, tên người dùng hoặc email thật vào fixture, tài liệu hoặc ảnh baseline công khai.

**SHELL-01 — Ranh giới thay đổi.** Giữ `Book` và `TabRail`; nội dung mới là children của `main.leaf__page`. Không dựng shell/header thứ hai, không dùng header rút gọn của minh họa làm thiết kế thay thế. Không đổi cấu trúc, chiều cao, khoảng cách, đường kẻ, nền, font, logo, vùng định danh tenant và cụm tài khoản/VI–EN/trợ lý/đăng xuất. Chỉ tối ưu heading/toolbar/bảng/hồ sơ/graph bên trong nội dung Models. Không đổi `.leaf`, `.runhead`, `.rail`, token gốc hoặc breakpoint của shell để lấy thêm diện tích.

**SHELL-02 — Thanh bảy phân khu.** Giữ thứ tự Customers → Sources → Journal → Raw Lake → Models → Reports → People, kích thước tương đối, màu, lettering, trạng thái disabled và route hiện tại. Màu theo `DIVISIONS`, không tạo bảng màu mới trong Models. Ở checkout audit: Customers `#b24b1a`, Sources `#eda600`, Journal `#3e782b`, Raw Lake `#0f7673`, Models `#634cb0`, Reports `#7f4023`, People `#234c9e`; đây là giá trị đối chiếu, không phải yêu cầu copy/hardcode thêm. Tab active vẫn do phân khu hiện tại quyết định: vào Models thì Models nổi và có dấu chọn, không cố định Raw Lake theo ảnh. Hai tab Danh sách/Dòng dữ liệu là điều hướng bên trong Models, không thay thanh bảy phân khu.

**SHELL-03 — Hiệu ứng hiện có.** Giữ chuyển động nâng/hạ tab khi hover/active, dấu chọn dạng lỗ tròn `punch-through`, hiệu ứng `leaf-turn`, thứ tự lớp và phép tính màu nền `applyBoard`. Giữ token chuyển động (`--hinge`, `--turn`) và nhịp bước hiện tại, không thêm fade/smooth transition riêng hoặc tắt hiệu ứng để che layout chậm. Key của leaf vẫn theo tenant/phân khu: đổi List/Lineage, hồ sơ, filter, nhóm, panel không làm lật lại toàn trang. Tôn trọng nhánh reduced-motion hiện có; giữ hiệu ứng không có nghĩa ép chuyển động khi người dùng đã giảm chuyển động.

**SHELL-04 — Responsive và hành vi chung.** Giữ breakpoint shell hiện hữu: ở checkout audit, rail chuyển xuống chân trang và cuộn ngang dưới/ngang 760 px; không ép bản desktop trong ảnh lên điện thoại. Các breakpoint 768/1.000 px tại §10 chỉ áp dụng nội dung Models. Giữ liên kết logo/tenant/tài khoản, đổi VI–EN, trợ lý chung, sign-out, skip link và thứ tự focus. Nút trợ lý hiện có trong header vẫn được giữ; không thêm nút AI trong các vùng Models mới. Nội dung tenant/tài khoản động vẫn cập nhật, không đóng băng theo ảnh.

**SHELL-05 — Cách tích hợp.** Tái sử dụng [Book.tsx](../../../apps/ui/src/components/Book.tsx), [TabRail.tsx](../../../apps/ui/src/components/TabRail.tsx), [divisions.ts](../../../apps/ui/src/lib/divisions.ts), [index.css](../../../apps/ui/src/index.css) và formatter/i18n hiện có. CSS mới giới hạn theo root/component Models; không override `header`, `nav`, `button`, `table`, `:root` hoặc token chung ở phạm vi toàn app. Dùng Zustand cho lựa chọn UI, tRPC cache cho server state theo quy tắc repository; không sao chép state độc lập của minh họa vào ứng dụng.

**SHELL-06 — Bằng chứng nghiệm thu.** Trước sửa, chụp baseline shell bằng tenant/tài khoản tổng hợp ở cùng viewport, locale, route và trạng thái; sau sửa so với baseline, không dùng ảnh chứa dữ liệu thật làm fixture tracked. Kiểm tra tĩnh và tương tác riêng: screenshot không chứng minh motion đúng. Đối chiếu hover/active, chuyển phân khu/tenant, ở lại trong Models, VI/EN, reduced motion và mobile; thử thêm một phân khu ngoài Models để phát hiện CSS rò. Nếu checkout triển khai khác checkout audit, xác minh shell thật trước, không tự phục dựng hoặc đổi shell theo các con số ví dụ ở đây.

## 3. M01 — Danh sách Models

### 3.1. Bố cục

```text
Mô hình dữ liệu · N                              [Tạo model]
[Danh sách] [Dòng dữ liệu]
[Tìm tên hoặc mô tả — theo khả năng thực tế…                ]
[Tất cả lớp] [Đầu vào] [Biến đổi] [Đầu ra] [Chưa phân lớp]
[Bộ lọc (N): Nghiệp vụ / Nguồn / Lần chạy / Family] [Sắp xếp]
Điều kiện đang bật · N kết quả                   [Xóa bộ lọc]
Nhóm theo lớp | Model / tên kỹ thuật / mô tả ngắn | Xem luồng / ⋯
…
                             1–25 trên N     [Trước] [Sau]
```

Số liệu trong wireframe là minh họa bố cục, không phải dữ liệu cố định.

### 3.2. Các thành phần

| ID | Thành phần | Quy tắc |
|---|---|---|
| LIST-01 | Tiêu đề và tổng số | Tổng tenant theo quyền ở tiêu đề. Dưới bộ lọc chỉ ghi 1–25 trong N model; không lặp N kết quả và cùng tổng ngay cạnh nhau |
| LIST-02 | Tạo model | Hiện khi có quyền; đi vào luồng tạo hiện hữu |
| LIST-03 | Tìm kiếm | Chuỗi đã trim, không phân biệt hoa/thường, tìm chuỗi con trong tên kỹ thuật và alias được hỗ trợ; thêm mô tả nếu được hỗ trợ |
| LIST-04 | Bộ lọc | Nghiệp vụ/Nguồn/Lần chạy/Family trong Bộ lọc (N) theo capability; AND giữa các chiều. Điều kiện active luôn thành chip ngoài popup |
| LIST-05 | Chọn lớp | Tất cả lớp / Đầu vào / Biến đổi / Đầu ra; có lựa chọn Chưa phân lớp. Chọn lớp không xóa các bộ lọc khác |
| LIST-06 | Tên model | Link tới M02. displayName đã xác nhận là dòng chính, tên kỹ thuật dòng phụ luôn đọc được; thiếu alias dùng tên kỹ thuật, không lặp hai tên giống nhau. Mô tả ngắn khi có |
| LIST-07 | Phạm vi | Cột nhóm theo lớp tại mục 3.6; không lặp vai trò trên mọi hàng khi đã chọn lớp. Tất cả nhóm theo vai trò, Chưa phân lớp không đoán vai trò từ prefix |
| LIST-08 | Build gần nhất | Mặc định không có cột riêng; lỗi/đang chạy/đang chờ thể hiện ngắn cạnh model, bấm mở Vận hành. Khi lọc trạng thái hoặc sort theo lần chạy, hiện trạng thái + thời điểm có nhãn đúng nghĩa trên hàng; chi tiết theo mục 7 và GRP-07 |
| LIST-09 | Lối tắt hàng | Xem dòng dữ liệu hiện rõ trên hàng; Xem SQL, Sửa SQL, Mở lần chạy trong menu theo quyền/khả năng. Sửa SQL đi trực tiếp editor; không thêm Build nhanh |
| LIST-10 | Dòng phạm vi | Hiện vai trò, nghiệp vụ, nguồn và mọi điều kiện đang bật, kể cả Family trong Bộ lọc thêm; count là kết quả giao các điều kiện |
| LIST-11 | Xóa bộ lọc | Xóa q/layer/domain/source/fam/status, về trang đầu; giữ sort. Tất cả lớp chỉ bỏ layer; Tất cả trạng thái chỉ bỏ status |

Bỏ dãy năm thẻ thống kê và phép cộng. Tổng tenant + số kết quả đủ cho mặc định; bộ lọc lần chạy giữ đầy đủ trạng thái. Không thay bằng năm thẻ KPI khác. Tạo model mở luồng hiện hữu từ nút, không đặt form thường trực cuối danh sách.

Metadata chưa hỗ trợ không ngăn List hoạt động: có ghi chú phân loại chưa có, control không khả dụng không làm người dùng tưởng đang lọc được. Vai trò thiếu gọi Chưa phân lớp; nghiệp vụ thiếu gọi Chưa phân loại. Control có điều kiện active từ URL không được âm thầm ẩn hoặc bỏ điều kiện.

Trong nhóm, tên mặc định sắp tăng dần; tên bằng nhau dùng ID làm khóa phụ. `build_desc` dùng thời điểm bắt đầu lần chạy gần nhất; model chưa có lần chạy nằm cuối nhóm. Thứ tự nhóm và phân trang theo mục 3.6. Mỗi trang mặc định 25 model; sử dụng cursor nếu backend hiện hữu dùng cursor. Phân trang trình bày không bắt buộc đổi API nếu metadata đầy đủ còn nhẹ; tìm/lọc/count luôn trên toàn tập được phép đọc.

### 3.3. Phân loại, bộ lọc và số lượng

**DISC-01 — Vai trò:** mỗi model có đúng một vai trò đã xác nhận hoặc chưa phân loại.

| Mã | Nhãn chính | Diễn đạt phụ | Cơ sở |
|---|---|---|---|
| input | Đầu vào | Chuẩn hóa từng nguồn | Metadata/config được rà soát |
| transform | Biến đổi | Ghép và tính toán | Metadata/config được rà soát |
| output | Đầu ra | Phục vụ báo cáo, phân tích hoặc ứng dụng | Metadata/config được rà soát |
| unclassified | Chưa phân lớp | Chưa xác định vai trò | Chưa có gán lớp đáng tin cậy |

- `stg/int/mart` chỉ là ví dụ quy ước của bản minh họa. Prefix có thể giúp đề xuất mapping khi rà soát, không tự trở thành phân loại chính thức.
- Không phân lớp bằng graph rank: một input có thể nằm ở downstream của model khác. Vai trò và quan hệ là hai khái niệm riêng.
- Không tự gán Bronze/Silver/Gold. Medallion không thuộc bộ chọn v1; có thể thêm diễn đạt phụ khi mapping được xác nhận, không thay nhãn vai trò chính. Không biến source/raw thành model để điền ô Bronze.
- Chưa phân lớp là lựa chọn nhỏ cạnh nhóm lớp; hiện khi có kết quả, đang được chọn hoặc chưa biết count. Count bằng 0 có thể ẩn nếu không đang chọn. Không bỏ model chưa phân lớp khỏi Tất cả lớp.

**DISC-02 — Nghiệp vụ:** dùng danh mục ID/nhãn và assignment có bằng chứng; một model có thể thuộc nhiều nghiệp vụ. Chọn một nghiệp vụ khớp model có chứa ID đó, không tạo bản sao hàng. Chưa có assignment xác nhận → nhóm Chưa phân loại. Lỗi tải metadata tạm thời là lỗi tải, không tự chuyển thành chưa phân loại.

**DISC-03 — Nguồn dữ liệu:** lọc theo nguồn gốc upstream ở mọi cấp trong snapshot có bằng chứng, không chỉ nguồn trực tiếp. Phân biệt nguồn nghiệp vụ/tài khoản ingestion với bảng thô vật lý. Production hiện có raw.records/raw.documents; cạnh tới raw.records không chứng minh Xero hay HubSpot. Nguồn nghiệp vụ cần mapping ingestion/macro đã rà soát; nếu chỉ hỗ trợ quan hệ vật lý, nhãn là Bảng thô và không hiển thị danh mục Xero/HubSpot giả. Một filter source dùng một loại danh mục công bố rõ theo capability, không trộn ID bảng thô với ID tài khoản nguồn. Ví dụ model dùng Xero và HubSpot sẽ khớp khi chọn từng nguồn; chỉ hiển thị một lần trong kết quả. Không suy nguồn từ tên model.

- Phân biệt nguồn chưa xác định đầy đủ với tập nguồn đã xác nhận rỗng. Tập rỗng + coverage complete → “Không có nguồn upstream được ghi nhận”.
- Coverage partial/unknown/unsupported → “Chưa xác định đầy đủ”; vẫn hiện các nguồn đã biết. Bộ lọc nguồn `unknown` bao gồm các model này, kể cả đã biết một phần nguồn.
- Khi lọc Xero trên coverage partial, chỉ liệt kê những model đã xác nhận dùng Xero và báo “Kết quả nguồn gốc có thể chưa đầy đủ”. Không xem không khớp là bằng chứng không liên quan.

**DISC-04 — Tổ hợp:** mỗi control chọn một giá trị hoặc tất cả; các control kết hợp AND. Metadata nguồn/nghiệp vụ dạng nhiều giá trị dùng phép contains cho giá trị được chọn. Không bắt người dùng chọn theo thứ tự; có thể bắt đầu từ nghiệp vụ hoặc nguồn. Giữ các lựa chọn dù tổ hợp cho 0 kết quả, kèm Xóa bộ lọc; không tự bỏ lọc.

**DISC-05 — Count:**

- Tổng cạnh tiêu đề = số model duy nhất trong tenant theo quyền, độc lập với bộ lọc.
- Count trên từng nút vai trò = tập model khớp q/domain/source/fam/status, **chưa áp dụng layer**, rồi chia theo vai trò. Tất cả lớp bao gồm Chưa phân lớp.
- Count dòng phạm vi = kết quả sau toàn bộ điều kiện, trước phân trang; không đếm theo số hàng trang hiện tại.
- Khi count đầy đủ, tổng các vai trò bao gồm Chưa phân lớp bằng Tất cả lớp. Không cộng count các nguồn/nghiệp vụ vì một model có thể thuộc nhiều nhóm.
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

### 3.6. Nhóm bên trong từng lớp

**GRP-01 — Ba cột, phân cấp hai tầng.** Bộ chọn phía trên xác định lớp; cột bên trái trả lời nhóm nào trong lớp đó. Cột giữa giữ tên dễ hiểu/tên kỹ thuật và một câu mô tả để chọn đúng model; cột cuối giữ Xem luồng và menu kỹ thuật. Dòng mô tả là tóm tắt nhận diện, không sao chép toàn bộ Hiểu dữ liệu. Không tạo nhiều cột thẻ ngang theo mỗi nguồn hoặc thêm tầng nhóm thứ ba mặc định.

| Lớp đang chọn | Cột nhóm | Ví dụ giả lập | Cột còn lại |
|---|---|---|---|
| Tất cả | Lớp dữ liệu | Đầu vào / Biến đổi / Đầu ra / Chưa phân lớp | Model / Khám phá |
| Đầu vào | Nguồn dữ liệu | Xero · Kế toán / HubSpot · CRM | Model / Khám phá |
| Biến đổi | Nghiệp vụ | Công nợ / Bán hàng / Kho | Model / Khám phá |
| Đầu ra | Chủ đề phân tích | Doanh thu / Công nợ / Tồn kho | Model / Khám phá |
| Chưa phân lớp | Nhóm kỹ thuật khi có | Family được hệ thống cung cấp, ví dụ staging_custom | Model / Khám phá; thiếu family dùng nhóm Chưa có nhóm kỹ thuật |

**GRP-02 — Nguồn có bằng chứng.** Đầu vào dùng nguồn nghiệp vụ/tài khoản đã xác nhận của DISC-03, phân biệt các connection cùng nền tảng bằng nhãn đủ rõ. Biến đổi và Đầu ra dùng danh mục/assignment nghiệp vụ đã khai báo của DISC-02; Chủ đề phân tích là nhãn trình bày trong lớp Đầu ra, không tự tạo một taxonomy khác từ SQL. Các ví dụ trên chỉ áp dụng nếu có assignment tương ứng. Nếu capability nguồn/nghiệp vụ chưa có, công bố ngắn ở đầu bảng và giữ danh sách dùng được; chỉ nhóm theo Family khi metadata kỹ thuật thực có, đổi tiêu đề thành Nhóm kỹ thuật. Không âm thầm coi prefix là nguồn hoặc tự chia Bronze/Silver/Gold.

**GRP-03 — Mỗi model chỉ xuất hiện một lần.** Nhóm hiển thị là phân hoạch để đọc bảng, khác facet lọc nhiều giá trị. Một nguồn/nghiệp vụ đã xác nhận → nhóm tương ứng. Nhiều nguồn/nghiệp vụ → nhóm Nhiều nguồn / Liên nghiệp vụ / Nhiều chủ đề tương ứng; hiện tối đa 2 nhãn liên quan rồi +N có thể mở đầy đủ. Không tự lấy nguồn đầu tiên hoặc nhân bản hàng ở nhiều nhóm. Coverage nguồn partial/unknown → nhóm Chưa xác định đầy đủ, có thể hiện các nguồn đã biết ở dòng phụ. Tập nguồn complete rỗng có nhóm riêng Không có nguồn được ghi nhận. Metadata chưa gán → Chưa phân loại; lỗi tải tạm thời vẫn là lỗi, không đổi assignment. Khi lọc một nguồn/nghiệp vụ, model nhiều assignment vẫn khớp contains theo DISC-04 và giữ nhãn nhiều nhóm để không làm sai nghĩa.

Thứ tự phân nhóm nguồn là: lỗi tải → trạng thái lỗi riêng; capability unsupported → fallback GRP-02; partial/unknown → Chưa xác định đầy đủ, dù đã biết một hay nhiều nguồn; chỉ khi complete mới chia 0/1/nhiều nguồn. Nếu capability nguồn chỉ là physical_raw, cột phải ghi Bảng thô theo DISC-03, không gắn nhãn tài khoản nguồn. Trong một bảng dùng một chế độ nhóm thống nhất; không trộn một số hàng nhóm business source với các hàng khác nhóm Family. Nguồn partial nhưng đã xác nhận Xero vẫn khớp filter Xero và nằm đúng một lần ở nhóm Chưa xác định đầy đủ.

**GRP-04 — Giảm lặp mà không mất định hướng.** Tên nhóm, số model và nút thu/mở hiện một lần ở đầu mỗi nhóm trong trang. Các hàng tiếp theo có ô nhóm trống về thị giác, nhưng vẫn gắn nhãn nhóm cho screen reader; không dùng ký hiệu mũi tên như một dependency. Nhóm tiếp sang trang sau lặp nhãn kèm tiếp theo. Mobile đưa tên nhóm thành hàng tiêu đề, thông tin model và hành động xuống dòng, không ép bảng rộng hoặc giấu nhóm. Tất cả đã có nhóm vai trò nên không lặp badge vai trò; các lớp riêng không lặp Đầu vào/Biến đổi/Đầu ra ở mọi hàng.

**GRP-05 — Phân trang, thu/mở và số lượng.** Lọc toàn tập trước, chia nhóm, sắp nhóm ổn định rồi sắp model trong nhóm và phân trang 25 model. Tất cả theo thứ tự vai trò của bộ chọn; nhóm cụ thể theo tên/ID, nhóm nhiều/chưa xác định đặt sau các nhóm đơn. Sort UI ghi Sắp xếp trong nhóm; URL sort cũ vẫn giữ ý nghĩa khóa sắp xếp đó trong từng nhóm, không âm thầm trộn timestamp khác nghĩa. Count nhóm tính toàn kết quả lọc, distinct, trước phân trang; nếu bị chia trang ghi ví dụ Xero · 38 model, 15 trên trang này. Thu nhóm chỉ ẩn các hàng thuộc trang hiện tại, không fetch/render cả nhóm, không thay tổng/trang hoặc lấp chỗ bằng model trang khác; công bố số hàng đang thu. Tổng nhóm hiển thị cộng được vì GRP-03 là phân hoạch; tổng facet nguồn/nghiệp vụ nhiều giá trị vẫn không được cộng theo DISC-05.

Tổng **tất cả nhóm của kết quả lọc**, gồm cả nhóm ở trang khác, bằng tổng distinct nếu count exact; không cộng riêng các nhóm đang thấy rồi gán thành tổng tenant. Key nhóm dùng ID có namespace/kind hoặc sentinel ổn định, không dùng nhãn dịch. Đổi locale có thể đổi thứ tự tên nhưng không đổi assignment; về trang đầu nếu thứ tự thay đổi. Với phân trang server, server/adapter phải nhóm và sort trước khi cắt trang, trả count nhóm theo cùng revision. Không lấy 25 hàng bất kỳ rồi nhóm client và tuyên bố đó là phân nhóm toàn dataset. Nếu index đầy đủ còn nhẹ, dùng client grouping theo cùng hợp đồng; không bắt buộc endpoint mới.

**GRP-06 — Không bắt mở hàng loạt.** Tìm/lọc đưa về trang đầu; nhóm có kết quả trong truy vấn mới mặc định mở để người dùng thấy hàng khớp, không tưởng kết quả biến mất. Khi còn nhóm thu có nút Mở các nhóm trên trang; không đồng nghĩa tải/vẽ toàn tenant. Đổi trang không tự mở nhóm ngoài trang. Quay lại từ hồ sơ giữ lớp, query, trang, sort và trạng thái thu nhóm của ngữ cảnh trước; đổi tenant xóa trạng thái đó. Gõ tìm kiếm không tạo lịch sử cho từng ký tự.

Trạng thái thu nhóm gắn tenant/identity/query/sort/revision/page/groupKey, không lây từ trang này sang trang chưa xem. Nút thu/mở có aria-expanded và tên nhóm; các hàng liên kết ngữ nghĩa tới nhãn nhóm. Sau thu/mở giữ focus trên nút nhóm; nếu hàng đang focus bị ẩn, đưa về nút nhóm thay vì đầu trang. Nhóm không có kết quả không xuất hiện; tổng chưa exact không dùng số trang hoặc count nhóm giả. Đổi query/sort reset trang và mở nhóm, Back khôi phục ngữ cảnh cũ còn hợp lệ.

**GRP-07 — Trạng thái phục vụ điều tra, không thành cột lặp.** Mặc định chỉ nhấn lỗi/đang chạy/đang chờ cạnh tên; thành công hoặc chưa có kết quả không tạo nhãn lặp trên mọi hàng. Không có nhãn không có nghĩa dữ liệu đã được xác nhận tốt. Bộ lọc trạng thái giữ đầy đủ các trạng thái hiện có. Khi filter trạng thái đang bật, mỗi hàng có nhãn và thời điểm đúng phạm vi ở dòng phụ, kể cả never/unknown; bấm mở Vận hành. Mở lần chạy trong menu vẫn đi Nhật ký như trước. Thời gian không có thì không suy từ SQL updatedAt. Số cột, row count, duration, freshness/test chi tiết nằm trong hồ sơ; không đưa thêm cột chỉ để lấp chỗ.

Khi `sort=build_desc`, hiện thêm thời điểm **Bắt đầu lần chạy** cạnh trạng thái vì đó là khóa sort, kể cả khi không bật filter trạng thái. Khi filter trạng thái cần thời điểm kết thúc theo §7, dùng nhãn riêng nếu đồng thời hiển thị hai mốc; không gọi startedAt là kết thúc. Không có khóa sort thì xếp cuối với nhãn Chưa có thời điểm bắt đầu, tên/ID làm khóa phụ. Đổi lại sort tên và bỏ filter trạng thái sẽ trở về hàng gọn.

**GRP-08 — Chi phí và khả năng tương thích.** Nhóm dùng metadata/index nhẹ chung, không phát N truy vấn lineage/detail cho N model. Snapshot/count/group key nhất quán theo tenant/quyền/revision; response cũ không ghi đè query mới. Group UI không thay vai trò đã khai báo, không gán lại metadata và không cắt dependency khi mở Lineage. Đây là đọc/lọc, chưa thêm thao tác gán lớp hoặc sửa taxonomy. State thu nhóm là session/history, không quảng cáo lưu được trong link chia sẻ v1.

## 4. M02 — Hồ sơ model

### 4.1. Phần đầu trang

Breadcrumb Models → tên model; tên thân thiện nếu đã xác nhận, tên kỹ thuật luôn hiện; mục đích, lớp và lần chạy gần nhất. Family/nghiệp vụ/nguồn ở Tổng quan, dùng cùng provenance với List. Hành động: **Xem dòng dữ liệu**, **Sửa SQL** theo quyền; đường **Xem SQL** đọc vẫn có. Nếu đến từ Lineage có Quay lại dòng dữ liệu khôi phục đúng root/scope/camera; hồ sơ không thành tab cấp cao thứ ba.

**Điểm vào và phân cấp:** tên model trong List là link có gạch chân/focus rõ mở Hiểu dữ liệu; Xem luồng vẫn là hành động riêng. Node trong Lineage mở panel ngắn, trong đó có nút Hiểu dữ liệu mở cùng hồ sơ; không nhét bốn tab vào panel graph. Click trạng thái lần chạy trong List có thể mở thẳng Vận hành, còn Mở lần chạy vẫn đi Nhật ký. Không dùng thanh bốn bước như wizard và không thêm tab Hiểu dữ liệu cạnh hai tab cấp cao khi chưa có model cụ thể.

```text
[Danh sách] [Dòng dữ liệu]
← Quay lại danh sách đã lọc / Quay lại dòng dữ liệu

Đối chiếu công nợ · int_invoice_balance
Biến đổi · Lần chạy: thành công       [Xem luồng] [Sửa SQL]

[Hiểu dữ liệu] [Dữ liệu] [SQL & cấu hình] [Vận hành]
```

Nhãn Hiểu dữ liệu dùng URL `tab=overview`. Các mục thuộc một model, dùng chung header và EntityRef; tên/mục đích không lặp nguyên khối trên mọi tab. Mở tên mặc định overview; các lối tắt có đích tab rõ, Back phục hồi tab và vị trí trước đó. Mobile dùng hàng tab xuống dòng theo thứ tự đọc, không giấu Vận hành trong menu chỉ có icon. Vận hành là phần đọc theo model, không tạo hệ Nhật ký hay dashboard vận hành thứ hai.

“Xem SQL” chọn mục SQL chỉ đọc; “Sửa SQL” đi thẳng editor theo quyền từ hàng/hồ sơ/panel. Không bắt kỹ sư đi qua mục SQL chỉ đọc trước khi vào editor, không dùng một nhãn cho hai hành vi.

### 4.2. Hiểu dữ liệu — Tổng quan

Thứ tự các khối:

1. **Mục đích:** mô tả hoặc “Chưa có mô tả”.
2. **Mỗi dòng đại diện cho:** metadata grain hoặc “Chưa được mô tả”. Không suy ra từ khóa chính hoặc tên model.
3. **Tình trạng:** lần chạy gần nhất; dữ liệu hiện có từ lần thành công nào nếu biết; SQL thay đổi nếu so được.
4. **Quan hệ trực tiếp:** đầu vào và nơi sử dụng đã xác nhận. Mỗi phía tối đa 5 tên rồi “Xem quan hệ”; đếm chỉ khi có đủ bằng chứng. Trong khối Nơi sử dụng có nút phụ “Xem tác động” đi tới bảng downstream theo mục 6.1.

Sau grain có đơn vị/tiền tệ/múi giờ và quy tắc nghiệp vụ nếu có bằng chứng. Ba nhãn Lần chạy / Độ mới / Kiểm tra dữ liệu độc lập, không dùng badge Healthy tổng hợp. Không hỗ trợ thì ghi ngắn Chưa có thông tin trong khối tình trạng, không nhân thành nhiều thẻ rỗng.

Ngôn ngữ trả lời bốn câu: Dùng để làm gì? Mỗi dòng là gì? Dùng thế nào cho đúng? Cần lưu ý gì? Ví dụ hoàn toàn giả lập: một dòng là một hóa đơn, có thể cộng số còn phải thu theo cùng tiền tệ; không cộng tổng tiền hóa đơn sau khi join nhiều khoản thanh toán nếu làm lặp hóa đơn. Ví dụ chỉ được xuất bản cho model khi có nguồn định nghĩa đã xác nhận, không tự suy quy tắc từ SQL. Người phụ trách nghiệp vụ và tài liệu liên quan hiện khi có; updatedBy không được dùng thay owner.

Tình trạng là một khối ngắn gồm lần chạy, độ mới và kiểm tra riêng rẽ; nhấn từng dòng mở Vận hành đúng phần. Khối quan hệ chỉ tóm tắt trực tiếp và dẫn tới Lineage. Trên desktop ưu tiên nội dung giải thích ở vùng rộng, tóm tắt tình trạng/quan hệ ở vùng phụ; màn hẹp xếp thành một cột. Không thêm dãy nhiều KPI phía trên nội dung khiến người dùng phải cuộn mới biết model dùng để làm gì.

Run ID, thời lượng, timestamp, lịch sử và tóm tắt lỗi nằm ở mục con Vận hành theo 4.6; Mở lần chạy dẫn tới Nhật ký hiện hữu. Tóm tắt theo model phải gắn đúng model ID và run, không lấy tổng kiểm thử của run làm kết quả model. Nếu chưa ánh xạ được thì chỉ link Nhật ký và nói chưa có kết quả riêng model.

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

### 4.4. SQL & cấu hình

- Hiển thị SQL đã lưu, chỉ đọc, có copy nếu chính sách hiện tại cho phép xem SQL.
- Ghi rõ đây là SQL đã lưu, không phải bản nháp hoặc bằng chứng dữ liệu đã được build từ chính phiên bản đó.
- Sửa SQL và Build tiếp tục thuộc editor hiện hữu. Rời editor vẫn bảo vệ thay đổi chưa lưu.
- Có thể tái sử dụng `models.check` để hiện lỗi/cảnh báo và phần chưa xác minh trước khi chạy. Đây là kiểm tra tĩnh, không phải chứng nhận compile thành công, đúng nghiệp vụ hoặc tests đạt.
- Chưa bổ sung thao tác sửa mô tả/grain nếu backend không có luồng lưu và quyền tương ứng.
- Cấu hình kỹ thuật trình bày thành danh sách nhãn–giá trị cạnh/dưới SQL: relation đích, môi trường/target, materialization, cách cập nhật, unique_key, incremental_strategy, on_schema_change, partition/index/cluster và contract theo adapter/capability. Chỉ hiện các trường áp dụng; table/view không có cấu hình incremental thì không dựng thẻ trống. Ephemeral không bị báo lỗi vì không có bảng vật lý để preview.
- Phân biệt cấu hình đang lưu với cấu hình đã resolve ở lần chạy được chọn. Cho kỹ sư copy ID/relation, mở file/path khi ứng dụng hỗ trợ. Compiled SQL chỉ hiện khi đã thu thập đúng model/run và có quyền; không coi SQL đã lưu hoặc models.check là SQL đã compile. Không thêm form chỉnh cấu hình tại đây; sửa qua editor/luồng hiện hữu.

### 4.5. Metadata chuyên sâu

- Comment SQL có thể cung cấp ứng viên mô tả/grain/quy tắc kèm file/phiên bản nguồn. Chưa rà soát thì ghi Trích từ comment SQL, chưa xác nhận; không tự coi thành ngữ nghĩa chuẩn hoặc bằng chứng dữ liệu đúng.
- SQL & cấu hình sở hữu cấu hình kỹ thuật; Hiểu dữ liệu chỉ giải thích tác động nghiệp vụ của watermark, xử lý xóa/đến muộn, lưu lịch sử khi có định nghĩa. Không thêm tab con cho từng trường và không sao chép toàn bộ cấu hình ở cả hai nơi.
- Hiệu năng/chi phí/owner/quyền dẫn về nguồn quản trị hoặc đo hiện có; số đo có thời điểm và phạm vi. Không đặt dashboard chi phí, quyền hoặc feature store mới vào phạm vi này.
- Metadata có cấu trúc và provenance dùng chung giữa các màn hình theo quyền. Không thêm UI, endpoint hoặc connector phục vụ chuyển ngữ cảnh sang AI trong phạm vi thiết kế này.

### 4.6. Vận hành — lần chạy, kiểm tra và hiệu năng của model

**Ưu tiên đọc:** lần thử gần nhất và lỗi cần xử lý → bản thành công gần nhất nếu biết → thời lượng → kiểm tra dữ liệu/độ mới → lịch sử. Lần thử lỗi và bản dữ liệu thành công cũ được đặt cạnh nhau để không tạo hiểu nhầm dữ liệu biến mất. Metadata ít thì dùng bảng nhãn–giá trị gọn; không lấp chỗ trống bằng KPI 0 hoặc biểu đồ giả.

| Thông tin engineer cần | Nơi chính | Hợp đồng hiển thị |
|---|---|---|
| Kết quả chạy, bắt đầu/kết thúc, lỗi, run ID | Vận hành | Đúng model/attempt; link Nhật ký vào run/step khi hỗ trợ. Timestamp cấp run phải ghi rõ, không đổi nhãn thành kết thúc model |
| Thời lượng model | Vận hành | Dùng executionMs hoặc node timing có ánh xạ đáng tin; compile/execute tách khi nguồn có. Không dùng tổng thời lượng pipeline cho model |
| Lịch sử và thay đổi thời lượng | Vận hành | Tối đa 10 attempt gần nhất ban đầu, bảng có thời gian/kết quả/thời lượng/mode/run link và Tải thêm theo capability. Biểu đồ nhỏ chỉ khi có lịch sử so sánh được, luôn có bảng tương đương |
| Chất lượng: pass/warn/fail/error/skipped/chưa chạy | Vận hành | Kết quả riêng test/model/run; ghi thời điểm kiểm tra. Test nhiều model có thể xuất hiện ở mỗi model liên quan, nhưng không suy model nào gây lỗi |
| Độ mới | Vận hành; tóm tắt ở Hiểu dữ liệu | Cột/thời điểm dữ liệu được đo, checkedAt, ngưỡng và múi giờ; nguồn freshness khác model freshness, lần build mới không chứng minh dữ liệu mới |
| Số cột, tên/kiểu/khóa/mô tả | Dữ liệu | Schema có nguồn/phiên bản; khai báo khóa, thực thi constraint và test unique là ba bằng chứng khác nhau |
| Số dòng, dung lượng | Dữ liệu | Số đo có thời điểm, đơn vị, exact/estimate và relation; không tự COUNT toàn bảng lúc mở hồ sơ; view/ephemeral hoặc adapter không hỗ trợ có trạng thái không áp dụng |
| Tỷ lệ null/trùng, min/max, phân bố | Dữ liệu, mở theo nhu cầu | Chỉ từ profiling đã được cấp quyền/thu thập; ghi toàn tập hay mẫu, cỡ mẫu và thời gian. Không suy tỷ lệ từ preview 50 dòng |
| Bảng/view/incremental, khóa cập nhật, schema change | SQL & cấu hình | Config đã resolve có nguồn/run; không suy từ tên hoặc loại ingestion. Config unique_key không chứng minh tính duy nhất |
| SQL hiện lưu, SQL đã chạy, macro/config/version | SQL & cấu hình | Tách các phiên bản; compiled SQL chỉ khi có artifact tương ứng. Hash SQL không đại diện toàn bộ môi trường/config/macro |
| Upstream/downstream, tác động thay đổi | Dòng dữ liệu; tóm tắt tại Hiểu dữ liệu | Cùng module scope/count; không chạy graph để điền KPI trong hồ sơ |
| Lịch chạy, lần chạy kế tiếp, owner | Vận hành/Hiểu dữ liệu theo loại | Chỉ từ orchestration/metadata được khai báo; không suy lịch từ khoảng cách hai run hay owner từ người sửa cuối |
| Chi phí, bytes scanned, query ID | Chi tiết lần chạy trong Vận hành khi hỗ trợ | Có adapter/source, môi trường và phạm vi; không đổi execution time thành tiền hoặc chia tổng chi phí run cho từng model |

**MET-01 — Bằng chứng từng chỉ số:** giá trị phải kèm đơn vị, thời điểm quan sát, nguồn, EntityRef/relation, environment, run/attempt khi áp dụng và chất lượng exact/estimate/partial. Missing/unsupported/not_applicable/not_authorized/not_loaded là trạng thái riêng; UI có thể gộp lời giải thích ngắn nhưng không biến thành 0. Không tiết lộ metadata không được cấp quyền.

**MET-02 — Kết quả chạy không phải kết quả kiểm tra:** test đã cấu hình nhưng chưa có result hiện Chưa có kết quả; pass 8, fail 1, chưa chạy 3 phải hiển thị đủ các nhóm, không tuyên bố 8/9 là toàn bộ kiểm thử. Nếu không biết tập test dự kiến thì chỉ đếm các result đã biết và công bố coverage. Không biến warning/error/skipped thành pass hoặc failure nghiệp vụ. Test lỗi không lan nhãn lỗi sang model downstream.

**MET-03 — So sánh có cùng điều kiện:** biểu đồ thời lượng ghi môi trường, khoảng thời gian, N mẫu và đơn vị; phân biệt incremental/full-refresh, retry và cấu hình ảnh hưởng. Không nối attempt lỗi như một lần chạy thành công nhanh hơn. Khi ít mẫu hoặc khác điều kiện thì dùng bảng số đo, không tự gắn nhãn chậm bất thường. Tỷ lệ thành công nếu bổ sung sau phải có tử/mẫu và window; v1 không cần điểm health, p95 hay score tổng hợp.

**MET-04 — Ngữ nghĩa row count:** rows_affected là số hàng tác động của statement theo adapter, không phải tổng hàng relation; sentinel không xác định như -1 hiện Chưa xác định. Số hàng kết quả preview, số hàng tác động và tổng hàng đã đo có ba nhãn khác nhau. Freshness của một nguồn không tự chuyển thành freshness model đầu ra.

**MET-05 — Tải theo nhu cầu:** mở hồ sơ chỉ tải metadata nhẹ và tóm tắt có sẵn; chọn Dữ liệu mới tải schema/stats đã lưu, Vận hành mới tải lịch sử/chi tiết test. Preview/profiling/refresh số đo tốn query phải có hành động rõ, quyền và timeout; không tự build/test/compile/profiling chỉ vì đổi tab. Hủy/loại response khi đổi model; một phần lỗi không chặn các mục khác. Cache theo tenant/quyền/model/revision/môi trường và run khi cần, không gọi N request detail từ List.

### 4.7. Khả năng dữ liệu và nguồn triển khai

Đối chiếu theo checkout đã audit trong FEASIBILITY, không mặc định production hiện tại đã có schema mới:

| Nhóm | Dùng ngay từ nền có sẵn | Cần nối/bổ sung trước khi bật |
|---|---|---|
| Hồ sơ đọc | models.get, SQL lưu, lastBuild, cấu hình test, link runs.get | Mục đích/grain/owner nghiệp vụ/alias có nguồn duy trì; không hồi sinh form context bắt điền theo ADR 0112 |
| Dữ liệu | bi.schema cho tên/kiểu theo quyền | Nullable/constraint/mô tả; row count/size/profiling; preview độc lập theo model ID |
| Vận hành | RunStepShape có executionMs và kết quả bước để dẫn Nhật ký | Ánh xạ chắc chắn model–step–test–attempt, lịch sử theo model, lastSuccessfulBuild, freshness policy/result |
| SQL & cấu hình | SQL lưu, models.check, lối tắt editor | Config resolve/compiled SQL, artifact theo invocation, hash và environment được nối đúng |

Nguồn tham chiếu kỹ thuật (kiểm tra 11/10/2026): [dbt run results](https://docs.getdbt.com/reference/artifacts/run-results-json) cung cấp trạng thái/timing theo node đã chạy và adapter response; [dbt manifest](https://docs.getdbt.com/reference/artifacts/manifest-json) cung cấp resource/config/dependency; [dbt catalog](https://docs.getdbt.com/reference/artifacts/catalog-json) cung cấp metadata relation/cột và stats phụ thuộc database. Đây là nguồn có thể tích hợp, không phải cam kết Undercroft đã ingest chúng. Dùng parser theo dbt_schema_version/dbt_version thực tế, không áp field từ phiên bản mới vào artifact cũ; không cần nâng dbt chỉ để làm UI.

Nếu tích hợp artifacts, phải nối tenant/project/environment/invocation + unique_id, kiểm tra phiên bản và quyền; unique_id không phải khóa toàn cục giữa tenant/run. Model không có trong run_results của một invocation chỉ có nghĩa chưa có result ở invocation đó, không suy Chưa từng chạy. Chỉ công bố chỉ số khi adapter xác định được ý nghĩa và phạm vi.

## 5. M03/M04 — Quan hệ tập trung

### 5.1. Bố cục

```text
Mô hình dữ liệu
[Danh sách] [Dòng dữ liệu]
<Trung tâm · Đổi model> [Sơ đồ | Bảng] [Xem toàn bộ tác động]
Hai phía · Trực tiếp · Đang hiện N/M liên quan [Đổi phạm vi]
Theo khai báo SQL · Chưa có quan hệ tới báo cáo

┌────────────────────────────────────┬─────────────────────┐
│                                    │ Node đang xem       │
│ Đầu vào | Biến đổi | Đầu ra         │ Loại / trạng thái   │
│                                    │ Xem chi tiết         │
│                                    │ Lấy làm trung tâm*  │
│ [+] [−] [Vừa khung] [Về trung tâm]   │                     │
└────────────────────────────────────┴─────────────────────┘
```

`*` Giữ khả năng lấy model và bảng hồ thô đã được production hỗ trợ làm trung tâm. Raw root có loại riêng, không có editor/build. Tài khoản nguồn/report chỉ refocus khi capability thực sự hỗ trợ; không suy từ khả năng raw root. Các hợp đồng scope/count áp dụng cả hai loại root.

M04 có lời nhắc Chọn model hoặc bảng thô để xem dòng dữ liệu; tìm kiếm và chọn lớp có count theo DISC-05, kết quả phân trang 25 mục. Bộ lọc nghiệp vụ/nguồn theo capability nằm trong Bộ lọc. Chọn lớp chỉ lọc danh sách chọn; chọn model mới mở M03. Không chạy ELK ở M04, không tự chọn model đầu, không vẽ dây giữa các nhóm vai trò. Raw là loại riêng và giữ link production.

M03 thu gọn toolbar: tên root/Đổi model, Sơ đồ–Bảng, Xem toàn bộ tác động. Dòng phạm vi luôn hiện hướng, độ sâu, nhánh mở và số đang vẽ/tổng; Đổi phạm vi mở hướng/depth. Bằng chứng coverage là dòng ngắn riêng; chi tiết ref/source/macro mở khi cần.

**LAYER-01 — Dải vai trò mềm:** dùng assignment đã xác nhận để định hướng Đầu vào/Biến đổi/Đầu ra; Biến đổi có thể có nhiều cột theo dependency. Raw và Chưa phân lớp nhận diện riêng, không suy vai trò theo hop. Cạnh bỏ lớp, đầu ra đọc đầu ra hoặc cạnh quay về lớp trước vẫn đúng hướng. Khi ép dải gây sai nghĩa hoặc đường quá rối, ưu tiên bố cục dependency và nhãn vai trò; không thay đổi topology để làm hình đều. Vai trò không có metadata thì chỉ hiện nhãn chưa phân lớp, không tạo nhóm giả.

### 5.2. Phạm vi và độ sâu

**REL-01.** Cạnh có hướng `nguồn dữ liệu → đối tượng sử dụng`. Upstream đi ngược cạnh; downstream đi thuận cạnh.

**REL-02.** Phạm vi cơ sở là hợp của các node reachable theo hướng đã chọn trong tối đa D cạnh. Mặc định D=1 và cả hai phía. Root luôn hiện và không tính vào số đối tượng liên quan.

**REL-03.** Độ sâu toàn bộ là toàn bộ reachable của root theo hướng chọn, không phải mọi model trong tenant. Giới hạn vận hành hoặc dữ liệu thiếu phải được trả về thành trạng thái truncated/partial.

**REL-04.** Một node có nhiều đường đi vẫn chỉ là một đối tượng. Số cấp là đường đi ngắn nhất theo từng hướng trong tập quan hệ đã biết. Có cycle thì một đối tượng có thể có vai trò cả upstream/downstream; không cộng hai lần vào tổng distinct.

**REL-05.** Bộ lọc danh sách gồm layer/domain/source/fam/status/q chỉ giới hạn bộ chọn trung tâm, không giới hạn duyệt quan hệ. Bộ lọc loại đối tượng trong bảng quan hệ, nếu có, lọc kết quả trình bày sau khi duyệt; không cắt mất đường nối đi qua loại khác.

### 5.3. Hai hành động mở rộng khác nhau

| Hành động | Thay đổi gì | Ảnh hưởng tới bảng/số lượng |
|---|---|---|
| “Còn N model trực tiếp — chọn để hiện” | Mở danh sách tìm kiếm/phân trang các node thuộc scope đang ẩn; xác nhận lựa chọn mới thay tập đang vẽ | Không đổi phạm vi hay tổng; không tự xổ N node |
| “Xem bước tiếp theo” | Thêm một cấp hàng xóm theo hướng nhánh vào scope; nếu vượt ngân sách, mở bộ chọn các node muốn vẽ | Bảng và tổng cập nhật theo scope mới; không tự vẽ tất cả |
| “Thu nhánh mở rộng” | Bỏ đóng góp của nhánh mở sâu, tính lại hợp với scope cơ sở và các nhánh còn mở | Tổng distinct tính lại; node dùng chung còn cần được giữ |
| “Thu bớt phần đang hiện” | Ẩn node đã chọn khỏi canvas, giữ scope | Bảng/tổng không đổi, số đang vẽ cập nhật |

Nhánh mở thủ công là hợp bổ sung vào phạm vi cơ sở. Thanh phạm vi ghi ví dụ **“Trực tiếp + 2 nhánh mở rộng”**. Có nút “Về phạm vi ban đầu”: giữ root/hướng/preset độ sâu, bỏ nhánh thủ công và phục hồi tập vẽ ban đầu. Thay root, hướng hoặc preset độ sâu xóa các nhánh bổ sung và tính lại phạm vi cơ sở. Root không được thu mất; thu nhánh cha xóa các mở rộng phụ thuộc vào nó nhưng không xóa node còn reachable qua nhánh khác đang mở.

Bộ chọn node ẩn có nhãn hướng, tổng còn ẩn, tìm kiếm, phân trang, chọn nhiều/chọn tất cả và xác nhận theo mục 5.3.1; nút Hủy không đổi tập đang vẽ. Báo số node/cạnh dự kiến thêm. Ngân sách vẽ không giới hạn số được chọn: vượt ngân sách vẫn giữ lựa chọn và có Xem N đối tượng đã chọn trong bảng. Không tự bỏ các nhánh đang hiện. Bộ chọn không biến thành node thật trong count; count chưa xác định ghi Đã tải N/Chưa rõ tổng, không bịa N.

Mỗi lần xem bước tiếp theo chỉ bổ sung hàng xóm trực tiếp theo hướng đã chọn chưa có trong phạm vi; sau đó mở tiếp từ node mới. Duyệt có visited set; không chạy đệ quy vô hạn khi có cycle. Lưu đóng góp mỗi nhánh kể cả node đã có từ nhánh khác để thu nhánh không xóa nhầm node chung. Nhãn bộ chọn dùng model hay đối tượng theo loại kết quả thực tế.

Trong v1, nhánh thủ công được giữ trong history/session nhưng không nằm trong link chia sẻ. Không gắn nhãn “sao chép chính xác sơ đồ hiện tại” cho chức năng chia sẻ.

### 5.3.1. Chọn nhiều mà không phải bấm từng hàng

**SEL-01 — Phạm vi chọn phải rõ.** Bộ chọn dành cho các đối tượng đang ẩn trong nhóm/nhánh hiện tại, thuộc snapshot và phạm vi quan hệ đã công bố. Không chọn toàn tenant, không mở thêm cấp chỉ vì chọn tất cả. Ví dụ giả lập có 58 model trong nhóm Biến đổi, trang đang hiện 25; tìm tên còn 12 kết quả thì chọn tất cả chỉ áp dụng 12 kết quả đó.

```text
Hiện thêm · Biến đổi                         [Đóng]
[Tìm trong nhóm…                              ]
[□ Chọn trang này · 25] [Chọn tất cả 58 kết quả]
Đã chọn 30 · 5 ngoài kết quả lọc  [Chỉ xem đã chọn] [Bỏ chọn hết]
… các hàng có checkbox …
1–25 / 58                   [Trước] [Trang 1/3] [Sau]
Sẽ thêm N đối tượng · E quan hệ
[Hiện N đối tượng trên sơ đồ] [Xem N đã chọn trong bảng] [Hủy]
```

Các con số chỉ minh họa; số kết quả, số được chọn và số bổ sung vào canvas có thể khác nhau và phải có nhãn riêng.

| ID | Thao tác | Hành vi bắt buộc |
|---|---|---|
| SEL-02 | Chọn trang này | Checkbox ba trạng thái: chưa chọn / chọn một phần / chọn hết trang. Bấm khi chọn một phần sẽ chọn hết trang; bỏ dấu chỉ bỏ các ID trên trang, giữ lựa chọn trang khác. Không dùng nhãn mơ hồ Chọn tất cả cho checkbox này |
| SEL-03 | Chọn tất cả N kết quả | Một thao tác chọn mọi ID khớp tìm/lọc hiện tại qua tất cả trang; hợp với lựa chọn đang có, không xóa lựa chọn ngoài bộ lọc. Thao tác không kích hoạt layout. Bỏ chọn kết quả này chỉ bỏ ID khớp bộ lọc, giữ các ID còn lại |
| SEL-04 | Đổi trang, sort, tìm hoặc xóa từ khóa | Giữ tập ID đã chọn; tìm/lọc/sort về trang đầu, không tự chọn thêm kết quả mới. Hiện tổng đã chọn và số nằm ngoài bộ lọc. Chỉ xem đã chọn bỏ qua bộ lọc tìm để xem toàn bộ lựa chọn; quay lại phục hồi tìm/lọc/trang trước đó |
| SEL-05 | Bỏ chọn hết | Xóa toàn bộ lựa chọn tạm trong bộ chọn, kể cả ngoài trang/bộ lọc; không xóa model hay thay canvas. Không cần hộp xác nhận cho thao tác đọc có thể làm lại này |
| SEL-06 | Hiện N đối tượng trên sơ đồ | Áp dụng một lần sau khi xác nhận, tính ID distinct và toàn bộ cạnh thật giữa tập node sẽ hiện. Bao gồm node trung gian nếu hành động yêu cầu mở đường và công bố số thêm. Không xóa nhánh hiện có để nhường chỗ, không cắt ngầm lựa chọn cho vừa giới hạn |
| SEL-07 | Xem N đã chọn trong bảng | Mở Bảng cùng root/hướng/scope với chip Đã chọn N đối tượng; chỉ lọc hàng trình bày theo tập ID đã chọn. Hiện N/M trong phạm vi, phân trang; bỏ chip trở lại M. Không đổi thành down/all và không chạy layout. Quay lại bộ chọn giữ lựa chọn và từ khóa/trang để tiếp tục |
| SEL-08 | Đóng / Hủy / Escape | Cùng hủy lựa chọn tạm kể từ khi mở bộ chọn; giữ canvas/camera trước đó, trả focus về nút mở. Không hỏi xác nhận lần nữa. Nếu vừa Xem bước tiếp theo đã mở scope thì giữ scope đó; chỉ hành động Thu nhánh/Hoàn tác mới đảo việc mở scope |

**SEL-09 — Chọn được hết, không buộc vẽ hết.** Nếu tập đã chọn phù hợp ngân sách thì Hiện trên sơ đồ áp dụng tất cả trong một lần. Nếu quá ngân sách, giữ tất cả checkbox; nêu lý do cạnh nút vẽ và đưa Xem N đã chọn trong bảng thành hành động chính. Người dùng vẫn xem đủ tập đã chọn ngay, hoặc dùng Chỉ xem đã chọn để giảm bớt. Không bắt bỏ chọn hàng chục mục chỉ để thoát ngõ cụt. Số 9 trong minh họa không trở thành giới hạn sản phẩm; ngân sách theo mục 14. Không thêm nút ép vẽ toàn bộ bỏ qua giới hạn/timeout.

**SEL-10 — Tổng chưa đầy đủ.** Chỉ ghi Chọn tất cả N kết quả khi có tập ID/count đầy đủ trong phạm vi đã biết và theo quyền. Nếu mới tải một phần, dùng Chọn N kết quả đã tải kèm Chưa đầy đủ và Tải thêm khi được hỗ trợ. Có trạng thái đang lấy danh sách lựa chọn và nút hủy tác vụ; lỗi giữ lựa chọn cũ, retry không chọn trùng. Không tải SQL/schema hoặc mount mọi hàng chỉ để chọn tất cả. Nếu backend hỗ trợ chọn theo query thì khóa query + revision và ID loại trừ; không cần API mới khi index nhẹ đã đủ.

**SEL-11 — Snapshot và quyền.** Lựa chọn dùng EntityRef có tenant/loại/ID, gắn graph revision và phạm vi bộ chọn; tách khỏi node đang xem trong panel. Đổi từ khóa không thay tập đã chọn theo kiểu truy vấn sống. Đổi root/tenant xóa draft; revision quan hệ đổi thì chặn áp dụng cũ, yêu cầu tải lại, đối chiếu ID còn hợp lệ và công bố số bị loại trước khi người dùng áp dụng. Mất quyền loại metadata/ID theo hợp đồng quyền, không giữ tên bị hạn chế trong nhãn thông báo.

**SEL-12 — Thao tác ổn định.** Checkbox và nhãn hàng đều có vùng bấm, nhưng link mở hồ sơ không tự tick. Space đổi checkbox có focus; checkbox đầu trang công bố trạng thái mixed; live region chỉ đọc số đã chọn. Tick/bỏ tick không nhảy scroll, mất focus hoặc chạy layout. Bộ chọn mặc định 25 hàng/trang, có nhập/chọn trang trực tiếp khi biết tổng; footer lựa chọn và hành động luôn dễ tới, có thể sticky trong panel mà không che hàng/focus ở mobile hoặc zoom 200%. Không yêu cầu Shift-click/hover để dùng thao tác chính.

**SEL-13 — Một lần áp dụng, một lần xử lý.** Gom chọn hàng loạt thành một lần cập nhật state; preview số node/cạnh chạy trên index, không gọi ELK cho từng checkbox. Lúc áp dụng đang xử lý, không nhận apply trùng; đổi lựa chọn/hủy bỏ kết quả preview cũ bằng request identity. Mục tiêu phản hồi theo mục 14 áp dụng cả chọn tất cả, bỏ chọn hết và mở bảng.

### 5.4. Giới hạn hiển thị ban đầu

Ngân sách vẽ là cấu hình tập trung theo viewport, node/edge count, kích thước nhãn và số đo; không có giới hạn node cố định áp dụng cho mọi graph. Chốt ngưỡng cụ thể trên fixture trước triển khai; chưa có một số node tối ưu được chứng minh.

- Root luôn hiện. Phạm vi một bước có thể rất rộng; khi cần chỉ hiện tập hàng xóm vừa ngân sách và bộ chọn phần còn ẩn, không đợi layout toàn scope mới thu gọn.
- Thứ tự chọn ban đầu ổn định theo hướng, loại, tên và ID; có cả hai phía nếu có quan hệ và ngân sách cho phép. Không đổi chỉ vì refresh status.
- Node được chọn để xem phải hiện hoặc có chỉ dẫn nó đang ẩn; không tự layout toàn scope để tìm node.
- Giữ cạnh trực tiếp thật giữa các node hiện. Nếu cạnh quá dày thì giảm tập vẽ có công bố hoặc dùng Bảng, không âm thầm lược cạnh. Không nối A → B trực tiếp thay A → X → B khi X ẩn; ghi đường qua node đang ẩn và cho mở một đường hợp lệ.
- Tổng trong bảng là tổng scope, không phải số node đang vẽ. “Đang vẽ N/M đối tượng liên quan” loại root khỏi cả tử và mẫu; raw/model theo đúng loại, không gọi mọi đối tượng là model.
- Graph/Bảng cùng snapshot/scope; ngân sách render không biến thành coverage partial. Partial/truncated dành cho thiếu dữ liệu hoặc giới hạn duyệt, có lý do riêng.

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

### 5.8. Phục hồi ngữ cảnh và thao tác hàng loạt

| Điểm bất tiện | Quyết định để giảm thao tác | Giới hạn |
|---|---|---|
| Phải tick từng model qua nhiều trang | Chọn trang / chọn tất cả kết quả / bỏ chọn kết quả / bỏ chọn hết theo SEL-01–05 | Chỉ nơi thực sự cần chọn nhiều; bộ chọn root vẫn chọn một |
| Đã chọn nhưng tìm kiếm làm mất dấu | Giữ lựa chọn, đếm phần ngoài bộ lọc, Chỉ xem đã chọn | Không tự chọn thêm theo từ khóa mới |
| Chọn hết rồi nút vẽ bị chặn | Xem tập đã chọn trong bảng ngay; giữ lựa chọn khi quay lại | Chọn tất cả không có nghĩa ép vẽ tất cả |
| Điều hướng tập kết quả nhiều trang | Bộ chọn 25 hàng/trang; trang trực tiếp khi biết tổng. List mặc định 25, Bảng quan hệ mặc định 50 như hợp đồng hiện hữu; dùng cùng component phân trang | API chỉ có cursor thì Trước/Sau + vị trí đã biết, không bịa tổng trang; tìm kiếm vẫn trên toàn phạm vi được hỗ trợ |
| Tick một hàng làm nhảy vị trí hoặc footer ở quá xa | Giữ scroll/focus; tóm tắt lựa chọn và hành động cạnh nhau, footer không che nội dung | Không thêm toolbar trùng nhau hoặc modal xác nhận mỗi lần chọn |
| Đổi model phải tìm lại từ đầu; mở nhầm model khó quay lại | M04 mở từ Đổi model có Hủy/Quay lại; giữ graph cũ tới khi chọn root mới. Bộ lọc không có kết quả hiện Xóa tìm kiếm và bỏ từng chip; giữ draft chooser khi xem hồ sơ rồi Back trong cùng session/revision | Không tự chọn kết quả đầu hoặc bỏ lọc âm thầm; root picker vẫn single-select |
| Mở thêm/thu nhầm nhánh làm mất công khôi phục | Sau mỗi lần áp dụng tập vẽ, mở/thu nhánh, Về phạm vi ban đầu có Hoàn tác thao tác vừa rồi; khôi phục scope, tập vẽ, camera và selection còn hợp lệ | Một bước hoàn tác rõ ràng ở v1, không lịch sử chỉnh sửa vô hạn; không đảo dữ liệu/SQL. Revision đổi thì báo không thể khôi phục bản cũ và cho tải lại |
| Về trung tâm, Vừa khung, Về phạm vi ban đầu dễ bị hiểu là một | Nhãn/phần giải thích rõ: Về trung tâm chỉ pan, Vừa khung chỉ zoom/pan, Về phạm vi ban đầu bỏ nhánh mở; chỉ thao tác cuối thay scope | Không reset query List hoặc đổi root |
| Muốn đọc hết nhóm nhưng bị đưa tới toàn downstream | Xem nhóm này trong bảng và Xem N đã chọn trong bảng là bộ lọc hàng của scope hiện tại; Toàn bộ tác động là down/all/table, có Back về đúng ngữ cảnh | Không đổi nghĩa scope hoặc lẫn count nhóm, lựa chọn, tổng quan hệ |
| Sơ đồ lỗi/chậm làm mất công chọn | Giữ tập lựa chọn và nhánh; Retry/Bảng cùng scope vẫn dùng được, Hủy bố trí dừng worker và đưa về bảng cùng scope | Lỗi tải dữ liệu không được giả kết quả đầy đủ |

**Điều hướng bảng có chọn lọc:** Xem nhóm này trong bảng có chip nhóm + số kết quả; chọn tập ID có chip Đã chọn N đối tượng. Đây là hai lối vào cùng bảng, không tạo tab mới. Quay lại phục hồi bộ chọn/graph nguồn và camera. Bỏ chip chỉ bỏ lọc trình bày, không xóa lựa chọn để người dùng còn quay lại. Các chip tạm không được quảng cáo là được lưu trong link chia sẻ. Thay root/tenant hoặc revision phải xử lý theo SEL-11.

**Hoàn tác và Back:** lần xác nhận thay canvas/scope tạo một mốc trạng thái, không tạo mốc cho mỗi checkbox. Hoàn tác và Back dùng cùng hợp đồng phục hồi; Hoàn tác tạo trạng thái mới tương ứng bản trước, không gọi browser Back một cách mù quáng. Nút Hoàn tác tồn tại tới thao tác thay canvas/scope kế tiếp hoặc đổi root/revision, không chỉ nằm trong toast tự biến mất. Không chạy layout khi chỉ mở/đóng bộ chọn hoặc bỏ lọc bảng.

**Ngoài phạm vi:** chọn nhiều tại Danh sách nếu chưa có hành động hàng loạt hữu ích; Build/Delete hàng loạt; Đảo lựa chọn; tổ hợp phím chuyên dụng bắt buộc; dashboard riêng cho các lựa chọn. Ưu tiên chọn tất cả/bỏ chọn/khôi phục trước khi tăng số nút.


## 6. Bảng quan hệ và tác động

### 6.1. Tên gọi và phạm vi

Control chuyển cách xem dùng **Sơ đồ / Bảng quan hệ**, tránh nhầm với tab Danh sách cấp cao. Không đặt danh sách quan hệ toàn tenant nối dài dưới graph. Tiêu đề bên trong bảng đổi theo hướng để không gọi upstream là đối tượng bị ảnh hưởng:

| Hướng | Tiêu đề |
|---|---|
| Phía trước | Các đối tượng cung cấp dữ liệu |
| Phía sau | Các đối tượng có thể bị ảnh hưởng |
| Hai phía | Quan hệ với trung tâm; có cột Quan hệ với trung tâm |

Nút tắt **Xem tác động / Xem toàn bộ tác động** luôn giữ root và đặt `dir=down`, `depth=all`, `mode=table`, dù mở từ hồ sơ hay Lineage. Loading/giới hạn thu thập vẫn phải thể hiện rõ; all là toàn bộ reachable đã biết trong phạm vi quyền, không phải mọi report ngoài coverage. Muốn chỉ đổi hướng và giữ độ sâu hiện tại thì dùng Đổi phạm vi. Back phục hồi phạm vi trước đó. Nút Xem quan hệ thông thường mở both/depth=1/graph.

### 6.2. Cột và thao tác

| Cột | Nội dung |
|---|---|
| Đối tượng | Tên và mô tả ngắn nếu có; click mở panel |
| Loại | Source, Model, Report hoặc loại được hỗ trợ |
| Quan hệ với trung tâm | Phía trước, Phía sau, hoặc Cả hai; ẩn nếu một hướng. Không gọi cột này là Vai trò vì dễ nhầm với Đầu vào/Biến đổi/Đầu ra |
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

UI hiển thị thời gian tương đối, hover/focus/tap thấy timestamp tuyệt đối và timezone. Tái sử dụng `@/lib/when`: quy tắc hiện hữu dùng `Asia/Singapore`, không đổi thành múi giờ thiết bị, tenant hoặc theo VI/EN trong phạm vi này. Múi giờ nghiệp vụ của dữ liệu, nếu được khai báo, là metadata riêng và có nhãn; không thay múi giờ hiển thị sự kiện. Nếu thiếu thời gian kết thúc thì không lấy thời gian sửa SQL thay vào. Dùng formatter chung cho số lượng/dung lượng; tiền dùng `formatMoney` và chuỗi decimal theo quy tắc repo, không sao chép định dạng số minh họa thành chuẩn sản phẩm.

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
| DiscoveryGroupSummary | `groupKey`, kind, label, Count theo toàn kết quả lọc, số model thuộc trang, dấu continued; chung tenant/identity/filterRevision/dataRevision với items. Group key không dựa vào nhãn dịch |
| ModelDetail | ModelSummary + `semanticMetadata?` có nguồn/revision/trạng thái xác nhận, `technicalMetadata?` theo capability, `freshness?`, `qualityResults?` theo model/run, `grain?`, `savedSql?`, `savedSqlHash?`, `hashVersion?`, `lastSuccessfulBuild?`, schema/provenance nếu có |
| BuildAttempt | `status`, `runId?`, `queuedAt?`, `startedAt?`, `endedAt?`, lỗi an toàn để hiển thị nếu được phép |
| SuccessfulBuild | `runId`, `completedAt?`, `sqlHash?`, `hashVersion?`, relation đọc được nếu backend xác nhận |
| LineageNode | `ref`, `label`, metadata được phép, `resolvable`, capability mở chi tiết/refocus |
| LineageEdge | `from`, `to`, loại quan hệ phụ thuộc, bằng chứng/nguồn nếu có; hướng nguồn → nơi dùng |
| LineageSnapshot | `snapshotId` hoặc revision tương đương, root có EntityRef.kind, nodes/edges hoặc cursor, basis, `collectedAt?`, coverage, completeness, truncationReason? |
| Count | `value`, `accuracy: exact/lower_bound/unknown`, phạm vi áp dụng |
| PreviewResult | cột/kiểu, rows, giới hạn áp dụng, `truncated`, thời điểm đọc, phiên bản dữ liệu nếu biết |
| ModelMetric | `ref`, mã metric, giá trị/đơn vị theo hợp đồng, trạng thái khả dụng, accuracy, observedAt, source, environment, relation/run/attempt/revision khi áp dụng; tiền giữ dạng chuỗi theo quy tắc repo |
| ModelRunHistory | `ref`, environment, attempts có định danh, status/timing/mode/source, pagination và completeness; retry phân biệt với lần chạy gốc |
| ModelTestResult | test ID, model refs liên quan, run/attempt, result, checkedAt, nguồn/coverage; cấu hình test không được trộn thành result |

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
| listModels | tenant, q, layer, domainId/sentinel, sourceId/sentinel, family, status, sort, page/cursor; group mode suy từ layer/capability, locale nếu sort nhãn phụ thuộc locale | items đã nhóm/sort trước phân trang hoặc index nhẹ complete để client xử lý; pagination, DiscoveryFacets, DiscoveryGroupSummary hoặc batch tương đương, count accuracy, capability tìm kiếm |
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

Tái sử dụng token của ứng dụng; giá trị dưới chỉ áp dụng nội dung Models, là kích thước mục tiêu khi chưa có token tương ứng. Không áp chúng lên shell được bảo vệ ở §2.4.

| Thành phần | Quy định |
|---|---|
| Nhịp khoảng cách | Bội số 4 px; gap thông thường 8/12/16/24 |
| Nội dung desktop | Padding 24 px; màn hình hẹp 16 px |
| Hàng danh sách | Chiều cao tự nhiên cho tên, tên kỹ thuật và mô tả ngắn; không ép 56 px hoặc cắt hành động. Ưu tiên mật độ dễ đọc bằng token spacing hiện hữu |
| Body | 14 px; tên/heading theo hierarchy hiện hữu, không giảm chữ để nhét graph |
| Node graph | Rộng mục tiêu 224 px, cao tự tăng; tên tối đa hai dòng, có xem đầy đủ |
| Panel desktop | Rộng 360 px khi vùng nội dung khả dụng ≥ 1.000 px |
| Graph viewport | Dùng phần chiều cao còn lại; tối thiểu 400 px nếu màn hình cho phép |

### 10.2. Responsive

- Vùng nội dung dưới 1.000 px: panel chuyển overlay có nút đóng; không ép canvas còn một dải hẹp.
- Viewport dưới 768 px: bộ chọn vai trò xuống dòng, Chưa phân lớp vẫn truy cập được; Bộ lọc mở dạng sheet có nút đóng. Nhóm chuyển thành tiêu đề hàng; ưu tiên tên, mô tả ngắn, trạng thái cần chú ý và Xem luồng theo mục 3.6; chip điều kiện active luôn thấy. Không ép cột nguồn/nghiệp vụ cạnh model trên màn hình hẹp.
- Toolbar xuống dòng theo nhóm, không tạo cuộn ngang toàn trang. Preview table/graph có vùng cuộn riêng.
- Dưới 768 px, dùng Bảng cùng scope và ghi “Đang hiển thị bảng cho màn hình nhỏ”; không mount canvas/ELK ẩn. Giữ mode được yêu cầu trong URL/session để phục hồi khi đủ rộng, trừ khi người dùng chủ động chọn Bảng. Đây là fallback trình bày, không đổi root/phạm vi/dữ liệu.

### 10.3. Bàn phím và thông tin hỗ trợ

- Thứ tự focus theo thứ tự đọc. Mọi nút icon có accessible name; trạng thái có chữ.
- Link tên model là link thật, hỗ trợ mở tab mới.
- Picker/panel mở inline theo `apps/ui/DESIGN.md`, không dùng modal hoặc `showModal()`. Nội dung trước/sau vẫn trong document và tab order; không trap focus. Khi đóng, trả focus về nút đã mở nếu nút còn tồn tại.
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
- **F05 — Quy mô:** các tập tổng hợp 250 và 1.000 model, 2 bảng thô và source/report giả lập theo capability; có fan-out 100, chuỗi ít nhất 20 bước và merge nhiều nhánh.
- **F06 — Thiếu bằng chứng:** model edges có, report coverage unsupported; thêm trường hợp toàn bộ coverage unknown.
- **F07 — Trạng thái:** thành công trước, lần gần nhất lỗi, SQL hash đổi; thêm never/unknown/đang chạy.
- **F08 — Quyền và bất đồng bộ:** đối tượng không được phép, đổi tenant, response cũ về muộn, snapshot đổi.
- **F09 — Phân lớp:** 6 model A–F. A=input/Tài chính/Xero/failed; B=transform/[Tài chính,Bán hàng]/[Xero,HubSpot]; C=output/Tài chính/Xero; D=output/Bán hàng/HubSpot; E=unclassified/chưa gán nghiệp vụ/nguồn unknown; F=output/Tài chính/tập nguồn rỗng đã xác nhận complete. B–F build success. Các nguồn đã biết của A–D có coverage complete.
- **F10 — Nguồn chưa đầy đủ:** biến thể F09 trong đó B chỉ xác nhận Xero và coverage partial; không kết luận B không dùng HubSpot. Bổ sung nguồn đi qua hai model trung gian và ID bộ lọc không còn resolve được.

- **F11 — Chọn hàng loạt:** một nhóm có 58 model đang ẩn, đủ 3 trang ở cỡ 25; từ khóa khớp 12 model rải nhiều trang; có lựa chọn ngoài từ khóa, hai nhánh chung một node, trường hợp count partial và snapshot/quyền đổi. Không dùng topology thật.

### 12.2. Ma trận nghiệm thu duy nhất

Mỗi ID là một yêu cầu kiểm tra, không phải trạng thái đã hoàn thành. Kết quả và bằng chứng ghi trong IMPLEMENTATION-STATUS; giữ nguyên ID khi sửa nội dung.

| ID | Tình huống | Kết quả bắt buộc |
|---|---|---|
| AC-01 | Mở Models không có query | Vào M01, sort tên tăng dần, không tự render graph |
| AC-02 | Tìm tên tồn tại ngoài trang 1 | Vẫn tìm được; kết quả không chỉ lọc trang hiện tại |
| AC-03 | Đổi query nhanh, response cũ về sau | Chỉ kết quả query hiện tại được hiển thị |
| AC-04 | Đang lọc lớp/nghiệp vụ/nguồn/q/fam, chọn Trạng thái → Build lỗi | Chỉ thay status=failed; Tất cả trạng thái chỉ xóa status, không bỏ các điều kiện khác |
| AC-05 | Mở hồ sơ từ trang có filter rồi Back | Khôi phục filter, trang và vị trí cuộn |
| AC-06 | Mở link cũ lineage chỉ có fam | M04 hiển thị picker đã lọc, không tự chọn root |
| AC-07 | F01, root A, both/depth=1 | Phạm vi liên quan là S và B; R chưa nằm trong phạm vi |
| AC-08 | F01, chọn Xem bước tiếp theo ở B hướng down | R được thêm vào cả graph scope và bảng; nhãn phạm vi thể hiện nhánh bổ sung |
| AC-09 | F01, click B | Panel B mở; root vẫn A; camera/zoom không tự thay đổi |
| AC-10 | F01, lấy B làm trung tâm | Root B; both/depth=1; history mới; Back khôi phục root A và scope trước |
| AC-11 | F04, mở graph mặc định | Graph thu gọn đúng giới hạn; bảng có 50 downstream; số lượng không lấy từ node đang vẽ |
| AC-12 | F04, Còn N model trực tiếp — chọn để hiện | Mở bộ chọn; Hủy không đổi canvas; xác nhận chỉ hiện node được chọn trong ngân sách; scope/count không đổi |
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
| AC-36 | F09, chọn Chưa phân lớp theo vai trò | E vẫn tìm và mở được; Tất cả lớp không loại E |
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
| AC-60 | Layout engine gặp lỗi stack hoặc exception | Hiện lỗi layout riêng, log an toàn có nguyên nhân, Bảng cùng scope vẫn dùng được; không spinner vô hạn |
| AC-61 | Graph nhiều cạnh và layout chạy lâu | Tìm kiếm/đổi tab vẫn responsive; layout chạy Worker thật, timeout hủy được tác vụ |
| AC-62 | Đổi root A → B → C nhanh | Chỉ kết quả C được nhận; không backlog vô hạn; không ghi layout A lên scope C |
| AC-63 | Mở List/Bảng hoặc mobile không có canvas | Không khởi động ELK, không âm thầm mount graph ẩn để tính toàn bộ |
| AC-64 | Cùng scope chỉ chọn node khác | Highlight/detail đổi mà không tính lại layout; cache invalidation đúng khi topology thay đổi |
| AC-65 | Root có rất nhiều hàng xóm trực tiếp | Có cách chọn nhóm/nhánh và số còn ẩn; không tự xổ toàn bộ hoặc âm thầm bỏ cạnh |
| AC-66 | Legacy scope=related hoặc toàn bộ tác động có phạm vi lớn | Giữ đúng tập quan hệ và count; Bảng hữu dụng, graph thông báo phạm vi vẽ; không giả một bước là toàn bộ |
| AC-67 | Nghiệm thu với 250–1.000 model tổng hợp | Đo cold/warm, nhánh rộng/merge/chuỗi dài, lỗi/timeout/đổi root; lưu browser và API timings riêng, không dùng demo 8 model để kết luận đạt |
| AC-68 | Vào Lineage chưa có root, chọn lớp | Chỉ lọc bộ chọn, count đúng, không ELK/auto-root/đường nối giữa nhóm |
| AC-69 | Biến đổi nối Biến đổi qua nhiều bước, có cạnh bỏ/quay lớp | Vai trò và bước độc lập; nhãn lớp có bằng chứng, hướng cạnh không bị sửa |
| AC-70 | 100 con trực tiếp, chọn vài node rồi Hủy hoặc xác nhận | Không xổ cả 100; preview node/cạnh; Hủy giữ nguyên, xác nhận không vượt ngân sách hoặc âm thầm xóa nhánh khác |
| AC-71 | Hai nhánh nhập một model chung, thu một nhánh | Model dùng chung vẫn còn nếu nhánh kia cần; root còn; tổng distinct và bảng đúng |
| AC-72 | Node trung gian bị ẩn | Không tạo mũi tên trực tiếp giả; mở được đường đúng và có nhãn qua node đang ẩn |
| AC-73 | List trên 250 model, tìm model ngoài trang đầu | Mặc định 25 hàng; tìm/lọc/count toàn tập, không chỉ trang hiện tại |
| AC-74 | Bàn phím/mobile/reduced motion | Mở/đóng bộ chọn và panel được, focus trở lại hợp lý; không phụ thuộc hover/màu; mobile không chạy graph ẩn |
| AC-75 | F11, Chọn trang này rồi sang trang 2 | Chọn đúng 25 ID trang 1, không phải 58; trang 2 chưa được chọn, tổng lựa chọn vẫn 25 |
| AC-76 | F11, Chọn tất cả 58 kết quả rồi bỏ một hàng | Đủ 58 ID distinct qua mọi trang trong một thao tác; còn 57 sau khi bỏ, checkbox trang tương ứng mixed; không layout khi chọn |
| AC-77 | Đã chọn 5 ID ngoài từ khóa; tìm được 12 rồi chọn tất cả | Tổng 17, công bố 5 ngoài bộ lọc; xóa từ khóa không chọn thêm. Bỏ chọn kết quả này chỉ bỏ 12; Bỏ chọn hết về 0 |
| AC-78 | Đổi trang/sort, Chỉ xem đã chọn rồi quay lại tìm | Tập chọn không mất; chế độ đã chọn hiện toàn tập chọn; phục hồi query/page; tick không nhảy scroll/focus |
| AC-79 | Chọn tất cả, trong ngân sách vẽ | Xác nhận hiện đủ ID đã chọn và cạnh thật cần có trong một lần; preview số thêm đúng, không áp dụng hai lần |
| AC-80 | Chọn tất cả vượt ngân sách | Giữ lựa chọn, lý do rõ, không cắt ngầm; Xem 58 đã chọn trong bảng dùng ngay, có chip và N/M, không ELK |
| AC-81 | Từ bảng tập đã chọn quay lại bộ chọn hoặc bỏ chip | Quay lại giữ ID/query/page; bỏ chip trả về scope M, không tự down/all hoặc bỏ tập lựa chọn |
| AC-82 | Chọn thêm rồi Đóng/Hủy/Escape | Cả ba đều bỏ draft mới và giữ canvas/camera; focus trả đúng nút mở; scope mở trước đó chỉ đảo bằng Thu nhánh/Hoàn tác |
| AC-83 | Tổng chưa đầy đủ, tải thêm lỗi hoặc hủy | Chọn kết quả đã tải ghi đúng partial, không gọi toàn bộ; giữ lựa chọn cũ, retry không trùng và không mount mọi hàng |
| AC-84 | Snapshot đổi/mất quyền khi bộ chọn đang mở | Không apply snapshot cũ; reload đối chiếu và công bố số loại; không rò tên/ID ngoài quyền; đổi tenant/root xóa draft |
| AC-85 | Bàn phím, mobile, zoom 200% trong bộ chọn | Checkbox mixed đúng; Space thao tác được; footer không che dòng cuối/focus; không cần hover hoặc Shift-click |
| AC-86 | Mở/thu nhánh hoặc thêm node rồi Hoàn tác | Phục hồi một bước scope/tập vẽ/camera; node chung còn đúng; không layout toàn tenant hoặc thay SQL; Back không phục hồi trạng thái nửa áp dụng |
| AC-87 | Đổi model rồi Hủy; hoặc xem hồ sơ từ bộ chọn rồi Back | Graph cũ không đổi khi Hủy; trở lại cùng query/page/draft còn hợp lệ; không auto-root |
| AC-88 | Xem nhóm trong bảng / Toàn bộ tác động / Back | Nhóm chỉ lọc hàng cùng scope; tác động đặt down/all/table; Back khôi phục ngữ cảnh nguồn; count luôn có nhãn |
| AC-89 | Layout lỗi/timeout/hủy sau khi đã chọn tập lớn | Bảng cùng scope vẫn dùng được; không mất lựa chọn; hủy ngắt worker; thử lại không nhận kết quả stale |
| AC-90 | 250–1.000 model, chọn hết/bỏ chọn/chuyển bảng | Đo phản hồi theo mục 14; không ELK mỗi tick, không N request chi tiết cho N model, không render toàn tập chỉ để chọn hết |
| AC-91 | Mở tên model từ List; mở Hiểu dữ liệu từ panel Lineage | Cùng hồ sơ/EntityRef, bốn mục con, đúng hai tab cấp cao; Back phục hồi list filter/page/scroll hoặc root/scope/camera |
| AC-92 | Người không chuyên đọc Hiểu dữ liệu | Thấy mục đích/grain/cách dùng/lưu ý khi có nguồn; phân biệt build, freshness, quality; không cần đọc cấu hình để hiểu model |
| AC-93 | Model không có alias/grain hoặc chỉ có comment SQL | Dùng tên kỹ thuật; phần thiếu ngắn gọn; comment có nhãn nguồn/chưa xác nhận, không tạo ngữ nghĩa nghiệp vụ hoặc owner giả |
| AC-94 | Lần thử mới lỗi, còn bản thành công trước | Hiện hai trạng thái có nguồn/thời gian riêng; mở được Nhật ký; không lấy endedAt cấp run làm endedAt model hoặc tự kết luận dữ liệu biến mất |
| AC-95 | Test đã cấu hình; chỉ một phần có result, có test dùng nhiều model | Hiện pass/warn/fail/error/skipped/chưa biết đúng nguồn; không lấy tổng run làm tổng model hoặc kết tội một phía quan hệ |
| AC-96 | rows_affected=-1, preview 50 dòng, catalog có row estimate | Ba ý nghĩa được giữ; -1 không thành số hàng, preview không thành tổng, estimate có nhãn/thời gian; không tự COUNT/profile |
| AC-97 | Mở/đổi tab hoặc đổi model nhanh | Không tự preview/build/test/compile/profiling/layout; lazy-load theo MET-05, response cũ không ghi đè, lỗi một khối không làm sập hồ sơ |
| AC-98 | Cấu hình incremental/full-refresh khác, view hoặc ephemeral | Nhãn cách chạy rõ; không so thời lượng khác điều kiện như tương đương; không hiện lỗi thiếu relation cho ephemeral hoặc giả stats không áp dụng |
| AC-99 | SQL/config đã sửa nhưng artifact thuộc run cũ | Phân biệt bản hiện lưu/bản chạy cũ; compiled SQL đúng nguồn/quyền; hash SQL không chứng minh config/macro không đổi |
| AC-100 | Deep link tab=operations, viewport hẹp, thiếu metrics capability | Mở đúng mục Vận hành, tab truy cập bằng bàn phím, không che nút; phần sẵn có vẫn dùng được và phần thiếu không thành KPI 0 |
| AC-101 | Chuyển Tất cả / Đầu vào / Biến đổi / Đầu ra / Chưa phân lớp | Cột nhóm và dữ liệu theo GRP-01; không còn cột Vai trò lặp ở lớp riêng; không tự gán metadata |
| AC-102 | Model nhiều nguồn/nghiệp vụ, nguồn partial hoặc complete rỗng | Mỗi ID một hàng; nhóm nhiều/chưa rõ/rỗng đúng nghĩa; lọc contains vẫn khớp; tổng nhóm phân hoạch bằng tổng distinct |
| AC-103 | Nguồn/nghiệp vụ chưa được hỗ trợ, chỉ có family hoặc prefix tên | Ghi thiếu capability; chỉ nhóm kỹ thuật từ metadata thực và gọi đúng tên, không giả nguồn/nghiệp vụ từ prefix |
| AC-104 | Nhóm 38 model vắt qua hai trang | Count nhóm và số trên trang có nhãn; trang sau nhắc tên nhóm; tối đa 25 model mỗi trang, thu/mở không tải cả nhóm |
| AC-105 | Thu nhóm rồi tìm model trong nhóm đó | Kết quả query mới hiện trong nhóm mở; có cách mở các nhóm trên trang; count không đổi theo số hàng đang thu |
| AC-106 | Mở hồ sơ hoặc Lineage rồi quay lại danh sách | Giữ lớp/query/page/sort/thu nhóm đúng ngữ cảnh; filter nhóm không cắt quan hệ của model |
| AC-107 | Danh sách bình thường và khi lọc trạng thái | Không lặp cột trạng thái thường trực; lỗi/chờ/chạy còn thấy, filter trạng thái hiện nhãn/thời gian đúng; click mở Vận hành |
| AC-108 | Mobile, bàn phím và 250–1.000 model | Nhóm là tiêu đề đọc được, thu/mở có aria-expanded, không mất hành động; render có giới hạn, không N request detail; dòng đếm không lặp tổng |
| AC-109 | Cùng viewport/locale/route và fixture tổng hợp trước/sau thay Models | Rail/header giữ màu, font, hình dạng, tỷ lệ, khoảng cách, đường kẻ và vị trí; không thay bằng header của minh họa; baseline không chứa PII thật |
| AC-110 | Vào Models rồi đổi phân khu/tenant; dùng các control header | Đúng một tab phân khu active theo route; logo/tenant/tài khoản/VI–EN/trợ lý/sign-out và capability giữ nguyên; không thêm AI vào nội dung Models |
| AC-111 | Hover/chọn phân khu, đổi tenant; rồi đổi List/Lineage/hồ sơ/nhóm | Nâng tab, punch-through, leaf-turn giữ trigger/token cũ; thao tác nội bộ Models không làm lật toàn leaf; reduced-motion vẫn hoạt động |
| AC-112 | Màn rộng/hẹp quanh breakpoint shell, 320 px, zoom 200%; mở phân khu khác | Shell giữ hành vi responsive hiện hữu, rail mobile truy cập được; nội dung mới không che header/control, không CSS rò sang trang khác |
| AC-113 | Cùng dataset, lọc/group/sort ở client complete hoặc phân trang server | Cùng thứ tự toàn tập, page IDs và count; nhóm trước cắt trang, tên bằng nhau dùng ID, không lặp/bỏ sót model qua trang ở cùng snapshot |
| AC-114 | Đầu vào có nguồn complete 0/1/nhiều, partial 1/nhiều, unsupported hoặc lỗi | Theo thứ tự GRP-03; partial không thành nhóm đơn/đa nguồn đã đầy đủ, complete rỗng không thành unknown, lỗi không thành assignment thiếu; filter nguồn đã biết vẫn khớp |
| AC-115 | Nhóm chia nhiều trang hoặc count chưa exact | Count nhóm toàn query khác số trên trang; không cộng riêng nhóm đang thấy thành tổng tenant; không bịa count/trang exact; key nhóm giữ ID ổn định qua dịch nhãn |
| AC-116 | Dùng bàn phím thu nhóm, đổi trang, mở hồ sơ rồi Back hoặc tìm mới | Focus/nhãn nhóm đúng, không mất query/page/thu nhóm khi Back; trang chưa xem không tự bị thu; query mới hiện hàng khớp trong nhóm mở |
| AC-117 | Bật filter trạng thái hoặc sort build_desc rồi trở về sort tên | Trạng thái/thời điểm giúp hiểu kết quả, có nhãn bắt đầu/kết thúc đúng nghĩa; thiếu giờ không lấy SQL updatedAt; trở về mặc định không có cột/nhãn trạng thái lặp |
| AC-118 | Đổi VI/EN trên list, hồ sơ, bảng quan hệ | Chuỗi qua catalogue, tên kỹ thuật/ID/assignment không đổi; timestamp dùng formatter Asia/Singapore hiện hữu, tiền dùng formatMoney; không sao chép timezone hoặc số mẫu từ minh họa |

### 12.3. Mục tiêu phản hồi và đo kiểm

Các con số sau là mục tiêu triển khai, chưa phải kết quả đo ứng dụng:

- Click node mở panel có dữ liệu đã tải: mục tiêu p95 ≤200 ms theo mục 14.3, không gọi layout toàn graph.
- Với fixture F05 đã tải dữ liệu, tính scope và render phạm vi ban đầu: mục tiêu p95 dưới 1 giây trên máy nghiệm thu được ghi cấu hình.
- Trong lúc fetch/layout dài, trạng thái loading phải hiện; không khóa điều hướng hoặc nút chuyển bảng.
- Preview phải kết thúc thành công hoặc trả timeout theo giới hạn công bố; không treo spinner vô hạn.
- Báo cáo tách network, xử lý graph và render; không dùng một số tổng để che nguyên nhân chậm.

Nếu chưa đạt, ghi lại fixture, máy, số lần đo và nguyên nhân; hiệu chỉnh trước phát hành hoặc ghi giới hạn được chấp nhận rõ ràng.

### 12.4. Nghiệm thu mức dễ hiểu

Thử định tính với cả người không chuyên và kỹ sư theo PLAN P5 và giao thức định tính dưới đây. Đo tìm đúng model, hiểu grain, phân biệt build/freshness/quality, phân biệt trực tiếp/toàn chuỗi, thoát graph lỗi và vào editor nhanh. Mục tiêu và cỡ nhóm thử chưa phải kết quả đã đo; ghi câu trả lời sai/mức trợ giúp cùng thời gian, không chỉ kiểm tra click được.

- Khi có người tham gia do người dùng bố trí, vòng định tính đầu gồm 3 người không chuyên và 3 kỹ sư; đây không phải nghiên cứu thống kê. Không tự liên hệ/mời người ngoài để hoàn thành task.
- Tác vụ: tìm model theo nghiệp vụ; giải thích một dòng dữ liệu; phân biệt build/freshness/test; truy nguồn/nơi dùng; chọn hết 58 model và xem bằng bảng; quay lại/hoàn tác; mở editor; phục hồi khi graph lỗi.
- Mục tiêu 5/6 người hoàn thành nhóm tác vụ tìm/hiểu/truy nguyên không cần hướng dẫn thao tác; không ai hiểu build xanh là bằng chứng chắc chắn dữ liệu đúng/mới. Nếu không đạt thì sửa ngôn ngữ/phân bổ và kiểm tra lại.
- Chưa tổ chức thử người dùng thì ghi not-run trong STATUS, không thay bằng tự đánh giá của agent. Bàn giao kỹ thuật vẫn phải nêu rõ thiếu bằng chứng định tính.

## 13. Đầu ra bàn giao và ranh giới triển khai

### 13.1. Thiết kế

- M01: bộ chọn vai trò; nghiệp vụ/nguồn/trạng thái/Family trong Bộ lọc khi hỗ trợ, chip điều kiện đang bật luôn thấy; trường hợp chưa phân loại, nhiều nguồn, nguồn chưa đầy đủ, tổ hợp không kết quả, count chưa biết và lỗi.
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

## 14. Hợp đồng hiệu năng và phục hồi

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
