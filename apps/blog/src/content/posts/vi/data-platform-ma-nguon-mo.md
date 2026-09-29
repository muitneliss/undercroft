---
title: "Data platform mã nguồn mở: khi nào nên chọn Undercroft?"
description: "Chọn data platform mã nguồn mở theo nhu cầu thực tế: hiểu cách Undercroft giữ raw data, xây model và report, cùng trách nhiệm khi self-hosted."
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
heroAlt: "Sơ đồ data platform mã nguồn mở nối API qua connector, raw data lake, Postgres, dbt và report trên server của bạn"
---

Một data platform mã nguồn mở có thể giúp doanh nghiệp chủ động hơn với dữ liệu, nhưng giá trị thực tế phải thể hiện ở công việc hằng ngày. Khi mỗi phòng ban giữ một bản xuất riêng, cuộc họp dễ biến thành buổi đối chiếu số liệu. Người quản lý cần biết con số đến từ đâu; kỹ sư cần sửa cách tính mà không phải thu thập lại mọi thứ.

Undercroft nối việc lấy dữ liệu, giữ raw data, xây model và đọc report trong cùng một sản phẩm self-hosted. Tuy nhiên, dự án đang ở giai đoạn **pre-alpha**, chưa ổn định. Nên bắt đầu bằng một nhu cầu có phạm vi rõ ràng trước khi cân nhắc cho công việc quan trọng.

## Data platform mã nguồn mở cho doanh nghiệp quyền chủ động gì?

Open-source cho phép đội kỹ thuật xem và điều chỉnh phần mềm; Undercroft dùng giấy phép MIT. Self-hosted nghĩa là doanh nghiệp vận hành hệ thống và kiểm soát nơi lưu dữ liệu. Quyền chủ động ấy đi cùng trách nhiệm duy trì hoạt động.

Điều cần đánh giá là khả năng tách dữ liệu đã nhận khỏi cách tính đang dùng. Khi thay đổi chỉ tiêu, đội ngũ có còn căn cứ để kiểm tra kết quả không? Ai chịu trách nhiệm giải thích số liệu, và ai xử lý khi sync thất bại?

## ELT giúp thay đổi cách làm report như thế nào?

ELT là lấy dữ liệu, lưu lại, rồi xử lý cho mục đích phân tích. Có thể hình dung như giữ tài liệu gốc bên cạnh bản tổng hợp: cách tổng hợp thay đổi thì vẫn còn đầu vào để đối chiếu.

Trong Undercroft, connector lấy dữ liệu từ nguồn, raw data lake giữ những gì đã nhận, còn Postgres phục vụ phân tích. Đội kỹ thuật viết dbt model để áp dụng quy tắc nghiệp vụ. BI có sẵn trong sản phẩm hiển thị các câu hỏi đã lưu và dashboard dựa trên model đó.

![Sơ đồ so sánh việc ghép công cụ thu thập, lưu trữ, dbt và BI riêng với luồng dữ liệu trong Undercroft](../../../assets/posts/open-source-data-platform/flow.png)

Cách tổ chức này giảm phần việc ghép các công cụ với nhau. Doanh nghiệp vẫn phải thống nhất ý nghĩa của từng chỉ tiêu. Bài [ETL và ELT khác nhau ở đâu](/etl-va-elt-la-gi/) giải thích thêm vì sao thứ tự lưu và xử lý ảnh hưởng đến khả năng sửa cách tính.

## Vì sao cần giữ raw data khi đã có dashboard?

Một dashboard có thể đúng theo quy tắc hôm nay nhưng chưa trả lời được câu hỏi tháng sau. Đội vận hành muốn đổi cách phân nhóm; người phụ trách tài chính muốn dùng một mốc ngày khác. Nếu chỉ giữ kết quả cuối, việc kiểm tra lại sẽ khó hơn.

Undercroft giữ nội dung đã thu thập mà không ghi đè nội dung trước đó. Nội dung giống nhau chỉ được lưu một lần; nội dung thay đổi được giữ thành phiên bản mới. Khi cần sửa model, đội kỹ thuật có thể xây lại kết quả từ raw data còn lưu.

Điều này không khôi phục được dữ liệu chưa từng lấy về. Raw data lake bất biến cũng không tự bảo vệ trước sự cố mất ổ đĩa. Bản triển khai được tài liệu hoá chưa đưa raw data lake vào phạm vi sao lưu, nên doanh nghiệp cần phương án bảo vệ riêng. Xem thêm về [raw data lake bất biến](/raw-data-lake-bat-bien/).

## Có BI sẵn thì còn cần đội kỹ thuật làm gì?

Undercroft không có sẵn schema nghiệp vụ hay định nghĩa chung cho mọi doanh nghiệp. Người sử dụng cần thống nhất trạng thái nào được tính, ngày nào quyết định kỳ report và cách thể hiện dữ liệu thiếu. Kỹ sư đưa những quyết định đó vào model.

Một khoản tiền chưa đọc được phải khác khoản tiền bằng không. Nguyên tắc của Undercroft là để phần thiếu hiện rõ thay vì đoán. Report chỉ đọc kết quả đã qua model, với quyền chỉ đọc; dữ liệu giữa các tổ chức được phân tách bằng quyền truy cập.

Bài [xây report Xero với SQL và dbt](/bao-cao-xero-sql-dbt/) minh hoạ phần việc này. Kết nối thành công chưa đủ để có một chỉ tiêu đáng tin.

## Có nên dùng Undercroft thay thế Fivetran hoặc Airbyte?

Hãy bắt đầu từ phần việc còn thiếu. Nếu đã có data warehouse và BI phù hợp, doanh nghiệp có thể chỉ cần công cụ đưa dữ liệu vào đó. Nếu muốn quản lý cả raw data, model và report cùng nhau, phạm vi của Undercroft đáng để đánh giá.

Các nguồn hiện có gồm Xero, HubSpot, Gmail và Google Drive. Vẫn cần kiểm tra đúng loại dữ liệu mà công việc yêu cầu. Có REST API không đồng nghĩa nguồn đó đã được hỗ trợ; thêm connector còn đòi hỏi hiểu quyền truy cập và cách nguồn biểu diễn thay đổi.

Khi so sánh với Fivetran hoặc Airbyte, hãy đặt độ phù hợp của nguồn, công sức vận hành và khả năng dùng với hệ thống hiện có lên trước danh sách tính năng. Đó mới là những yếu tố quyết định lượng việc đội ngũ phải gánh.

## Khi nào Undercroft chưa phù hợp?

Undercroft chưa phù hợp nếu cần một hệ thống ổn định để giao ngay quy trình quan trọng. Giai đoạn pre-alpha là hạn chế thực tế. Sản phẩm cũng khó đáp ứng đội chỉ muốn dashboard dùng ngay mà không có người xây model.

Self-hosted cần người phụ trách quyền truy cập, lỗi sync, nâng cấp và phục hồi. Giấy phép open-source không xoá chi phí hạ tầng hay thời gian kỹ sư. Undercroft hợp hơn với đội coi trọng việc giữ đầu vào, muốn tự định nghĩa phân tích và có khả năng vận hành thử.

## Nên bắt đầu đánh giá Undercroft từ đâu?

Khám phá [Undercroft](https://undercroft.lowbit.link) và [repository](https://github.com/muitneliss/undercroft), rồi chọn một nguồn cùng một report đã thống nhất cách tính. Đánh giá khả năng giải thích kết quả và phục hồi sau lỗi sync. Đọc [hướng dẫn triển khai](https://github.com/muitneliss/undercroft/blob/main/docs/runbook/deployment.md) để cân nhắc công sức vận hành trước khi mở rộng.

## Câu hỏi thường gặp

### Data platform mã nguồn mở có miễn phí không?

Undercroft phát hành code theo giấy phép MIT. Doanh nghiệp vẫn cần chi phí lưu trữ, hạ tầng và người xây model, vận hành hệ thống.

### Undercroft có thay thế Airbyte hoặc Fivetran được không?

Có thể cân nhắc nếu nguồn được hỗ trợ đáp ứng nhu cầu và bạn muốn cả model lẫn report trong cùng sản phẩm. Cần đánh giá riêng mức độ phù hợp vì Undercroft vẫn là pre-alpha.

### Undercroft có dashboard sẵn không?

Sản phẩm có BI để tạo câu hỏi đã lưu và dashboard. Đội sử dụng vẫn phải xây model và thống nhất chỉ tiêu, không có sẵn mọi report nghiệp vụ.

### Self-hosted có chạy hoàn toàn offline không?

Không, connector vẫn cần kết nối tới dịch vụ nguồn bên ngoài. Self-hosted cho bạn quyền vận hành hệ thống và nơi lưu dữ liệu, không phải cam kết mọi hoạt động đều offline.
