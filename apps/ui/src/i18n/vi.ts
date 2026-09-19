/**
 * Vietnamese, and the catalogue every other language is measured against.
 *
 * This file is the SOURCE OF TRUTH for what keys exist. `@/i18n` declares i18next's
 * `CustomTypeOptions` against `typeof vi`, so a key that is not here is a typecheck error at
 * the call site, and `i18n.test.ts` fails if `en.ts` does not answer every key in it.
 *
 * Vietnamese first because the operators read Vietnamese; English is carried for the
 * colleagues and auditors who do not. `DEFAULT_LOCALE` in `@undercroft/core` records the
 * same decision on the server.
 *
 * ## Writing a message here
 *
 * - **Interpolation is `{{name}}`.** Never build a sentence by concatenating translated
 *   fragments: word order is not shared between these two languages, and a sentence
 *   assembled from pieces can only be correct in the language it was assembled in.
 * - **A count uses i18next's plural suffixes**, `_one`/`_other`, and is written
 *   `{{count, number}}` so it is grouped the reader's way -- `1.234` in Vietnamese,
 *   `1,234` in English. Vietnamese has one plural form, so only `_other` appears here;
 *   English adds `_one` in `en.ts` and that asymmetry is expected -- the parity test
 *   compares keys with the suffix stripped.
 * - **No date and no monetary amount is formatted here.** Those go through `@/lib/when`
 *   and `@/lib/money`, which decide a zone and a separator in one place each.
 */

// biome-ignore-all lint/style/useNamingConvention: Every name this fires on is an identifier owned by something outside this repo, and renaming it would break the call: Postgres column names (tenant_id, expires_at, display_name), the AWS S3 SDK command shape (Bucket, Key, Body), Docker's inspect JSON (State, Status, ExitCode, Config, Image), a source API's payload keys, HTTP header names, and Better Auth's option keys and table names. strictCase cannot be satisfied by code that talks to another system.

export const vi = {
  app: {
    name: "Undercroft",
    caption: "Undercroft · bảng điều khiển",
    signOut: "Đăng xuất",
    /**
     * Labels the build stamp in the colophon. The tag beside it is never translated and
     * never reformatted: it is the literal string that rolls the stack back to this build.
     */
    release: "Phiên bản",
  },

  lang: {
    label: "Ngôn ngữ",
    vi: "Tiếng Việt",
    en: "English",
    /** The short face on the switcher itself, where there is room for two letters. */
    viShort: "VI",
    enShort: "EN",
  },

  nav: {
    sections: "Các mục",
    customers: "Khách hàng",
    sources: "Nguồn dữ liệu",
    lake: "Hồ dữ liệu thô",
    people: "Người dùng",
    lockedTitle: "Hãy chọn một khách hàng trước",
    /** Read to a screen reader after the tab's own label, hence the leading dash. */
    lockedHint: " — hãy chọn một khách hàng trước",
  },

  common: {
    loading: "Đang tải",
    notLoaded: "Không tải được",
    nothingToShow: "Không có gì để hiển thị.",
  },

  signIn: {
    title: "Bảng điều khiển",
    lead: "Kết nối các tài khoản của bạn và xem những gì đã được đồng bộ.",
    expired: "Phiên làm việc đã kết thúc. Hãy đăng nhập lại để tiếp tục.",
    deniedHeading: "Không có quyền truy cập",
    denied:
      "Tài khoản đó không có quyền truy cập. Nếu bạn đã được mời, hãy đăng nhập bằng đúng địa chỉ đã nhận lời mời.",
    google: "Tiếp tục với Google",
    emailLabel: "Hoặc đăng nhập bằng mã",
    emailPlaceholder: "ban@example.com",
    notSent: "Chưa gửi được",
    sending: "Đang gửi…",
    sendCode: "Gửi mã cho tôi",
    codeLabel: "Mã sáu chữ số",
    codeHint: "Nếu {{email}} có quyền truy cập, mã đang được gửi đi. Mã hết hạn sau mười phút.",
    notSignedIn: "Chưa đăng nhập được",
    signingIn: "Đang đăng nhập…",
    signIn: "Đăng nhập",
    useAnotherAddress: "Dùng địa chỉ khác",
    /** Shown only when the server refused without saying why. */
    sendFailed: "Không gửi được mã đăng nhập. Hãy thử lại.",
    codeFailed: "Mã đó không dùng được. Hãy yêu cầu mã mới.",
  },

  tenants: {
    title: "Các công ty thành viên",
    lead: "Dữ liệu của mỗi khách hàng được lưu trữ và truy cập riêng biệt. Mở một khách hàng để cấp, giới hạn hoặc thu hồi quyền truy cập vào tài khoản của họ.",
    emptyTitle: "Chưa có khách hàng nào",
    emptyBody:
      "Khách hàng là đơn vị mà mọi thứ khác gắn vào: các tài khoản đã kết nối, các bản ghi đã đồng bộ, và những ai được xem chúng.",
    caption_other: "{{count, number}} khách hàng",
    colCustomer: "Khách hàng",
    colReference: "Mã tham chiếu",
    colRole: "Vai trò của bạn",
    addHead: "Thêm khách hàng",
    /**
     * Shown in place of the form to everyone who is not a platform administrator. It names
     * who can do this rather than only saying that the reader cannot, so the next step is
     * obvious instead of being a dead end.
     */
    addNote:
      "Chỉ quản trị viên toàn hệ thống mới thêm được khách hàng. Hãy đề nghị người quản lý bảng điều khiển tạo mã tham chiếu mới.",
    addLead:
      "Mã tham chiếu là một CASE-id và không đổi được sau khi dữ liệu thô đầu tiên đã ghi vào hồ — hãy chọn kỹ.",
    idLabel: "Mã tham chiếu",
    idPlaceholder: "CASE-0001",
    idHint: "Chữ cái, chữ số, dấu gạch ngang và gạch dưới. Không dùng tên thật của khách hàng.",
    nameLabel: "Tên hiển thị",
    namePlaceholder: "Để trống thì dùng chính mã tham chiếu",
    add: "Thêm khách hàng",
    adding: "Đang thêm…",
    notAdded: "Chưa thêm được",
    notLoaded: "Không tải được danh sách khách hàng. Không có gì bị thay đổi.",
  },

  sources: {
    title: "Các nguồn đã kết nối",
    none: "Khách hàng này chưa kết nối nguồn nào.",
    count_other: "Có {{count, number}} nguồn được ghi nhận.",
    grantsHead: "Quyền đã cấp",
    colSource: "Nguồn",
    colStatus: "Trạng thái",
    notLoaded:
      "Không tải được các quyền của khách hàng này, hoặc bạn không có quyền xem chúng. Không có gì bị thay đổi.",
  },

  lake: {
    head: "Hồ dữ liệu",
    title: "Hồ dữ liệu thô",
    lead: "Những gì thực sự đã về cho {{tenantId}}, trước mọi bước biến đổi.",
    emptyTitle: "Chưa khả dụng",
    emptyBody:
      "Việc duyệt các đối tượng trong hồ dữ liệu và nguồn gốc của chúng cần những endpoint mà bảng điều khiển chưa cung cấp. Mục này có sẵn để dùng khi chúng xuất hiện.",
  },

  people: {
    title: "Người dùng",
    lead: "Ai được xem {{tenantId}}, và họ đã được mời như thế nào.",
    emptyTitle: "Chưa ai có quyền truy cập",
    emptyBody:
      "Hãy mời một địa chỉ email bên dưới. Người kiểm soát địa chỉ đó có thể đăng nhập bằng Google hoặc mã dùng một lần — lời mời chính là thứ cho phép họ vào.",
    caption_other: "{{count, number}} người có quyền truy cập",
    colAddress: "Địa chỉ",
    colRole: "Vai trò",
    notLoaded: "Không tải được danh sách người dùng của {{tenantId}}. Không có gì bị thay đổi.",

    invitationsHead: "Lời mời",
    noneWaiting: "Không có lời mời nào đang chờ được chấp nhận.",
    waitingCaption_other: "{{count, number}} lời mời đang chờ được chấp nhận",
    colInvitedAs: "Được mời với vai trò",
    colExpires: "Hết hạn",
    colWithdraw: "Thu hồi",
    withdraw: "Thu hồi",
    notWithdrawn: "Chưa thu hồi được",

    inviteLabel: "Mời một địa chỉ",
    invitePlaceholder: "dongnghiep@example.com",
    inviteHint:
      "Họ phải đăng nhập bằng đúng địa chỉ này. Lời mời không phải là mật khẩu — nó không cấp gì cho đến khi họ chứng minh mình kiểm soát hòm thư.",
    roleLabel: "Vai trò",
    roleViewer: "viewer — chỉ xem",
    roleMember: "member — có thể chạy đồng bộ",
    roleAdmin: "admin — có thể kết nối tài khoản và mời người khác",
    notInvited: "Chưa mời được",
    invitedAndEmailed: "Đã mời {{email}}. Email đã được gửi cho họ.",
    invitedNotEmailedHeading: "Đã mời, nhưng chưa gửi được email",
    invitedNotEmailed:
      "{{email}} có thể đăng nhập ngay, nhưng chưa có email nào được gửi — hệ thống mail chưa được cấu hình. Hãy báo họ đăng nhập bằng đúng địa chỉ đó.",
    inviting: "Đang mời…",
    sendInvitation: "Gửi lời mời",
    adminOnly: "Chỉ quản trị viên của {{tenantId}} mới có thể mời người khác.",
  },

  grant: {
    markGranted: "Đã cấp",
    markPending: "Chờ chọn phạm vi",
    markLapsed: "Cần kết nối lại",
    markAbsent: "Chưa cấp",
    account: "Tài khoản",
    reads: "Đọc",
    schedule: "Lịch",
    since: "Từ",
    connect: "Kết nối {{name}}",
    chooseScope: "Chọn dữ liệu cần đồng bộ",
    reconnect: "Kết nối lại {{name}}",
    changeScope: "Đổi dữ liệu đồng bộ",
    disconnect: "Ngắt kết nối",
    connecting: "Đang chuyển tới Google…",
    connectFailed: "Chưa kết nối được nguồn này.",
    connectDeclined: "Bạn đã huỷ ở màn hình của Google. Không có gì được cấp.",
    /**
     * Distinct from `connectDeclined` because what the reader did was different: they
     * pressed Allow, having unticked the permission that makes the source work. Nothing was
     * saved, and the sentence has to say which tick to leave alone next time.
     */
    connectScopeDeclined:
      "Ở màn hình của Google, quyền cần thiết đã bị bỏ tích nên kết nối chưa được lưu. Hãy kết nối lại và giữ nguyên mọi dấu tích.",
    disconnecting: "Đang ngắt kết nối…",
    disconnectFailed: "Chưa ngắt kết nối được.",
    disconnected: "Đã ngắt kết nối.",
    disconnectedNotRevoked:
      "Đã ngắt kết nối phía chúng tôi, nhưng chưa báo được cho Google. Hãy thu hồi quyền tại myaccount.google.com/permissions.",
    errata: "Đính chính",
    whatWeRead: "Chúng tôi đọc gì",
    whatWeChange: "Chúng tôi thay đổi gì",
  },

  /** What a connection card says in each state. Chosen by `@/lib/connectionState`. */
  grantState: {
    lapsedHeadline: "Cần kết nối lại",
    lapsedDetail:
      "Quyền truy cập đã cấp nay đã hết hiệu lực hoặc bị thu hồi. Không có dữ liệu nào bị mất — kết nối lại sẽ tiếp tục từ lần đồng bộ gần nhất.",
    notConnectedHeadline: "Chưa kết nối",
    needsScopeHeadline: "Chọn dữ liệu cần đồng bộ",
    needsScopeDetail: "Đã kết nối. Hãy cho biết cần đọc tài khoản nào trước lần đồng bộ đầu tiên.",
    needsScopeDetailNamed:
      "Đã kết nối tới {{account}}. Hãy chọn dữ liệu cần đồng bộ trước lần chạy đầu tiên.",
    connectedHeadline: "Đã kết nối",
    connectedDetail: "Đang đồng bộ theo lịch.",
    actionConnect: "Kết nối",
    actionChoose: "Chọn",
    actionReconnect: "Kết nối lại",
  },

  /** What a live grant permits, in the customer's words. `@/lib/connectionState`. */
  scopePicker: {
    title: "Chọn những gì được đọc",
    leadGmail:
      "Chọn các nhãn cần đọc. Chỉ tiêu đề thư và tệp PDF đính kèm trong những nhãn đó được đọc; không nhãn nào khác được đọc.",
    leadDrive:
      "Chọn thư mục hoặc tài liệu cần đọc. Google chỉ cho phép đọc đúng những gì bạn chọn ở đây.",
    wholeMailbox: "Đọc toàn bộ hòm thư",
    wholeMailboxHint:
      "Không chọn nhãn nào nghĩa là đọc toàn bộ hòm thư. Đây là một lựa chọn có chủ đích, không phải bỏ trống.",
    directChildrenOnly:
      "Chỉ đọc tệp nằm trực tiếp trong thư mục đã chọn. Thư mục con không được đọc.",
    labelsHead: "Nhãn",
    /** The runs of the index. Gmail reports who owns a label; nothing here infers it. */
    labelsMine: "Nhãn của bạn",
    labelsSystem: "Nhãn sẵn có của Gmail",
    labelsUnclassified: "Nhãn chưa phân loại",
    filterLabel: "Lọc danh sách nhãn",
    filterPlaceholder: "Gõ để lọc",
    /** The size of the mailbox while nothing is typed; the ratio once something is. */
    filterTotal_other: "{{count, number}} nhãn",
    /** Figures only, and the same two in either language. The words are the key below. */
    filterTally: "{{shown, number}} / {{total, number}}",
    filterTallyRead: "Đang hiện {{shown, number}} trong {{total, number}} nhãn",
    noMatch: "Không có nhãn nào khớp với từ đã gõ.",
    /** The standing line under the list: what this selection permits, while it is made. */
    echoHead: "Sẽ đọc",
    echoChosen_other: "Tiêu đề thư và tệp PDF đính kèm trong {{count, number}} nhãn đã chọn",
    clearAll: "Bỏ chọn tất cả",
    pickFromDrive: "Chọn từ Google Drive",
    nothingToChoose: "Chưa có mục nào để chọn.",
    notLoaded: "Không tải được danh sách từ Google. Không có gì bị thay đổi.",
    save: "Lưu lựa chọn",
    saving: "Đang lưu…",
    notSaved: "Không lưu được lựa chọn.",
    saved: "Đã lưu lựa chọn.",
    pickerUnavailable:
      "Bộ chọn của Google chưa sẵn sàng. Hãy tải lại trang; nếu vẫn vậy, kết nối Google Drive chưa được cấu hình.",
  },

  scope: {
    driveFolders_other: "PDF trong {{count, number}} thư mục đã chọn",
    gmailWholeMailbox: "Tiêu đề thư và tệp PDF đính kèm, toàn bộ hòm thư",
    gmailLabels: "Tiêu đề thư và tệp PDF đính kèm trong {{labels}}",
  },

  /** Dates in the operator's terms. Chosen by `@/lib/when`. */
  when: {
    noExpiry: "Không ghi nhận hạn dùng",
    lapsedYesterday: "Đã hết hạn từ hôm qua",
    lapsedDays_other: "Đã hết hạn {{count, number}} ngày trước",
    expiresToday: "Hết hạn hôm nay",
    expiresTomorrow: "Hết hạn ngày mai",
    expiresInDays_other: "Còn {{count, number}} ngày nữa là hết hạn",
    hourly: "Mỗi giờ",
    dailyAt: "Hằng ngày lúc {{time}} SGT",
  },

  /** The three-valued comparison, kept three-valued. `@/lib/verdict`. */
  verdict: {
    okLabel: "Đã đối chiếu khớp",
    okDescription: "Đã kiểm tra với nguồn và khớp.",
    mismatchLabel: "Lệch",
    mismatchDescription: "Đã kiểm tra với nguồn và không khớp.",
    unverifiedLabel: "Chưa kiểm chứng",
    unverifiedDescription:
      "Không có bằng chứng theo hướng nào. Không có sai lệch không có nghĩa là khớp.",
  },

  /**
   * What the platform will read, in the customer's words rather than ours.
   *
   * Shown BEFORE the redirect. Someone is about to hand over access to their company email
   * and their accounting system, and a button with no statement of what that means is not
   * consent -- so this copy is load-bearing, and translating it loosely would weaken the
   * consent it exists to obtain.
   */
  source: {
    readOnly: "Không gì cả. Quyền chỉ đọc, và bạn có thể ngắt kết nối bất cứ lúc nào.",
    hubspotReads: "Công ty, liên hệ và giao dịch từ CRM của bạn.",
    xeroReads: "Hóa đơn, thanh toán, giấy báo có và liên hệ từ một tổ chức bạn chọn.",
    gmailReads: "Tiêu đề thư và tệp PDF đính kèm từ hòm thư bạn kết nối.",
    driveReads: "Tài liệu PDF trong các thư mục bạn chọn. Không thư mục nào khác được đọc.",
  },
};
