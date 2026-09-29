---
title: "Tích hợp Xero: đồng bộ dữ liệu vào Postgres với dbt"
description: "Tích hợp Xero qua OAuth và YAML connector, lưu raw data vào data lake bất biến rồi Postgres. Tìm hiểu incremental sync, full re-sync và model với dbt."
translationKey: "xero-integration"
pubDate: "2026-09-29"
tags: ["Xero", "Integration", "ELT", "Postgres"]
keywords:
  ["tích hợp Xero", "kết nối Xero API", "xuất dữ liệu Xero", "đồng bộ Xero", "Xero Việt Nam"]
hero: "../../../assets/posts/xero-integration/hero.png"
heroAlt: "Sơ đồ tích hợp Xero qua OAuth và YAML connector vào raw data lake, Postgres, dbt rồi report"
integration: "xero"
---

Tích hợp Xero giúp đội kỹ thuật đưa dữ liệu kế toán vào Postgres để đội finance/ops có thể dùng chung một nguồn cho SQL và report. Với Undercroft, dữ liệu đi qua Xero API, được lưu vào raw data lake bất biến trên S3/MinIO, rồi mới đưa vào Postgres. Các dbt model do bạn viết quyết định cách dữ liệu xuất hiện trên dashboard.

Điểm cần làm rõ ngay từ đầu là phạm vi dữ liệu và độ mới của từng lần sync. Một lần chạy thành công chưa chắc đã đọc đủ mọi entity. Bài viết này giải thích connector hiện có, cách kết nối và những giới hạn cần hiểu trước khi dùng dữ liệu cho report. [Undercroft là nền tảng open-source](https://github.com/muitneliss/undercroft) theo MIT license; README hiện ghi trạng thái pre-alpha.

## Tích hợp Xero vào Postgres hoạt động như thế nào?

Luồng chính gồm Xero API → YAML connector → raw data lake → `raw.records` trong Postgres → dbt → report. OAuth cấp quyền đọc organisation đã chọn. Worker thực hiện các request theo cấu hình trong `specs/connectors/xero.yaml`.

Raw data được lưu trước khi đưa vào Postgres. Data lake dùng cơ chế create-only và nhận diện nội dung bằng hash. Nếu nội dung giống phiên bản mới nhất, kết quả là `unchanged`; nếu khác, hệ thống tạo phiên bản mới. Phiên bản đã lưu không bị ghi đè tại chỗ.

Trong Postgres, `raw.records` giữ trạng thái quan sát mới nhất của mỗi record, kèm JSONB payload và các định danh nguồn. Vì vậy, truy vấn bảng này không có nghĩa là đang đọc toàn bộ lịch sử phiên bản. Data lake giữ dữ liệu đã thu thập; Postgres là projection có thể dựng lại.

Khi đổi cách tính một chỉ tiêu, đội kỹ thuật có thể sửa model dựa trên dữ liệu đã lưu. Bài về [raw data lake bất biến](/raw-data-lake-bat-bien/) giải thích kỹ hơn vai trò này; bài [ETL và ELT](/etl-va-elt-la-gi/) đặt luồng xử lý trong bối cảnh data integration.

## Connector đọc được những dữ liệu nào từ Xero API?

Spec hiện khai báo 20 entity list. Danh sách thực sự được đọc còn phụ thuộc vào lựa chọn của admin và scope trong OAuth grant.

| Scope                              | Dữ liệu connector khai báo                                                               |
| ---------------------------------- | ---------------------------------------------------------------------------------------- |
| `accounting.invoices.read`         | Invoices, credit notes, quotes, purchase orders, repeating invoices, linked transactions |
| `accounting.payments.read`         | Payments, overpayments, prepayments, batch payments                                      |
| `accounting.contacts.read`         | Contacts, contact groups                                                                 |
| `accounting.settings.read`         | Items, accounts, tracking categories, tax rates, currencies                              |
| `accounting.banktransactions.read` | Bank transactions, bank transfers                                                        |
| `accounting.manualjournals.read`   | Manual journals                                                                          |

Phần journals ở đây là `/ManualJournals`. Connector chưa khai báo endpoint `/Journals` chứa system journal. Khi lên yêu cầu xuất dữ liệu Xero, cần ghi đúng phạm vi này để tránh hiểu rằng mọi journal entry đều đã có.

Mỗi entity có định danh riêng, chẳng hạn `InvoiceID` hoặc `ContactID`. Các list hỗ trợ `pageSize` được cấu hình ở mức 500; những endpoint không hỗ trợ pagination được đọc theo cách riêng. Bank transfers có `includeDeleted: "true"`, còn tracking categories có `includeArchived: "true"`.

Với endpoint hỗ trợ, spec gửi `unitdp: "4"` để yêu cầu unit amount có bốn chữ số thập phân. Tham số này không áp dụng đồng loạt cho mọi list. Bạn có thể kiểm tra trực tiếp [Xero connector spec](https://github.com/muitneliss/undercroft/blob/main/specs/connectors/xero.yaml) trước khi xác định dữ liệu đầu vào cho model.

## Cần chuẩn bị gì để kết nối Xero API?

Người vận hành cấu hình ứng dụng trước, sau đó admin của tenant thực hiện OAuth. Quy trình chi tiết nằm trong [Xero setup runbook](https://github.com/muitneliss/undercroft/blob/main/docs/runbook/xero-setup.md).

1. Tạo Xero OAuth web app, đăng ký callback chính xác tại `<UNDERCROFT_PUBLIC_URL>/oauth/xero/callback`.
2. Cấu hình `UNDERCROFT_XERO_CLIENT_ID` và `UNDERCROFT_XERO_CLIENT_SECRET` trên cả control plane lẫn worker. `UNDERCROFT_PUBLIC_URL` phải là origin người dùng mở trên trình duyệt.
3. Trong Sources, admin chọn **Connect Xero**, chấp thuận quyền truy cập, chọn organisation và các entity cần đọc.
4. Chạy **Run now**, rồi kiểm tra số lượng và cảnh báo theo entity trong Journal.

Organisation ID của Xero được gửi qua header `xero-tenant-id`; nó khác tenant ID của Undercroft. Một tài khoản có thể thấy nhiều organisation, nên bước chọn đúng organisation rất quan trọng.

Worker mã hóa credential và xử lý refresh token dưới row lock để tránh hai lần refresh đồng thời. Nếu grant thiếu scope của một list, list đó không được request và Journal nêu rõ lý do; các list còn quyền vẫn tiếp tục. Admin cần reconnect để bổ sung quyền mới.

## Incremental sync dùng watermark ra sao?

Lần đầu chưa có watermark phù hợp, worker đọc toàn bộ list trong giới hạn request budget. Các lần incremental sync sau gửi `If-Modified-Since` để Xero lọc phía server.

Đây là phần cấu hình có thật của invoices trong spec, không phải một connector hoàn chỉnh:

```yaml
incremental:
  strategy: header
  header: If-Modified-Since
  sourcePath: UpdatedDateUTC
  format: ms-json-date
  send: rfc3339-seconds
```

Watermark lưu nguyên văn giá trị `UpdatedDateUTC`. Khi gửi header, runtime chuyển thời điểm đó sang UTC RFC 3339 và làm tròn xuống giây. Cách này có thể đọc lại một ít record; nội dung không đổi vẫn được ghi nhận là `unchanged`.

Watermark chỉ tiến lên sau khi đọc xong entity. Nếu lấy timestamp lớn nhất từ một bảng mới nạp được nửa chừng, các record cũ hơn ở trang sau có thể bị bỏ qua. Cursor dùng cho việc đưa dữ liệu từ data lake vào Postgres được quản lý riêng.

Watermark cũng gắn với request đã dùng. Khi cấu hình request thay đổi, watermark cũ không còn khớp và list được đọc lại toàn bộ. Các entity không khai báo incremental sync vốn được đọc toàn bộ trong mỗi lần chạy.

![Sơ đồ so sánh incremental sync gửi watermark qua If-Modified-Since với full re-read theo lịch tùy chọn, giữ phiên bản mới khi nội dung thay đổi](../../../assets/posts/xero-integration/flow.png)

## Vì sao đồng bộ Xero vẫn cần full re-sync?

Một số chỉnh sửa không làm `UpdatedDateUTC` thay đổi. Tài liệu trong repo nêu các trường hợp như sửa due date hoặc cờ đã gửi trên giao dịch thanh toán một phần, các trường `Balances`, `IsSupplier`, `IsCustomer` của contact và `AccountCode` trên một dòng dữ liệu. Incremental sync có thể không nhìn thấy những chỉnh sửa này.

Undercroft có lịch **Full re-sync** riêng cho từng connection, nhưng **mặc định đang tắt**. Admin bật trên source card khi cần đọc lại toàn bộ. Full re-sync chỉ diễn ra trong một lần sync; nếu sync đang paused, lịch re-sync không tự tạo một lần chạy khác.

Khi đọc toàn bộ, list không gửi watermark. Record không đổi vẫn là unchanged; nội dung thay đổi tạo phiên bản mới. Độ mới còn phụ thuộc lịch chạy và request budget, nên không nên mặc định dữ liệu luôn được làm mới đầy đủ mỗi ngày.

Spec hiện cấu hình 1.000 request mỗi ngày, dành 800 cho whole read và giữ 200 cho các lần đọc thay đổi. Khoảng cách tối thiểu giữa request là 1.100 ms. Khi hết whole-read budget, list có thể chuyển sang incremental sync hoặc chờ nếu chưa có watermark; Journal ghi nhận phần bị hoãn dù run vẫn có thể thành công.

Với đội Xero Việt Nam, một chi tiết dễ nhầm là custom cron được tính theo Asia/Singapore, không phải giờ Việt Nam. Cần kiểm tra múi giờ khi đặt lịch phục vụ công việc cuối ngày. Whole read bị ngắt vì budget sẽ bắt đầu lại list từ đầu ở lần chạy sau, không tiếp tục từ số trang cũ.

## Dùng dbt để xây dựng report từ raw data thế nào?

Undercroft không cung cấp sẵn business schema cho invoice hay customer. Connector đưa dữ liệu vào; đội của bạn viết dbt model để xác định invoice grain, trạng thái được tính, cách gắn payment và ý nghĩa của account code.

Ví dụ, một report theo dõi khoản còn phải thu cần xác định ngày đến hạn và currency ở cấp invoice. Runbook khuyến nghị tính outstanding và overdue từ invoices thay vì xem `Balances` trên contact là câu trả lời tương đương. Giá trị thiếu phải được giữ là thiếu; tự thay bằng zero sẽ làm report có vẻ đầy đủ hơn dữ liệu thực tế.

Worker chạy dbt để tạo các bảng trong analytics schema của tenant. Report đọc các model đã build bằng BI login chỉ có quyền đọc. BI role không được đọc trực tiếp `raw`, nên model là nơi đội kỹ thuật và finance/ops thống nhất định nghĩa trước khi đưa lên dashboard.

Trước khi đối chiếu tổng, hãy kiểm tra entity đã chọn, scope còn thiếu và bằng chứng lần đọc toàn bộ gần nhất. SQL không sửa được một nguồn chưa được đọc. Phần [report Xero với SQL và dbt](/bao-cao-xero-sql-dbt/) tiếp tục từ bước thiết kế model này.

## Câu hỏi thường gặp

### Tích hợp Xero có cần tự viết connector không?

Undercroft đã có YAML connector cho Xero và runtime thực thi spec đó. Bạn cấu hình OAuth, chọn organisation, entity rồi tự viết dbt model cho nhu cầu report.

### Xuất dữ liệu Xero có bao gồm toàn bộ journals không?

Connector có manual journals khi lựa chọn và quyền truy cập cho phép. Endpoint `/Journals` riêng chưa được khai báo, nên không thể coi đó là toàn bộ general ledger.

### Đồng bộ Xero có cập nhật ngay mọi thay đổi không?

Đây là các lần đọc API theo lịch hoặc do người dùng kích hoạt. Thay đổi mà incremental filter bỏ sót cần whole read; lịch full re-sync mặc định tắt.

### Run thành công đã đủ để dùng số liệu chưa?

Bạn vẫn cần xem Journal vì một số list có thể thiếu scope hoặc đang chờ request budget. Hãy kiểm tra cả phạm vi dữ liệu lẫn lần full read trước khi xác nhận report đã được cập nhật.
