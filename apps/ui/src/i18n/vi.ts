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

// biome-ignore-all lint/style/noExcessiveLinesPerFile: One catalogue, one file: every sentence the interface says in this language, in one place a translator reads top to bottom. Splitting it by length would split a language, and a key added to one half and forgotten in the other is exactly what the single file exists to prevent.
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
    journal: "Nhật ký",
    lake: "Hồ dữ liệu thô",
    models: "Mô hình",
    reports: "Báo cáo",
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
    colReference: "Mã khách hàng",
    colRole: "Vai trò của bạn",
    addHead: "Thêm khách hàng",
    /**
     * Shown in place of the form to everyone who is not a platform administrator. It names
     * who can do this rather than only saying that the reader cannot, so the next step is
     * obvious instead of being a dead end.
     */
    addNote:
      "Chỉ quản trị viên toàn hệ thống mới thêm được khách hàng. Hãy đề nghị người quản lý bảng điều khiển tạo mã khách hàng mới.",
    /**
     * Two sentences because there are two different promises, and running them together is
     * what produced the question this wording answers: an operator read one warning over a
     * form with two fields and concluded the whole form was permanent. The id is permanent
     * for a reason a reader can check -- it becomes the storage path -- and the display name
     * is not permanent at all.
     */
    addLead:
      "Mã khách hàng trở thành đường dẫn lưu trữ trong hồ dữ liệu thô, nên không đổi được sau khi dữ liệu đầu tiên đã ghi vào — hãy chọn kỹ. Tên hiển thị thì sửa lại được bất cứ lúc nào.",
    idLabel: "Mã khách hàng",
    idPlaceholder: "CASE-0001",
    idHint: "Chữ cái, chữ số, dấu gạch ngang và gạch dưới. Không dùng tên thật của khách hàng.",
    nameLabel: "Tên hiển thị",
    namePlaceholder: "Để trống thì dùng chính mã khách hàng",
    add: "Thêm khách hàng",
    adding: "Đang thêm…",
    notAdded: "Chưa thêm được",
    notLoaded: "Không tải được danh sách khách hàng. Không có gì bị thay đổi.",

    renameHead: "Đổi tên hiển thị",
    /**
     * The counterpart to `addLead`, on the page where the correction actually happens. It
     * states what does NOT change, because that is the question an operator hesitating over
     * this form is really asking.
     */
    renameLead:
      "Chỉ tên hiển thị thay đổi. Mã khách hàng và toàn bộ dữ liệu đã đồng bộ giữ nguyên.",
    renameNote: "Chỉ quản trị viên của khách hàng này mới đổi được tên hiển thị.",
    rename: "Lưu tên",
    renaming: "Đang lưu…",
    renamed: "Đã đổi tên hiển thị.",
    notRenamed: "Chưa đổi được tên",
  },

  sources: {
    title: "Các nguồn đã kết nối",
    none: "Khách hàng này chưa kết nối nguồn nào.",
    count_other: "Có {{count, number}} nguồn được ghi nhận.",
    grantsHead: "Quyền đã cấp",
    notLoaded:
      "Không tải được các quyền của khách hàng này, hoặc bạn không có quyền xem chúng. Không có gì bị thay đổi.",
  },

  /** Ingest keys: the credential a script presents to land data. Shown once, at minting. */
  keys: {
    head: "Khoá ghi dữ liệu",
    lead: "Khoá để một kịch bản hay bộ điều phối ghi dữ liệu vào hồ thay mặt {{tenantId}}. Mỗi khoá chỉ hiển thị một lần, lúc tạo.",
    notLoaded: "Không tải được danh sách khoá.",
    caption_other: "{{count, number}} khoá",
    colLabel: "Nhãn",
    colSources: "Nguồn",
    colCreated: "Tạo",
    colLastUsed: "Dùng gần nhất",
    colExpires: "Hết hạn",
    colRevoke: "Thu hồi",
    allSources: "Mọi nguồn",
    noExpiry: "Không hết hạn",
    revoked: "Đã thu hồi",
    revoke: "Thu hồi",
    notRevoked: "Chưa thu hồi được",
    none: "Chưa có khoá nào.",
    mintHead: "Tạo khoá mới",
    labelLabel: "Nhãn",
    labelPlaceholder: "Ví dụ: kịch bản nhập hoá đơn",
    sourcesLabel: "Nguồn được phép",
    sourcesHint: "Không chọn nguồn nào nghĩa là mọi nguồn.",
    expiresLabel: "Hết hạn sau",
    expiresNever: "Không hết hạn",
    expires30: "30 ngày",
    expires90: "90 ngày",
    expires365: "1 năm",
    mint: "Tạo khoá",
    minting: "Đang tạo…",
    notMinted: "Chưa tạo được khoá",
    mintedHead: "Khoá mới",
    mintedNote:
      "Sao chép ngay: khoá này sẽ không hiển thị lại. Nếu mất, hãy tạo khoá khác và thu hồi khoá này.",
    copy: "Sao chép",
    copied: "Đã sao chép vào bộ nhớ tạm.",
    notCopied: "Không sao chép được. Hãy chọn và sao chép bằng tay.",
    done: "Xong",
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
    lastRun: "Lần chạy gần nhất",
    nextRun: "Lần chạy kế tiếp",
    cadenceLabel: "Tần suất đồng bộ",
    runNow: "Chạy ngay",
    running: "Đang chạy…",
    runFailedHead: "Lần chạy gần nhất thất bại",
    openInJournal: "Xem trong nhật ký",
    runNotStarted: "Chưa chạy được",
    cadenceNotSaved: "Chưa lưu được tần suất",
    since: "Từ",
    connect: "Kết nối {{name}}",
    chooseScope: "Chọn dữ liệu cần đồng bộ",
    reconnect: "Kết nối lại {{name}}",
    changeScope: "Đổi dữ liệu đồng bộ",
    disconnect: "Ngắt kết nối",
    connectFailed: "Chưa kết nối được nguồn này.",
    connectDeclined: "Bạn đã huỷ ở màn hình của Google. Không có gì được cấp.",
    /**
     * Distinct from `connectDeclined` because what the reader did was different: they
     * pressed Allow, having unticked the permission that makes the source work. Nothing was
     * saved, and the sentence has to say which tick to leave alone next time.
     */
    connectScopeDeclined:
      "Ở màn hình của Google, quyền cần thiết đã bị bỏ tích nên kết nối chưa được lưu. Hãy kết nối lại và giữ nguyên mọi dấu tích.",
    disconnectFailed: "Chưa ngắt kết nối được.",
    disconnected: "Đã ngắt kết nối.",
    disconnectedNotRevoked:
      "Đã ngắt kết nối phía chúng tôi, nhưng chưa báo được cho Google. Hãy thu hồi quyền tại myaccount.google.com/permissions.",
    errata: "Đính chính",
    whatWeRead: "Chúng tôi đọc gì",
    whatWeChange: "Chúng tôi thay đổi gì",
    /** HubSpot: no consent screen, a private app's token pasted in the row. */
    pasteToken: "Dán mã ứng dụng riêng",
    tokenLabel: "Mã ứng dụng riêng của HubSpot",
    tokenHint:
      "Tạo trong HubSpot: Cài đặt → Tích hợp → Ứng dụng riêng. Mã được kiểm tra với HubSpot trước khi lưu và sẽ không hiển thị lại.",
    tokenSave: "Kiểm tra và lưu",
    tokenSaving: "Đang kiểm tra…",
    tokenRejected: "Mã chưa được chấp nhận",
  },

  /**
   * What a connection card says in each state. Chosen by `@/lib/connectionState`.
   *
   * Only the sentence the card prints. The headline is the source's own name and the
   * action's label is written on its plate, so neither is worded here; keys that were
   * translated and never reached a screen have been removed rather than kept "in case".
   */
  grantState: {
    lapsedDetail:
      "Quyền truy cập đã cấp nay đã hết hiệu lực hoặc bị thu hồi. Không có dữ liệu nào bị mất — kết nối lại sẽ tiếp tục từ lần đồng bộ gần nhất.",
    needsScopeDetail: "Đã kết nối. Hãy cho biết cần đọc tài khoản nào trước lần đồng bộ đầu tiên.",
    needsScopeDetailNamed:
      "Đã kết nối tới {{account}}. Hãy chọn dữ liệu cần đồng bộ trước lần chạy đầu tiên.",
    connectedDetail: "Đang đồng bộ theo lịch.",
  },

  /** What a live grant permits, in the customer's words. `@/lib/connectionState`. */
  scopePicker: {
    title: "Chọn những gì được đọc",
    leadGmail:
      "Chọn các nhãn cần đọc. Chỉ tiêu đề thư và tệp PDF đính kèm trong những nhãn đó được đọc; không nhãn nào khác được đọc.",
    leadDrive:
      "Chọn thư mục hoặc tài liệu cần đọc. Google chỉ cho phép đọc đúng những gì bạn chọn ở đây.",
    leadXero:
      "Chọn tổ chức Xero cần đọc, và những loại dữ liệu nào. Một lần cấp quyền có thể thấy nhiều tổ chức; chỉ tổ chức bạn chọn ở đây được đọc.",
    leadNone: "Nguồn này không cần chọn phạm vi.",
    xeroEntitiesHint:
      "Không chọn loại dữ liệu nào nghĩa là đọc tất cả các loại. Đây là một lựa chọn có chủ đích, không phải bỏ trống.",
    organisationsHead: "Tổ chức",
    entitiesHead: "Loại dữ liệu",
    noOrganisations:
      "Tài khoản Xero đã cấp quyền không thấy tổ chức nào. Hãy kết nối lại bằng một tài khoản có quyền truy cập sổ sách.",
    chooseOrganisation: "Hãy chọn một tổ chức trước khi lưu.",
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
    save: "Lưu lựa chọn",
    saving: "Đang lưu…",
    notSaved: "Không lưu được lựa chọn.",
    pickerUnavailable:
      "Bộ chọn của Google chưa sẵn sàng. Hãy tải lại trang; nếu vẫn vậy, kết nối Google Drive chưa được cấu hình.",
  },

  scope: {
    driveFolders_other: "PDF trong {{count, number}} thư mục đã chọn",
    gmailWholeMailbox: "Tiêu đề thư và tệp PDF đính kèm, toàn bộ hòm thư",
    gmailLabels: "Tiêu đề thư và tệp PDF đính kèm trong {{labels}}",
    /** Xero's entities, by the spec's ids. The ids are recorded; these are the words. */
    xeroContacts: "Liên hệ",
    xeroInvoices: "Hóa đơn",
    xeroPayments: "Thanh toán",
    xeroCreditNotes: "Giấy báo có",
    xeroAll: "Mọi loại dữ liệu: liên hệ, hóa đơn, thanh toán, giấy báo có",
    xeroEntities: "{{entities}}",
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
    every6h: "Mỗi 6 giờ",
    daily: "Hằng ngày",
    paused: "Tạm dừng",
    pausedNoNext: "Không chạy khi đang tạm dừng",
    /** The scheduler asks every fifteen minutes; a due time already past means its next ask. */
    dueNow: "Ở lượt kế tiếp, trong vòng 15 phút",
    neverUsed: "Chưa dùng lần nào",
  },

  /** A run as the card prints it. Chosen by `@/lib/runs`. */
  run: {
    ok: "Thành công",
    running: "Đang chạy",
    failed: "Thất bại",
    never: "Chưa chạy",
    landed_other: "{{countText}} bản ghi",
  },

  /** The journal: every run, newest first, and one run opened in its row. */
  journal: {
    title: "Nhật ký",
    lead: "Mỗi lần đọc dữ liệu của {{tenantId}} và mỗi lần dựng mô hình, mới nhất ở trên.",
    notLoaded: "Không tải được nhật ký của {{tenantId}}.",
    caption_other: "{{count, number}} lần chạy",
    colWhen: "Khi nào",
    colWhat: "Việc gì",
    colOutcome: "Kết quả",
    colLanded: "Đã về",
    colCreated: "Mới",
    colChanged: "Đổi",
    colRefused: "Từ chối",
    colDuration: "Mất",
    kindModels: "Dựng mô hình",
    kindBuild: "Dựng thử một mô hình",
    kindLakeApi: "Ghi từ ngoài vào {{source}}",
    triggerSchedule: "theo lịch",
    triggerManual: "chạy tay",
    triggerBuild: "từ trình soạn",
    triggerLakeApi: "qua API hồ dữ liệu",
    testsFailed_other: "{{countText}} kiểm tra không đạt",
    older: "Cũ hơn",
    emptyTitle: "Chưa có lần chạy nào",
    emptyBody: "Lần đầu sẽ chạy lúc {{when}}. Hoặc bấm Chạy ngay ở mục Nguồn dữ liệu.",
    emptyBodyDueNow:
      "Lần đầu sẽ chạy ở lượt kế tiếp, trong vòng 15 phút. Hoặc bấm Chạy ngay ở mục Nguồn dữ liệu.",
    emptyBodyNoSchedule:
      "Chưa có nguồn nào sẵn sàng để chạy. Hãy kết nối một nguồn và chọn dữ liệu cần đồng bộ ở mục Nguồn dữ liệu.",
    goToSources: "Đến Nguồn dữ liệu",
    detailNotLoaded: "Không tải được chi tiết lần chạy này.",
    started: "Bắt đầu",
    ended: "Kết thúc",
    trigger: "Khởi chạy",
    runId: "Mã lần chạy",
    errorHead: "Lỗi",
    entitiesHead: "Theo từng loại dữ liệu",
    colEntity: "Loại",
    colUnchanged: "Không đổi",
    refusalsHead: "Bản ghi bị từ chối",
    colRecordId: "Mã bản ghi",
    colReason: "Lý do",
    colAt: "Lúc",
    stepsHead: "Các bước dbt",
    colStep: "Bước",
    colStatus: "Trạng thái",
    colFailures: "Dòng lỗi",
    colTook: "Mất",
    nothingRecorded: "Lần chạy này chưa ghi nhận gì thêm.",
  },

  models: {
    head: "Mô hình",
    title: "Mô hình dữ liệu",
    lead: "Các mô hình dbt của {{tenantId}}, soạn ngay trong trình duyệt.",
    emptyTitle: "Sắp có",
    emptyBody: "Trình soạn mô hình sẽ xuất hiện ở đây.",
  },

  reports: {
    head: "Báo cáo",
    title: "Báo cáo",
    lead: "Câu hỏi, biểu đồ và bảng điều khiển của {{tenantId}}.",
    emptyTitle: "Sắp có",
    emptyBody: "Câu hỏi và bảng điều khiển sẽ xuất hiện ở đây.",
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
