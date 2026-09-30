---
title: "Tích hợp HubSpot: nối dữ liệu bán hàng với kế toán"
description: "Tích hợp HubSpot để đối chiếu bán hàng với kế toán. Hiểu cách Undercroft giữ raw data, hỗ trợ report và những việc doanh nghiệp cần tự quyết định."
translationKey: "hubspot-integration"
pubDate: "2026-09-29"
tags: ["HubSpot", "Integration", "Reporting", "ELT"]
keywords:
  [
    "tích hợp HubSpot",
    "HubSpot sang Postgres",
    "báo cáo doanh thu HubSpot",
    "HubSpot custom properties",
    "tích hợp HubSpot Xero",
  ]
hero: "../../../assets/posts/hubspot-integration/hero.png"
heroAlt: "Sơ đồ tích hợp HubSpot đưa dữ liệu CRM và Xero qua raw data lake, Postgres rồi kết hợp để tạo report doanh thu theo khách hàng"
integration: "hubspot"
---

Tích hợp HubSpot với dữ liệu kế toán giúp doanh nghiệp nhìn rõ khoảng cách giữa bán được hàng và ghi nhận doanh thu. Cơ hội đã chốt chưa chắc đã thu tiền. Ghép các bản xuất dữ liệu cho từng cuộc họp vừa mất thời gian, vừa khó giải thích chênh lệch.

Undercroft đưa dữ liệu HubSpot vào raw data lake rồi sang Postgres để phân tích. Doanh nghiệp vẫn cần thống nhất cách nhận diện khách hàng và tính chỉ tiêu. Sync thành công mới xác nhận dữ liệu đã được đọc, chưa chứng minh report đúng ý nghĩa nghiệp vụ.

## Tích hợp HubSpot giúp trả lời câu hỏi kinh doanh nào?

Đội bán hàng muốn biết nhóm khách nào thường chốt hợp đồng. Kế toán quan tâm phần đã xuất hóa đơn, còn người điều hành cần hiểu vì sao chưa thu được tiền. Những câu hỏi này cần dữ liệu chung nhưng dùng định nghĩa khác nhau.

Nền tảng phân tích chung giúp dùng lại quy tắc đã thống nhất và tìm nguyên nhân khi số liệu thay đổi. Khách hàng chưa đối chiếu được cần hiện rõ để xử lý, không bị bỏ qua cho report trông đầy đủ.

## Vì sao giữ raw data trước khi làm report?

Có thể hình dung raw data là tài liệu gốc, còn report là cách đọc theo một câu hỏi. Đổi câu hỏi không nên làm mất tài liệu. Undercroft giữ các phiên bản đã nhận trong data lake; Postgres là nơi làm việc với dữ liệu, còn dbt model thể hiện quy tắc phân tích.

Đó là ELT: đưa dữ liệu vào trước, rồi tổ chức theo nhu cầu. Bạn có thể sửa model dựa trên dữ liệu đã giữ. Lịch sử chỉ gồm những gì hệ thống từng đọc, không bảo đảm có mọi thay đổi giữa các lần sync.

Bài về [raw data lake bất biến](/raw-data-lake-bat-bien/) giải thích giá trị của việc giữ dữ liệu nguồn. Phần so sánh [ETL và ELT](/etl-va-elt-la-gi/) giúp cân nhắc thời điểm xử lý dữ liệu.

## Có thể đưa những dữ liệu HubSpot nào vào phân tích?

Connector đọc người liên hệ, công ty, cơ hội bán hàng và các dữ liệu thương mại được hỗ trợ như báo giá, sản phẩm, chi tiết hàng bán. Nó cũng đọc người phụ trách, giai đoạn bán hàng và các quan hệ được hỗ trợ giữa bản ghi. Quan hệ có sẵn giúp xác định cơ hội thuộc công ty nào mà không phải đoán theo tên.

Bạn có thể chọn thêm custom properties cho các loại bản ghi được hỗ trợ. Tuy nhiên, điều đó không đồng nghĩa connector đọc được mọi loại đối tượng tự tạo trong HubSpot.

Quyền truy cập quyết định dữ liệu nào được đọc. Undercroft nêu rõ phần thiếu quyền và tiếp tục với phần được phép. Vì vậy, một lần sync thành công vẫn có thể thiếu dữ liệu mà report cần; dữ liệu trống chưa chắc có nghĩa là không phát sinh nghiệp vụ.

## Dữ liệu trên dashboard có mới ngay sau khi sửa HubSpot không?

Không. Undercroft đọc theo lịch hoặc khi có yêu cầu chạy. Với người liên hệ, công ty và cơ hội bán hàng, mỗi lần sync vẫn xem qua danh sách hiện có rồi xác định bản ghi cần lưu dựa trên thay đổi được nguồn thông báo. Ít thay đổi không có nghĩa là ít công đọc.

Doanh nghiệp cần cân bằng độ mới với thời gian và khả năng đáp ứng của API. Cách này phù hợp với report chấp nhận độ trễ, nhưng không đáp ứng yêu cầu mọi chỉnh sửa xuất hiện tức thì.

Khi kết hợp với Xero, cũng không nên mặc định hai nguồn mới ngang nhau. Một số chỉnh sửa kế toán cần đọc lại toàn bộ mới được phát hiện; việc đọc lại có thể phải chờ để giới hạn khối lượng xử lý.

## Xóa dữ liệu trong HubSpot thì report thay đổi thế nào?

Sau khi đọc trọn danh sách và có đủ bằng chứng, Undercroft nhận ra bản ghi từng biết nay không còn xuất hiện. Bản ghi được đánh dấu đã loại bỏ trong Postgres, còn lịch sử vẫn được giữ trong raw data lake. Model cần xét trạng thái này khi tạo report về dữ liệu đang hoạt động.

![Một lần đọc HubSpot đầy đủ phát hiện bản ghi vắng mặt; Postgres đánh dấu đã loại bỏ, model bỏ khỏi kết quả đang hoạt động và raw data lake giữ lịch sử](../../../assets/posts/hubspot-integration/flow.png)

Đọc dở dang không đủ để kết luận dữ liệu đã bị xóa. Kết quả trống cũng không khiến toàn bộ bản ghi bị coi là đã mất. Sự thận trọng này tránh kết luận sai khi gặp sự cố, nhưng có thể khiến report phản ánh việc xóa chậm hơn.

Thời điểm ghi nhận là lúc phát hiện sự vắng mặt, không phải giờ xóa chính xác trong HubSpot. Nếu dựng lại dữ liệu phân tích từ lake, hệ thống cần đọc nguồn đầy đủ để xác định lại trạng thái hiện tại.

## Ghép HubSpot với Xero có tự ra doanh thu đúng không?

Không thể chỉ nối dữ liệu rồi tin vào tổng cuối cùng. Trước hết, doanh nghiệp cần xác nhận khách hàng ở hai hệ thống là cùng một bên; tên gần giống chưa đủ bằng chứng. Cách ghép cũng phải tránh tính một giao dịch nhiều lần và giữ rõ những khách hàng chưa đối chiếu được.

Giá trị cơ hội bán hàng, doanh thu theo hóa đơn và tiền đã thu trả lời những câu hỏi khác nhau. Nhóm phụ trách cần thống nhất kỳ ghi nhận, cách xử lý điều chỉnh và tiền tệ. Khoản tiền thiếu phải khác số không; quy đổi cần có quy tắc rõ ràng. Bài [tích hợp Xero](/tich-hop-xero-postgres/) trình bày thêm về nguồn kế toán.

## Khi nào doanh nghiệp nên chọn cách tiếp cận này?

Undercroft phù hợp khi bạn muốn giữ dữ liệu nguồn, tự quyết định logic report và có người xây dựng, duy trì model. Giá trị rõ hơn khi cần kết hợp CRM với nhiều hệ thống và câu hỏi phân tích thường thay đổi.

Nếu cần report doanh thu làm sẵn, ghép khách hàng tự động hoặc cập nhật tức thì, đây chưa phải lựa chọn phù hợp. Chọn self-hosted còn cần người vận hành. Khi report trong HubSpot đã đáp ứng đủ, thêm một data platform có thể chỉ làm tăng việc.

## Nên bắt đầu từ đâu?

Hãy chọn câu hỏi kinh doanh và thống nhất cách hiểu kết quả. Tìm hiểu [Undercroft](https://undercroft.lowbit.link), gửi [hướng dẫn kết nối HubSpot](https://github.com/muitneliss/undercroft/blob/main/docs/runbook/hubspot-setup.md) cho người phụ trách rồi cùng kiểm tra một report nhỏ.

## Câu hỏi thường gặp

### Có sync HubSpot custom properties sang Postgres được không?

Có, với các loại bản ghi được hỗ trợ. Model quyết định cách dùng những giá trị đó trong report.

### Tích hợp HubSpot có cập nhật tức thì không?

Không, dữ liệu được đọc theo lịch hoặc yêu cầu chạy. Độ mới phụ thuộc thời điểm và thời gian hoàn thành sync.

### Xóa người liên hệ trong HubSpot có mất raw data không?

Không, lịch sử đã thu thập vẫn nằm trong raw data lake. Model cần xét trạng thái loại bỏ để tạo report chỉ gồm bản ghi còn hoạt động.

### Có sẵn model doanh thu HubSpot và Xero không?

Không, doanh nghiệp tự xây dựng dbt model. Cách ghép khách hàng, tính doanh thu và xử lý tiền tệ cần phản ánh nghiệp vụ của mình.
