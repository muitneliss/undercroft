---
title: "Tích hợp Gmail: đưa email vào phân tích doanh nghiệp"
description: "Tích hợp Gmail giúp giữ nội dung thư và tài liệu đính kèm để tra cứu, phân tích. Tìm hiểu cách Undercroft xử lý dữ liệu, lợi ích và giới hạn cần biết."
translationKey: "gmail-integration"
pubDate: "2026-09-29"
tags: ["Gmail", "Integration", "ELT"]
keywords:
  [
    "tích hợp Gmail",
    "lưu email vào database",
    "trích xuất hóa đơn từ email",
    "phân tích dữ liệu email",
    "OCR file đính kèm",
  ]
hero: "../../../assets/posts/gmail-integration/hero.png"
heroAlt: "Sơ đồ tích hợp Gmail đưa email đã chọn qua raw data lake, trích xuất nội dung và model để tạo report"
integration: "gmail"
---

Tích hợp Gmail hữu ích khi thông tin cần cho công việc nằm rải rác trong email. Hóa đơn ở file đính kèm, lý do điều chỉnh ở nội dung thư, còn người làm report phải hỏi đồng nghiệp để tìm đủ cả hai. Tải riêng file về máy thường không giải quyết được phần ngữ cảnh bị bỏ lại.

Với đội tài chính và vận hành, vấn đề là thời gian tìm kiếm và khó kiểm tra nguồn thông tin. Undercroft đưa email đã chọn vào data platform để lưu giữ, tra cứu và phân tích. Nhóm triển khai vẫn quyết định thông tin nào đủ căn cứ để đưa lên report.

## Vì sao cần đưa email vào dữ liệu phân tích?

Gmail giúp quản lý trao đổi, nhưng một cuộc trao đổi chưa phải dữ liệu nghiệp vụ đã được kiểm tra. Tìm cụm “hóa đơn” có thể gặp hóa đơn thật, thư nhắc thanh toán hoặc câu trả lời trích lại thư cũ. Đếm kết quả tìm kiếm sẽ dễ đếm sai sự việc.

Có thể hình dung email như tập hồ sơ kèm lời giải thích. Đưa hồ sơ vào nơi tra cứu chung giúp nhóm đối chiếu thuận tiện hơn. Nếu sổ kế toán nằm ở Xero, [tích hợp Xero](/tich-hop-xero-postgres/) cung cấp dữ liệu có cấu trúc, còn email bổ sung ngữ cảnh cho những chỗ cần làm rõ.

## Tích hợp Gmail trong Undercroft hoạt động thế nào?

Undercroft thu thập thư theo label bạn chọn, giữ nội dung thư và các loại file đính kèm được phép trong raw data lake. Sau đó, hệ thống trích xuất nội dung đọc được vào Postgres để nhóm xây model phục vụ phân tích.

Cách làm này giống giữ hồ sơ gốc bên cạnh bản tổng hợp. Bản tổng hợp có thể sửa khi cách hiểu nghiệp vụ thay đổi; tài liệu đã thu thập vẫn là căn cứ để xem lại. Dữ liệu phục vụ phân tích có thể dựng lại từ phần đã lưu.

Đó là lý do [raw data lake bất biến](/raw-data-lake-bat-bien/) có giá trị khi cần kiểm tra nguồn. Cách làm cũng theo tư duy [ELT](/etl-va-elt-la-gi/): đưa dữ liệu về trước, áp dụng cách hiểu nghiệp vụ sau, thay vì chỉ giữ kết quả đã rút gọn.

## Nội dung thư và file đính kèm được giữ ra sao?

Một nhà cung cấp có thể giải thích thay đổi ngay trong thư nhưng vẫn gửi kèm tài liệu cũ. Undercroft giữ nội dung thư thành tài liệu riêng, bên cạnh các file đính kèm. Việc chọn loại file không loại bỏ nội dung thư đã chọn.

![Email tách thành nội dung thư và file đính kèm, cùng được đưa vào raw data lake để giữ bằng chứng gốc](../../../assets/posts/gmail-integration/flow.png)

Hệ thống đọc được nội dung từ PDF, tài liệu Word được hỗ trợ và workbook Excel hiện đại. Với bản scan và ảnh được hỗ trợ, OCR nhận diện chữ tiếng Việt và tiếng Anh. Tuy nhiên, file có mật khẩu, bị hỏng hoặc không có bộ đọc phù hợp vẫn có thể không trích xuất được.

Thu thập thành công chưa đồng nghĩa với đọc thành công. Hệ thống ghi lý do không đọc được và cho biết khi nội dung trích xuất chưa đầy đủ. Nhờ vậy, nhóm có thể phân biệt tài liệu đang chờ xử lý với tài liệu cần tìm cách bổ sung.

## Có tự biến email thành dữ liệu hóa đơn không?

Undercroft không cung cấp sẵn schema hóa đơn quyết định mọi dòng hàng, số tiền và trạng thái thanh toán. Nhóm của bạn dùng dbt model để tổ chức dữ liệu và áp dụng quy tắc nghiệp vụ. Số tiền không đọc được phải để thiếu; không nên coi một lời nhắc thanh toán là bằng chứng đã trả tiền.

Tính năng phân loại tùy chọn có thể gợi ý loại tài liệu theo danh mục do tổ chức quản lý. Kết quả không đủ tin cậy hoặc đã lỗi thời không được coi là kết luận được chấp nhận. Tính năng này gửi nội dung đến nhà cung cấp AI bên ngoài khi được bật, nên cần cân nhắc trước khi sử dụng.

Nhãn “hóa đơn” chỉ mô tả tài liệu, không xác nhận số tiền hay phê duyệt giao dịch. Nội dung được trích lại trong thư trả lời cũng cần quy tắc xử lý để tránh đếm trùng.

## Có kiểm soát được phạm vi thu thập và quyền đọc không?

Bạn chọn label và loại file phù hợp với công việc. Khi chọn nhiều label, thư thuộc bất kỳ label nào trong số đó đều được lấy. Nếu chưa lưu lựa chọn, hệ thống từ chối thu thập; đăng nhập bằng Google cũng không tự cấp quyền lấy email.

Quyền đọc mailbox do Google cấp rộng hơn các label đã chọn. Phạm vi thu thập theo label do Undercroft thực thi, không phải Google chỉ cho phép đọc từng label đó. Trong platform, BI không được đọc trực tiếp nội dung raw data; model của nhóm quyết định phần nào đến report.

Các lần sync thường bỏ qua thư đã giữ. Mở rộng loại file có thể bổ sung attachment trước đây bị bỏ qua, còn thu hẹp lựa chọn không xóa dữ liệu đã thu thập.

## Khi nào cách làm này phù hợp với doanh nghiệp?

Cách làm phù hợp khi nhóm thường xuyên cần tra cứu bằng chứng, kết hợp email với nguồn khác và có người phụ trách model. Lợi ích là giảm việc gom tài liệu thủ công, giữ ngữ cảnh và có thể xem lại cách hình thành một kết quả.

Đổi lại, đội kỹ thuật phải vận hành platform self-hosted; đội nghiệp vụ phải thống nhất ý nghĩa của report và cách xử lý thiếu dữ liệu. Open-source giúp kiểm tra cách hệ thống hoạt động, nhưng không thay thế những trách nhiệm này.

Nếu cần dịch vụ duyệt hóa đơn dùng ngay, công cụ sao lưu nguyên mailbox hoặc cam kết đọc đúng mọi file, đây chưa phải lựa chọn phù hợp. Với nhu cầu chỉ chuyển tiếp vài tài liệu, một data platform có thể làm công việc phức tạp thêm.

## Nên bắt đầu từ đâu?

Hãy chọn một câu hỏi công việc thường mất thời gian tìm email để trả lời. Bạn có thể xem [Undercroft](https://undercroft.lowbit.link), tìm hiểu [repository open-source](https://github.com/muitneliss/undercroft) và giao đội kỹ thuật tham khảo [hướng dẫn kết nối Google](https://github.com/muitneliss/undercroft/blob/main/docs/runbook/google-ingestion-setup.md). Khi đánh giá, hãy xem kết quả có truy ngược về tài liệu được không và phần còn thiếu có được nhận diện rõ không.

## Câu hỏi thường gặp

### Tích hợp Gmail có lấy toàn bộ inbox không?

Undercroft thu thập theo label đã chọn và từ chối khi chưa có lựa chọn. Quyền đọc mailbox do Google cấp rộng hơn phạm vi thu thập này.

### Có lưu nội dung email mà không lấy file đính kèm không?

Nội dung thư được thu thập độc lập với lựa chọn loại file đính kèm. Sau khi trích xuất, phần đọc được có thể dùng để tra cứu và phân tích.

### Có đọc được hóa đơn scan gửi qua Gmail không?

OCR hỗ trợ tiếng Việt và tiếng Anh cho bản scan và ảnh phù hợp. Nội dung đọc được vẫn cần kiểm tra trước khi dùng làm dữ liệu hóa đơn.

### Sync thành công thì report đã đủ dữ liệu chưa?

Chưa, vì thu thập và trích xuất là các bước riêng. Report có thể còn thiếu tài liệu đang chờ đọc hoặc không đọc được.
