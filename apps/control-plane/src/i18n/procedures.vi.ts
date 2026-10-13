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
  "account.tokens.list":
    "Các token truy cập cá nhân của bạn. Chỉ gọi được từ phiên đăng nhập, không bằng token.",
  "account.tokens.mint":
    "Tạo token truy cập cá nhân, chỉ đọc hoặc đọc và ghi, hết hạn trong tối đa 365 ngày; token chỉ được trả về một lần. Chỉ gọi được từ phiên đăng nhập.",
  "account.tokens.revoke":
    "Thu hồi một token truy cập cá nhân của bạn. Chỉ gọi được từ phiên đăng nhập.",
  "account.apps.list":
    "Các ứng dụng (như trình kết nối Claude) bạn đã cho phép truy cập bằng cách đăng nhập và đồng ý, kèm quyền đã cấp. Chỉ gọi được từ phiên đăng nhập.",
  "account.apps.revoke":
    "Thu hồi quyền của một ứng dụng đã kết nối; ứng dụng bị chặn ngay từ lần gọi tiếp theo. Chỉ gọi được từ phiên đăng nhập.",
  "tenants.list": "Các khách hàng bạn có quyền truy cập.",
  "tenants.get": "Một khách hàng và vai trò của bạn trong đó.",
  "tenants.create": "Tạo khách hàng mới. Chỉ quản trị nền tảng.",
  "tenants.rename": "Sửa tên hiển thị của khách hàng. Quản trị khách hàng.",
  "tenants.deactivate":
    "Ngừng kích hoạt khách hàng: mọi thành viên mất quyền truy cập và mọi lần đồng bộ dừng lại cho đến khi được kích hoạt lại. Không xoá dữ liệu nào. Quản trị khách hàng.",
  "tenants.reactivate":
    "Kích hoạt lại một khách hàng đã ngừng kích hoạt: quyền truy cập và lịch đồng bộ trở lại như trước. Quản trị khách hàng.",
  "connections.list": "Các nguồn của khách hàng và trạng thái kết nối.",
  "connections.get": "Một nguồn và trạng thái kết nối của nó.",
  "connections.startOAuth":
    "Bắt đầu cấp quyền OAuth; trả về URL để mở trong trình duyệt. Quản trị.",
  "connections.browseScope":
    "Những gì có thể chọn cho phạm vi đọc: nhãn Gmail, tổ chức Xero, thư mục Google Drive kèm đường dẫn và các loại tệp đang có, hoặc các trường của từng đối tượng HubSpot, kể cả trường do portal tự tạo. parentId cho một cấp của cây thư mục hay nhãn (null là cấp trên cùng), query tìm theo tên hoặc đường dẫn, limit và cursor để chia trang; partial vẫn báo khi danh sách chưa đủ. Quản trị.",
  "connections.setScope":
    "Đặt phạm vi đọc của một nguồn. Với HubSpot, các trường chọn thêm cho từng đối tượng được đọc cùng các trường chuẩn, không thay thế chúng. Quản trị.",
  "connections.setToken": "Kết nối một nguồn bằng token dán vào. Quản trị.",
  "connections.setCadence":
    "Đặt tần suất đọc một nguồn: hourly, every_6h, daily, paused, hoặc custom kèm --cron, một biểu thức cron 5 trường theo giờ Singapore, không chạy dày hơn 5 phút một lần. Quản trị.",
  "connections.setResync":
    "Đặt tần suất đọc lại toàn bộ các danh sách của một nguồn, để bắt những thay đổi bộ lọc thay đổi bỏ sót: cùng các lựa chọn như set-cadence, mặc định paused (tắt). Mỗi lần đọc lại toàn bộ chỉ dùng tối đa phần lượt gọi mỗi ngày mà spec cho phép; phần chưa kịp sẽ tiếp tục ở lần chạy sau. Quản trị.",
  "connections.disconnect": "Chấm dứt quyền truy cập của một nguồn. Quản trị.",
  "keys.list": "Các khoá nạp dữ liệu của khách hàng. Quản trị.",
  "keys.mint": "Tạo khoá nạp dữ liệu; token chỉ được trả về một lần. Quản trị.",
  "keys.revoke": "Thu hồi một khoá nạp dữ liệu. Quản trị.",
  "people.members": "Những người có quyền truy cập khách hàng. Quản trị.",
  "people.invitations": "Các lời mời đang mở. Quản trị.",
  "people.invite": "Mời một địa chỉ với một vai trò. Quản trị.",
  "people.revokeInvitation": "Thu hồi một lời mời đang mở. Quản trị.",
  "people.setRole": "Đổi vai trò của một thành viên; không áp dụng cho admin cuối cùng. Quản trị.",
  "people.removeMember":
    "Gỡ quyền truy cập của một thành viên; không áp dụng cho admin cuối cùng. Quản trị.",
  "audit.mine":
    "Các thao tác của chính bạn, mới nhất trước: đã làm gì, qua đâu, và kết quả ra sao.",
  "audit.tenant": "Mọi thao tác trong khách hàng, của bất kỳ ai, mới nhất trước. Quản trị.",
  "audit.all": "Mọi thao tác trên nền tảng, mới nhất trước. Chỉ quản trị nền tảng.",
  "lake.summary": "Những gì đã nạp, theo từng luồng: số lượng và độ mới.",
  "lake.records":
    "Các bản ghi thô của một thực thể, hoặc những bản ghi một lần chạy đã ghi. Quản trị.",
  "lake.documents":
    "Các tài liệu thô của một nguồn, hoặc những tài liệu một lần chạy đã ghi. Quản trị.",
  "lake.query": "Chạy một câu SELECT trên hồ dữ liệu thô. Quản trị.",
  "lake.search":
    "Tìm kiếm toàn văn trên hồ dữ liệu thô. Mỗi loại chỉ xếp hạng các kết quả khớp mới nhất, và câu trả lời nói rõ khi bị cắt. Quản trị.",
  "lake.querySchema":
    "Các bảng và cột mà lake query đọc được; tables cho đúng những bảng đó, match lọc theo một đoạn tên (không phân biệt hoa thường), columns: false chỉ lấy tên bảng. Quản trị.",
  "documentKinds.list":
    "Catalogue loại tài liệu của khách hàng, phiên bản đã publish, và số tài liệu một lần publish sẽ phân loại.",
  "documentKinds.add":
    "Thêm một loại vào bản nháp catalogue; từ catalogue chung, hoặc loại riêng kèm mô tả. Quản trị.",
  "documentKinds.update": "Sửa mô tả của một loại trong bản nháp catalogue. Quản trị.",
  "documentKinds.remove": "Xoá một loại khỏi bản nháp catalogue; không xoá được other. Quản trị.",
  "documentKinds.initialise":
    "Khởi tạo các loại đầu tiên của catalogue từ một mẫu tài liệu của khách hàng, như một lần chạy; không publish gì. Quản trị.",
  "documentKinds.publish":
    "Publish bản nháp catalogue, để mọi tài liệu được phân loại lại theo nó. Quản trị.",
  "models.list": "Các mô hình dbt của khách hàng.",
  "models.get": "Một mô hình dbt và SQL của nó.",
  "models.save": "Lưu một mô hình dbt; không chạy gì. Quản trị.",
  "models.delete":
    "Xoá một mô hình dbt cùng bảng nó đã dựng và các dòng kiểm thử nó đã lưu; không xoá gì nếu chưa gỡ được bảng. Quản trị.",
  "models.build":
    "Dựng mô hình bằng một lần dbt build: name cho một mô hình, hoặc names cho tối đa 20, mỗi mục là name, +name (kèm các mô hình phía trên) hoặc name+ (kèm các mô hình phía dưới); mọi tên phải là mô hình của khách hàng. Mặc định chờ kết quả và trả về waited true với ok, testsFailed, stepSummary (đếm theo loại và trạng thái), các bước được hỏi (steps: none, problems là mặc định, hoặc all; lọc bằng stepStatus, stepKind, stepName; trang tiếp đọc bằng runs.get với runId và stepCursor), rowCounts (số dòng của từng mô hình được nêu; null là không đếm được, không phải 0) và preview khi chỉ nêu một mô hình. wait false trả về ngay waited false với runId; chờ lần chạy đó bằng runs.get với waitSeconds. Khi đang có lần dựng khác, CONFLICT nêu runId và startedAt của lần đó. Quản trị.",
  "models.lineage":
    "Mô hình nào đọc mô hình nào và bảng hồ thô nào, theo đúng khai báo ref() và source() của chính các mô hình và macro. name cho phần quanh một mô hình hay một bảng thô (raw.records), direction up, down hoặc both và depth để giới hạn số bước.",
  "models.reference":
    "Tài liệu tham khảo cho người viết mô hình: các nguồn, macro của nền tảng và macro riêng của khách hàng.",
  "models.check":
    "Kiểm tra SQL của một mô hình trước khi lưu, không chạy gì: lỗi chắc chắn, điều đáng ngờ, và những gì không kiểm được.",
  "macros.list": "Các macro dbt riêng của khách hàng, mỗi macro kèm công dụng và tham số.",
  "macros.get": "Một macro dbt của khách hàng và định nghĩa của nó.",
  "macros.check":
    "Kiểm tra định nghĩa một macro trước khi lưu, không chạy gì: điều sẽ bị từ chối, điều đáng ngờ, và những gì không kiểm được.",
  "macros.save":
    "Lưu một macro dbt, trọn một định nghĩa {% macro %} mà mọi mô hình gọi được; không chạy gì. Quản trị.",
  "macros.delete": "Xoá một macro dbt; bị từ chối khi còn mô hình hay macro khác gọi nó. Quản trị.",
  "bi.answer": "Trả lời một định nghĩa câu hỏi. Thành viên trở lên.",
  "bi.runQuestion": "Chạy một câu hỏi đã lưu với tham số.",
  "bi.compile": "Dịch một định nghĩa câu hỏi thành SQL. Thành viên trở lên.",
  "bi.schema":
    "Các bảng và cột mà báo cáo đọc được; tables cho đúng những bảng đó, match lọc theo một đoạn tên (không phân biệt hoa thường), columns: false chỉ lấy tên bảng.",
  "bi.questions.list": "Các câu hỏi đã lưu.",
  "bi.questions.get": "Một câu hỏi đã lưu.",
  "bi.questions.answer": "Câu trả lời của một câu hỏi đã lưu với tham số.",
  "bi.questions.save": "Lưu một câu hỏi. Thành viên trở lên.",
  "bi.questions.delete": "Xoá một câu hỏi. Thành viên trở lên.",
  "bi.dashboards.list": "Các bảng điều khiển.",
  "bi.dashboards.get": "Một bảng điều khiển.",
  "bi.dashboards.save": "Lưu một bảng điều khiển. Thành viên trở lên.",
  "bi.dashboards.delete": "Xoá một bảng điều khiển. Thành viên trở lên.",
  "bi.exports.create":
    "Xuất mọi dòng của một câu hỏi đã lưu, một định nghĩa hoặc một mô hình dbt thành tệp CSV; trả về một liên kết tải xuống dùng được 15 phút, chỉ cho chính bạn. Mở liên kết trong trình duyệt đã đăng nhập Undercroft, hoặc tải bằng `undercroft bi exports download`. Định nghĩa và mô hình: thành viên trở lên.",
  "bi.exports.get": "Một bản xuất bạn đã yêu cầu và còn hạn: SQL nó chạy và tên tệp.",
  "dq.failures": "Các dòng mà một kiểm thử chất lượng dữ liệu đã lưu khi thất bại. Quản trị.",
  "runs.list":
    "Sổ các lần chạy, mới nhất trước. Mọi bộ lọc đều tuỳ chọn và kết hợp được với nhau và với con trỏ: một nguồn (source), loại (kind, một hoặc nhiều), trạng thái (status), cách khởi chạy (trigger), lần chạy cha (parentRunId: các lần chạy nối tiếp từ lần đó, như lần dựng sau một lần đọc), chỉ lần chạy được nối tiếp hay không (chained), bắt đầu từ (startedAfter, tính cả mốc) và trước (startedBefore), và tối đa 50 mã (ids). Trang rỗng nghĩa là không có gì khớp.",
  "runs.get":
    "Một lần chạy, với phạm vi nó đã đọc và các dòng bị từ chối. Các bước dbt có stepSummary (đếm theo loại và trạng thái; bước skipped vẫn là skipped) cùng các bước được hỏi: steps là none, problems (mặc định: mọi bước không phải success, pass hay skipped) hoặc all; lọc bằng stepStatus, stepKind, stepName (khi có bộ lọc mà không nêu steps thì là all) và sang trang bằng stepCursor với nextStepCursor. waitSeconds (tối đa 50) trả lời ngay khi lần chạy hết running, và với một lần đọc kết thúc ok thì khi lần dựng nối tiếp (childRun) đã có; hết giờ chờ thì vẫn báo running. Dùng nó thay cho việc hỏi lặp.",
  "runs.events": "Những gì worker đang báo về một lần chạy.",
  "runs.trigger": "Chạy ngay việc đọc một nguồn. Quản trị.",
  "config.google": "Nửa công khai của ứng dụng Google, cho trình chọn Drive.",
  "config.signIn": "Các cách đăng nhập máy chủ này cung cấp, cho trang đăng nhập.",
  health: "Máy chủ có đang trả lời không.",
};
