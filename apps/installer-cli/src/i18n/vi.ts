/**
 * Vietnamese, for everything the setup wizard says to a person -- the source of truth for which
 * keys exist. `en.ts` answers each one and `index.ts` pins that with a type annotation.
 *
 * A command, a flag and a file name are not translated: they are what a person types
 * (`.claude/rules/i18n.md`). Nor is a vendor's name.
 */

import type { CliProblemCode } from "../services/options.ts";

export const vi = {
  help: [
    "Cài đặt và vận hành Undercroft trên máy này bằng Docker.",
    "",
    "Cách dùng: undercroft-installer [lệnh] [tuỳ chọn]",
    "",
    "Lệnh:",
    "  up         Cài đặt, hoặc khởi động bản đã cài (mặc định)",
    "  down       Dừng Undercroft; dữ liệu được giữ nguyên",
    "  status     Trạng thái từng dịch vụ",
    "  logs       Theo dõi nhật ký (logs [dịch vụ])",
    "  update     Chuyển sang bản phát hành của trình cài đặt này, hoặc --tag vX.Y.Z",
    "  uninstall  Gỡ cài đặt; thêm --keep-data để giữ dữ liệu",
    "",
    "Tuỳ chọn chung: --lang vi|en, --dir <thư mục>, --yes (không hỏi), --help, --version",
    "Cài không cần hỏi: --mode desktop|server, --port, --bind, --public-url, --admin,",
    "  --email-api-key, --email-from, --google-client-id, --google-client-secret,",
    "  --google-ingest-client-id, --google-ingest-client-secret, --xero-client-id,",
    "  --xero-client-secret, --tag, --dry-run, --no-open",
    "",
    "Hướng dẫn đầy đủ: docs/runbook/install.md",
  ].join("\n"),

  intro: "Cài đặt Undercroft {{version}}",
  outro: "Xong.",
  pressEnter: "Nhấn Enter để đóng cửa sổ này.",
  cancelled: "Đã huỷ. Chưa có gì thay đổi sau bước cuối cùng đã xong.",
  badInvocation: "Không hiểu lệnh này: {{detail}}. Xem --help.",
  noInstall: "Chưa có bản cài nào ở {{dir}}. Chạy undercroft-installer để cài.",
  stepFailed: "Bước này không thành công. Những dòng cuối Docker in ra:",

  language: {
    question: "Ngôn ngữ / Language",
  },

  mode: {
    question: "Bạn cài Undercroft cho ai?",
    desktop: "Chỉ mình tôi, trên máy này",
    desktopHint: "mở tại localhost, tự đăng nhập, không cần email",
    server: "Cả nhóm, trên một máy chủ",
    serverHint: "cần địa chỉ https, reverse proxy và một cách đăng nhập",
    name: {
      desktop: "máy cá nhân",
      server: "máy chủ",
    },
  },

  existing: {
    found: "Đã có một bản cài ở {{dir}}: {{url}}",
    question: "Bạn muốn làm gì?",
    start: "Khởi động bản đã cài",
    reconfigure: "Đổi cấu hình (mật khẩu và khoá bí mật được giữ nguyên)",
  },

  docker: {
    checking: "Đang kiểm tra Docker…",
    ready: "Docker đã sẵn sàng (Compose {{version}}).",
    missing: "Máy này chưa có Docker. Undercroft chạy trong Docker.",
    licence:
      "Docker Desktop miễn phí cho cá nhân và doanh nghiệp nhỏ; công ty trên 250 nhân viên hoặc doanh thu trên 10 triệu USD cần giấy phép trả phí.",
    offerInstall: "Cài Docker ngay bây giờ bằng lệnh: {{command}}?",
    installManual: "Hãy tải và cài Docker tại {{url}}, mở nó lên, rồi chạy lại trình cài đặt.",
    stopped: "Docker đã được cài nhưng chưa chạy.",
    offerStart: "Mở Docker ngay bây giờ?",
    startManual: "Hãy mở Docker, đợi nó báo đang chạy, rồi chạy lại trình cài đặt.",
    waiting: "Đang đợi Docker khởi động…",
    noPermission:
      "Người dùng này chưa được phép dùng Docker. Chạy: sudo usermod -aG docker $USER, đăng xuất rồi đăng nhập lại, rồi chạy lại trình cài đặt.",
    noCompose:
      "Docker thiếu Compose v2. Hãy cài gói docker-compose-plugin (hoặc cập nhật Docker Desktop), rồi chạy lại trình cài đặt.",
    notReady: "Docker chưa sẵn sàng; --yes không tự cài Docker. Hãy cài và mở Docker trước.",
  },

  settings: {
    port: "Cổng trên máy này",
    bind: "Địa chỉ mở cổng (127.0.0.1 khi reverse proxy chạy trên cùng máy chủ)",
    publicUrl: "Địa chỉ https mọi người dùng để mở Undercroft",
    adminEmail: "Email của quản trị viên đầu tiên",
    signIn: "Mọi người đăng nhập bằng cách nào?",
    signInEmail: "Mã một lần gửi qua email (Resend)",
    signInGoogle: "Tài khoản Google",
    emailApiKey: "Khoá API của Resend",
    emailFrom: "Người gửi, ví dụ: Undercroft <no-reply@ten-mien-cua-ban>",
    googleClientId: "Client ID của ứng dụng đăng nhập Google",
    googleClientSecret: "Client secret của ứng dụng đăng nhập Google",
    keep: "(để trống để giữ giá trị hiện có)",
    required: "Cần điền mục này.",
  },

  connectors: {
    question: "Bật thêm nguồn dữ liệu nào? (HubSpot luôn có sẵn, không cần cấu hình)",
    hint: "phím cách để chọn, Enter để tiếp tục",
    googleIngest: "Gmail và Google Drive",
    xero: "Xero",
    clientId: "Client ID của {{name}}",
    clientSecret: "Client secret của {{name}}",
  },

  install: {
    summary: "Sẽ cài chế độ {{mode}} vào {{dir}}, mở tại {{url}}, bản phát hành {{tag}}.",
    confirm: "Bắt đầu cài đặt?",
    dryRun: "Chạy thử: không ghi tệp nào và không gọi Docker.",
    written: "Đã ghi cấu hình vào {{dir}}.",
    orphaned:
      "Máy này còn dữ liệu của một bản cài trước ({{volume}}) nhưng tệp .env giữ khoá của nó đã mất. Hãy khôi phục .env vào {{dir}}, hoặc chạy undercroft-installer uninstall để xoá dữ liệu cũ.",
    pulling: "Đang tải các image (lần đầu mất vài phút)…",
    pulled: "Đã tải xong các image.",
    starting: "Đang khởi động các dịch vụ (lần đầu Kestra mất khoảng một phút)…",
    started: "Các dịch vụ đã chạy.",
    waiting: "Đang đợi Undercroft trả lời…",
    unhealthy:
      "Undercroft chưa trả lời sau {{minutes}} phút ({{error}}). Xem nhật ký bằng undercroft-installer logs control-plane.",
  },

  done: {
    desktop: "Undercroft đang chạy tại {{url}} — bạn được đăng nhập với tư cách chủ sở hữu.",
    cli: "Từ CLI undercroft: undercroft config set-profile local --url {{url}}, rồi undercroft auth login — không cần mã.",
    server: "Undercroft đang chạy trên cổng {{bind}}:{{port}}.",
    proxy: "Trỏ reverse proxy https của bạn tới http://{{bind}}:{{port}}; mọi người mở {{url}}.",
    admin: "Quản trị viên {{email}} đăng nhập tại {{url}} rồi mời những người còn lại.",
    redirects: "Đăng ký các URI chuyển hướng này với nhà cung cấp tương ứng:",
    backup:
      "Hãy sao lưu {{env}}: nó giữ UNDERCROFT_SECRET_KEY và mật khẩu của các volume dữ liệu. Mất tệp này là mất quyền mở dữ liệu. Hồ dữ liệu thô (volume minio-data) là lớp duy nhất không thể dựng lại.",
  },

  redirect: {
    googleSignIn: "Google (đăng nhập): {{uri}}",
    googleIngest: "Google (Gmail, Drive): {{uri}}",
    xero: "Xero: {{uri}}",
  },

  problem: {
    "port-invalid": "Cổng phải là số nguyên từ 1 đến 65535.",
    "image-tag-invalid": "Bản phát hành phải có dạng vX.Y.Z.",
    "bind-invalid": "Địa chỉ mở cổng phải là một địa chỉ IPv4, ví dụ 127.0.0.1 hoặc 0.0.0.0.",
    "public-url-invalid":
      "Địa chỉ phải là một origin, ví dụ https://data.congty.vn, không có đường dẫn.",
    "public-url-not-https":
      "Địa chỉ của máy chủ phải là https: phiên đăng nhập không được đi qua mạng dạng văn bản thường.",
    "admin-email-invalid": "Email của quản trị viên không hợp lệ.",
    incomplete: "Một mục của {{field}} đang để trống.",
    unwritable: "{{field}} chứa dấu nháy đơn hoặc xuống dòng, tệp .env không ghi được.",
    "desktop-bind":
      "Bản cài cho máy cá nhân chỉ mở trên 127.0.0.1; --bind chỉ dùng với --mode server.",
  } satisfies Record<CliProblemCode, string>,

  field: {
    port: "cổng",
    imageTag: "bản phát hành",
    bind: "địa chỉ mở cổng",
    publicUrl: "địa chỉ https",
    adminEmail: "email quản trị viên",
    signIn: "cách đăng nhập",
    googleIngest: "Gmail và Google Drive",
    xero: "Xero",
  },

  status: {
    none: "Không có dịch vụ nào đang chạy.",
    unknown: "Docker không cho biết được trạng thái.",
    row: "{{service}}: {{state}}",
  },

  down: {
    done: "Đã dừng Undercroft. Dữ liệu được giữ nguyên; chạy undercroft-installer up để khởi động lại.",
  },

  update: {
    summary: "Chuyển bản cài ở {{dir}} từ {{from}} sang {{to}}.",
  },

  uninstall: {
    needsYes: "Chạy không có terminal: thêm --yes để xác nhận gỡ cài đặt.",
    confirmKeep: "Gỡ các container của Undercroft, giữ lại dữ liệu và tệp .env?",
    confirmAll:
      "Xoá hẳn Undercroft, kể cả MỌI dữ liệu: hồ dữ liệu thô, cơ sở dữ liệu và tệp .env. Không thể hoàn tác. Tiếp tục?",
    doneKeep: "Đã gỡ các container. Dữ liệu và {{dir}} được giữ lại.",
    doneAll: "Đã xoá Undercroft và toàn bộ dữ liệu của nó.",
  },
};
