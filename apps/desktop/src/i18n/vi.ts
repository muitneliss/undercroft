/**
 * Vietnamese, for everything the desktop app says to a person -- the wizard's window, the tray
 * menu and its dialogs. The source of truth for which keys exist; `en.ts` answers each one and
 * `index.ts` pins that with a type annotation, `i18n.test.ts` with a comparison.
 *
 * A command, a file name and a vendor's name are not translated (`.claude/rules/i18n.md`), and
 * neither is a word Docker prints about a service (`running`, `healthy`): it is Docker's.
 */

import type { WizardProblemCode } from "../view/wizard.ts";

export const vi = {
  app: {
    name: "Undercroft",
    windowTitle: "Cài đặt Undercroft",
  },

  steps: {
    language: "Ngôn ngữ",
    mode: "Chế độ",
    docker: "Docker",
    settings: "Cấu hình",
    connectors: "Nguồn dữ liệu",
    install: "Cài đặt",
    done: "Xong",
  },

  nav: {
    next: "Tiếp tục",
    back: "Quay lại",
    required: "Cần điền mục này.",
  },

  language: {
    title: "Ngôn ngữ / Language",
    lead: "Chọn ngôn ngữ cho trình cài đặt và cho Undercroft.",
  },

  mode: {
    title: "Bạn cài Undercroft cho ai?",
    desktop: "Chỉ mình tôi, trên máy này",
    desktopHint: "Mở tại localhost, tự đăng nhập, không cần email. Dữ liệu ở lại trên máy này.",
    server: "Cả nhóm, trên một máy chủ",
    serverHint:
      "Cần một địa chỉ https, một reverse proxy của bạn và một cách đăng nhập cho mọi người.",
  },

  docker: {
    title: "Docker",
    lead: "Undercroft chạy trong Docker. Trình cài đặt kiểm tra Docker trước khi làm gì khác.",
    checking: "Đang kiểm tra Docker…",
    ready: "Docker đã sẵn sàng (Compose {{version}}).",
    missing: "Máy này chưa có Docker.",
    stopped: "Docker đã được cài nhưng chưa chạy.",
    noPermission:
      "Người dùng này chưa được phép dùng Docker. Chạy sudo usermod -aG docker $USER, đăng xuất rồi đăng nhập lại, sau đó bấm Kiểm tra lại.",
    noCompose:
      "Docker thiếu Compose v2. Hãy cập nhật Docker Desktop, hoặc cài gói docker-compose-plugin, rồi bấm Kiểm tra lại.",
    licence:
      "Docker Desktop miễn phí cho cá nhân và doanh nghiệp nhỏ; công ty trên 250 nhân viên hoặc doanh thu trên 10 triệu USD cần giấy phép trả phí.",
    licenceLink: "Điều khoản của Docker",
    install: "Cài Docker cho tôi",
    installing: "Đang cài Docker… Windows có thể hỏi quyền quản trị.",
    command: "Lệnh sẽ chạy: {{command}}",
    runYourself: "Chạy lệnh này trong Terminal, rồi quay lại đây: {{command}}",
    download: "Tải Docker",
    start: "Mở Docker",
    starting: "Đang đợi Docker khởi động… lần đầu có thể mất vài phút.",
    recheck: "Kiểm tra lại",
    restartNeeded:
      "Docker đã được cài nhưng Windows cần khởi động lại để bật WSL 2. Sau khi khởi động lại, trình cài đặt tự mở lại ở bước này.",
    restart: "Khởi động lại Windows",
    restartFailed: "Không khởi động lại được. Hãy tự khởi động lại máy rồi mở Undercroft.",
    installFailed: "Chưa cài được Docker. Hãy tải và cài Docker bằng tay, rồi bấm Kiểm tra lại.",
  },

  settings: {
    title: "Cấu hình",
    dir: "Thư mục cài đặt",
    dirHint:
      "Nơi giữ tệp .env với mật khẩu và khoá bí mật của bản cài. Dữ liệu nằm trong các volume của Docker.",
    dirLocked: "Bản cài đã ở thư mục này; muốn chuyển chỗ thì gỡ cài đặt rồi cài lại.",
    choose: "Chọn…",
    port: "Cổng trên máy này",
    portHint: "Undercroft sẽ mở tại {{url}}.",
    publicUrl: "Địa chỉ https mọi người dùng để mở Undercroft",
    adminEmail: "Email của quản trị viên đầu tiên",
    bind: "Địa chỉ mở cổng",
    bindHint: "127.0.0.1 khi reverse proxy chạy trên cùng máy chủ.",
    signIn: "Mọi người đăng nhập bằng cách nào?",
    signInEmail: "Mã một lần gửi qua email (Resend)",
    signInGoogle: "Tài khoản Google",
    emailApiKey: "Khoá API của Resend",
    emailFrom: "Người gửi, ví dụ: Undercroft <no-reply@ten-mien-cua-ban>",
    googleClientId: "Client ID của ứng dụng đăng nhập Google",
    googleClientSecret: "Client secret của ứng dụng đăng nhập Google",
    googleRedirect: "Đăng ký URI chuyển hướng này trong ứng dụng Google: {{uri}}",
    reconfigure: "Đổi cấu hình của bản cài hiện có. Mật khẩu và khoá bí mật được giữ nguyên.",
  },

  connectors: {
    title: "Nguồn dữ liệu",
    lead: "Không bắt buộc. HubSpot luôn có sẵn, không cần cấu hình. Gmail, Google Drive và Xero cần một ứng dụng OAuth do chính bạn đăng ký; bạn có thể thêm sau bằng mục Cài đặt ở khay hệ thống.",
    googleIngest: "Gmail và Google Drive",
    xero: "Xero",
    enable: "Bật {{name}}",
    clientId: "Client ID",
    clientSecret: "Client secret",
    redirect: "URI chuyển hướng cần đăng ký:",
    guide: "Hướng dẫn đăng ký ứng dụng",
    skip: "Bỏ qua, để sau",
  },

  install: {
    title: "Cài đặt",
    lead: "Trình cài đặt sẽ:",
    mode: "Chế độ: {{mode}}",
    modeDesktop: "chỉ mình tôi, trên máy này",
    modeServer: "cả nhóm, trên một máy chủ",
    dir: "Thư mục: {{dir}}",
    url: "Địa chỉ: {{url}}",
    tag: "Bản phát hành: {{tag}}",
    secretsNew: "Mật khẩu và khoá bí mật được tạo mới trên chính máy này.",
    secretsKept: "Mật khẩu và khoá bí mật hiện có được giữ nguyên.",
    start: "Cài đặt",
    retry: "Thử lại",
    phase: {
      writing: "Đang ghi cấu hình…",
      pulling: "Đang tải các image (lần đầu mất vài phút)…",
      starting: "Đang khởi động các dịch vụ (lần đầu Kestra mất khoảng một phút)…",
      waiting: "Đang đợi Undercroft trả lời…",
    },
    image: {
      pulling: "đang tải",
      pulled: "xong",
      failed: "lỗi",
    },
    failed: {
      docker: "Docker ngừng trả lời. Hãy quay lại bước Docker.",
      invalid: "Cấu hình chưa hợp lệ. Hãy quay lại bước Cấu hình.",
      orphaned:
        "Máy này còn dữ liệu của một bản cài trước ({{volume}}) nhưng tệp .env giữ khoá của nó đã mất. Hãy khôi phục .env vào thư mục cài đặt, hoặc chạy undercroft-installer uninstall để xoá dữ liệu cũ.",
      step: "Bước này không thành công. Những dòng cuối Docker in ra:",
      unhealthy:
        "Undercroft chưa trả lời ({{error}}). Xem nhật ký trong Docker Desktop, hoặc chạy undercroft-installer logs control-plane.",
      noInstall: "Chưa có bản cài nào ở thư mục này.",
    },
  },

  done: {
    title: "Xong",
    desktop: "Undercroft đang chạy tại {{url}}. Bạn được đăng nhập ngay với tư cách chủ sở hữu.",
    cli: "Từ CLI undercroft: undercroft config set-profile local --url {{url}}, rồi undercroft auth login — không cần mã.",
    server:
      "Undercroft đang chạy. Trỏ reverse proxy https của bạn tới cổng {{port}}; quản trị viên {{email}} đăng nhập tại {{url}} rồi mời những người còn lại.",
    open: "Mở Undercroft",
    close: "Đóng cửa sổ này",
    tray: "Undercroft vẫn chạy khi cửa sổ đóng; biểu tượng của nó ở khay hệ thống.",
    backup:
      "Hãy sao lưu {{env}}: nó giữ UNDERCROFT_SECRET_KEY và mật khẩu của các volume dữ liệu. Mất tệp này là mất quyền mở dữ liệu.",
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
    "dir-required": "Hãy chọn một thư mục cài đặt.",
  } satisfies Record<WizardProblemCode, string>,

  field: {
    dir: "thư mục cài đặt",
    port: "cổng",
    imageTag: "bản phát hành",
    bind: "địa chỉ mở cổng",
    publicUrl: "địa chỉ https",
    adminEmail: "email quản trị viên",
    signIn: "cách đăng nhập",
    googleIngest: "Gmail và Google Drive",
    xero: "Xero",
  },

  tray: {
    open: "Mở Undercroft",
    start: "Khởi động",
    stop: "Dừng",
    status: "Trạng thái",
    settings: "Cài đặt…",
    logs: "Thư mục nhật ký",
    updates: "Kiểm tra cập nhật",
    uninstall: "Gỡ cài đặt…",
    quit: "Thoát",
  },

  dialog: {
    ok: "OK",
    cancel: "Huỷ",
    starting: "Đang khởi động Undercroft…",
    started: "Undercroft đang chạy tại {{url}}.",
    startFailed: "Không khởi động được Undercroft.",
    stopped: "Đã dừng Undercroft. Dữ liệu được giữ nguyên.",
    stopFailed: "Không dừng được Undercroft.",
    statusTitle: "Trạng thái các dịch vụ",
    statusNone: "Không có dịch vụ nào đang chạy.",
    statusUnknown: "Docker không cho biết được trạng thái.",
    statusRow: "{{service}}: {{state}}",
    uninstallTitle: "Gỡ cài đặt Undercroft",
    uninstallQuestion: "Gỡ các container của Undercroft khỏi máy này?",
    uninstallDetail:
      "Giữ dữ liệu: có thể cài lại sau với cùng dữ liệu. Xoá hết: xoá hồ dữ liệu thô, cơ sở dữ liệu và tệp .env; không thể hoàn tác.",
    uninstallKeep: "Gỡ, giữ dữ liệu",
    uninstallAll: "Xoá hết",
    uninstallConfirm: "Xoá hẳn MỌI dữ liệu của Undercroft trên máy này? Không thể hoàn tác.",
    uninstallDoneKeep: "Đã gỡ các container. Dữ liệu và {{dir}} được giữ lại.",
    uninstallDoneAll:
      "Đã xoá Undercroft và toàn bộ dữ liệu của nó. Muốn gỡ luôn ứng dụng này thì xoá nó như mọi ứng dụng khác.",
    uninstallFailed: "Chưa gỡ được Undercroft.",
    noInstall: "Chưa có bản cài nào. Mở Cài đặt… để cài.",
    updatesNone: "Bạn đang dùng bản mới nhất.",
    updatesAvailable: "Có bản mới {{version}}. Tải về và khởi động lại ứng dụng?",
    updatesInstall: "Cập nhật",
    updatesLater: "Để sau",
    updatesFailed: "Không kiểm tra được bản cập nhật: {{error}}",
    updatesDev: "Bản dựng để phát triển không tự cập nhật.",
    updatesStack:
      "Ứng dụng đã được cập nhật. Chọn Khởi động ở khay hệ thống để chuyển Undercroft sang bản mới.",
  },
};
