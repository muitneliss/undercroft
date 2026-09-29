---
title: "Raw data lake bất biến: giữ căn cứ để tính lại report"
description: "Raw data lake giúp giữ đầu vào để kiểm tra và tính lại report. Tìm hiểu cách Undercroft tiếp cận, lợi ích, chi phí và khi nào phù hợp với đội ngũ."
translationKey: "raw-data-lake"
pubDate: "2026-09-29"
tags: ["Data lake", "Kiến trúc", "ELT"]
keywords:
  [
    "raw data lake",
    "data lake là gì",
    "data lake và data warehouse",
    "lưu trữ dữ liệu gốc",
    "immutable data",
    "raw data",
  ]
hero: "../../../assets/posts/raw-data-lake/hero.png"
heroAlt: "Sơ đồ raw data lake làm nền cho Postgres, dbt model và dashboard có thể dựng lại"
---

Một raw data lake giúp doanh nghiệp giữ căn cứ phía sau các con số, để khi cần sửa report vẫn còn đầu vào để tính lại. Khi cần giải thích chênh lệch, chỉ giữ kết quả cuối cùng thường không đủ.

Dữ liệu ở ứng dụng nguồn cũng thay đổi. Hồ sơ có thể được sửa, tài liệu có thể bị xóa. Lấy lại dữ liệu hôm nay chưa chắc tái hiện được điều đội ngũ đã thấy trước đó.

## Raw data lake là gì?

Raw data lake giữ phần dữ liệu đã thu thập trước khi xử lý theo yêu cầu của một report. Có thể hình dung nó như nơi giữ hồ sơ đầu vào, còn report là bản tổng hợp được lập từ hồ sơ ấy.

Khi cách tổng hợp thay đổi, bạn quay về đầu vào đã giữ để làm lại. Thông tin chưa dùng hôm nay có thể hữu ích sau này.

Tuy nhiên, raw data không có nghĩa là toàn bộ lịch sử của ứng dụng. Connector chưa lấy một phiên bản thì lake không thể tự tạo ra phiên bản đó. Bài về [data integration qua REST API](/data-integration-la-gi-rest-api/) giải thích thêm ranh giới này.

## Vì sao có dashboard rồi vẫn cần giữ raw data?

Giả sử đội vận hành thay đổi cách xác định hồ sơ trễ hạn. Nếu đầu vào còn đủ thông tin, đội kỹ thuật có thể sửa quy tắc trong model rồi tính lại kết quả.

Nếu chỉ giữ tổng số hồ sơ trễ theo tháng, đội ngũ khó biết từng hồ sơ đã được xếp loại ra sao. Khi ứng dụng nguồn cũng đã sửa dữ liệu, lần lấy mới không còn đủ căn cứ để kiểm tra kết quả cũ.

Giữ raw data giúp tách việc sửa cách tính khỏi việc tìm lại thông tin đã mất. Mọi người có cùng căn cứ để đối chiếu khi bất đồng về định nghĩa nghiệp vụ.

## Undercroft giữ dữ liệu như thế nào?

Undercroft coi raw lake là nền dữ liệu cần bảo toàn. Nội dung mới được lưu mà không ghi đè phiên bản đã thu thập trước đó. Postgres phục vụ phân tích, còn dbt model do đội ngũ của bạn xây dựng quyết định cách diễn giải dữ liệu.

Lake có thể dùng S3 hoặc MinIO. Các lớp phục vụ report phía trên có thể dựng lại từ đầu vào còn giữ, cùng các định nghĩa xử lý và report. Vì vậy, bảo vệ lake là phần thiết yếu của kế hoạch khôi phục.

Dữ liệu được lưu dần trong quá trình thu thập. Nếu sync bị ngắt, phần đã lưu không phải chờ cả lượt hoàn tất mới được giữ lại. Phần chưa đến nơi lưu trữ vẫn có thể mất.

## Tài liệu trùng nhau có phải lưu nhiều lần không?

Undercroft dùng chung bản lưu cho nội dung giống hệt nhau. Khi cùng một mục ở nguồn được đọc lại mà nội dung mới nhất không đổi, một lần sync nữa không tạo thêm phiên bản lịch sử.

Nơi tài liệu xuất hiện vẫn được ghi nhận riêng. Chẳng hạn, cùng tài liệu đính kèm trong nhiều email có thể dùng chung bản lưu, nhưng vẫn giữ được mối liên hệ với từng email.

![Tài liệu giống nhau từ email và thư mục dùng chung được lưu một lần trong raw lake, giữ nguồn gốc và đi qua model để tạo report](../../../assets/posts/raw-data-lake/flow.png)

Cách này không tự kết luận các hồ sơ nghiệp vụ là trùng nhau. Tài liệu nhìn giống nhau chưa chắc có nội dung hoàn toàn giống nhau; cách đếm trong report vẫn thuộc quy tắc của bạn.

## Data lake khác data warehouse ở đâu?

Data lake giữ đầu vào; data warehouse tổ chức dữ liệu để phân tích. Trong Undercroft, Postgres và dbt model đảm nhiệm phần phân tích. Platform không áp sẵn schema nghiệp vụ cho mọi doanh nghiệp.

Điều đó cho phép bạn quyết định thế nào là khách hàng đang hoạt động hay hồ sơ hoàn tất. Đổi lại, đội ngũ phải chịu trách nhiệm xây dựng và kiểm tra các định nghĩa ấy. Bài [so sánh ETL và ELT](/etl-va-elt-la-gi/) giải thích lựa chọn xử lý dữ liệu trước hay sau khi đưa vào hệ thống.

## Khi nào doanh nghiệp nên dùng raw data lake bất biến?

Cách tiếp cận này phù hợp khi định nghĩa report thường thay đổi, nguồn có thể sửa dữ liệu, và đội ngũ cần xem lại căn cứ đã thu thập. Giá trị lớn nhất nằm ở khả năng sửa cách tính mà vẫn còn đầu vào.

Chi phí cần cân nhắc gồm:

- Lưu lịch sử cần dung lượng, dù nội dung không đổi có thể dùng chung bản lưu.
- Dựng lại dữ liệu phân tích cần thời gian và tài nguyên; một số tình huống còn phải đọc lại nguồn.
- Triển khai self-hosted cần người chăm sóc hạ tầng và việc khôi phục.
- Model cần người hiểu nghiệp vụ để xây dựng và rà soát.

Nếu chỉ cần số liệu hiện tại, dễ lấy lại đầu vào và ít dùng lịch sử, lợi ích có thể chưa bù được công vận hành. Đây cũng không phải lựa chọn phù hợp nếu bạn cần report nghiệp vụ có sẵn mà không muốn làm model.

## Bất biến có nghĩa là giữ dữ liệu mãi mãi không?

Bất biến nghĩa là không âm thầm thay thế phiên bản đã lưu. Việc giữ lịch sử bao lâu là quyết định riêng. Khi áp dụng quy tắc lưu giữ, Undercroft báo những lần ghi nhận lịch sử bị loại bỏ.

Bớt lịch sử chưa chắc giảm ngay dung lượng tương ứng, vì nội dung có thể đang được dùng chung. Bất biến cũng không thay thế sao lưu hay kế hoạch phục hồi hạ tầng. Đội ngũ vẫn cần thống nhất những căn cứ nào phải giữ.

## Bắt đầu với Undercroft từ đâu?

Hãy chọn một report thường phải sửa cách tính và xác định đầu vào cần giữ để làm lại. Bạn có thể xem [Undercroft](https://undercroft.lowbit.link) và [repository open-source](https://github.com/muitneliss/undercroft) để cùng đội kỹ thuật đánh giá mức phù hợp.

## Câu hỏi thường gặp

### Raw data lake có thay thế bản sao lưu không?

Không, lake chỉ giữ phần đầu vào đã thu thập, không sao lưu toàn bộ ứng dụng nguồn. Bản thân nơi lưu lake cũng cần được bảo vệ và có cách khôi phục.

### Nguồn xóa dữ liệu rồi có lấy lại được không?

Có thể dùng bản đã giữ nếu nội dung được thu thập trước khi bị xóa và vẫn còn trong lake. Dữ liệu chưa từng được lấy về thì không thể khôi phục từ lake.

### Có dùng SQL để phân tích dữ liệu từ lake được không?

Được. Trong Undercroft, raw data cũng có sẵn trong Postgres, nên admin có thể khám phá bằng SQL trước khi có model nào, còn các model của đội bạn biến nó thành bảng phân tích cho report. Lake giữ bản gốc mà cả hai được xây dựng từ đó.

### Có raw data lake thì report sẽ chính xác hơn không?

Lake giúp giữ căn cứ để kiểm tra và tính lại, nhưng không tự bảo đảm kết quả đúng. Chất lượng nguồn, phạm vi thu thập và quy tắc trong model vẫn quyết định độ chính xác.
