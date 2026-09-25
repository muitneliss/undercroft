/**
 * Vietnamese, for everything the CLI says to a person.
 *
 * The CLI is read in two ways. An agent reads the JSON envelope, where the `code` is the
 * contract and the `message` is courtesy; a person reads `--help`, the prompts and the same
 * `message`. Both are worded here, because `.claude/rules/i18n.md` makes Vietnamese the
 * default for every string a person reads and a CLI's help text is one.
 *
 * What a procedure does is not worded here: that sentence belongs to the procedure, beside the
 * router, in `apps/control-plane/src/i18n/procedures.{vi,en}.ts`, and reaches the CLI through
 * the manifest its build bakes in. A flag name, a command name and an error code are NOT
 * translated: they are what a person types and what an agent matches, and a translated
 * `--tenant-id` would be a different flag.
 *
 * `vi.ts` is the source of truth for which keys exist; `en.ts` answers them and `index.ts`
 * pins that with a type annotation.
 */

import type { TopicKey } from "../manifest.ts";

export const vi = {
  cli: {
    description: "Undercroft từ terminal: mọi thao tác của giao diện web, qua cùng một API.",
  },

  /**
   * One sentence per topic -- the group a command's first words name. Keyed by the topic's
   * words joined in camelCase (`bi questions` is `biQuestions`), since `:` is i18next's own
   * namespace separator and cannot appear in a key (`topicKey` in `manifest.ts`). Typed
   * against the router's namespaces, so a new one with no sentence is a `tsc` error.
   */
  topics: {
    account: "Tài khoản của bạn.",
    accountTokens: "Token truy cập cá nhân, cho tác tử kết nối qua MCP.",
    accountApps:
      "Các ứng dụng bạn đã cho phép bằng cách đăng nhập và đồng ý, như trình kết nối Claude.",
    auth: "Đăng nhập, đăng xuất và phiên của bạn.",
    bi: "Báo cáo: câu hỏi, bảng điều khiển và lược đồ.",
    biQuestions: "Các câu hỏi đã lưu.",
    biDashboards: "Các bảng điều khiển.",
    config: "Hồ sơ môi trường của CLI, và cấu hình công khai của máy chủ.",
    connections: "Các nguồn dữ liệu và quyền truy cập của chúng.",
    dq: "Chất lượng dữ liệu.",
    keys: "Khoá nạp dữ liệu.",
    lake: "Hồ dữ liệu thô.",
    models: "Các mô hình dbt.",
    people: "Người có quyền truy cập và lời mời.",
    runs: "Các lần chạy.",
    session: "Phiên hiện tại.",
    tenants: "Khách hàng.",
  } satisfies Record<TopicKey, string>,

  command: {
    authLogin: "Đăng nhập bằng mã một lần gửi tới email, như trên giao diện web.",
    authLogout: "Đăng xuất: huỷ phiên trên máy chủ rồi xoá phiên đã lưu cho địa chỉ này.",
    authStatus: "Cho biết bạn đang đăng nhập vào máy chủ nào, với địa chỉ nào.",
    configShow:
      "Hiển thị hồ sơ đang dùng, URL, quyền ghi và nguồn gốc của từng giá trị. Không bao giờ in phiên.",
    configSetProfile: "Tạo hoặc sửa một hồ sơ môi trường có tên.",
    configUse: "Chọn hồ sơ mặc định.",
    describe:
      "Liệt kê mọi lệnh cùng tác động của nó, hoặc mô tả một lệnh và lược đồ đầu vào của nó.",
  },

  flag: {
    agent: "Chế độ tác tử: một phong bì JSON trên stdout, không hỏi, không màu.",
    json: "In kết quả dưới dạng phong bì JSON (giống --agent).",
    noInput: "Không bao giờ hỏi; thiếu tham số là lỗi ngay.",
    noColor: "Không dùng màu ANSI.",
    quiet: "Bớt thông báo phụ.",
    verbose: "Ghi chẩn đoán ra stderr.",
    yes: "Xác nhận trước một lệnh xoá dữ liệu.",
    dryRun: "Kiểm tra đầu vào tại chỗ và in yêu cầu mà không gọi máy chủ.",
    profile: "Hồ sơ môi trường cần dùng.",
    url: "URL máy chủ dùng một lần; không bao giờ cho phép ghi.",
    lang: "Ngôn ngữ của thông báo (vi hoặc en).",
    input: "Đầu vào JSON: `-` để đọc stdin, hoặc đường dẫn tới một tệp.",
    inputJson: "Đầu vào JSON viết trực tiếp.",
    email: "Địa chỉ email để đăng nhập.",
    code: "Mã sáu chữ số đã nhận qua email.",
    profileUrl: "URL gốc của máy chủ cho hồ sơ này.",
    allowWrites: "Cho phép lệnh ghi trên hồ sơ này. Chỉ người dùng ở terminal mới bật được.",
    profileName: "Tên hồ sơ.",
    commandName: "Lệnh cần mô tả, ví dụ `runs.trigger` hoặc `runs trigger`.",
    field: "Trường `{{name}}` của đầu vào.",
  },

  prompt: {
    tenant: "Chọn khách hàng",
    value: "Nhập {{name}}",
    email: "Địa chỉ email",
    code: "Mã sáu chữ số trong email",
    confirmDestructive: "{{command}} sẽ xoá dữ liệu và không hoàn tác được. Tiếp tục?",
  },

  note: {
    codeRequested:
      "Nếu {{email}} có quyền truy cập, một mã đã được gửi tới đó. Chạy lại với --code để đăng nhập.",
    signedIn: "Đã đăng nhập vào {{origin}} với {{email}}.",
    signedOut: "Đã đăng xuất khỏi {{origin}}.",
    noRows: "Không có dòng nào.",
  },

  error: {
    INVALID_ARGUMENT: "Tham số không hợp lệ cho lệnh {{command}}.",
    inputUnreadable: "Không đọc được đầu vào JSON từ {{source}}.",
    inputNotObject: "Đầu vào JSON phải là một đối tượng.",
    unknownProfile: "Chưa cấu hình hồ sơ “{{profile}}”.",
    MISSING_REQUIRED_ARGUMENT: "Thiếu tham số bắt buộc: {{names}}.",
    UNKNOWN_COMMAND: "Không có lệnh “{{command}}”. Chạy `undercroft describe` để xem danh sách.",
    CONFIG_REQUIRED:
      "Chưa chọn máy chủ. Dùng --profile, --url, hoặc tạo hồ sơ bằng `undercroft config set-profile`.",
    configUnreadable: "Không đọc được tệp {{path}}; hãy sửa hoặc xoá nó.",
    CONFIRMATION_REQUIRED: "{{command}} xoá dữ liệu; ở chế độ tác tử cần thêm --yes.",
    NOT_FOUND: "Không tìm thấy.",
    CONFLICT: "Máy chủ từ chối vì trạng thái hiện tại không cho phép.",
    AUTHENTICATION_REQUIRED: "Chưa đăng nhập vào {{origin}}. Chạy `undercroft auth login`.",
    codeRejected: "Mã không được chấp nhận. Hãy yêu cầu mã mới.",
    PERMISSION_DENIED: "Bạn không có quyền làm việc này.",
    WRITES_DISABLED:
      "Hồ sơ “{{profile}}” không cho phép ghi. Người dùng phải bật nó trong terminal: `undercroft config set-profile {{profile}} --allow-writes`.",
    writesNeedProfile: "URL dùng một lần không bao giờ cho phép ghi; hãy dùng một hồ sơ có tên.",
    HUMAN_REQUIRED: "Chỉ người dùng ở terminal mới cho phép ghi trên một hồ sơ.",
    NETWORK_ERROR: "Không kết nối được với {{origin}}.",
    TIMEOUT: "{{origin}} không trả lời trong {{seconds}} giây.",
    VALIDATION_FAILED: "Máy chủ từ chối đầu vào.",
    localValidation: "Đầu vào không khớp lược đồ của lệnh.",
    CANCELLED: "Đã huỷ; không có gì thay đổi.",
    INTERNAL_ERROR: "Máy chủ gặp lỗi nội bộ.",
    traceId: "Mã truy vết: {{traceId}} — ghi kèm mã này khi báo lỗi.",
  },
};
