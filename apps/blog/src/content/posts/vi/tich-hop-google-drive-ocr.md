---
title: "Tích hợp Google Drive: OCR tiếng Việt và tìm kiếm tài liệu"
description: "Tích hợp Google Drive để đưa file vào raw data lake, OCR tiếng Việt cho PDF scan và ảnh, phân loại tài liệu và tìm kiếm nội dung trên toàn lake."
translationKey: "google-drive-integration"
pubDate: "2026-09-29"
tags: ["Google Drive", "Integration", "OCR", "Search"]
keywords:
  [
    "tích hợp Google Drive",
    "Google Drive OCR tiếng Việt",
    "tìm kiếm tài liệu",
    "số hóa chứng từ",
    "google drive api",
    "unstructured data",
  ]
hero: "../../../assets/posts/google-drive-integration/hero.png"
heroAlt: "Sơ đồ tích hợp Google Drive từ folder được chọn qua collector, raw data lake, OCR tiếng Việt, phân loại tài liệu đến tìm kiếm"
integration: "google-drive"
---

Tích hợp Google Drive giúp đội kỹ thuật và finance/ops tìm lại nội dung trong những file đã lưu: một điều khoản hợp đồng, mã tham chiếu trên PDF scan, hay đoạn văn trong ảnh chụp tài liệu. Undercroft đưa file từ các folder được chọn vào raw data lake bất biến, trích xuất nội dung và hỗ trợ tìm kiếm cùng raw data từ những nguồn khác. PDF scan và ảnh có thể được đọc bằng OCR tiếng Việt và tiếng Anh.

Với số hóa chứng từ, cần phân biệt ba việc: giữ được file, đọc được chữ và xác định loại tài liệu. Undercroft tách chúng thành các bước riêng. Một file đã vào lake chưa chắc có nội dung tìm kiếm được; một tài liệu đọc được cũng chưa chắc đã được phân loại.

## Tích hợp Google Drive đưa file vào raw data lake thế nào?

Admin chọn folder hoặc file, định dạng được phép và có đọc cả subfolder hay không. Collector trong worker dùng Google Drive API để đọc phạm vi đó, rồi đưa bytes qua đường ghi chung của lake.

Drive dùng collector do nền tảng triển khai, không dùng YAML connector. Connector dạng khai báo đọc JSON qua REST API, còn PDF và ảnh cần giữ nguyên bytes. Google Docs cũng cần export trước khi có nội dung để lưu.

Raw data lake giữ bytes đã thu nhận. Postgres chứa danh mục tài liệu và nội dung đọc được trong `raw.document_text`; các bảng này có thể dựng lại từ lake. Tên file và folder nằm trong manifest của lake có kiểm soát truy cập, không trở thành cột tên trong danh mục tài liệu.

Việc tách lưu trữ và xử lý giúp đội vận hành biết file còn nguyên dù OCR chưa thành công. Bài về [raw data lake bất biến](/raw-data-lake-bat-bien/) giải thích vai trò của lớp lưu trữ này; bài về [data integration và REST API](/data-integration-la-gi-rest-api/) đặt nguồn tài liệu cạnh các nguồn dữ liệu có cấu trúc.

## Cần cấu hình gì để chỉ sync các folder đã chọn?

Người vận hành cấu hình OAuth cho deployment; admin của tenant kết nối tài khoản và chọn nội dung cần sync. [Runbook Google ingestion](https://github.com/muitneliss/undercroft/blob/main/docs/runbook/google-ingestion-setup.md) ghi đầy đủ callback, browser origin và các biến cấu hình.

1. Tạo OAuth client cho ingestion, tách khỏi client dùng đăng nhập Google. Bật các API cần thiết và khai báo callback, origin.
2. Cấu hình thông tin ingestion và Google Picker. Client secret không được đưa xuống browser; worker lưu credential đã mã hóa và refresh quyền truy cập.
3. Kết nối tài khoản Drive bằng quyền admin. Chọn folder hoặc file, loại file và lựa chọn đọc subfolder.
4. Chạy **Run now**, rồi xem số lượng và lý do từ chối trong Journal.

Quyền ingestion là `drive.readonly`, rộng hơn các folder đã chọn. Collector chịu trách nhiệm giới hạn phạm vi đọc theo lựa chọn đã lưu. `drive.file` của Picker trong browser là quyền riêng, không thay thế quyền đọc nội dung có sẵn trong folder.

Nếu không bật đọc đệ quy, collector chỉ lấy file trực tiếp trong folder. Nếu bật, nó đi xuống các subfolder. Một tenant có thể kết nối nhiều tài khoản Drive, mỗi tài khoản có phạm vi, lịch sync và lịch sử chạy riêng.

## Những loại file nào đọc được nội dung để tìm kiếm?

Khả năng lưu file khác khả năng đọc file. Mỗi file đã land giữ nguyên bytes; mức hỗ trợ của reader quyết định phần nào thành nội dung tìm kiếm. [Danh sách định dạng trong repo](https://github.com/muitneliss/undercroft/blob/main/docs/reference/file-formats.md) ghi rõ từng trường hợp.

| Định dạng                                  | Nội dung được đọc                                                            |
| ------------------------------------------ | ---------------------------------------------------------------------------- |
| PDF                                        | Đọc text layer; chuyển sang OCR nếu toàn bộ layer có dưới 80 ký tự nhìn thấy |
| JPEG, PNG, WebP                            | OCR tiếng Việt và tiếng Anh, có giới hạn xử lý                               |
| DOCX, DOC được hỗ trợ                      | Nội dung văn bản và các vùng bổ sung reader hỗ trợ                           |
| Google Docs                                | Export thành DOCX rồi đọc                                                    |
| XLSX, XLSM                                 | Các dòng của mọi sheet; không chạy macro                                     |
| Google Sheets                              | Export thành XLSX rồi đọc workbook                                           |
| Google Slides                              | Export và lưu plain text                                                     |
| TXT, CSV, Markdown, XML, JSON thông thường | Đọc text; CSV chưa được chuyển thành các dòng nghiệp vụ                      |
| XLS cũ                                     | Lưu bytes và ghi lý do chưa hỗ trợ reader                                    |

HTML, MHTML và EML cũng có reader. Attachment bên trong file EML không được reader đó đọc. ZIP, RAR, HEIC và TIFF không nằm trong danh sách định dạng được hỗ trợ; chọn mọi loại file vẫn có thể lưu chúng, nhưng việc đọc sẽ có lý do từ chối.

Hệ thống nhận dạng bằng MIME type trước. Extension chỉ được xét khi nguồn trả `application/octet-stream` và admin đã chọn extension đó. Một dấu chấm trong tên hợp đồng vì vậy không đủ để quyết định định dạng.

## Google Drive OCR tiếng Việt xử lý PDF scan ra sao?

Trong Undercroft, Google Drive OCR tiếng Việt diễn ra ở worker sau khi file được đưa vào lake. Tesseract dùng cả hai language pack tiếng Việt và tiếng Anh để đọc ảnh. Với PDF, `pdftotext` đọc text layer trước; nếu toàn bộ layer có dưới 80 ký tự nhìn thấy, các trang được chuyển thành ảnh để OCR.

Đây là điều kiện trên toàn PDF, không phải cam kết OCR mọi ảnh trong PDF đã có nhiều text. Kết quả ghi phương pháp đọc, chẳng hạn `pdf_ocr`, hoặc lý do không đọc được. Extraction có lượt chạy riêng nên lỗi OCR không đồng nghĩa với mất file đã thu nhận.

![Trang hợp đồng scan đi qua OCR tiếng Việt và tiếng Anh, thành nội dung trích xuất rồi xuất hiện trong kết quả tìm kiếm](../../../assets/posts/google-drive-integration/flow.png)

Ảnh dưới 20 KB bị từ chối với `image-too-small-to-read`. Các lý do khác gồm không tìm thấy chữ, hết thời gian OCR hoặc thiếu công cụ đọc. PDF có mật khẩu mở file vẫn được giữ nguyên bytes nhưng cần bản đã mở khóa để đọc.

ADR về Vietnamese OCR xác nhận việc đọc dấu tiếng Việt trên một mẫu tài liệu nhỏ, đồng thời nói rõ không thể dùng mẫu đó làm tỷ lệ chính xác chung. Với chứng từ, hãy đối chiếu mã, ngày và số tiền trên các bản scan đại diện trước khi đưa text vào model nghiệp vụ.

## Tài liệu được phân loại thành invoice hay contract thế nào?

Classification đọc text và chọn một kind trong danh mục riêng của tenant. Provider hiện tại là TypeSafe Jev. Admin có thể khởi tạo danh mục từ mẫu tài liệu, sau đó thêm, sửa hoặc bỏ kind. `other` luôn được giữ để tài liệu không bị ép vào một nhãn cụ thể.

Các chỉnh sửa là bản nháp cho tới khi publish. Một danh mục thay đổi được publish sẽ dẫn tới phân loại lại theo phiên bản mới. Worker cần `UNDERCROFT_TYPESAFE_API_KEY`; chưa có danh mục đã publish thì chưa có công việc classification đến hạn. Khởi tạo danh mục cũng là thao tác admin chủ động gửi nội dung mẫu tới provider.

Kết quả giữ kind, confidence và phiên bản danh mục. Trong view `raw.document_kinds`, `accepted_kind` là NULL nếu confidence dưới 0.90 hoặc kết quả thuộc danh mục đã bị thay thế. Text quá ngắn và lỗi provider có trạng thái riêng.

Các thao tác quản lý danh mục có qua router, CLI và MCP; ADR đưa tính năng vào chưa bao gồm màn hình quản lý riêng. Kind giúp tổ chức unstructured data, nhưng nhãn invoice chưa tạo ra bảng chi tiết hóa đơn hay chứng minh số tiền đúng. Phần đó thuộc dbt model do đội của bạn định nghĩa.

## Có thể tìm kiếm tài liệu trên toàn lake mà không viết SQL không?

Có. Phần Lake có ô full-text search dành cho admin, tìm trên giá trị của raw records và text đã trích xuất. Search hoạt động độc lập với classification, nên không cần chờ tài liệu có kind mới tìm được nội dung.

Tìm kiếm tiếng Việt không phân biệt dấu: `hop dong` có thể khớp `hợp đồng`, còn đoạn trích vẫn giữ dấu gốc. Tiếng Anh có stemming, chẳng hạn `contract` khớp `contracts`. Đây là full-text search; không nên hiểu thành khả năng tự sửa lỗi OCR hay trả lời mọi câu hỏi theo ngữ nghĩa.

Mỗi giá trị chỉ được index trong 200.000 ký tự đầu. File chưa đọc được không có text để khớp, nên không tìm thấy chưa chứng minh tài liệu gốc thiếu cụm từ đó. Truy vấn đi qua worker bằng dbt login của tenant; BI không được đọc trực tiếp schema `raw`.

SQL minh họa dưới đây dùng bảng có thật, dành cho dbt connection được cấp quyền của tenant, để tổng hợp phương pháp đọc và lý do từ chối:

```sql
SELECT method, reason, count(*) AS documents
FROM raw.document_text
GROUP BY method, reason;
```

Hãy xem kết quả cùng Journal của ingestion để phân biệt thiếu file với thiếu text. Nếu chứng từ còn đến qua email, bài [tích hợp Gmail vào database](/tich-hop-gmail-email-vao-database/) mô tả đường thu nhận còn lại. Mã nguồn và các giới hạn được ghi trong [repo open-source Undercroft](https://github.com/muitneliss/undercroft).

## Câu hỏi thường gặp

### Tích hợp Google Drive có đọc toàn bộ tài khoản không?

Collector đọc phạm vi file, folder, định dạng và độ sâu đã lưu. OAuth grant rộng hơn phạm vi này, nên giới hạn được thực thi trong collector.

### OCR có đọc được PDF scan tiếng Việt không?

Có, worker dùng Tesseract với language pack tiếng Việt và tiếng Anh khi PDF đáp ứng điều kiện chuyển sang OCR. Chất lượng phụ thuộc bản scan và cần kiểm tra trên tài liệu đại diện.

### Chưa bật classification thì có tìm kiếm được không?

Có, full-text search dùng text đã trích xuất độc lập với kind. Classification cần cấu hình provider và danh mục do admin publish.

### Số hóa chứng từ có tự tạo schema kế toán không?

Không, extraction tạo text còn classification trả kind cùng confidence. Đội của bạn viết dbt model để định nghĩa schema nghiệp vụ và dữ liệu đưa lên report.
