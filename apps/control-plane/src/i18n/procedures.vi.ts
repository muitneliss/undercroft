/**
 * Vietnamese: one sentence per router procedure, keyed by its dotted path.
 *
 * Every caller that is not the browser describes a procedure with these -- the CLI's help and
 * `describe`, a model-context client's tool list -- so the words are written once, beside the
 * router they describe. The sentence says what the procedure does and, where it matters, who
 * may call it: the role gate is the server's, and saying so saves a person a refused call.
 *
 * Read by `handlers/procedures.ts` into each `ProcedureSpec`, never through i18next: a missing
 * key there would come back as the key itself, and `runs.trigger` printed as a description
 * reads like a description. Typed against the router instead (`SentenceTable`), so a procedure
 * with no sentence, or a sentence for one that is gone, is a `tsc` error in both languages.
 */

import type { SentenceTable } from "../handlers/surface.ts";

export const procedureSentences: SentenceTable = {
  "session.me": "Bạn là ai trên máy chủ này.",
  "session.signOut": "Huỷ phiên hiện tại trên máy chủ.",
  "session.setLocale": "Ghi nhớ ngôn ngữ bạn đọc, cho những email gửi khi bạn không mở trang.",
  "tenants.list": "Các khách hàng bạn có quyền truy cập.",
  "tenants.get": "Một khách hàng và vai trò của bạn trong đó.",
  "tenants.create": "Tạo khách hàng mới. Chỉ quản trị nền tảng.",
  "tenants.rename": "Sửa tên hiển thị của khách hàng. Quản trị khách hàng.",
  "connections.list": "Các nguồn của khách hàng và trạng thái kết nối.",
  "connections.get": "Một nguồn và trạng thái kết nối của nó.",
  "connections.startOAuth":
    "Bắt đầu cấp quyền OAuth; trả về URL để mở trong trình duyệt. Quản trị.",
  "connections.browseScope":
    "Những gì có thể chọn cho phạm vi đọc: nhãn Gmail, tổ chức Xero, thư mục Google Drive kèm đường dẫn và các loại tệp đang có, hoặc các trường của từng đối tượng HubSpot, kể cả trường do portal tự tạo. Quản trị.",
  "connections.setScope":
    "Đặt phạm vi đọc của một nguồn. Với HubSpot, các trường chọn thêm cho từng đối tượng được đọc cùng các trường chuẩn, không thay thế chúng. Quản trị.",
  "connections.setToken": "Kết nối một nguồn bằng token dán vào. Quản trị.",
  "connections.setCadence":
    "Đặt tần suất đọc một nguồn: hourly, every_6h, daily, paused, hoặc custom kèm --cron, một biểu thức cron 5 trường theo giờ Singapore, không chạy dày hơn 5 phút một lần. Quản trị.",
  "connections.disconnect": "Chấm dứt quyền truy cập của một nguồn. Quản trị.",
  "keys.list": "Các khoá nạp dữ liệu của khách hàng. Quản trị.",
  "keys.mint": "Tạo khoá nạp dữ liệu; token chỉ được trả về một lần. Quản trị.",
  "keys.revoke": "Thu hồi một khoá nạp dữ liệu. Quản trị.",
  "people.members": "Những người có quyền truy cập khách hàng.",
  "people.invitations": "Các lời mời đang mở.",
  "people.invite": "Mời một địa chỉ với một vai trò. Quản trị.",
  "people.revokeInvitation": "Thu hồi một lời mời đang mở. Quản trị.",
  "people.setRole": "Đổi vai trò của một thành viên; không áp dụng cho admin cuối cùng. Quản trị.",
  "people.removeMember":
    "Gỡ quyền truy cập của một thành viên; không áp dụng cho admin cuối cùng. Quản trị.",
  "lake.summary": "Những gì đã nạp, theo từng luồng: số lượng và độ mới.",
  "lake.records": "Các bản ghi thô của một thực thể. Quản trị.",
  "lake.documents": "Các tài liệu thô của một nguồn. Quản trị.",
  "lake.query": "Chạy một câu SELECT trên hồ dữ liệu thô. Quản trị.",
  "lake.search": "Tìm kiếm toàn văn trên hồ dữ liệu thô. Quản trị.",
  "lake.querySchema": "Các bảng và cột mà lake query đọc được. Quản trị.",
  "models.list": "Các mô hình dbt của khách hàng.",
  "models.get": "Một mô hình dbt và SQL của nó.",
  "models.save": "Lưu một mô hình dbt; không chạy gì. Quản trị.",
  "models.delete": "Xoá một mô hình dbt. Quản trị.",
  "models.build": "Chạy dbt cho một mô hình và chờ kết quả. Quản trị.",
  "models.reference": "Tài liệu tham khảo cho người viết mô hình.",
  "bi.answer": "Trả lời một định nghĩa câu hỏi. Thành viên trở lên.",
  "bi.runQuestion": "Chạy một câu hỏi đã lưu với tham số.",
  "bi.compile": "Dịch một định nghĩa câu hỏi thành SQL. Thành viên trở lên.",
  "bi.schema": "Các bảng và cột mà báo cáo đọc được.",
  "bi.questions.list": "Các câu hỏi đã lưu.",
  "bi.questions.get": "Một câu hỏi đã lưu.",
  "bi.questions.answer": "Câu trả lời của một câu hỏi đã lưu với tham số.",
  "bi.questions.save": "Lưu một câu hỏi. Thành viên trở lên.",
  "bi.questions.delete": "Xoá một câu hỏi. Thành viên trở lên.",
  "bi.dashboards.list": "Các bảng điều khiển.",
  "bi.dashboards.get": "Một bảng điều khiển.",
  "bi.dashboards.save": "Lưu một bảng điều khiển. Thành viên trở lên.",
  "bi.dashboards.delete": "Xoá một bảng điều khiển. Thành viên trở lên.",
  "dq.failures": "Các dòng mà một kiểm thử chất lượng dữ liệu đã lưu khi thất bại. Quản trị.",
  "runs.list": "Sổ các lần chạy, mới nhất trước.",
  "runs.get": "Một lần chạy, với các dòng bị từ chối và các bước dbt.",
  "runs.events": "Những gì worker đang báo về một lần chạy.",
  "runs.trigger": "Chạy ngay việc đọc một nguồn. Quản trị.",
  "config.google": "Nửa công khai của ứng dụng Google, cho trình chọn Drive.",
  health: "Máy chủ có đang trả lời không.",
};
