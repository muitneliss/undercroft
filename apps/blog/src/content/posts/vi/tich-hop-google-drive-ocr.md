---
title: "Tích hợp Google Drive: tìm nội dung trong tài liệu"
description: "Tích hợp Google Drive giúp tìm nội dung trong tài liệu và bản scan. Hiểu vai trò của OCR, raw data lake và giới hạn trước khi áp dụng cho doanh nghiệp."
translationKey: "google-drive-integration"
pubDate: "2026-09-29"
tags: ["Google Drive", "Integration", "OCR", "Search"]
keywords:
  [
    "tích hợp Google Drive",
    "Google Drive OCR tiếng Việt",
    "tìm kiếm tài liệu",
    "số hóa chứng từ",
    "tìm nội dung PDF scan",
  ]
hero: "../../../assets/posts/google-drive-integration/hero.png"
heroAlt: "Sơ đồ tích hợp Google Drive đưa tài liệu qua thu nhận, raw data lake, OCR, phân loại và tìm kiếm"
integration: "google-drive"
---

Tích hợp Google Drive có ích khi doanh nghiệp đã lưu đủ hồ sơ nhưng vẫn mất thời gian tìm bằng chứng. Kế toán cần chứng từ của một khoản thanh toán; bộ phận vận hành cần điều khoản gia hạn. Nếu phải mở từng tài liệu để dò, việc lưu trữ chưa giải quyết được nhu cầu tra cứu.

Undercroft thu nhận tài liệu được chọn từ Drive, giữ lại nội dung đã nhận và giúp tìm kiếm phần chữ đọc được. Mục tiêu là đưa người dùng đến bằng chứng nhanh hơn, đồng thời phân biệt rõ tài liệu còn nguyên với tài liệu đã đọc được.

## Tích hợp Google Drive giúp gì ngoài việc lưu file?

Có thể hình dung kho tài liệu như một thư viện. Kệ giữ sách, danh mục giúp tìm sách, còn mục tra cứu chỉ đến nội dung bên trong. Sách có trên kệ chưa có nghĩa mọi trang đều tra cứu được.

Undercroft cũng tách việc giữ tài liệu, đọc chữ và phân loại. Một bản scan đã được lưu vẫn có thể chưa tìm kiếm được vì OCR thất bại. Ngược lại, tài liệu có chữ đọc được không cần chờ phân loại mới xuất hiện trong tìm kiếm.

Với người quản lý, sự phân biệt này giúp đánh giá đúng tiến độ số hóa. Có đủ hồ sơ và có đủ nội dung để tra cứu là những kết quả khác nhau.

## Undercroft giữ tài liệu từ Drive như thế nào?

Quản trị viên chọn tài liệu hoặc thư mục, định dạng cần thu nhận và có lấy cả thư mục con hay không. Quyền đọc do Google cấp rộng hơn phạm vi đã chọn; Undercroft chịu trách nhiệm giới hạn việc thu nhận theo lựa chọn đó.

Tài liệu được giữ trong raw data lake bất biến để làm căn cứ cho xử lý về sau. File tải xuống được giữ nguyên. Với Google Docs, Sheets và Slides, hệ thống lưu bản xuất từ Google, không giữ toàn bộ trải nghiệm chỉnh sửa trực tuyến.

Nếu cách đọc hoặc nhu cầu làm report thay đổi, đội kỹ thuật vẫn còn tài liệu đã thu nhận để đối chiếu. Bài về [raw data lake bất biến](/raw-data-lake-bat-bien/) giải thích lựa chọn này. Với hồ sơ còn đến qua email, [tích hợp Gmail](/tich-hop-gmail-email-vao-database/) bổ sung một đường thu nhận vào cùng nền tảng.

## OCR có giúp tìm nội dung trong PDF scan tiếng Việt không?

OCR nhận diện chữ trong ảnh để tạo nội dung có thể tìm kiếm. Undercroft hỗ trợ tiếng Việt và tiếng Anh cho ảnh và PDF scan được hỗ trợ. Tài liệu đã có chữ đọc được có thể được trích xuất trực tiếp.

Với PDF, hệ thống thử đọc phần chữ có sẵn trước, rồi dùng OCR khi phần đó quá ít. Vì vậy, ảnh nằm trong một PDF đã có nhiều chữ không mặc nhiên được đọc hết.

![Trang hợp đồng scan đi qua OCR tiếng Việt và tiếng Anh, thành nội dung trích xuất rồi xuất hiện trong kết quả tìm kiếm](../../../assets/posts/google-drive-integration/flow.png)

Chữ mờ, trang nghiêng hoặc bố cục phức tạp có thể làm kết quả thiếu hay sai. Khi không đọc được, hệ thống ghi nhận lý do; tài liệu đã lưu vẫn còn. Một số định dạng chưa được hỗ trợ đọc, còn tài liệu khóa bằng mật khẩu cần bản đã mở khóa.

Với chứng từ, hãy xem OCR là cách hỗ trợ tra cứu. Số tiền, ngày tháng và mã tham chiếu quan trọng vẫn cần đối chiếu bản gốc trước khi dùng cho report.

## Tìm kiếm và phân loại tài liệu khác nhau ở đâu?

Tìm kiếm trả lời câu hỏi nội dung cần tìm nằm ở đâu. Trong Undercroft, quản trị viên có thể tìm trên chữ đã trích xuất và raw data từ các nguồn khác. Gõ tiếng Việt không dấu vẫn có thể khớp với nội dung có dấu; đoạn trích giữ dấu gốc.

Phân loại trả lời câu hỏi tài liệu thuộc nhóm nào, chẳng hạn hóa đơn hay hợp đồng. Đây là chức năng tùy chọn, dựa trên danh mục của tổ chức. Kết quả chưa đủ tin cậy không được coi là nhãn đã chấp nhận; nhóm “khác” giúp tránh ép tài liệu vào loại không phù hợp.

Phân loại dùng dịch vụ AI bên ngoài và cần quản trị viên chủ động thực hiện. Doanh nghiệp phải cân nhắc việc gửi nội dung cho nhà cung cấp và chi phí xử lý. Nhãn hóa đơn cũng chưa tạo ra dữ liệu kế toán: đội của bạn vẫn định nghĩa model nghiệp vụ.

## Khi nào cách tiếp cận này phù hợp với doanh nghiệp?

Cách này phù hợp khi câu hỏi thường xuyên liên quan cả hồ sơ trên Drive lẫn dữ liệu ở hệ thống khác. Nó cũng hữu ích khi doanh nghiệp muốn giữ tài liệu làm căn cứ lâu dài và có đội phụ trách xử lý dữ liệu.

Đổi lại, cần chấp nhận các giới hạn sau:

- **Vận hành:** lựa chọn self-hosted cần người duy trì hệ thống và xử lý các lần đọc thất bại.
- **Tìm kiếm:** hệ thống tìm theo chữ, không bảo đảm hiểu ý hay sửa lỗi OCR. Nội dung rất dài có thể chỉ được tìm kiếm một phần.
- **Quyền truy cập:** tìm kiếm trong lake dành cho quản trị viên, chưa phải cổng tra cứu chung cho mọi nhân viên.
- **Làm report:** chữ trích xuất và nhãn tài liệu vẫn cần kiểm tra, chuẩn bị theo nhu cầu nghiệp vụ.

Nếu chỉ thỉnh thoảng tìm tài liệu trong Drive, thêm nền tảng có thể làm tăng việc vận hành. Nếu cần tự động duyệt hóa đơn hoặc đọc chính xác mọi bản scan, riêng quy trình này chưa đáp ứng được.

## Nên bắt đầu đánh giá từ đâu?

Hãy chọn một nhóm hồ sơ đại diện và câu hỏi thường gặp, rồi đánh giá nội dung nào đọc được, phần nào còn thiếu và ai sẽ kiểm tra kết quả. Có thể xem [Undercroft](https://undercroft.lowbit.link) và chuyển [hướng dẫn kết nối Google](https://github.com/muitneliss/undercroft/blob/main/docs/runbook/google-ingestion-setup.md) cho người phụ trách triển khai.

## Câu hỏi thường gặp

### Tích hợp Google Drive có đọc toàn bộ tài khoản không?

Undercroft thu nhận theo phạm vi quản trị viên đã chọn. Quyền Google cấp rộng hơn, nên ứng dụng phải thực thi giới hạn này.

### Có thể tìm PDF scan tiếng Việt không?

Có, nếu OCR đọc được bản scan thuộc định dạng hỗ trợ. Nên kiểm tra trên hồ sơ đại diện vì chất lượng ảnh ảnh hưởng kết quả.

### Chưa bật phân loại thì có tìm kiếm được không?

Có, tìm kiếm dùng nội dung đã trích xuất, độc lập với phân loại. Bật phân loại là quyết định riêng về xử lý và chia sẻ nội dung.

### Không tìm thấy có nghĩa là không có tài liệu không?

Không, tài liệu có thể đã lưu nhưng chưa đọc được hoặc nội dung cần tìm chưa được đưa vào tìm kiếm. Cần kiểm tra tình trạng thu nhận và đọc tài liệu trước khi kết luận.
