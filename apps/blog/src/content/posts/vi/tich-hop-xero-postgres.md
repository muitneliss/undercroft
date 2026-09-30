---
title: "Tích hợp Xero: từ dữ liệu kế toán đến report đáng tin"
description: "Tích hợp Xero với Undercroft để giữ raw data và chủ động xây dựng report. Hiểu phạm vi dữ liệu, độ mới sau sync và trách nhiệm của đội vận hành."
translationKey: "xero-integration"
pubDate: "2026-09-29"
tags: ["Xero", "Integration", "ELT", "Postgres"]
keywords: ["tích hợp Xero", "đồng bộ Xero", "xuất dữ liệu Xero", "report Xero", "Xero Postgres"]
hero: "../../../assets/posts/xero-integration/hero.png"
heroAlt: "Sơ đồ tích hợp Xero giữ dữ liệu đã thu thập trong raw data lake trước khi model tạo report"
integration: "xero"
---

Tích hợp Xero thường bắt đầu từ một vướng mắc quen thuộc: mỗi lần họp, đội kế toán lại xuất dữ liệu, ghép các bản tải về rồi giải thích vì sao số liệu khác lần trước. Khi đội vận hành cũng cần theo dõi thanh toán, công việc thủ công ấy càng khó duy trì. Doanh nghiệp cần một quy trình có thể lặp lại, với số liệu đủ rõ nguồn gốc để cùng sử dụng.

Đưa dữ liệu vào Postgres mới giải quyết phần di chuyển. Muốn dùng cho quyết định kinh doanh, bạn còn phải biết dữ liệu đã đủ chưa, có cập nhật không và chỉ tiêu được tính theo cách nào. Undercroft tách những việc đó để đội kế toán và kỹ thuật cùng kiểm tra.

## Tích hợp Xero giúp doanh nghiệp làm report như thế nào?

Hãy hình dung một tủ lưu chứng từ và một bàn làm việc. Tủ giữ tài liệu đã nhận; trên bàn, bạn sắp xếp và tính toán theo câu hỏi đang cần trả lời. Đổi cách phân tích không có nghĩa phải bỏ toàn bộ tài liệu gốc.

Undercroft làm theo ý tưởng đó. Connector đọc dữ liệu từ đơn vị Xero được cấp quyền, lưu vào raw data lake rồi đưa sang Postgres. Đội của bạn dùng dbt model để xác định nội dung xuất hiện trên report. Có thể hiểu model là bộ quy tắc biến dữ liệu nguồn thành góc nhìn phục vụ công việc.

Đây là ELT: thu thập và lưu dữ liệu trước, áp dụng định nghĩa phục vụ phân tích sau. Bài [ETL và ELT khác nhau thế nào](/etl-va-elt-la-gi/) giải thích lựa chọn này.

## Vì sao cần giữ raw data của Xero?

Một hóa đơn có thể được sửa sau lần đọc đầu tiên. Nếu chỉ giữ kết quả cuối cùng, đội của bạn sẽ khó phân biệt chênh lệch do nguồn thay đổi hay do cách tính thay đổi.

Raw data lake giữ các phiên bản đã thu thập mà không ghi đè tại chỗ. Đọc lại nội dung không đổi không tạo thêm bản lưu; nội dung khác được giữ thành phiên bản mới. Postgres phục vụ việc phân tích và có thể dựng lại từ raw data còn được lưu giữ.

Nhờ vậy, đội kỹ thuật có thể sửa model từ dữ liệu đã có. Tuy nhiên, data lake không khôi phục được thay đổi chưa từng được thu thập, và lịch sử còn phụ thuộc chính sách lưu giữ. Bài [raw data lake bất biến](/raw-data-lake-bat-bien/) nói rõ hơn về giới hạn này.

## Có thể lấy những dữ liệu nào từ Xero?

Connector hỗ trợ hóa đơn, thanh toán, thông tin liên hệ, đơn mua hàng, giao dịch ngân hàng và bút toán thủ công, cùng dữ liệu tham chiếu như hệ thống tài khoản, thuế suất và tiền tệ. Phạm vi thực tế phụ thuộc vào lựa chọn và quyền truy cập được cấp.

Hãy kiểm tra theo câu hỏi nghiệp vụ. Report công nợ cần dữ liệu hóa đơn, thanh toán và cách xử lý ngày đến hạn; số dư tổng hợp của một liên hệ chưa chắc trả lời cùng câu hỏi. Connector có bút toán thủ công nhưng không bao gồm luồng bút toán hệ thống riêng của Xero. Vì vậy, không thể mặc nhiên xem dữ liệu thu được là bản xuất đầy đủ sổ cái.

## Dữ liệu Xero mới đến đâu sau mỗi lần sync?

Undercroft đọc dữ liệu theo lịch hoặc khi người dùng yêu cầu. Với dữ liệu Xero hỗ trợ lọc thay đổi, incremental sync chỉ hỏi phần thay đổi kể từ lần đọc hoàn tất trước đó. Tiến độ chỉ được ghi nhận khi đọc xong nhóm dữ liệu, tránh coi phần bị ngắt giữa chừng là đã hoàn thành.

Nhưng bộ lọc của Xero không thể hiện mọi chỉnh sửa. Một số thay đổi về ngày đến hạn hoặc thông tin liên hệ có thể không xuất hiện trong incremental sync. Tăng tần suất đọc theo cách này chưa chắc giải quyết được vấn đề.

Undercroft cho phép chọn lịch full re-sync để đọc lại dữ liệu và phát hiện khác biệt. Đội vận hành cần chủ động bật lịch này theo nhu cầu report. Nội dung không đổi không cần lưu thêm; nội dung mới quan sát được tạo phiên bản mới.

![Sơ đồ so sánh sync chỉ đọc thay đổi với lần đọc lại toàn bộ tùy chọn, cùng đưa dữ liệu vào raw data lake để giữ các phiên bản thay đổi](../../../assets/posts/xero-integration/flow.png)

Đọc lại toàn bộ mất thời gian và dùng nhiều khả năng truy cập Xero hơn. Undercroft dành phần khả năng đọc cho incremental sync, nên một số việc có thể phải chờ. Lần chạy hoàn tất vì vậy chưa có nghĩa mọi nhóm dữ liệu đều mới. Người phụ trách cần xem cảnh báo và phần việc còn chờ trước khi xác nhận report.

## Khi nào cách làm này phù hợp với doanh nghiệp?

Cách làm này phù hợp khi bạn muốn chủ động giữ dữ liệu và định nghĩa chỉ tiêu, đồng thời có đội kỹ thuật vận hành. Đội kế toán thống nhất ý nghĩa; đội kỹ thuật thể hiện chúng trong model. Với công nợ quá hạn, hai bên cần thống nhất chứng từ nào được tính, cách trừ thanh toán và xử lý tiền tệ. Giá trị thiếu phải hiện là thiếu, không tự thành số không.

Đổi lại, Undercroft không cung cấp sẵn business schema cho kế toán. Đây là nền tảng open-source, self-hosted và còn ở giai đoạn pre-alpha. Nếu cần dashboard dùng ngay hoặc chưa có người duy trì hệ thống và model, cách tiếp cận này có thể chưa phù hợp. Bạn cũng không nên chọn nó với kỳ vọng mọi chỉnh sửa sẽ xuất hiện tức thì. Bài [xây dựng report Xero với SQL và dbt](/bao-cao-xero-sql-dbt/) bàn tiếp về trách nhiệm định nghĩa chỉ tiêu.

## Bắt đầu tích hợp với Undercroft từ đâu?

Hãy chọn một câu hỏi kinh doanh cụ thể và thống nhất dữ liệu cần có để trả lời. Bạn có thể tìm hiểu [Undercroft](https://undercroft.lowbit.link), xem [repository của dự án](https://github.com/muitneliss/undercroft) và giao phần kết nối cho đội kỹ thuật theo [hướng dẫn thiết lập Xero](https://github.com/muitneliss/undercroft/blob/main/docs/runbook/xero-setup.md). Trước khi dùng report, hãy kiểm tra cả phạm vi dữ liệu lẫn độ mới.

## Câu hỏi thường gặp

### Tích hợp Xero có cần tự viết connector không?

Undercroft đã có connector cho Xero. Đội của bạn vẫn cần cấp quyền truy cập và xây dựng model phục vụ report.

### Đồng bộ Xero có cập nhật tức thì không?

Dữ liệu được đọc theo lịch hoặc theo yêu cầu. Một số chỉnh sửa cần đọc lại toàn bộ, nên không có cam kết cập nhật tức thì.

### Có xuất được toàn bộ sổ cái Xero không?

Connector có bút toán thủ công nhưng không bao gồm luồng bút toán hệ thống riêng. Phạm vi đó chưa tương đương bản xuất đầy đủ sổ cái.

### Sync thành công đã đủ để tin report chưa?

Chưa, vì có thể còn dữ liệu thiếu quyền đọc hoặc đang chờ làm mới toàn bộ. Cần kiểm tra cảnh báo và xác nhận dữ liệu report cần đã được đọc.
