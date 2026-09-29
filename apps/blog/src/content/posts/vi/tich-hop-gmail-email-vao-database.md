---
title: "Tích hợp Gmail: đọc email và file đính kèm bằng SQL"
description: "Tích hợp Gmail để đưa email theo label và file đính kèm vào raw data lake, trích xuất text và truy vấn bằng SQL trong Postgres cho đội kỹ thuật, tài chính."
translationKey: "gmail-integration"
pubDate: "2026-09-29"
tags: ["Gmail", "Integration", "SQL", "ELT"]
keywords:
  [
    "tích hợp Gmail",
    "kết nối Gmail API",
    "trích xuất hóa đơn từ email",
    "lưu email vào database",
    "Gmail SQL",
  ]
hero: "../../../assets/posts/gmail-integration/hero.png"
heroAlt: "Sơ đồ tích hợp Gmail từ label đã chọn qua collector, raw data lake và trích xuất text đến raw.document_text và SQL"
integration: "gmail"
---

Tích hợp Gmail giúp đội tài chính và vận hành gom chứng từ từ email mà vẫn giữ nội dung trao đổi đi kèm. Hóa đơn có thể nằm trong PDF, biên nhận trong ảnh, còn lý do điều chỉnh lại ở phần thân thư. Undercroft đọc email theo label đã chọn, lưu body và file đính kèm được phép vào raw data lake, rồi trích xuất text sang Postgres để truy vấn bằng SQL.

Đây là bước chuẩn bị dữ liệu cho phân tích. Nhóm của bạn vẫn quyết định cách nhận diện chứng từ, kiểm tra thông tin và viết dbt model. [Undercroft là data platform open-source](https://github.com/muitneliss/undercroft), nên đội kỹ thuật có thể xem trực tiếp collector và các giới hạn trong repository.

## Tích hợp Gmail đưa dữ liệu vào Postgres như thế nào?

Luồng chính là Gmail API → collector → raw data lake → trích xuất text → `raw.document_text` → SQL. Message record được đưa vào `raw.records`; `raw.documents` ghi nhận các document đã lưu. Bytes đã thu thập nằm trong lake, còn các bảng Postgres là projection có thể dựng lại.

Gmail dùng first-party collector trong worker thay vì connector YAML. Connector thông thường đọc JSON; email còn có file nhị phân và cần gom kết quả từ nhiều label. Collector xử lý những việc này ngay trong worker, nơi có quyền mở credential đã được niêm phong.

Ingest và trích xuất là hai run riêng. PDF đã lưu thành công vẫn có thể đang chờ đọc text. Bài về [raw data lake bất biến](/raw-data-lake-bat-bien/) giải thích lớp lưu trữ này; bài [ETL và ELT](/etl-va-elt-la-gi/) giải thích vì sao model nghiệp vụ được xây sau khi dữ liệu đã về.

## Email được tách thành những phần nào?

Một message đi theo ba nhánh. Record giữ sáu header `From`, `To`, `Cc`, `Subject`, `Date`, `Message-ID`, cùng ID và thông tin thu thập. Body và `snippet` của Gmail không được đưa vào payload của record.

![Email tách thành header lưu dưới dạng record, body lưu thành một document và các file đính kèm lưu thành những document riêng](../../../assets/posts/gmail-integration/flow.png)

Body là document có ID `<messageId>:body`. Collector ưu tiên phần `text/plain` không có filename; nếu thiếu thì lấy `text/html`. Charset được xử lý khi lưu và body được giữ dưới dạng UTF-8. Phần text có filename vẫn là attachment.

Lựa chọn loại attachment không loại trừ body. Body của message được đọc vẫn đi vào lake, rồi text mới đến `raw.document_text.text`. Body hoặc attachment vượt 25 MiB bị từ chối. Cách lưu này không tạo một file `.eml` nguyên thư chứa thêm bản sao của mọi attachment.

## Cần làm gì để kết nối Gmail API theo label?

Người vận hành cấu hình OAuth client riêng cho ingestion, tách khỏi client đăng nhập. Đăng nhập bằng Google không đồng nghĩa với cho phép thu thập email. [Runbook Google ingestion](https://github.com/muitneliss/undercroft/blob/main/docs/runbook/google-ingestion-setup.md) ghi các biến cấu hình và callback cần thiết.

Sau khi deployment đã sẵn sàng:

1. Admin của tenant mở Gmail trong Sources và chọn **Connect**.
2. Hoàn tất OAuth consent cho mailbox muốn kết nối.
3. Chọn label, loại attachment cần lấy và lưu lựa chọn.
4. Chọn **Run now**, rồi kiểm tra số lượng và lý do từ chối trong Journal.

Nhiều label được hiểu là lấy message thuộc bất kỳ label nào đã chọn. Collector truy vấn từng label rồi gom ID, tránh cách truyền nhiều label vào một request khiến Gmail chỉ trả message có đủ tất cả label. Chưa lưu lựa chọn thì run thất bại, không tự chuyển sang toàn mailbox.

Quyền OAuth là `gmail.readonly`. Giới hạn theo label do collector thực thi, không phải token Google chỉ có quyền đọc vài label. Cần phân biệt phạm vi cấp quyền với phạm vi thực tế thu thập.

## Có thể trích xuất hóa đơn từ email ở định dạng nào?

File đã về lake chưa chắc đã có text. Bytes được giữ nguyên; reader tạo text hoặc ghi rõ lý do không đọc được. [Danh mục file format](https://github.com/muitneliss/undercroft/blob/main/docs/reference/file-formats.md) là nguồn tra cứu đầy đủ.

| Loại file             | Nội dung đọc được và giới hạn                                 |
| --------------------- | ------------------------------------------------------------- |
| PDF                   | Đọc text layer; chuyển sang OCR nếu có dưới 80 ký tự hiển thị |
| JPEG, PNG, WebP       | OCR tiếng Việt và tiếng Anh; ảnh dưới 20 KB bị từ chối        |
| DOCX, DOC được hỗ trợ | Đọc text; file hỏng hoặc có mật khẩu nhận lý do riêng         |
| XLSX, XLSM            | Đọc từng hàng của mọi sheet; không chạy macro                 |
| CSV, TXT, XML         | Giữ text; không tự tách CSV thành các hàng dữ liệu            |
| XLS cũ                | Lưu bytes nhưng ghi `legacy-xls-unsupported`, không đọc cell  |

MIME type được ưu tiên khi xác định loại file. Extension chỉ được xét khi provider trả `application/octet-stream`. ZIP, RAR, HEIC và TIFF không có trong các lựa chọn được cung cấp; chế độ lấy mọi loại file vẫn có thể lưu chúng, nhưng thiếu reader sẽ nhận `unsupported-content-type`.

## Lưu email vào database rồi truy vấn SQL ra sao?

Mỗi kết quả trích xuất ghi `method` cho cách đọc, hoặc `reason` cho lý do không đọc được. `truncated` cho biết text đã bị cắt ở giới hạn của reader. Nhờ vậy, model có thể phân biệt thiếu dữ liệu với document thực sự không chứa thông tin cần tìm.

SQL minh họa dưới đây dùng tên bảng và cột có thật. Chạy bằng dbt login của tenant; BI login không được đọc trực tiếp schema `raw`:

```sql
SELECT source, document_id, method, truncated, left(text, 240) AS excerpt
FROM raw.document_text
WHERE (source = 'gmail' OR source LIKE 'gmail.%')
  AND reason IS NULL
  AND text ILIKE '%hóa đơn%'
LIMIT 20;
```

Kết quả chỉ chứng minh text chứa cụm từ tìm kiếm. Thư nhắc thanh toán hoặc câu trả lời trích lại thư cũ cũng có thể khớp. Đây chưa phải danh sách hóa đơn đã kiểm tra.

Mailbox đầu dùng source `gmail`; các mailbox sau dùng `gmail.<account key>`. Vì vậy, chỉ lọc `source = 'gmail'` sẽ bỏ sót tài khoản khác. Macro dbt `gmail_letters()` có thể gom các bản thư theo `Message-ID` và báo header khác nhau; phần nội dung được trích dẫn trong reply vẫn cần model xử lý.

## Có tự phân loại và tạo bảng hóa đơn không?

Undercroft cung cấp text để bạn xây model, không có sẵn business schema hóa đơn với dòng hàng và trạng thái thanh toán đã xác nhận. Nhóm triển khai phải định nghĩa các trường và cách kiểm tra. Số tiền không đọc được cần để thiếu, không thay bằng 0.

Classification là bước tùy chọn. Khi worker có TypeSafe API key, admin có thể khởi tạo catalogue loại document rồi publish. Bước khởi tạo gửi text mẫu đến TypeSafe Jev; classification sau đó dùng catalogue đã publish. Cần tính đến luồng gửi text này khi quyết định bật tính năng.

View `raw.document_kinds` cung cấp kind và confidence. `accepted_kind` là NULL khi confidence dưới 0.90 hoặc kết quả thuộc catalogue đã bị thay thế. Nhãn invoice không xác nhận số tiền hay phê duyệt giao dịch. Nếu cần dữ liệu kế toán có cấu trúc bên cạnh email, xem [tích hợp Xero vào Postgres](/tich-hop-xero-postgres/).

## Quyền riêng tư và các lần sync sau được xử lý thế nào?

Metadata trong `raw.documents` chỉ giữ ID, type, timestamp và count. Filename cùng thông tin mô tả do người viết nằm trong lake manifest có kiểm soát truy cập. Text là ngoại lệ được phép chứa nội dung document; BI không có quyền đọc schema `raw`, nên dữ liệu chỉ đến dashboard qua model khách hàng viết.

Run thông thường bỏ qua message đã giữ. Khi thêm loại attachment, collector chỉ đọc lại message trong các label đã chọn có phần còn thiếu vừa được cho phép. Bỏ loại file không xóa dữ liệu đã lưu. Connection có trước tính năng body sẽ đọc lại thư một lần để lấy body, không tải lại attachment đã có.

Trích xuất có kiểm tra backlog mỗi giờ và chạy riêng với sync. Khi report thiếu chứng từ, hãy kiểm tra cả Journal lẫn kết quả trích xuất trước khi sửa model: file chưa về, file chưa đọc và file không đọc được là ba tình huống khác nhau.

## Câu hỏi thường gặp

### Tích hợp Gmail có lấy toàn bộ inbox không?

Collector lấy hợp của các label đã chọn và từ chối khi chưa có lựa chọn. Quyền `gmail.readonly` rộng hơn phạm vi đó; label là giới hạn thu thập của ứng dụng.

### Có lưu body khi không lấy loại attachment đó không?

Có, body được thu thập độc lập với lựa chọn attachment. Nó là document trong lake và trở thành text sau trích xuất, không nằm trong message record.

### Có OCR hóa đơn scan và ảnh biên nhận không?

Có, PDF thiếu text layer và các ảnh được hỗ trợ có thể được đọc bằng OCR tiếng Việt và tiếng Anh. File có mật khẩu, ảnh quá nhỏ hoặc OCR thất bại nhận lý do rõ ràng.

### Sync thành công nghĩa là SQL đã đọc được mọi chứng từ chưa?

Chưa, vì trích xuất chạy riêng và có thể còn document đang chờ hoặc bị từ chối. Kiểm tra `method`, `reason` và `truncated` trước khi dùng dữ liệu trong model.
