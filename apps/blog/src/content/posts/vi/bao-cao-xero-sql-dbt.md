---
title: "Báo cáo Xero: thống nhất cách tính trước khi vẽ biểu đồ"
description: "Xây báo cáo Xero theo cách doanh nghiệp vận hành: thống nhất định nghĩa, giữ rõ dữ liệu thiếu và cân nhắc lợi ích, công sức khi dùng Undercroft."
translationKey: "xero-reporting"
pubDate: "2026-09-29"
tags: ["Xero", "dbt", "BI"]
keywords: ["báo cáo Xero", "Xero dashboard", "công nợ Xero", "Xero BI", "Xero dbt"]
hero: "../../../assets/posts/xero-reporting/hero.png"
heroAlt: "Sơ đồ báo cáo Xero từ dữ liệu nguồn qua raw data lake và model đến report"
---

Báo cáo Xero tùy chỉnh thường xuất phát từ một vướng mắc quen thuộc: cùng nói về doanh thu hoặc công nợ, nhưng mỗi bộ phận đưa ra một con số. Kế toán chốt theo kỳ, kinh doanh theo dõi hóa đơn, người quản lý lại muốn biết tiền đã về. Nếu các định nghĩa chưa thống nhất, thêm dashboard chỉ khiến cuộc tranh luận chuyển sang một màn hình khác.

Điều doanh nghiệp cần là cách tính dùng chung và đủ bằng chứng để giải thích kết quả. Undercroft hỗ trợ hướng này bằng raw data, model do đội ngũ tự xây và BI trong cùng sản phẩm. Nền tảng open-source này đang ở giai đoạn pre-alpha, chưa có sẵn bộ báo cáo tài chính Xero.

## Báo cáo Xero tùy chỉnh nên bắt đầu từ câu hỏi nào?

Hãy bắt đầu từ quyết định cần đưa ra. Muốn ưu tiên thu hồi công nợ thì cần thống nhất ngày chốt, cách tính số còn phải thu và cách chia nhóm quá hạn. Muốn xem hiệu quả kinh doanh thì cần thống nhất kỳ và nhóm doanh thu, chi phí.

Có thể xem model như công thức nấu ăn dùng chung: dữ liệu là nguyên liệu, quy tắc nghiệp vụ là cách chế biến, report là kết quả. Kế toán quyết định ý nghĩa; kỹ thuật biến cách tính đó thành thứ có thể chạy lại. Biểu đồ đẹp không bù được nguyên liệu thiếu.

## Undercroft biến dữ liệu thành report như thế nào?

Dữ liệu Xero được thu thập vào raw data lake bất biến, sau đó đưa vào Postgres để xây model bằng dbt. Model áp dụng những quy tắc đã thống nhất, chẳng hạn cách nhóm chi phí. Mục Reports dùng kết quả để tạo câu hỏi đã lưu, biểu đồ và dashboard có bộ lọc chung.

![Sơ đồ dữ liệu nguồn đi qua quy tắc nghiệp vụ dùng chung để tạo report](../../../assets/posts/xero-reporting/flow.png)

Điểm có ích là dữ liệu đã thu thập được giữ tách khỏi cách diễn giải. Khi đổi cách nhóm chi phí, đội ngũ có thể dựng lại phần báo cáo từ bằng chứng còn lưu. Bài về [raw data lake bất biến](/raw-data-lake-bat-bien/) giải thích lý do giữ lớp này; bài [ETL và ELT](/etl-va-elt-la-gi/) nói rõ vì sao có thể xử lý sau khi thu thập.

Các model cũng có thể dùng chung quy tắc để tránh mỗi report tính một kiểu. Đổi lại, sửa quy tắc chung có thể ảnh hưởng nhiều report, nên cần rà soát.

## Lợi nhuận, công nợ và dòng tiền khác nhau ở đâu?

Những góc nhìn này dùng dữ liệu liên quan nhưng trả lời câu hỏi khác nhau. Ngày lập hóa đơn không đồng nghĩa ngày nhận tiền; tổng hóa đơn cũng không phải số tiền còn phải thu.

| Nhu cầu          | Điều cần thống nhất                                       |
| ---------------- | --------------------------------------------------------- |
| Lãi lỗ quản trị  | Kỳ, nhóm tài khoản và khoản điều chỉnh được tính          |
| Công nợ phải thu | Ngày chốt, số dư và nhóm quá hạn                          |
| Dòng tiền        | Ngày ghi nhận, phạm vi tài khoản và cách tránh tính trùng |

Connector Xero có hóa đơn, thanh toán, khoản giảm trừ, giao dịch ngân hàng và bút toán thủ công, nhưng không thu thập toàn bộ nhật ký hệ thống. Vì vậy, chưa thể coi report quản trị từ các đầu vào này là báo cáo đầy đủ từ sổ cái.

Dữ liệu thực có còn phụ thuộc quyền truy cập và kết quả thu thập. Một lần sync thành công chưa chứng minh đủ đầu vào; bài [tích hợp Xero vào Postgres](/tich-hop-xero-postgres/) giải thích phần này.

## Vì sao số tiền thiếu phải khác số không?

Số không là một kết quả đã biết. Số tiền thiếu nghĩa là chưa có bằng chứng hoặc không đọc được. Nếu thay phần thiếu bằng số không, tổng nhìn rất gọn nhưng người quản lý không còn thấy khoảng trống.

Undercroft tính tiền bằng số thập phân và giữ giá trị không đọc được ở trạng thái thiếu. Model tùy chỉnh phải bảo toàn ý nghĩa đó. Khi chỉ cộng được phần đã biết, report nên nói rõ tổng chưa đầy đủ hoặc chưa hiển thị tổng.

Các loại tiền cũng cần giữ riêng, trừ khi đã thống nhất cách quy đổi với tỷ giá gắn ngày. Khi đối chiếu, thiếu bằng chứng phải được ghi là chưa xác minh; không thấy chênh lệch chưa đủ để kết luận khớp.

## Có dashboard rồi thì đã tin được số liệu chưa?

Chưa. Hãy để người đọc thấy khoản chưa phân loại và dữ liệu thiếu bên cạnh chỉ tiêu tài chính. Đối chiếu với kết quả tham chiếu của kế toán, rồi giải thích chênh lệch trước khi sử dụng.

Undercroft hỗ trợ kiểm tra trùng lặp và thiếu giá trị bắt buộc trong model. Tuy nhiên, kết quả vẫn có thể được tạo dù kiểm tra báo lỗi; kiểm tra kỹ thuật cũng không xác nhận cách hiểu nghiệp vụ.

Công nợ lịch sử cần đặc biệt thận trọng. Số dư hôm nay không cho biết chắc cuối tháng trước còn nợ bao nhiêu. Raw data chỉ giúp dựng lại khi có đủ bằng chứng về thay đổi và model xử lý chúng; data lake không tự tạo ảnh chụp công nợ quá khứ.

## Khi nào doanh nghiệp nên tự xây report?

Hướng này phù hợp khi câu hỏi quản trị lặp lại nhưng report hiện có chưa đáp ứng, và kế toán có thể phối hợp với người biết SQL, dbt. Lợi ích là dùng lại định nghĩa, lần về dữ liệu nguồn và sửa cách tính khi nhu cầu đổi.

Đổi lại, phải có người duy trì model, rà soát thay đổi và xử lý dữ liệu thiếu. Nếu chọn self-hosted, đội ngũ còn chịu trách nhiệm vận hành. Giai đoạn pre-alpha cũng có nghĩa sản phẩm chưa ổn định.

Nếu report hiện tại đã đủ, thêm nền tảng có thể chỉ tăng việc. Nếu cần ngay bộ báo cáo hoàn chỉnh hoặc không có người duy trì model, cách tiếp cận này khó phù hợp.

## Nên bắt đầu tìm hiểu từ đâu?

Chọn một câu hỏi thường gặp và thống nhất thế nào là câu trả lời đáng tin. Xem [Undercroft](https://undercroft.lowbit.link) cùng [repository của dự án](https://github.com/muitneliss/undercroft), rồi đánh giá một phạm vi nhỏ trước khi mở rộng. Mục tiêu là xác nhận cả dữ liệu lẫn năng lực duy trì của đội ngũ.

## Câu hỏi thường gặp

### Undercroft có sẵn báo cáo tài chính Xero không?

Chưa có sẵn bộ báo cáo tài chính. Đội ngũ tự định nghĩa model và cách tính theo nhu cầu doanh nghiệp.

### Có thể tạo Xero dashboard riêng không?

Có, mục Reports ghép các câu hỏi đã lưu từ model thành dashboard. Trước đó cần thống nhất ý nghĩa và phạm vi dữ liệu của từng chỉ tiêu.

### Có xem được công nợ Xero tại ngày quá khứ không?

Chỉ khi dữ liệu đã thu thập đủ bằng chứng và model dựng lại được số dư tại ngày đó. Giữ raw data không tự bảo đảm có lịch sử đầy đủ.

### AI agent có thể hỗ trợ xây report không?

Quy trình model-builder hướng dẫn AI agent làm rõ yêu cầu, xem dữ liệu và kiểm tra model. Việc lưu và chạy model cần sự đồng ý cùng quyền phù hợp; người dùng vẫn phải rà soát ý nghĩa kết quả.
