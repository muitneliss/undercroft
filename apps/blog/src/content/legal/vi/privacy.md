---
title: "Chính sách quyền riêng tư"
description: "Cách dịch vụ Undercroft thu thập, sử dụng, lưu trữ, chia sẻ và xoá dữ liệu của bạn, bao gồm dữ liệu đọc từ Gmail và Google Drive."
updated: 2026-10-10
---

Chính sách này áp dụng cho dịch vụ Undercroft được vận hành tại [undercroft.lowbit.link](https://undercroft.lowbit.link) và blog này. Dịch vụ do multnelis ("chúng tôi") vận hành. Bạn có thể liên hệ với chúng tôi qua [contact@multnelis.org](mailto:contact@multnelis.org).

Undercroft cũng là phần mềm open-source mà ai cũng có thể tự cài trên máy chủ của mình. Bản do bạn hoặc tổ chức của bạn tự vận hành không do chúng tôi vận hành, và chính sách này không áp dụng cho bản đó.

Nếu bản tiếng Việt và [bản tiếng Anh](/en/privacy/) có điểm khác nhau, bản tiếng Anh được ưu tiên.

## Ai sử dụng dịch vụ

Undercroft là data platform dành cho tổ chức. Mỗi tổ chức là một workspace riêng (một "khách hàng"). Quản trị viên của workspace mời thành viên và quyết định workspace đọc những nguồn nào, ví dụ Gmail, Google Drive, Xero hoặc HubSpot. Chỉ người được mời mới đăng nhập được.

## Chúng tôi thu thập gì

**Tài khoản của bạn.** Khi bạn đăng nhập, chúng tôi nhận địa chỉ email của bạn. Nếu bạn đăng nhập bằng Google, chúng tôi nhận thêm tên và ảnh đại diện mà Google chia sẻ qua quyền đăng nhập cơ bản. Chúng tôi lưu bạn thuộc những workspace nào và vai trò của bạn trong từng workspace.

**Dữ liệu từ Google, khi quản trị viên kết nối.** Quản trị viên của một workspace có thể kết nối một hộp thư Gmail hoặc một tài khoản Google Drive. Google hiển thị màn hình xin quyền liệt kê những gì chúng tôi yêu cầu, và không có gì được đọc cho đến khi quản trị viên đồng ý.

- **Gmail (chỉ đọc).** Chúng tôi đọc các thư trong những nhãn mà quản trị viên chọn, và chỉ những nhãn đó. Với mỗi thư, chúng tôi lưu người gửi, người nhận, tiêu đề, ngày gửi, mã định danh thư, nội dung thư, và các tệp đính kèm thuộc những loại tệp quản trị viên chọn.
- **Google Drive (chỉ đọc).** Chúng tôi đọc các tệp trong những thư mục quản trị viên chọn qua trình chọn tệp của Google, và nội dung chữ trong các tệp đó. Tài liệu scan và hình ảnh được chuyển thành chữ (OCR) bằng phần mềm chạy trên máy chủ của chính chúng tôi.
- **Tài khoản đã kết nối.** Chúng tôi ghi lại tài khoản Google nào đã đồng ý, địa chỉ email và mã tài khoản Google của nó, để lần kết nối lại sau vẫn gắn với đúng tài khoản đó.

Chúng tôi không bao giờ gửi, sửa, gắn nhãn hay xoá email, và không bao giờ tạo, sửa hay xoá tệp trên Google Drive.

**Dữ liệu từ các nguồn khác** mà quản trị viên kết nối, như Xero hoặc HubSpot, được đọc theo cùng cách: chỉ đọc, và chỉ trong phạm vi quản trị viên chọn.

**Dữ liệu kỹ thuật.** Máy chủ của chúng tôi lưu log và trace của các yêu cầu, có thể gồm địa chỉ IP, thông tin trình duyệt, trang hoặc thao tác được yêu cầu, thời điểm và kết quả. Chúng tôi dùng chúng để giữ dịch vụ hoạt động an toàn và để điều tra lỗi.

Blog không đặt cookie và không chạy script phân tích hay quảng cáo nào. Dịch vụ chỉ dùng những cookie cần thiết để giữ bạn ở trạng thái đăng nhập.

## Chúng tôi dùng dữ liệu để làm gì

Chúng tôi chỉ dùng dữ liệu của bạn để cung cấp dịch vụ cho chính workspace sở hữu nó:

- lưu một bản sao những gì mỗi nguồn đã kết nối đang có vào kho dữ liệu riêng của workspace đó, để workspace xây model và report trên đó;
- trích xuất và đánh chỉ mục nội dung chữ của thư và tài liệu, để thành viên của workspace tìm kiếm;
- hiển thị cho thành viên của workspace dữ liệu, model, report và lịch sử sync của workspace;
- gửi email cho quản trị viên về workspace, ví dụ khi một lần sync thất bại hoặc một quyền truy cập sắp hết hạn;
- giữ dịch vụ an toàn, ngăn chặn lạm dụng và tuân thủ nghĩa vụ pháp lý.

Chúng tôi không bán dữ liệu của bạn, không dùng nó cho quảng cáo, và không xây hồ sơ về bạn.

## Các tính năng tuỳ chọn dùng nhà cung cấp khác

Hai tính năng gửi nội dung tới nhà cung cấp bên ngoài. Cả hai đều tắt cho đến khi bên vận hành cấu hình chúng, và tính năng thứ hai còn cần quản trị viên của workspace thao tác.

- **Trợ lý.** Một trợ lý dạng chat trong dịch vụ trả lời câu hỏi về dữ liệu của workspace bằng mô hình ngôn ngữ do Anthropic cung cấp. Khi thành viên đặt câu hỏi, câu hỏi và những dữ liệu trợ lý đọc để trả lời, có thể gồm nội dung email hoặc tài liệu, được gửi tới Anthropic để tạo câu trả lời. Một bước kiểm tra thứ hai, do TypeSafe cung cấp, chỉ nhận chính lời của thành viên, không bao giờ nhận dữ liệu, để xác nhận thành viên thực sự yêu cầu thay đổi mà trợ lý sắp thực hiện.
- **Phân loại tài liệu.** Khi quản trị viên công bố danh sách loại tài liệu cho workspace, nội dung chữ của từng tài liệu, có thể gồm nội dung email và tệp, được gửi tới TypeSafe để xác định tài liệu thuộc loại nào.

Các nhà cung cấp này chỉ nhận nội dung để trả kết quả đó về cho workspace. Chúng tôi không dùng dữ liệu người dùng Google, và không cho phép các nhà cung cấp này dùng nó, để phát triển, cải thiện hay huấn luyện các mô hình AI hoặc machine learning tổng quát.

## Dữ liệu người dùng Google và Limited Use

Undercroft's use and transfer to any other app of information received from Google APIs will adhere to the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), including the Limited Use requirements.

Nghĩa là: việc Undercroft sử dụng và chuyển cho bất kỳ ứng dụng nào khác thông tin nhận được từ Google API sẽ tuân thủ Chính sách dữ liệu người dùng của Google API Services, bao gồm các yêu cầu Limited Use. Cụ thể:

- chúng tôi chỉ dùng dữ liệu người dùng Google để cung cấp và cải thiện các tính năng mô tả ở trên, do quản trị viên của workspace chọn dùng;
- chúng tôi chỉ chuyển nó cho bên khác khi cần để cung cấp các tính năng đó như mô tả ở trên, để tuân thủ pháp luật, hoặc trong một vụ sáp nhập hay mua lại có thông báo cho bạn;
- chúng tôi không dùng hay chuyển nó cho quảng cáo, và không bán nó;
- không ai ở multnelis đọc nó, trừ khi bạn yêu cầu bằng văn bản (ví dụ để xử lý một yêu cầu hỗ trợ), khi cần cho mục đích bảo mật như điều tra lạm dụng, khi pháp luật yêu cầu, hoặc khi nó đã được tổng hợp và ẩn danh để vận hành dịch vụ.

## Ai khác có thể xem dữ liệu của bạn

- **Thành viên trong workspace của bạn**, theo vai trò quản trị viên giao cho họ. Thành viên của workspace khác không xem được.
- **Các nhà cung cấp nêu trên**, chỉ khi tính năng tương ứng được dùng.
- **Nhà cung cấp dịch vụ email của chúng tôi**, nhận địa chỉ và nội dung các email chúng tôi gửi cho bạn, như mã đăng nhập và lời mời.
- **Cơ quan có thẩm quyền**, nếu pháp luật yêu cầu chúng tôi cung cấp dữ liệu.

## Chúng tôi bảo vệ dữ liệu thế nào

- Mọi kết nối tới dịch vụ đều được mã hoá bằng HTTPS.
- Access token từ Google và các nguồn khác được mã hoá trước khi lưu, bằng một khoá chỉ dịch vụ nền đọc các nguồn nắm giữ. Bản thân ứng dụng web không giải mã được chúng.
- Dữ liệu của mỗi workspace được tách biệt khỏi mọi workspace khác, và mỗi yêu cầu đều được kiểm tra theo vai trò của thành viên trong workspace đó.
- Phần report của dịch vụ không đọc được bản sao thô của email và tài liệu. Chúng chỉ được truy cập qua các model do chính workspace viết.

## Chúng tôi giữ dữ liệu bao lâu, và cách xoá

- **Ngắt kết nối một nguồn** sẽ gỡ quyền truy cập của chúng tôi ngay: chúng tôi thu hồi access token với Google và xoá bản lưu của nó. Nếu không liên lạc được với Google để thu hồi, dịch vụ sẽ báo cho quản trị viên để họ tự thu hồi.
- **Dữ liệu đã đọc** được giữ trong kho dữ liệu của workspace khi workspace còn tồn tại, vì đó là bản ghi của workspace về những gì mỗi nguồn đã có. Quản trị viên có thể yêu cầu chúng tôi xoá dữ liệu đó, hoặc xoá cả workspace, bằng cách viết cho [contact@multnelis.org](mailto:contact@multnelis.org). Chúng tôi xoá trong vòng 30 ngày kể từ khi nhận yêu cầu.
- **Tài khoản của bạn** cũng có thể được xoá theo cách tương tự.

Bạn cũng có thể gỡ quyền truy cập của Undercroft vào tài khoản Google bất cứ lúc nào tại [trang quyền của Tài khoản Google](https://myaccount.google.com/permissions).

## Quyền của bạn

Bạn có thể yêu cầu chúng tôi cung cấp bản sao dữ liệu cá nhân chúng tôi giữ về bạn, sửa hoặc xoá nó, bằng cách viết cho [contact@multnelis.org](mailto:contact@multnelis.org). Nếu dữ liệu của bạn được đưa vào dịch vụ qua workspace của tổ chức bạn, chúng tôi có thể đề nghị quản trị viên của tổ chức đó xác nhận yêu cầu.

## Trẻ em

Dịch vụ dành cho tổ chức và không hướng tới trẻ em. Chúng tôi không cố ý thu thập dữ liệu của bất kỳ ai dưới 16 tuổi.

## Thay đổi chính sách

Khi chính sách này thay đổi, chúng tôi cập nhật ngày ở đầu trang. Nếu thay đổi ảnh hưởng tới cách chúng tôi dùng dữ liệu người dùng Google, chúng tôi sẽ báo cho quản trị viên các workspace trước khi thay đổi có hiệu lực.

## Liên hệ

Câu hỏi về chính sách này: [contact@multnelis.org](mailto:contact@multnelis.org).
