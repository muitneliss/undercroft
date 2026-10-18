---
title: "Undercroft: ứng dụng làm gì và vì sao đọc dữ liệu Google"
description: "Undercroft là data platform cho tổ chức. Trang này giải thích ứng dụng làm gì, đọc gì từ Gmail và Google Drive, vì sao, và những gì nó không bao giờ làm với dữ liệu đó."
updated: 2026-10-18
---

**Undercroft** là data platform cho tổ chức, do multnelis vận hành tại [undercroft.lowbit.link](https://undercroft.lowbit.link). Ứng dụng sao chép dữ liệu kinh doanh mà tổ chức đã có, từ email, tài liệu, hệ thống kế toán và bán hàng, vào một nơi do chính tổ chức kiểm soát. Ở đó đội ngũ có thể tìm kiếm, viết model bằng SQL và dựng báo cáo.

Trang này giới thiệu ứng dụng cho người chưa đăng nhập. Chỉ cần đăng nhập để dùng ứng dụng, không cần để đọc về nó. [Chính sách quyền riêng tư](/privacy/) và [điều khoản dịch vụ](/terms/) cũng công khai.

Nếu bản tiếng Việt và [bản tiếng Anh](/en/app/) có điểm khác nhau, bản tiếng Anh được ưu tiên.

## Ứng dụng dùng để làm gì

Phần lớn tổ chức giữ dữ liệu ở nhiều hệ thống không nói chuyện với nhau: hoá đơn ở Xero, deal ở HubSpot, hợp đồng và biên lai ở Google Drive, đơn hàng và xác nhận trong Gmail. Undercroft gom chúng lại mà không thay đổi hệ thống nào:

1. **Kết nối nguồn.** Quản trị viên của không gian làm việc kết nối một nguồn, ví dụ một hộp thư Gmail hay một thư mục Google Drive, và chọn chính xác những gì Undercroft được đọc.
2. **Giữ bản gốc.** Undercroft đọc dữ liệu đó với quyền chỉ đọc và giữ một bản sao nguyên vẹn trong kho dữ liệu riêng của không gian làm việc. Nội dung email và tài liệu được trích xuất thành văn bản để không gian làm việc có thể tìm kiếm.
3. **Tự định nghĩa câu trả lời.** Thành viên viết SQL model của riêng mình trên bản sao đó, ví dụ "mọi hoá đơn nhà cung cấp nhận qua email trong tháng này", rồi dựng báo cáo và dashboard.

Mỗi tổ chức là một không gian làm việc riêng. Dữ liệu chỉ hiện với những thành viên được quản trị viên mời, theo vai trò được giao.

## Ứng dụng đọc gì từ Google, và vì sao

Undercroft dùng Google API cho đúng hai việc: đăng nhập, và đọc dữ liệu Gmail và Google Drive mà quản trị viên chọn kết nối.

| Quyền Google                                    | Undercroft dùng quyền đó để làm gì                                                                                                                                                        |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `openid`, `email`, `profile`                    | Đăng nhập bằng tài khoản Google, và ghi nhận tài khoản Google nào đã đồng ý cho một kết nối.                                                                                              |
| `gmail.readonly`, Gmail chỉ đọc                 | Đọc thư trong các nhãn quản trị viên chọn, và chỉ các nhãn đó: người gửi, người nhận, tiêu đề, ngày, nội dung và tệp đính kèm thuộc loại tệp họ chọn. Không bao giờ gửi, sửa hay xoá thư. |
| `drive.readonly`, Google Drive chỉ đọc          | Đọc các tệp trong thư mục quản trị viên chọn, và văn bản bên trong. Không bao giờ tạo, sửa hay xoá tệp.                                                                                   |
| `drive.file`, chỉ cho trình chọn tệp của Google | Hiện trình chọn tệp của chính Google trên trình duyệt để quản trị viên chọn thư mục. Chỉ trả về mã định danh của những gì họ chọn.                                                        |

Không gian làm việc dùng dữ liệu này để tìm kiếm email và tài liệu của chính mình, và dựng model và báo cáo trên đó: ví dụ đối chiếu một hoá đơn nhận qua email với khoản thanh toán ghi trong hệ thống kế toán.

## Những gì ứng dụng không bao giờ làm với dữ liệu Google

- Không bao giờ bán dữ liệu người dùng Google, và không dùng nó cho quảng cáo.
- Không bao giờ dùng dữ liệu người dùng Google để tạo, sửa hay sinh hình ảnh, video, âm thanh hay bất kỳ nội dung tổng hợp nào. Điều này bao gồm mọi loại hình ảnh nhạy cảm.
- Không bao giờ dùng dữ liệu người dùng Google để phát triển, cải thiện hay huấn luyện mô hình trí tuệ nhân tạo hay machine learning, và không cho phép nhà cung cấp nào làm vậy.
- Không bao giờ ghi vào hộp thư Gmail hay Google Drive. Mọi quyền Google mà ứng dụng xin để đọc dữ liệu đều là quyền chỉ đọc.

Undercroft's use and transfer to any other app of information received from Google APIs will adhere to the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), including the Limited Use requirements. [Chính sách quyền riêng tư](/privacy/) mô tả cách dữ liệu được lưu trữ, bảo vệ, chia sẻ và xoá, và nêu tên hai tính năng tuỳ chọn gửi văn bản tới nhà cung cấp bên ngoài.

## Thu hồi quyền truy cập

Quản trị viên có thể ngắt kết nối một nguồn Google bất cứ lúc nào. Undercroft khi đó thu hồi access token với Google và xoá bản lưu của token. Bạn cũng có thể gỡ quyền của Undercroft tại [trang quyền của Tài khoản Google](https://myaccount.google.com/permissions). Để xoá dữ liệu đã đọc, hãy viết tới [contact@multnelis.org](mailto:contact@multnelis.org).

## Mã nguồn mở

Undercroft là phần mềm open-source theo giấy phép MIT. Ai cũng có thể tự cài và chạy bản của mình. Bản do người khác tự vận hành không do multnelis vận hành; trang này, chính sách quyền riêng tư và điều khoản chỉ mô tả dịch vụ tại [undercroft.lowbit.link](https://undercroft.lowbit.link).

## Liên hệ

Câu hỏi về ứng dụng hoặc cách ứng dụng dùng dữ liệu Google: [contact@multnelis.org](mailto:contact@multnelis.org).
