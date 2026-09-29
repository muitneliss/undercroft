# Báo cáo: nghiên cứu giải pháp và quyết định thiết kế

Ngày nghiên cứu: 29/09/2026. Phạm vi: trải nghiệm đọc, khám phá và biên tập báo cáo trong Undercroft. Nguồn bên dưới là tài liệu chính thức của sản phẩm/thư viện. Đây là so sánh thiết kế và kiến trúc, không phải benchmark hiệu năng hay đánh giá sau triển khai thực tế.

## Đề xuất phù hợp nhất

Giữ Reports là BI first-party của Undercroft; giữ Chart.js và các hợp đồng câu hỏi/dashboard hiện có. Tổ chức trải nghiệm theo thứ tự **câu hỏi → kết quả → bằng chứng**, với một trang báo cáo có trọng tâm, chế độ đọc tách khỏi biên tập và đường quay lại giữ bộ lọc.

Ví dụ: mở **Nhịp kinh doanh**, chọn **Dịch vụ**, đọc tổng trong kỳ và xu hướng; mở **Doanh thu theo tháng → Số liệu**, xem đúng sáu hàng đã tạo biểu đồ; quay lại vẫn là Dịch vụ. Việc mở hàng tổng hợp không được gọi là truy xuống từng hóa đơn: đó là một năng lực khác cần định nghĩa và quyền truy cập riêng.

## Những gì đã có thật trong Undercroft

Đã kiểm tra mã nguồn tại `116a41e6ee19df1b9caba916126d59566b590b03` trên origin/main; các file Reports, Question, Dashboard, People, Tenants, QuestionCard, peopleRouter, tenantsRouter và hợp đồng BI không khác bản kiểm tra ban đầu `7306846` trong phạm vi đối chiếu.

- ADR 0020: Reports là BI của ứng dụng; Metabase đã rời stack. Câu hỏi trực quan/SQL chạy qua worker bằng tenant read-only BI login; admin và member biên tập, viewer đọc câu hỏi đã lưu.
- `packages/contracts/src/bi.ts`: 16 kiểu biểu đồ; layout 12 cột; bộ lọc date_range, text, number; tham số phải được bind, không đoán giá trị còn thiếu.
- `QuestionCard.tsx`: câu hỏi từng ô được truy vấn qua React Query; thiếu tham số hoặc câu hỏi bị xóa được thể hiện tại ô. Link tiêu đề hiện tại mở câu hỏi nhưng không mang bộ lọc dashboard — bản mẫu đề xuất sửa chỗ này.
- `chartData.ts`, `plot.ts`: giữ cả số dùng vẽ và chuỗi gốc dùng đọc; null là khoảng trống. Không dùng float để in tiền.
- `plotPalette.ts`: bảng màu biểu đồ riêng đạt ngưỡng tương phản; màu tab mang ý nghĩa phân hệ. Số series vượt bảy được gộp Other; không in tổng Other tính bằng float như một số kế toán.

Đây là nền tương thích, không phải lời hứa rằng HTML prototype có thể ghép trực tiếp vào React.

## So sánh giải pháp trình diễn

| Giải pháp / nguồn chính thức | Điều nên học | Áp dụng cho Undercroft | Giới hạn cần giữ |
|---|---|---|---|
| [Metabase: dashboard interactivity](https://www.metabase.com/docs/latest/dashboards/interactive) | Phân biệt mở câu hỏi, đi tới đích và thay bộ lọc; có thể mang giá trị sang đích | Link từ dashboard phải giữ đúng tham số đã dùng; thao tác ghi rõ đích | Drill-through của visual query và SQL không giống nhau. Không sao chép hành vi mà chưa có hợp đồng dữ liệu |
| [Metabase: chart guide](https://www.metabase.com/learn/metabase-basics/querying-and-dashboards/visualization/chart-guide?use_case=ea) | Chọn biểu đồ từ cấu trúc dữ liệu và mục đích đọc; một số kiểu cần cấu hình thêm | Bộ chọn ghi “Đường · xu hướng thời gian”, “Thanh · so sánh nhóm” | Gauge không có mục tiêu, map không có vị trí phải bị từ chối, không đoán |
| [Tableau: effective dashboards](https://help.tableau.com/current/pro/desktop/en-us/dashboards_best_practices.htm) | Mục đích/người đọc rõ, ưu tiên vùng đầu trang, ít view và layout theo thiết bị | Mỗi dashboard mẫu trả lời một câu hỏi, có hai biểu đồ chính; điện thoại chuyển thành luồng dọc | Không thu nhỏ nguyên dashboard desktop vào màn hình điện thoại |
| [Power BI: accessibility](https://learn.microsoft.com/en-us/power-bi/create-reports/desktop-accessibility-creating-reports) | Focus view, data table, nhãn, thứ tự bàn phím và mô tả biểu đồ | Mọi biểu đồ có đường sang bảng số liệu; điểm và thanh có tên đọc được; focus mở câu hỏi rộng | Không coi tooltip hover hoặc màu là đường duy nhất để hiểu dữ liệu |
| [Evidence: Markdown](https://docs.evidence.dev/core-concepts/markdown), [components](https://docs.evidence.dev/core-concepts/components) | Văn bản, truy vấn và thành phần dữ liệu cùng tạo nên báo cáo | Tiêu đề trả lời câu hỏi, một câu diễn giải dưới biểu đồ, thứ tự đọc như một trang tài liệu | Chỉ học cấu trúc đọc. Không đưa runtime hoặc warehouse/credential thứ hai vào hệ |
| [Lightdash: interactive dashboards](https://www.lightdash.com/interactive-dashboards) | Cross-filter, drill và bảng underlying data là các hành vi rõ ràng cho người đọc | Xác định roadmap riêng cho drill/cross-filter; trước mắt làm link câu hỏi có ngữ cảnh | Nguồn này là mô tả sản phẩm, không phải kiểm thử thực hành API. Không giả định tính năng có sẵn trong Undercroft |
| [Superset: first dashboard](https://superset.apache.org/user-docs/using-superset/creating-your-first-dashboard/) | Tách quá trình dựng chart khỏi tập hợp chart thành dashboard | Dùng lại câu hỏi đã lưu; editor có thêm/bỏ/sắp xếp câu hỏi | Không nhúng cả Superset: sẽ thêm runtime và bề mặt quản lý quyền |

**Suy luận thiết kế của bản mẫu:** phối hợp cấu trúc đọc kiểu Evidence, điều hướng có tham số kiểu Metabase và đường đọc thay thế kiểu Power BI phù hợp concept “cuốn hồ sơ” hơn một canvas kéo-thả đầy ô KPI. Đây là đánh giá của người thiết kế, không phải kết luận được các hãng chứng nhận.

## Chọn thư viện

| Lựa chọn | Giá trị | Chi phí / quyết định |
|---|---|---|
| Chart.js đang có | Đã đi qua ChartFrame, palette, formatter, kiểu dữ liệu và bundle của repo | **Chọn cho tích hợp.** Bổ sung accessibility ngoài canvas và hành vi điều hướng, không thay engine |
| Apache ECharts | Có cơ chế ARIA và decal; đáng xem khi cần những loại hình mới | Chỉ đánh giá lại khi có yêu cầu mà 16 kiểu hiện tại không đáp ứng. Thay engine cần kiểm thử lại tiền, palette, kích thước, keyboard và lazy loading |
| SVG thuần trong prototype | Portable, không cần CDN/build, point link dùng được bằng bàn phím | Chỉ là phương tiện duyệt. Không đưa renderer này vào production |

[Chart.js accessibility](https://www.chartjs.org/docs/latest/general/accessibility.html) nói rõ canvas không tự cung cấp nội dung cho screen reader; ARIA/fallback cần được thêm. [Chart.js performance](https://www.chartjs.org/docs/latest/general/performance.html) có hướng xử lý dữ liệu lớn như decimation và giảm animation; chỉ áp dụng sau khi đo, không đánh đổi null thành đường nối giả. [ECharts ARIA](https://echarts.apache.org/handbook/en/best-practices/aria/) hỗ trợ mô tả và pattern nhưng không tự thay thế bảng dữ liệu hay kiểm thử accessibility.

## Quy tắc cho 16 kiểu sẵn có

| Nhu cầu | Kiểu ưu tiên | Điều kiện / cách từ chối |
|---|---|---|
| Đọc từng dòng / đối chiếu | table | Có tiêu đề cột, đơn vị, dấu thiếu, xuất đúng kết quả đang lọc |
| Một đại lượng | number | Biết phép tính và phạm vi; không tự cộng các loại tiền |
| So sánh nhóm | bar | Trục 0; nhãn đủ đọc; nhiều nhóm chuyển bảng hoặc phân trang |
| Thay đổi theo thời gian | line, area | Trục thời gian có thứ tự; null ngắt đường; area không dùng cho nhóm không có thứ tự |
| Thành phần trong tổng | pie, doughnut | Ít nhóm không âm, cùng đơn vị và tổng hợp lệ; ưu tiên bar khi cần so chính xác |
| Quan hệ hai / ba đại lượng | scatter, bubble | Trường số và đơn vị rõ; size là đại lượng thứ ba có nghĩa |
| Hồ sơ nhiều chiều | radar | Cùng thang hoặc chuẩn hóa được giải thích; không chọn mặc định |
| Hai cách trình bày chung trục | combo | Trục và đơn vị tách rõ; không làm hai đường khác thang trông như tương quan |
| Các bước chuyển đổi | funnel | Bước có thứ tự và định nghĩa tập được đếm; không gán funnel cho nhóm bất kỳ |
| Tiến độ so mục tiêu | progress, gauge | Có mục tiêu do người dùng/định nghĩa cung cấp; ưu tiên progress tiết kiệm chỗ |
| Tổng hợp hai chiều | pivot | Tổng theo kiểu số chính xác; biểu thị ô thiếu; hỗ trợ cuộn trong vùng bảng |
| Địa lý | map | Có trường vị trí xác thực; không geocode tên tùy ý hoặc dùng bản đồ trang trí |

Bản mẫu thao tác đầy đủ với table, number, bar, line, area; 11 kiểu còn lại được nêu trong catalog. Tích hợp production phải giữ cả 16 kiểu đang có, không cắt xuống 5.

## Hành vi đã làm trong prototype

- Danh mục dashboard và câu hỏi có tìm kiếm; tác giả đi vào editor, viewer chỉ có chế độ đọc.
- Hai mẫu hữu ích: doanh thu theo tháng và công nợ theo tuổi/từng hóa đơn. Mẫu thứ ba thể hiện model chưa dựng.
- Bộ lọc tháng được đổi thành ranh giới ngày đầu/cuối tháng; không cho chọn một phần ngày rồi giả vờ dữ liệu tổng tháng là dữ liệu ngày.
- Click điểm/thanh mở **cùng hàng kết quả tổng hợp**, chưa phải drill-through. Link quay lại và browser Back/Forward giữ bộ lọc.
- Một số tiền thiếu khiến subtotal liên quan hiện thiếu, có lời giải thích; không được trình bày tổng một phần như tổng đầy đủ.
- Editor câu hỏi, đổi loại biểu đồ, preview, save/discard; SQL ngoài mẫu không có kết quả giả. Editor dashboard thêm/bỏ/đổi thứ tự, save/discard và xóa có xác nhận inline.
- In/PDF qua chức năng in của trình duyệt; CSV là các dòng kết quả đang lọc. Đây không phải dịch vụ xuất PDF hoặc lịch gửi báo cáo.

## Cần thêm hợp đồng trước khi triển khai

1. **Drill-through:** mapping từ aggregate sang tập bản ghi, bind tham số, giới hạn kết quả, quyền viewer, SQL ngoài visual builder. Chưa có ⇒ không vẽ affordance giả.
2. **Cross-filter:** định nghĩa field mapping và filter scope từng tile. Cần hiện “áp dụng 2/3 ô” khi có một ô không bind được.
3. **Freshness:** thời điểm query trả kết quả không chứng minh nguồn đã được đọc mới; cần một trường nguồn có chứng cứ nếu muốn SLA badge.
4. **Narrative tùy biến, favorite, thư mục, lịch email:** hiện chưa nằm trong hợp đồng dashboard đang kiểm tra; không tự thêm trường hoặc backend trong đề xuất UI này.
5. **Màu series ổn định:** hiện palette theo rank; map màu theo danh tính qua bộ lọc là thay đổi semantics cần thiết kế, không gắn thêm màu trong CSS.

Ưu tiên đầu tiên: link giữ tham số, chế độ đọc rõ, data table, empty/error per tile, selector có mục đích và quyền member/viewer đúng. Đo khả năng hoàn thành nhiệm vụ trước khi mở rộng chart engine.
