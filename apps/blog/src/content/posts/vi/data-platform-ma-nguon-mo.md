---
title: "Undercroft: data platform mã nguồn mở cho self-hosted ELT"
description: "Tìm hiểu Undercroft, data platform mã nguồn mở theo giấy phép MIT: ingestion, raw data lake, dbt và BI trong một stack; so sánh với Fivetran và Airbyte."
translationKey: "open-source-data-platform"
pubDate: "2026-09-29"
tags: ["Open Source", "ELT", "Data Platform", "BI"]
keywords:
  [
    "data platform mã nguồn mở",
    "thay thế Fivetran",
    "thay thế Airbyte",
    "self-hosted ELT",
    "open source ELT",
  ]
hero: "../../../assets/posts/open-source-data-platform/hero.png"
heroAlt: "Sơ đồ data platform mã nguồn mở trên server của bạn: API đi qua connector, raw data lake, Postgres, dbt và report"
---

Một data platform mã nguồn mở cần giúp cả kỹ sư lẫn đội finance/ops trả lời được: dữ liệu lấy từ đâu, được giữ ở đâu và đi qua những phép tính nào trước khi lên dashboard. Undercroft gom ingestion, raw data lake, Postgres, dbt và BI vào một stack self-hosted, với code được phát hành theo giấy phép MIT.

Đây là một hướng để cân nhắc khi tìm giải pháp thay thế Fivetran hoặc thay thế Airbyte. Tuy nhiên, [repository Undercroft](https://github.com/muitneliss/undercroft) ghi rõ trạng thái **pre-alpha**, chưa có gì ổn định. Nên đánh giá bằng nguồn dữ liệu và report cụ thể trước khi giao một quy trình quan trọng cho hệ thống.

## Data platform mã nguồn mở Undercroft giải quyết phần việc nào?

Undercroft nối cả chuỗi từ việc lấy dữ liệu đến lúc đọc report. Connector đọc nguồn, raw data lake giữ đầu vào, Postgres phục vụ truy vấn, dbt xây các bảng phân tích và khu vực Reports hiển thị câu hỏi đã lưu cùng dashboard.

Repository có connector YAML cho Xero và HubSpot. Gmail và Google Drive dùng collector riêng vì lấy nội dung file cần xử lý bytes. Dữ liệu từ script cũng có thể đi qua lake write API và dùng chung đường ghi create-only.

Phần còn lại thuộc về đội sử dụng: định nghĩa chỉ tiêu và viết model. Undercroft không có sẵn business schema để quyết định thay bạn thế nào là khách hàng hay doanh thu.

![Sơ đồ so sánh các công cụ ingestion, storage, dbt và BI riêng biệt với connector, raw data lake, Postgres, dbt và report trong một Undercroft stack](../../../assets/posts/open-source-data-platform/flow.png)

Hình minh hoạ hai cách tổ chức stack, không khẳng định các công cụ riêng lẻ thiếu khả năng tích hợp.

## Raw data được giữ ở đâu trước khi lên dashboard?

Theo [tài liệu kiến trúc](https://github.com/muitneliss/undercroft/blob/main/docs/architecture.md), worker ghi dữ liệu vào raw data lake trên S3 hoặc MinIO trước. Stack server trong repository dùng MinIO. Với record, Postgres giữ bản projection trong bảng chung `raw.records`; document có phần lưu danh mục và extracted text riêng.

Đường ghi lake là create-only và content-addressed. Nội dung giống nhau được deduplicate; nội dung thay đổi tạo version manifest mới thay vì ghi đè bản trước. Khi sửa SQL, đội kỹ thuật có thể dùng raw data còn giữ để xây lại các bảng phân tích.

Điều này không khôi phục được dữ liệu chưa từng lấy từ nguồn. Nó cũng không thay thế kế hoạch bảo vệ storage: runbook ghi rõ raw data lake chưa nằm trong backup set. Người vận hành vẫn phải tính đến độ bền, replication và phục hồi. Bài [raw data lake bất biến](/raw-data-lake-bat-bien/) giải thích kỹ hơn ranh giới này.

## Self-hosted ELT đi từ nguồn đến report như thế nào?

Luồng chính gồm năm bước:

1. Connector đọc API bằng quyền đã được cấp.
2. Worker ghi record hoặc document vào raw data lake.
3. Dữ liệu được đưa vào các projection trong Postgres.
4. dbt chạy model của tenant để tạo bảng phân tích.
5. Reports truy vấn bằng BI login chỉ đọc của tenant đó.

Với đội finance/ops, lợi ích là tách được đầu vào khỏi cách tính. Khi đổi quy tắc phân nhóm, kỹ sư sửa model trên dữ liệu đã giữ. Cả hai đội vẫn phải thống nhất ngày nào dùng cho kỳ report, trạng thái nào được tính và xử lý giá trị thiếu ra sao.

Ví dụ, một số tiền không đọc được phải khác số tiền bằng không. Nguyên tắc của Undercroft là giữ trạng thái thiếu thay vì tự đoán. Raw data là căn cứ để kiểm tra, không tự trở thành kết luận nghiệp vụ.

## Undercroft khác Fivetran và Airbyte ở những điểm nào?

Trong bài toán ELT, Fivetran và Airbyte tập trung vào data movement giữa nguồn và destination. Undercroft cung cấp thêm raw data lake, môi trường dbt trên Postgres và BI trong cùng sản phẩm. Bảng dưới so sánh phạm vi đó, không bao quát mọi sản phẩm khác của hai hãng.

| Tiêu chí        | Undercroft                                                         | Fivetran                                          | Airbyte                                                                                 |
| --------------- | ------------------------------------------------------------------ | ------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Triển khai      | Self-hosted                                                        | SaaS; có hybrid processing                        | Self-managed và managed                                                                 |
| Giấy phép       | MIT cho repository Undercroft                                      | Dịch vụ thương mại                                | Core và connector dùng ELv2; Protocol dùng MIT; sản phẩm thương mại có điều khoản riêng |
| Nơi giữ dữ liệu | Raw data lake trên S3/MinIO đã cấu hình; projection trong Postgres | Destination do bạn chọn; nơi xử lý tuỳ deployment | Destination do bạn chọn; nơi chạy tuỳ deployment                                        |
| Phạm vi so sánh | Ingestion, raw data lake, dbt, BI                                  | Data movement và khả năng transformation          | Replication từ nguồn đến destination                                                    |
| Connector       | Xero, HubSpot; collector Gmail, Drive                              | Hàng trăm connector                               | Hàng trăm connector                                                                     |

Không nên gọi Fivetran là dịch vụ chỉ chạy trong cloud của hãng: [tài liệu deployment](https://fivetran.com/docs/deployment-models) có cả hybrid processing trong mạng của khách hàng. Fivetran cũng có [dbt và transformation orchestration](https://fivetran.com/docs/transformations). Khác biệt ở cách ghép và vận hành toàn bộ stack.

Airbyte có [lựa chọn self-hosted và managed](https://airbyte.com/why-open-source). [Danh mục giấy phép](https://github.com/airbytehq/airbyte/blob/master/docs/community/licenses/README.md) phân biệt ELv2, MIT và sản phẩm thương mại; không nên hiểu toàn bộ Airbyte có cùng giấy phép MIT như Undercroft.

## Khi nào nên chọn Fivetran hoặc Airbyte?

Hai sản phẩm có lợi thế rõ về độ rộng connector. Fivetran mô tả khả năng kết nối [hàng trăm nguồn](https://www.fivetran.com/data-movement/hybrid-deployment); Airbyte cũng có catalogue hàng trăm connector. Nếu nguồn bắt buộc đã được hỗ trợ, đội kỹ thuật có thể tránh được nhiều công việc tự viết và bảo trì connector.

Fivetran phù hợp để cân nhắc khi muốn nhà cung cấp vận hành ingestion. Airbyte đáng xem khi ưu tiên self-managed replication và hệ sinh thái connector rộng. Nếu doanh nghiệp đã có data warehouse, dbt và BI phù hợp, chỉ bổ sung ingestion có thể hợp lý hơn thay cả stack.

Undercroft đáng thử khi nguồn hiện có đáp ứng nhu cầu và đội muốn quản lý raw data, model, report trong cùng hệ thống. Connector còn thiếu vẫn là công việc thật: phải kiểm tra auth, pagination, quyền đọc và cách API biểu diễn thay đổi.

## Có thể thêm REST API bằng YAML không?

Có, nếu API phù hợp với connector contract. Đoạn dưới lấy từ `specs/connectors/hubspot.yaml`, thể hiện nguồn và cách lấy bearer token từ connection; đây chỉ là trích đoạn, chưa phải connector hoàn chỉnh:

```yaml
apiVersion: "undercroft.dev/v1"
kind: "Connector"
id: "hubspot"
displayName: "HubSpot CRM"
baseUrl: "https://api.hubapi.com"
auth:
  kind: "bearer"
  token: { from: "connection" }
  grantRefusal: "hubspot-missing-scopes"
```

Các phần khác khai báo entity, pagination và quy tắc đọc. Bảng raw chung giúp thêm nguồn REST mà không cần migration tạo business schema. Để nguồn xuất hiện trong sản phẩm, vẫn cần đóng gói spec, bổ sung nguồn được hỗ trợ và phát hành phiên bản.

Bài [data integration với REST API và YAML](/data-integration-la-gi-rest-api/) giải thích chi tiết. YAML giảm phần code lặp lại, không đồng nghĩa mọi API đều được hỗ trợ ngay.

## dbt và BI phân chia quyền giữa các tenant ra sao?

Mỗi tenant có dbt login và schema phân tích riêng. Row-level security giới hạn việc đọc raw data theo login. Reports dùng BI login chỉ đọc, truy cập schema phân tích của tenant; BI không được đọc trực tiếp schema `raw`. Thiết kế này được ghi trong [ADR 0018](https://github.com/muitneliss/undercroft/blob/main/docs/adr/0018-per-tenant-roles-and-row-level-security.md).

Reports là BI do Undercroft cung cấp trong control plane, không còn Metabase trong stack. Member và admin tạo câu hỏi đã lưu, dashboard; viewer đọc nội dung được tạo cho họ.

Kỹ sư vẫn cần viết model và cùng người sử dụng kiểm tra kết quả. Hướng dẫn [report Xero bằng SQL và dbt](/bao-cao-xero-sql-dbt/) minh hoạ phần việc từ payload đến bảng phân tích. Có BI trong stack giúp nối luồng sử dụng, không có nghĩa sẵn mọi chỉ tiêu finance/ops.

## Đội kỹ thuật phải vận hành những gì khi self-hosted?

Triển khai được tài liệu hoá là một Docker Compose stack trên Dokploy, gồm nhiều service. Control plane là bề mặt public; worker, Postgres, MinIO và scheduler trao đổi trong mạng nội bộ. Một stack vẫn cần người theo dõi tài nguyên và xử lý lỗi.

Dokploy lấy compose file từ `main`, còn application image đi theo release. Việc kiểm tra deployment đối chiếu image digest đang chạy. Rollback image không tự rollback compose file, nên phải đọc [deployment runbook](https://github.com/muitneliss/undercroft/blob/main/docs/runbook/deployment.md) trước khi nâng cấp hoặc quay lại phiên bản cũ.

Giấy phép MIT không xoá chi phí server, storage hay thời gian vận hành. Một thử nghiệm hữu ích là lấy một nguồn, dựng một model và đối chiếu một report đã thống nhất; sau đó kiểm tra lỗi sync và cách phục hồi. Kết quả ấy có giá trị hơn số lượng tính năng trên bảng so sánh.

## Câu hỏi thường gặp

### Undercroft có thể thay thế Fivetran không?

Có thể cân nhắc nếu các nguồn được hỗ trợ đáp ứng nhu cầu và đội muốn self-hosted cả ingestion, raw data lake, dbt, BI. Undercroft hiện là pre-alpha và có ít connector hơn nhiều.

### Khi nào nên dùng Undercroft để thay thế Airbyte?

Khi mục tiêu là quản lý cả model và report trong cùng stack với ingestion. Nếu cần nhiều connector để đưa dữ liệu vào destination đang có, Airbyte vẫn đáng ưu tiên đánh giá.

### Undercroft có sẵn business model không?

Không có business schema đi kèm sản phẩm. Đội sử dụng viết dbt model để định nghĩa các bảng và phép tính phù hợp.

### Self-hosted có nghĩa dữ liệu không bao giờ ra ngoài server?

Không: connector vẫn gọi API bên ngoài, và các dịch vụ ngoài được cấu hình có thể tạo thêm request. Self-hosted cho bạn quyền vận hành stack và storage, không phải cam kết hệ thống chạy offline.
