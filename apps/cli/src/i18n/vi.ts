/**
 * Vietnamese, for everything the CLI says to a person.
 *
 * The CLI is read in two ways. An agent reads the JSON envelope, where the `code` is the
 * contract and the `message` is courtesy; a person reads `--help`, the prompts and the same
 * `message`. Both are worded here, because `.claude/rules/i18n.md` makes Vietnamese the
 * default for every string a person reads and a CLI's help text is one.
 *
 * `procedures` mirrors the router's own nesting, one sentence per procedure, and the build
 * refuses a procedure with no sentence here (`apps/cli/scripts/build.ts`). A flag name, a
 * command name and an error code are NOT translated: they are what a person types and what
 * an agent matches, and a translated `--tenant-id` would be a different flag.
 *
 * `vi.ts` is the source of truth for which keys exist; `en.ts` answers them and `index.ts`
 * pins that with a type annotation.
 */

export const vi = {
  cli: {
    description: "Undercroft từ terminal: mọi thao tác của giao diện web, qua cùng một API.",
  },

  /**
   * One sentence per topic -- the group a command's first words name. Keyed by the topic's
   * words joined in camelCase (`bi questions` is `biQuestions`), since `:` is i18next's own
   * namespace separator and cannot appear in a key.
   */
  topics: {
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
  },

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

  /**
   * One sentence per procedure, nested exactly as the router is. The sentence says what the
   * procedure does and, where it matters, who may call it -- the role gate is the server's,
   * and saying so saves a person a refused call.
   */
  procedures: {
    session: {
      me: "Bạn là ai trên máy chủ này.",
      signOut: "Huỷ phiên hiện tại trên máy chủ.",
      setLocale: "Ghi nhớ ngôn ngữ bạn đọc, cho những email gửi khi bạn không mở trang.",
    },
    tenants: {
      list: "Các khách hàng bạn có quyền truy cập.",
      get: "Một khách hàng và vai trò của bạn trong đó.",
      create: "Tạo khách hàng mới. Chỉ quản trị nền tảng.",
      rename: "Sửa tên hiển thị của khách hàng. Quản trị khách hàng.",
    },
    connections: {
      list: "Các nguồn của khách hàng và trạng thái kết nối.",
      get: "Một nguồn và trạng thái kết nối của nó.",
      startOAuth: "Bắt đầu cấp quyền OAuth; trả về URL để mở trong trình duyệt. Quản trị.",
      browseScope:
        "Những gì có thể chọn cho phạm vi đọc: nhãn Gmail, tổ chức Xero, thư mục Google Drive kèm đường dẫn và các loại tệp đang có, hoặc các trường của từng đối tượng HubSpot, kể cả trường do portal tự tạo. Quản trị.",
      setScope:
        "Đặt phạm vi đọc của một nguồn. Với HubSpot, các trường chọn thêm cho từng đối tượng được đọc cùng các trường chuẩn, không thay thế chúng. Quản trị.",
      setToken: "Kết nối một nguồn bằng token dán vào. Quản trị.",
      setCadence: "Đặt tần suất đọc một nguồn. Quản trị.",
      disconnect: "Chấm dứt quyền truy cập của một nguồn. Quản trị.",
    },
    keys: {
      list: "Các khoá nạp dữ liệu của khách hàng. Quản trị.",
      mint: "Tạo khoá nạp dữ liệu; token chỉ được trả về một lần. Quản trị.",
      revoke: "Thu hồi một khoá nạp dữ liệu. Quản trị.",
    },
    people: {
      members: "Những người có quyền truy cập khách hàng.",
      invitations: "Các lời mời đang mở.",
      invite: "Mời một địa chỉ với một vai trò. Quản trị.",
      revokeInvitation: "Thu hồi một lời mời đang mở. Quản trị.",
      setRole: "Đổi vai trò của một thành viên; không áp dụng cho admin cuối cùng. Quản trị.",
      removeMember:
        "Gỡ quyền truy cập của một thành viên; không áp dụng cho admin cuối cùng. Quản trị.",
    },
    lake: {
      summary: "Những gì đã nạp, theo từng luồng: số lượng và độ mới.",
      records: "Các bản ghi thô của một thực thể. Quản trị.",
      documents: "Các tài liệu thô của một nguồn. Quản trị.",
      query: "Chạy một câu SELECT trên hồ dữ liệu thô. Quản trị.",
      search: "Tìm kiếm toàn văn trên hồ dữ liệu thô. Quản trị.",
      querySchema: "Các bảng và cột mà lake query đọc được. Quản trị.",
    },
    models: {
      list: "Các mô hình dbt của khách hàng.",
      get: "Một mô hình dbt và SQL của nó.",
      save: "Lưu một mô hình dbt; không chạy gì. Quản trị.",
      delete: "Xoá một mô hình dbt. Quản trị.",
      build: "Chạy dbt cho một mô hình và chờ kết quả. Quản trị.",
      reference: "Tài liệu tham khảo cho người viết mô hình.",
    },
    bi: {
      answer: "Trả lời một định nghĩa câu hỏi. Thành viên trở lên.",
      runQuestion: "Chạy một câu hỏi đã lưu với tham số.",
      compile: "Dịch một định nghĩa câu hỏi thành SQL. Thành viên trở lên.",
      schema: "Các bảng và cột mà báo cáo đọc được.",
      questions: {
        list: "Các câu hỏi đã lưu.",
        get: "Một câu hỏi đã lưu.",
        answer: "Câu trả lời của một câu hỏi đã lưu với tham số.",
        save: "Lưu một câu hỏi. Thành viên trở lên.",
        delete: "Xoá một câu hỏi. Thành viên trở lên.",
      },
      dashboards: {
        list: "Các bảng điều khiển.",
        get: "Một bảng điều khiển.",
        save: "Lưu một bảng điều khiển. Thành viên trở lên.",
        delete: "Xoá một bảng điều khiển. Thành viên trở lên.",
      },
    },
    dq: {
      failures: "Các dòng mà một kiểm thử chất lượng dữ liệu đã lưu khi thất bại. Quản trị.",
    },
    runs: {
      list: "Sổ các lần chạy, mới nhất trước.",
      get: "Một lần chạy, với các dòng bị từ chối và các bước dbt.",
      events: "Những gì worker đang báo về một lần chạy.",
      trigger: "Chạy ngay việc đọc một nguồn. Quản trị.",
    },
    config: {
      google: "Nửa công khai của ứng dụng Google, cho trình chọn Drive.",
    },
    health: "Máy chủ có đang trả lời không.",
  },
};
