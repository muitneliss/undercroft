# Nghiên cứu UX lineage cho hơn 200 dbt models

Ngày đọc nguồn: 11/10/2026. Trạng thái: đề xuất để thảo luận; chưa cập nhật quyết định trong PLAN/SPEC, chưa thi công prototype.

## Phạm vi và phương pháp

Đọc tài liệu chính thức của dbt Catalog, Atlan, DataHub, Dagster và OpenMetadata; đối chiếu nghiên cứu trực quan hóa đồ thị. Đây là 5 sản phẩm tham chiếu phù hợp, không phải bảng xếp hạng “top 5 thế giới”. Không benchmark trực tiếp sản phẩm thương mại và không suy diễn rằng một tính năng có tài liệu đồng nghĩa UX luôn tốt.

Mục tiêu: tìm/chọn model trong hơn 200 models; hiểu quan hệ; mở nhánh lớn có kiểm soát; kiểm tra đầy đủ ảnh hưởng. Giữ đúng hai tab Danh sách và Dòng dữ liệu, không thêm nút AI.

## Bằng chứng đáng dùng

| Nguồn chính thức | Điều tài liệu xác nhận | Bài học áp dụng — suy luận thiết kế |
|---|---|---|
| [dbt Catalog](https://docs.getdbt.com/docs/explore/explore-projects) | Cho chọn tập con bằng selectors, refocus theo hướng; có model-layer lens. Tài liệu thừa nhận graph rất lớn có thể không render. | Tìm phạm vi trước khi vẽ; lớp giúp nhận biết nhưng không thay thế việc thu hẹp graph. |
| [Atlan: View lineage](https://docs.atlan.com/product/capabilities/lineage/how-tos/view-lineage) | Tách mở sâu hơn theo chiều ngang khỏi hiển thị thêm quan hệ theo chiều dọc; có tìm trên canvas, refocus và điều chỉnh metadata. | Phân biệt “đi thêm một bước” với “còn các nhánh khác cùng bước”; giảm chữ trên node. |
| [DataHub: Impact Analysis](https://docs.datahub.com/docs/act-on-metadata/impact-analysis) | Phụ thuộc mặc định 1 degree, đổi hướng, lọc danh sách và xuất kết quả. | Dùng bảng để kiểm tra toàn bộ ảnh hưởng, không phụ thuộc các node đang vẽ. |
| [DataHub: Lineage](https://docs.datahub.com/docs/features/feature-guides/lineage) | Có Explorer và Impact Analysis. Riêng pipeline/task lineage giới hạn mở upstream và downstream của một task mỗi phía tại một thời điểm. | Khám phá theo nhánh đang quan tâm. Giới hạn task này không phải quy tắc chung của mọi graph trong DataHub. |
| [Dagster: Asset selection](https://dagster.io/blog/updated-asset-selection-syntax) | Có tập chọn lưu lại, lọc metadata, giới hạn traversal và phép chọn các node nằm giữa A và B bằng giao downstream(A)/upstream(B). | Thêm thao tác “Xem đường tới…” khi cần; người dùng không phải tự mở mọi nhánh để tìm đích. |
| [OpenMetadata: Detailed asset view](https://docs.open-metadata.org/v2.0.x/how-to-guides/data-discovery/details) | Cấu hình upstream, downstream và số node mỗi lớp; bấm asset mở preview. | Cần kiểm soát bề rộng song song với chiều sâu; chi tiết mở theo nhu cầu. “Layer” ở đây không chứng minh là lớp nghiệp vụ Bronze/Silver/Gold. |

### Không sao chép mọi giới hạn của nhà cung cấp

[Atlan impact report](https://docs.atlan.com/product/capabilities/lineage/how-tos/download-and-export-lineage) ghi rằng trên 200 impacted assets thì chỉ tải xuống thay vì xem báo cáo trực tiếp. Đây là giới hạn của chức năng đó, không phải bằng chứng 200 node là ngưỡng UX chung và không phải hành vi nên bê sang Undercroft.

[dbt account lineage](https://docs.getdbt.com/docs/explore/explore-multiple-projects) có thể gom mỗi project thành một node chứa số public model. Điều này cho thấy giá trị của cấp tổng hợp có ý nghĩa; không chứng minh rằng nên ép toàn bộ một tenant Undercroft vào vài nhóm tự suy đoán.

## Nghiên cứu nền tảng và giới hạn bằng chứng

[TreePlus, IEEE TVCG 2006](https://www.microsoft.com/en-us/research/publication/treeplus-interactive-exploration-networks-enhanced-tree-layouts/) nghiên cứu cách bắt đầu từ một node rồi mở theo nhu cầu; có thử nghiệm 28 người với 6 nhiệm vụ. Kết quả ủng hộ khám phá cục bộ trong bối cảnh nghiên cứu, không xác lập một số node tối ưu cho dbt lineage.

[ZAME, PacificVis 2008](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/12/Elmqvist_pacificvis08.pdf) thảo luận ảnh hưởng của kích thước, mật độ và nhiệm vụ tới khả năng đọc graph; tổng hợp ở nhiều cấp là một hướng xử lý. [MatLink, INTERACT 2007](https://www.microsoft.com/en-us/research/publication/matlink-enhanced-matrix-visualization-analyzing-social-networks/) cho thấy ma trận cũng có đánh đổi, nhất là việc lần theo đường đi. Không dùng những nghiên cứu về graph tổng quát này để khẳng định hiệu quả trên Undercroft khi chưa thử người dùng.

Không tìm được căn cứ trong các nguồn đã đọc cho quy tắc cứng “tối đa 12 model”. Rút lại giới hạn đó. Số node, số cạnh, độ dài nhãn, hình dạng graph và không gian màn hình phải được xét cùng nhau. Các ngưỡng cụ thể chỉ được chốt sau kiểm thử.

## Đề xuất sau nghiên cứu

### 1. Giữ Danh sách là nơi tìm; Dòng dữ liệu là nơi lần theo quan hệ

Từ List, “Xem luồng” mở đúng model. Vào Lineage trực tiếp thì có tìm/chọn model, dùng lại cách lọc quen thuộc. Không render tất cả models khi chưa chọn phạm vi. Nút Đổi model mở bộ chọn có tìm kiếm và kết quả phân trang, không phải select dài hơn 200 mục.

### 2. Phân lớp mềm, giữ đúng quan hệ

Giữ Đầu vào / Biến đổi / Đầu ra làm nhãn và vùng định hướng. Bên trong Biến đổi có thể có nhiều bước nối tiếp. Model đầu ra vẫn có thể được model khác dùng tiếp. Đường tắt và đường nối cùng lớp vẫn phải xuất hiện đúng.

Không ép mọi graph thành đúng 3 cột bất kể topology. Không tự gán Bronze/Silver/Gold hoặc lĩnh vực bằng vị trí node hay số bước tính từ root.

### 3. Mở nhánh khác với hiện thêm các model cùng cấp

- Mở tiếp: đi thêm một bước quan hệ ở nhánh được chọn.
- Xem N model khác: xem các đối tượng cùng phạm vi đang được gộp vì quá nhiều; mở bộ chọn có tìm kiếm.
- Xem đường tới: chọn một model đích và hiển thị các đường nối liên quan trong graph đã biết.

Nhánh nhỏ có thể thêm trực tiếp. Nhánh lớn mở bộ chọn trước. Giữ root, vị trí những node đang xét và lịch sử Quay lại; không tự bỏ mất node được người dùng ghim/chọn. Số node được hiển thị ban đầu là tham số để thử, chưa là acceptance requirement.

Khi có nhiều đường A → B, không mặc định chỉ vẽ đường ngắn nhất rồi gọi là toàn bộ liên hệ. Không tìm được đường phải ghi “Chưa tìm thấy trong quan hệ đã thu thập”, không kết luận không liên quan ngoài hệ thống.

### 4. Gom đúng phạm vi, không tạo quan hệ giả

Nhóm thu gọn có nhãn “N model khác” và dấu hiệu khác model thật. Nhóm theo quan hệ với node đang xét luôn dùng được; nhóm theo vai trò/lĩnh vực chỉ dùng khi có metadata đáng tin.

Một đường nối hai nhóm chỉ cho biết có quan hệ giữa các thành viên, không có nghĩa mọi thành viên nhóm này nối mọi thành viên nhóm kia. Có thể cần hiện số quan hệ khi mở chi tiết.

Nếu ẩn model trung gian trên một đường, không thay A → X → B bằng mũi tên trực tiếp A → B. Giữ dấu “qua N model đang thu gọn” và cho mở lại. Các node dùng chung được đếm một lần trong tổng kết quả.

### 5. Bảng kiểm tra tác động có tổng riêng

Sơ đồ và bảng thông thường dùng cùng phạm vi ngữ nghĩa; khác số phần tử đang render không làm thay đổi dữ liệu truy vấn. “Toàn bộ tác động” là hành động rõ ràng đổi sang downstream toàn chuỗi đã biết và mở bảng.

Ví dụ giả: 103 model phía sau = 16 trực tiếp + 87 gián tiếp; trang đầu hiện 20. Nhãn tổng ghi 103, số trang ghi 1–20, số node trên sơ đồ không thay thế cả hai. Áp dụng bộ lọc phải hiện “N / 103 kết quả”, không làm mất tổng gốc một cách im lặng. Mỗi dòng có “Xem đường tới model này”.

### 6. Thu gọn chrome

Một hàng chính: model đang xét / Đổi model / Sơ đồ–Bảng / Xem tác động. Một dòng trạng thái ngắn nêu phạm vi hiện tại và số lượng. Hướng, depth, metadata phụ ở tùy chọn mở thêm. Ngữ nghĩa phạm vi vẫn phải nhìn thấy khi đóng tùy chọn.

Panel chi tiết chỉ mở khi người dùng chọn xem; không luôn trải toàn bộ hồ sơ bên dưới graph. Tên dễ hiểu và tên kỹ thuật vẫn cùng xuất hiện. Không thêm AI button.

## Ưu tiên và khả thi trên Undercroft

Đối chiếu [audit repo ngày 10/10](./FEASIBILITY-models-repo.md), commit 69d69280390fbfbc07f5be8233e91d34687168fa. Đây là baseline đã kiểm tra, không phải kiểm tra lại HEAD ngày 11/10.

| Ưu tiên | Làm gì | Điều kiện |
|---|---|---|
| Trước | Tìm/chọn model, scope quanh root, chọn nhánh rộng, bảng phân trang, tổng chính xác, back giữ ngữ cảnh | Có thể xây trên models.lineage và traversal hiện có; vẫn cần code UI/state mới |
| Tiếp | Xem đường A → B | Có thể tính từ edges hiện có; phải xác định rõ phạm vi đã biết và trường hợp nhiều đường |
| Có điều kiện | Alias, phân lớp và nhóm nghiệp vụ, saved views theo lĩnh vực | Cần nguồn metadata mới; model contract hiện chưa có lớp/domain/alias |
| Để sau | Bản đồ tổng thể nhóm nghiệp vụ, minimap phức tạp, column lineage, report impact | Chưa cần để giải quyết việc tìm/lần theo quan hệ; report/column lineage chưa có nền dữ liệu đầy đủ |

Không kết luận ELK không xử lý nổi 200 models; audit mới xác nhận có layout failure trên web, chưa xác định nguyên nhân. Đổi layout engine không phải lời giải UX mặc định.

## Bộ tình huống cần mô phỏng trước prototype

Các tình huống dưới đây là dữ liệu kiểm thử đề xuất, không phải thống kê tenant.

1. 205 models chia thành nhiều cụm không liên quan: mở một cụm không kéo cả tenant vào.
2. Một node có 100 con trực tiếp: depth 1 vẫn phải tránh xả 100 card.
3. Chuỗi 20 bước, nhiều bước cùng vai trò Biến đổi: không gán lớp theo hop.
4. Hình kim cương: hai nhánh nhập về cùng một model; tổng không đếm trùng.
5. Hai hoặc nhiều đường tới cùng một đích: không che mất quan hệ chỉ vì chọn đường ngắn nhất.
6. Đường nối bỏ qua lớp, đầu ra dùng đầu ra, hoặc chưa phân lớp: giữ đúng edges.
7. Model thiếu, macro/undeclared và graph chưa đầy đủ: thông báo coverage đúng mức.
8. Đổi model, mở hồ sơ, quay lại: không mất scope, filter, selection và nhánh đã mở.

Đánh giá bằng nhiệm vụ: tìm đúng model, tìm nơi dùng trực tiếp, xác định tổng ảnh hưởng, lần được đường tới một đích và quay lại. Ghi thời gian, số thao tác, lỗi hiểu sai trực tiếp/gián tiếp và mức tự tin. Không lấy “render được 205 node” làm tiêu chí UX thành công.
