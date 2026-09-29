---
title: "ETL và ELT là gì? Chọn cách phù hợp cho báo cáo"
description: "ETL và ELT là gì, khác nhau ở đâu và khi nào nên chọn? Hiểu vai trò của raw data, trách nhiệm của đội dữ liệu và cách Undercroft hỗ trợ báo cáo thay đổi."
translationKey: "etl-vs-elt"
pubDate: "2026-09-29"
tags: ["ETL", "ELT", "Data integration", "dbt"]
keywords:
  [
    "ETL và ELT là gì",
    "ETL là gì",
    "ELT là gì",
    "so sánh ETL ELT",
    "data pipeline",
    "raw data",
    "dbt",
  ]
hero: "../../../assets/posts/etl-vs-elt/hero.png"
heroAlt: "ETL và ELT là gì: sơ đồ so sánh xử lý trước khi lưu với giữ raw data rồi xây dựng model"
---

ETL và ELT là gì thường trở thành câu hỏi thực tế khi doanh nghiệp muốn đổi một report. Trước đây chỉ cần tổng đơn hàng theo tháng, nay đội vận hành muốn biết từng đơn chậm ở đâu. Nếu chỉ giữ số tổng, đội dữ liệu phải tìm lại chi tiết từ nguồn, mà nguồn có thể đã thay đổi.

Điều cần cân nhắc là áp dụng quy tắc nghiệp vụ lúc nào và giữ lại gì sau đó. Undercroft chọn giữ raw data làm nền tảng, để khi đổi cách nhìn, đội phụ trách còn đầu vào để tính lại.

## ETL và ELT là gì, khác nhau ở đâu?

**ETL là extract, transform, load:** đọc dữ liệu từ nguồn, xử lý theo mục đích đã thống nhất, rồi đưa kết quả vào nơi phục vụ phân tích. Chẳng hạn, dữ liệu từng đơn hàng được gom thành tổng theo tháng trước khi chuyển đến đội làm report.

**ELT là extract, load, transform:** đưa dữ liệu vào môi trường phân tích trước, rồi áp dụng quy tắc nghiệp vụ qua các model. Model thể hiện cách doanh nghiệp muốn phân loại, kết hợp và tính toán dữ liệu.

Có thể hình dung ETL như gửi bản tổng hợp sau cuộc họp; ELT như chuyển cả ghi chép cho đội phân tích để họ tổng hợp theo từng câu hỏi. Việc có giữ ghi chép gốc hay không vẫn là quyết định riêng.

Hình đầu bài minh họa ETL bỏ raw data và ELT giữ lại. Đây chỉ là ví dụ: ETL cũng có thể lưu raw data riêng để dùng về sau.

| Câu hỏi                   | ETL                             | ELT                           |
| ------------------------- | ------------------------------- | ----------------------------- |
| Xử lý nghiệp vụ lúc nào?  | Trước khi đưa vào nơi phân tích | Sau khi đưa vào nơi phân tích |
| Đầu vào của report là gì? | Dữ liệu đã chuẩn bị             | Model xây từ dữ liệu đã lưu   |
| Muốn tính lại cần gì?     | Giữ đầu vào hoặc đọc lại nguồn  | Đầu vào còn đủ chi tiết       |

## Vì sao cách giữ dữ liệu ảnh hưởng đến report?

ETL giúp nơi nhận có dữ liệu đã chuẩn bị đúng mục đích. Cách này hữu ích khi yêu cầu ổn định, hoặc nơi nhận chỉ nên chứa thông tin đã chọn lọc. Đổi lại, phần chi tiết bị bỏ đi có thể chính là thứ cần cho câu hỏi tiếp theo.

ELT thuận tiện khi tài chính và vận hành cùng dùng một nguồn nhưng cần cách tính khác nhau. Mỗi đội có thể có model phù hợp mà không bắt phần đọc nguồn gánh mọi định nghĩa. Tuy nhiên, vẫn phải thống nhất ý nghĩa chỉ tiêu; dữ liệu vào thành công chưa chứng minh report đúng.

## Undercroft áp dụng ELT như thế nào?

Undercroft là data platform open-source. Connector đọc nguồn và đưa dữ liệu thu được vào raw data lake. Nội dung đã lưu không bị ghi đè tại chỗ; nội dung giống nhau không cần lưu thêm bản sao.

Postgres giúp đội dữ liệu khai thác các bản ghi đã thu thập. Đội phụ trách dùng dbt xây model theo quy tắc của doanh nghiệp, rồi đưa kết quả lên report và dashboard. Bài [data integration là gì](/data-integration-la-gi-rest-api/) giải thích thêm vai trò của việc kết nối và thu thập.

Undercroft không cung cấp sẵn business schema định nghĩa khách hàng hay hóa đơn cho mọi doanh nghiệp. Đội sử dụng có quyền quyết định cách hiểu của mình, đồng thời phải chịu trách nhiệm xây model và kiểm tra kết quả.

## Khi đổi cách tính, có phải lấy dữ liệu lại không?

Giả sử doanh nghiệp mở rộng tiêu chí khách hàng còn hoạt động, tính cả những người đã lâu chưa đặt hàng. Nếu còn chi tiết đơn hàng, đội dữ liệu có thể sửa model và tính lại. Nếu chỉ giữ nhãn hoạt động theo tiêu chí cũ, nhãn đó không cho biết lần mua gần nhất.

![Quy tắc nghiệp vụ thay đổi dẫn đến model và report mới, trong khi raw data lake được giữ nguyên](../../../assets/posts/etl-vs-elt/flow.png)

Trong Undercroft, các lớp phục vụ phân tích có thể được dựng lại từ đầu vào còn giữ. Sơ đồ thể hiện quan hệ này, không yêu cầu bỏ mọi model mỗi lần sửa. Bài [raw data lake bất biến](/raw-data-lake-bat-bien/) giải thích vì sao lớp dữ liệu gốc cần được bảo vệ.

Tính lại được cũng chưa có nghĩa là tính đúng. Người hiểu nghiệp vụ vẫn cần đối chiếu định nghĩa mới và giải thích vì sao kết quả khác trước.

## Khi nào nên chọn ELT, khi nào không phù hợp?

ELT đáng cân nhắc khi câu hỏi thường thay đổi, nhiều đội dùng chung nguồn và có người duy trì model. ETL có thể hợp hơn khi cần xử lý hoặc loại bớt thông tin trước khi đưa đến nơi nhận. Một hệ thống cũng có thể dùng cả hai cách.

Giữ raw data kéo theo chi phí lưu trữ, quản lý quyền đọc và thời gian lưu. Lake chỉ giữ những gì đã thu thập: thông tin chưa lấy hoặc bản ghi đã bị xóa trước lần sync không tự xuất hiện lại. Có lịch sử được lưu cũng chưa đồng nghĩa có report lịch sử; vẫn cần model sử dụng đúng đầu vào.

Undercroft theo hướng self-hosted và hiện ở giai đoạn pre-alpha. Doanh nghiệp cần người vận hành và người duy trì model; nếu muốn dịch vụ ổn định do bên khác quản lý hoặc report nghiệp vụ dùng ngay, đây có thể chưa phù hợp.

## Nên bắt đầu tìm hiểu Undercroft từ đâu?

Hãy chọn một report từng phải đổi cách tính và xác định dữ liệu cần giữ để tính lại. Xem [Undercroft](https://undercroft.lowbit.link) và [repository của dự án](https://github.com/muitneliss/undercroft), rồi trao đổi với đội kỹ thuật về người phụ trách vận hành, model và đối chiếu kết quả.

## Câu hỏi thường gặp

### ELT có luôn tốt hơn ETL không?

Không; lựa chọn phụ thuộc nơi cần xử lý và dữ liệu nơi nhận được phép giữ. ELT linh hoạt cho phân tích về sau, còn ETL phù hợp khi cần chuẩn bị dữ liệu từ trước.

### ETL có bắt buộc bỏ raw data không?

Không; ETL có thể giữ raw data riêng. Khả năng tính lại phụ thuộc đầu vào còn đủ, không chỉ thứ tự xử lý.

### dbt dùng trong ETL hay ELT?

Trong Undercroft, dbt đảm nhiệm phần xử lý sau khi dữ liệu đã được thu thập và lưu. Nó xây model phân tích, không thay connector đọc nguồn.

### Có raw data thì khôi phục được mọi lịch sử không?

Không; raw data chỉ phản ánh những gì đã thu thập và còn được giữ. Muốn phân tích quá khứ vẫn cần đủ đầu vào và model phù hợp.
