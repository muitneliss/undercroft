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

export const vi = {
  app: {
    name: "Undercroft",
    caption: "Undercroft · bảng điều khiển",
    signOut: "Đăng xuất",
    signingOut: "Đang đăng xuất…",
    /**
     * Labels the build stamp in the colophon. The tag beside it is never translated and
     * never reformatted: it is the literal string that rolls the stack back to this build.
     */
    release: "Phiên bản",
    /**
     * A tab running a release the server has replaced. "Is now live" rather than "new":
     * after a rollback the live release is the older one, and the tab is just as stale.
     */
    releaseLive: "Phiên bản {{release}} đã được triển khai. Tải lại trang để sử dụng.",
    reload: "Tải lại",
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

  /**
   * The slip that reports a failed request (`Errata` handed an `error`). `internal` stands in
   * for the bare `internal_error` the server answers an internal failure with; it does not
   * mention the trace id, because a request outside a trace has none to show.
   */
  errata: {
    internal: "Máy chủ gặp lỗi ngoài dự kiến. Chi tiết đã được ghi lại ở phía máy chủ.",
    traceLabel: "Mã truy vết",
    report: "Báo lỗi",
  },

  /**
   * The edges a reader drags, one key per surface.
   *
   * Each names the MEASURE it moves and the thing it moves it on, because a screen reader
   * hears the label with no picture of where the edge is -- "chiều rộng" on its own would be
   * four identical separators on one screen. A column's name is a SQL identifier, so it is
   * interpolated and never translated.
   */
  grip: {
    railWidth: "Chiều rộng bảng tham chiếu",
    paneHeight: "Chiều cao ô truy vấn",
    editorHeight: "Chiều cao ô soạn thảo",
    columnWidth: "Chiều rộng cột {{name}}",
  },

  signIn: {
    title: "Bảng điều khiển",
    lead: "Kết nối các tài khoản của bạn và xem những gì đã được đồng bộ.",
    expired: "Phiên làm việc đã kết thúc. Hãy đăng nhập lại để tiếp tục.",
    deniedHeading: "Không có quyền truy cập",
    denied:
      "Tài khoản đó không có quyền truy cập. Nếu bạn đã được mời, hãy đăng nhập bằng đúng địa chỉ đã nhận lời mời.",
    google: "Tiếp tục với Google",
    openingGoogle: "Đang chuyển tới Google…",
    googleFailed: "Không mở được trang đăng nhập của Google. Hãy thử lại.",
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
    /** A model-context client sent the person here to sign in (ADR 0061). */
    authorizing:
      "Một ứng dụng (như Claude) đang xin truy cập Undercroft thay mặt bạn. Hãy đăng nhập; bạn sẽ chọn quyền cho nó ở bước tiếp theo.",
    /** Shown only when the server refused without saying why. */
    sendFailed: "Không gửi được mã đăng nhập. Hãy thử lại.",
    codeFailed: "Mã đó không dùng được. Hãy yêu cầu mã mới.",
    /** Local development builds only; see `DevSignIn` in `SignIn.tsx`. */
    dev: "Đăng nhập cục bộ (môi trường phát triển)",
    devFailed:
      "Đăng nhập cục bộ đang tắt. Đặt UNDERCROFT_DEV_SIGN_IN_AS trong deploy/compose/.env rồi chạy lại task dev:run.",
  },

  landing: {
    skip: "Đến nội dung chính",
    docs: "Tài liệu",
    readDocs: "Xem tài liệu",
    title: "Giữ nguyên dữ liệu.",
    titleEnd: "Tự định nghĩa câu trả lời.",
    lead: "Từ tài khoản của bạn đến kho dữ liệu gốc, mô hình SQL và báo cáo.",
    invitation: "Truy cập theo lời mời.",
    pathLabel: "Hành trình của dữ liệu",
    sourcesTitle: "Nguồn dữ liệu",
    // biome-ignore lint/security/noSecrets: These are the four public source names, separated by line breaks.
    sourcesBody: "Gmail\nGoogle Drive\nHubSpot\nXero",
    rawTitle: "Kho dữ liệu gốc",
    rawBody: "Bản gốc được giữ nguyên.",
    modelsTitle: "Mô hình SQL",
    modelsBody: "SQL do bạn viết.",
    reportsTitle: "Báo cáo",
    reportsBody: "Kết quả từ mô hình của bạn.",
    principle: "Dữ liệu gốc là nền tảng. Các lớp phía trên có thể dựng lại.",
    userPathLabel: "Hành trình của bạn",
    stepInviteTitle: "Nhận lời mời",
    stepInviteBody: "Quản trị viên mời bạn qua email.",
    stepConnectTitle: "Kết nối",
    stepConnectBody: "Gmail, Google Drive, HubSpot hoặc Xero.",
    stepChooseTitle: "Chọn phạm vi",
    stepChooseBody: "Bạn chọn những gì được phép đọc.",
    stepRunTitle: "Chạy",
    stepRunBody: "Mỗi lần chạy ghi lại dữ liệu đã nhận, bị từ chối và lý do.",
    stepModelTitle: "Viết mô hình",
    stepModelBody: "SQL của bạn, chạy bằng vai trò riêng của bạn.",
    stepAskTitle: "Đặt câu hỏi",
    stepAskBody: "Câu hỏi, biểu đồ và bảng điều khiển.",
    vaultRefused: "Bị từ chối · đã ghi lý do",
    vaultEcho: "Đã có · không chép lại",
    agentTitle: "Dữ liệu của bạn, nơi tác tử làm việc.",
    agentBody:
      "Claude và các máy khách MCP khác có thể dùng Undercroft thay mặt bạn, với cùng quyền truy cập hồ sơ và giới hạn quyền như trong không gian làm việc.",
    agentDetail:
      "Kết nối qua OAuth hoặc token cá nhân trên trang tài khoản. Bạn chọn quyền chỉ đọc hoặc đọc và ghi, và có thể thu hồi quyền bất cứ lúc nào.",
    agentDocs: "Kết nối tác tử qua MCP",
    workflowTitle: "Một quy trình, từ đầu đến cuối.",
    workflowLead:
      "Trước cuộc gọi với khách hàng, hãy dùng tác tử chỉ đọc để trả lời một câu hỏi về dữ liệu mà không rời khỏi cuộc trò chuyện.",
    workflowConnectTitle: "Kết nối Claude",
    workflowConnectBody:
      "Thêm Undercroft bằng OAuth và chọn quyền chỉ đọc. Tác tử chỉ thấy các hồ sơ mà bạn được phép mở.",
    workflowAskTitle: "Đặt câu hỏi thật",
    workflowAskBody: "Hỏi: “Hóa đơn Xero mới nhất đã có trong báo cáo chưa?”",
    workflowCheckTitle: "Kiểm tra bằng chứng",
    workflowCheckBody:
      "Tác tử đọc nhật ký chạy, kho dữ liệu gốc và báo cáo bằng chính các công cụ bạn có thể dùng trong không gian làm việc.",
    workflowDecideTitle: "Quyết định bước tiếp theo",
    workflowDecideBody:
      "Bạn nhận được kết quả có dữ liệu để kiểm tra, hoặc câu trả lời rõ ràng rằng chưa có bằng chứng. Nếu cần thay đổi, hãy cấp quyền đọc và ghi riêng.",
    startTitle: "Một nơi để bắt đầu.",
    startBody:
      "Mỗi khách hàng có một không gian riêng cho nguồn dữ liệu, các lần chạy và báo cáo. Đăng nhập để mở những hồ sơ bạn được cấp quyền.",
    openWorkspace: "Mở không gian làm việc",
  },

  tenants: {
    title: "Hồ sơ khách hàng",
    lead: "Mở một hồ sơ để xem nguồn dữ liệu, nhật ký và báo cáo.",
    searchLabel: "Tìm khách hàng",
    searchPlaceholder: "Tìm tên khách hàng hoặc mã hồ sơ",
    clearSearch: "Xóa tìm kiếm",
    noMatches:
      "Không có khách hàng phù hợp. Thử tên hoặc mã khác, hoặc xóa tìm kiếm để xem tất cả.",
    colAction: "Hành động",
    open: "Mở",
    openNamed: "Mở hồ sơ {{name}}",
    guideHead: "Trong mỗi hồ sơ",
    guideBody:
      "Kết nối nguồn, xem dữ liệu đã nhận và mở báo cáo trong các thẻ của hồ sơ. Dữ liệu của mỗi khách hàng được lưu trữ và truy cập riêng biệt.",
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
    revoking: "Đang thu hồi…",
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
  },

  /**
   * The one showing of a secret the server hands back once -- an ingest key, a personal token.
   * Shared, because the act is the same whichever secret it is: copy it now or lose it.
   */
  secret: {
    copy: "Sao chép",
    copied: "Đã sao chép vào bộ nhớ tạm.",
    notCopied: "Không sao chép được. Hãy chọn và sao chép bằng tay.",
    done: "Xong",
  },

  /** The account page: what belongs to the person signed in, rather than to a customer. */
  account: {
    title: "Tài khoản",
    lead: "Những gì thuộc về {{email}}, không thuộc riêng khách hàng nào.",
    open: "Mở trang tài khoản",
  },

  /**
   * Personal access tokens (ADR 0060). "Token" stays as the word the operators already use for
   * it, the way "HubSpot" does: it is what an agent's setup screen will ask them to paste.
   */
  tokens: {
    head: "Token truy cập cá nhân",
    lead: "Token để một tác tử (Claude Code, Claude Desktop…) làm việc với Undercroft thay mặt bạn qua MCP, với đúng quyền bạn đang có ở mọi khách hàng. Mỗi token chỉ hiển thị một lần, lúc tạo.",
    notLoaded: "Không tải được danh sách token.",
    caption_other: "{{count, number}} token",
    colLabel: "Nhãn",
    colGrant: "Quyền",
    colCreated: "Tạo",
    colLastUsed: "Dùng gần nhất",
    colExpires: "Hết hạn",
    colRevoke: "Thu hồi",
    grantRead: "Chỉ đọc",
    grantWrite: "Đọc và ghi",
    revoked: "Đã thu hồi",
    revoke: "Thu hồi",
    revoking: "Đang thu hồi…",
    notRevoked: "Chưa thu hồi được",
    none: "Chưa có token nào.",
    mintHead: "Tạo token mới",
    labelLabel: "Nhãn",
    labelPlaceholder: "Ví dụ: Claude Code trên máy xách tay",
    grantLabel: "Quyền",
    grantReadHint: "Tác tử chỉ xem được dữ liệu; không có công cụ nào làm thay đổi gì.",
    grantWriteHint:
      "Tác tử làm được mọi việc bạn làm được, kể cả xoá. Hãy chỉ chọn khi bạn tin tác tử đó.",
    expiresLabel: "Hết hạn sau",
    expires30: "30 ngày",
    expires90: "90 ngày",
    expires365: "1 năm",
    mint: "Tạo token",
    minting: "Đang tạo…",
    notMinted: "Chưa tạo được token",
    mintedHead: "Token mới",
    mintedNote:
      "Sao chép ngay: token này sẽ không hiển thị lại. Nếu mất, hãy tạo token khác và thu hồi token này.",
  },

  /**
   * Connected apps (ADR 0061): model-context clients a person let in by signing in and
   * consenting, rather than with a token. "Claude" is a product's name and stays as it is.
   */
  apps: {
    head: "Ứng dụng đã kết nối",
    lead: "Những ứng dụng bạn đã cho phép truy cập Undercroft bằng cách đăng nhập qua chúng và đồng ý, như trình kết nối Claude. Thu hồi thì ứng dụng bị chặn ngay từ lần gọi tiếp theo; muốn cho lại, hãy kết nối lại từ ứng dụng.",
    notLoaded: "Không tải được danh sách ứng dụng.",
    none: "Chưa có ứng dụng nào được kết nối.",
    caption_other: "{{count, number}} ứng dụng",
    colName: "Ứng dụng",
    colHost: "Trả về tới",
    colGranted: "Đồng ý lúc",
    unnamed: "Không tên",
    grantNone: "Không có quyền nào",
  },

  /** The consent page a model-context client's authorization lands on (ADR 0061). */
  consent: {
    title: "Cho phép truy cập",
    lead: "{{name}} (trả về {{host}}) xin làm việc với Undercroft thay mặt bạn, với đúng quyền bạn đang có ở mọi khách hàng.",
    leadUnnamed:
      "Một ứng dụng (trả về {{host}}) xin làm việc với Undercroft thay mặt bạn, với đúng quyền bạn đang có ở mọi khách hàng.",
    signedInAs: "Đang đăng nhập bằng {{email}}.",
    grantLabel: "Quyền cho ứng dụng này",
    readHint:
      "Ứng dụng chỉ xem được dữ liệu; không có công cụ nào làm thay đổi gì. Nên chọn khi ứng dụng đọc nội dung do người khác viết.",
    nothingAsked:
      "Ứng dụng này không xin quyền đọc hay ghi nào của Undercroft, nên cho phép cũng không để nó làm được gì. Hãy từ chối và kết nối lại từ ứng dụng.",
    allow: "Cho phép",
    deny: "Từ chối",
    answering: "Đang trả lời…",
    notAnswered: "Chưa gửi được câu trả lời",
    answerFailed: "Không gửi được câu trả lời. Hãy bắt đầu lại từ ứng dụng.",
    clientFailed: "Không đọc được thông tin ứng dụng.",
  },

  lake: {
    head: "Hồ dữ liệu",
    title: "Hồ dữ liệu thô",
    lead: "Những gì thực sự đã về cho {{tenantId}}, trước mọi bước biến đổi.",
    notLoaded: "Không tải được hồ dữ liệu của {{tenantId}}.",
    emptyTitle: "Chưa có gì về",
    emptyBody:
      "Lần chạy đầu tiên sẽ vào lúc {{when}}. Những gì nó đọc được sẽ được đếm ở đây, theo từng nguồn và loại dữ liệu.",
    emptyBodyDueNow:
      "Lần chạy đầu tiên sẽ vào lượt kế tiếp, trong vòng 15 phút. Những gì nó đọc được sẽ được đếm ở đây, theo từng nguồn và loại dữ liệu.",
    emptyBodyNoSchedule:
      "Chưa có nguồn nào sẵn sàng để chạy. Hãy kết nối một nguồn và chọn dữ liệu cần đồng bộ ở mục Nguồn dữ liệu.",
    goToSources: "Đến Nguồn dữ liệu",
    recordsHead: "Bản ghi",
    recordsCaption_other: "{{count, number}} luồng dữ liệu",
    indexCaption_other: "{{count, number}} luồng đã về",
    colHolds: "Chứa",
    colHeld: "Số lượng",
    colAlso: "Ghi chú",
    alsoTombstoned_other: "{{count, number}} đã xoá ở nguồn",
    /**
     * `{{bytes}}` is what the lake stores, which is the distinct blobs and not the rows --
     * `{{count}}` of them, against the `{{total}}` catalogue rows in the column beside this
     * one. The gap between the two is the same attachment quoted down a reply chain.
     *
     * `{{readable}}`, `{{refused}}` and `{{waiting}}` sum to `{{total}}`, and are three words
     * on purpose: a document refused with a recorded reason and one the extract has not
     * reached yet are different news, and one gap made the first read as the second.
     */
    alsoBytesRead_other:
      "{{bytes}} trong {{count, number}} tệp riêng biệt · đọc được {{readable, number}}/{{total, number}} · {{refused, number}} bị từ chối · {{waiting, number}} chưa đọc",
    refusalsOpen: "Xem lý do từ chối",
    consoleHead: "Truy vấn SQL",
    consoleLead:
      "Viết một câu SELECT trên hồ dữ liệu thô. Chạy bằng quyền đọc của tenant: mọi thao tác ghi đều bị từ chối, và bạn chỉ thấy dữ liệu của chính mình.",
    consoleSqlLabel: "Câu truy vấn",
    consoleTables: "Bảng có thể truy vấn",
    consoleRun: "Chạy truy vấn",
    consoleChord: "Ctrl ↵",
    consoleRunning: "Đang chạy…",
    consoleIdle: "Chưa chạy. Viết câu lệnh rồi nhấn Chạy truy vấn, hoặc Ctrl ↵.",
    /**
     * Said on the head of a pane whose statement has not had its turn yet.
     *
     * The statements of one press run one at a time -- two queries at once collide at the
     * login the worker mints for them -- and a pane that simply sat empty in the meantime
     * would read as one that had answered nothing.
     */
    consoleQueued: "Đang chờ…",
    /** The body of that same pane, where its rows will be. */
    consoleWaiting: "Chưa có kết quả cho câu lệnh này.",
    /**
     * Which statement a pane answers, printed only when there is more than one. A lone pane
     * needs no number, and "Câu lệnh 1" over the only answer on screen is furniture.
     */
    consoleStatement: "Câu lệnh {{n, number}}",
    /** Said while what is on screen answers a selection rather than the whole buffer. */
    consoleFromSelection: "chạy phần đang chọn",
    /**
     * What was NOT run, when the buffer held more statements than one press may run. Said
     * rather than dropped in silence: a reader who does not know a statement was skipped
     * reads its absence as an answer with nothing in it.
     */
    consoleCapped: "Chỉ chạy {{ran, number}} câu lệnh đầu; còn {{skipped, number}} câu chưa chạy.",
    /**
     * Said only while the editor still holds the query that was generated, so it never
     * claims anything about a query the reader has since edited.
     *
     * A phrase rather than the two sentences it used to be: it now sits in the workbench's
     * own head, beside the run plate, where a sentence telling the reader they may edit the
     * text would be an instruction about the editor they are already looking at.
     */
    consoleFromStream: "tạo sẵn từ luồng {{stream}}",
    /** The way back to the index, printed on the plate that goes there. */
    consoleBack: "Hồ dữ liệu",
    /**
     * The door on the lake's index. It names the surface rather than the act, because what
     * the reader is choosing is a place to go and not a query to run.
     */
    consoleOpen: "Mở bảng truy vấn",
    /**
     * Said to a reader who followed a pasted address they may not open. It names who can do
     * this rather than only saying that they cannot, so the next step is obvious.
     */
    consoleAdminOnly:
      "Chỉ quản trị viên của khách hàng này mới chạy được truy vấn trên hồ dữ liệu thô. Bạn vẫn xem được số lượng đã về ở trang Hồ dữ liệu.",
    consoleRows_other: "{{count, number}} dòng",
    consoleRowsFrom_other: "{{count, number}} dòng, từ dòng {{from, number}}",
    consoleRefused: "Truy vấn không chạy được",
    consoleNewer: "Trang trước",
    consoleOlder: "Trang sau",
    consoleNoOrderBy:
      "Câu truy vấn này không có ORDER BY, nên khi lật trang Postgres có thể trả một dòng ở hai trang hoặc bỏ sót. Thêm ORDER BY để thứ tự ổn định.",
    chooseFromIndex: "Chọn một dòng ở bảng trên để xem từng bản ghi của luồng đó.",
    searchHead: "Tìm trong hồ dữ liệu",
    /**
     * Says the one thing a Vietnamese operator most needs to know before typing: that they do
     * not have to put the tones in. Nothing else about the feature is worth a sentence here --
     * a search box explains itself.
     */
    searchLead:
      "Tìm trong mọi bản ghi và nội dung tài liệu đã về. Gõ không dấu vẫn ra kết quả có dấu: “hop dong” tìm được “Hợp đồng”.",
    searchLabel: "Từ khoá",
    searchPlaceholder: "hop dong",
    searchSubmit: "Tìm",
    searching: "Đang tìm…",
    searchIdle: "Nhập từ khoá rồi nhấn Tìm.",
    searchNotLoaded: "Không tìm được. Hãy thử lại sau ít phút.",
    /** Absence, worded as absence. The lake is not broken; this word is not in it. */
    searchNothing: "Không có bản ghi hay tài liệu nào khớp với “{{q}}”.",
    searchHits_other: "{{count, number}} kết quả",
    /** Said only when the page was cut, so a reader knows to narrow rather than to conclude. */
    searchMore: "Còn kết quả khác. Hãy thêm từ khoá để thu hẹp.",
    searchColWhere: "Ở đâu",
    searchColMatch: "Nội dung khớp",
    searchKindRecord: "Bản ghi",
    searchKindDocument: "Tài liệu",
    /** How the text was read. An OCR'd scan is a likelier place for a near-miss than a text layer. */
    searchMethod: "đọc bằng {{method}}",
    searchMethodUnknown: "chưa đọc được nội dung",
    /** The extractor hit its ceiling: what was searched is less than what the document says. */
    searchTruncated: "Tài liệu bị cắt bớt khi đọc, nên phần sau chưa được tìm.",
    searchOpenStream: "Mở luồng",
    colSource: "Nguồn",
    colEntity: "Loại",
    colRecords: "Bản ghi",
    colTombstoned: "Đã xoá ở nguồn",
    colLatest: "Mới nhất",
    documentsHead: "Tài liệu",
    documentsCaption_other: "{{count, number}} nguồn tài liệu",
    colDocuments: "Tài liệu",
    colBytes: "Dung lượng",
    browserHead: "Duyệt bản ghi",
    browserLead:
      "Từng bản ghi đúng như nguồn gửi, chưa qua biến đổi. Chỉ quản trị viên thấy mục này: dữ liệu thô có thể chứa tên và địa chỉ.",
    streamLabel: "Luồng dữ liệu",
    chooseStream: "Chọn một luồng dữ liệu",
    streamRecords: "Bản ghi",
    streamDocuments: "tài liệu",
    browserNotLoaded: "Không tải được các bản ghi này.",
    rowsCaption_other: "{{count, number}} bản ghi, mới nhất ở trên",
    docsCaption_other: "{{count, number}} tài liệu, mới nhất ở trên",
    colRecordId: "Mã bản ghi",
    colObserved: "Quan sát",
    colLoaded: "Nạp",
    colRun: "Lần chạy",
    colAtSource: "Ở nguồn",
    colDocumentId: "Mã tài liệu",
    colContentType: "Kiểu",
    live: "Còn",
    deletedOn: "Đã xoá {{when}}",
    showPayload: "Xem nội dung",
    noRows: "Luồng này chưa có bản ghi nào.",
    older: "Cũ hơn",
    loadingOlder: "Đang tải…",
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
    roleFor: "Vai trò của {{email}}",
    roleSaving: "Đang lưu vai trò…",
    roleChanged: "{{email}} giờ có vai trò {{role}}.",
    roleNotChanged: "Chưa đổi được vai trò",
    colRemove: "Quyền truy cập",
    remove: "Gỡ…",
    removeConfirm: "Gỡ {{email}}",
    removing: "Đang gỡ…",
    removed: "{{email}} không còn quyền truy cập.",
    notRemoved: "Chưa gỡ được",

    invitationsHead: "Lời mời",
    noneWaiting: "Không có lời mời nào đang chờ được chấp nhận.",
    waitingCaption_other: "{{count, number}} lời mời đang chờ được chấp nhận",
    colInvitedAs: "Được mời với vai trò",
    colExpires: "Hết hạn",
    colWithdraw: "Thu hồi",
    withdraw: "Thu hồi",
    withdrawing: "Đang thu hồi…",
    notWithdrawn: "Chưa thu hồi được",

    inviteLabel: "Mời một địa chỉ",
    invitePlaceholder: "dongnghiep@example.com",
    inviteHint:
      "Họ phải đăng nhập bằng đúng địa chỉ này. Lời mời không phải là mật khẩu — nó không cấp gì cho đến khi họ chứng minh mình kiểm soát hòm thư.",
    roleLabel: "Vai trò",
    roleViewer: "viewer — chỉ xem",
    roleMember: "member — có thể tạo câu hỏi và bảng điều khiển",
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
    starting: "Đang bắt đầu…",
    cadenceSaving: "Đang lưu tần suất…",
    running: "Đang chạy…",
    runFailedHead: "Lần chạy gần nhất thất bại",
    openInJournal: "Xem trong nhật ký",
    runNotStarted: "Chưa chạy được",
    cadenceNotSaved: "Chưa lưu được tần suất",
    /** The custom cadence's field. The zone is named every time: see `@/lib/when`. */
    cronLabel: "Biểu thức cron",
    cronHint:
      "5 trường: phút, giờ, ngày trong tháng, tháng, thứ trong tuần (0 là Chủ nhật). Tính theo giờ Singapore (SGT), không dày hơn {{minutes}} phút một lần.",
    cronSave: "Lưu lịch",
    /** Heads the next fires. They ARE the confirmation; there is no paraphrase of the cron. */
    cronPreview: "Ba lần chạy kế tiếp (giờ Singapore)",
    /** Beside a stored expression on a card a reader cannot edit. */
    cronZone: "giờ Singapore (SGT)",
    /** Why Save is off, one per `CronRefusal` in `@undercroft/contracts`. */
    cronRefused: {
      fields: "Cần đúng 5 trường, cách nhau bằng dấu cách.",
      invalid: "Không đọc được biểu thức này.",
      never: "Biểu thức này không bao giờ đến lượt chạy.",
      tooFrequent:
        "Biểu thức này chạy dày hơn {{minutes}} phút một lần, nhanh hơn nhịp của bộ lập lịch.",
    },
    since: "Từ",
    connect: "Kết nối {{name}}",
    chooseScope: "Chọn dữ liệu cần đồng bộ",
    reconnect: "Kết nối lại {{name}}",
    connecting: "Đang chuyển tới {{name}}…",
    changeScope: "Đổi dữ liệu đồng bộ",
    disconnect: "Ngắt kết nối",
    disconnecting: "Đang ngắt kết nối…",
    /** Only where the page cannot tell which source it was; see `connectFailedFor`. */
    connectFailed: "Chưa kết nối được nguồn này.",
    /**
     * The heading over a failed consent, naming the vendor whose Connect was pressed. The
     * refusals under it are the server's and may be about a provider -- "not set up to
     * connect Google accounts" -- so a heading reading only "this source" left the reader to
     * guess which of four sources it meant (issue 211).
     */
    connectFailedFor: "Chưa kết nối được {{name}}.",
    connectDeclined: "Bạn đã huỷ ở màn hình của Google. Không có gì được cấp.",
    /**
     * Distinct from `connectDeclined` because what the reader did was different: they
     * pressed Allow, having unticked the permission that makes the source work. Nothing was
     * saved, and the sentence has to say which tick to leave alone next time.
     */
    connectScopeDeclined:
      "Ở màn hình của Google, quyền cần thiết đã bị bỏ tích nên kết nối chưa được lưu. Hãy kết nối lại và giữ nguyên mọi dấu tích.",
    /**
     * A reconnect finished by a different Google account than the connection belongs to, or
     * by an account already connected under another entry (ADR 0043). The likeliest intent is
     * a second mailbox, so the sentence names the plate that does that.
     */
    connectAccountMismatch:
      "Tài khoản Google vừa đồng ý không phải tài khoản của kết nối này, hoặc tài khoản đó đã được kết nối ở một mục khác. Không có gì bị thay đổi. Nếu bạn muốn kết nối thêm một tài khoản khác, hãy dùng nút “Thêm tài khoản khác”.",
    /** Google did not say who consented, or the first account never recorded who it is. */
    connectAccountUnidentified:
      "Không xác định được tài khoản Google nào vừa đồng ý nên chưa có gì được lưu. Nếu nguồn này đã có một tài khoản được kết nối, hãy kết nối lại tài khoản đó trước rồi thử lại.",
    /** The legend over one kind's accounts: "Tài khoản Gmail". */
    accountsLegend: "Tài khoản {{name}}",
    addAccount: "Thêm tài khoản khác",
    /** An account whose address was never recorded. Never shown as an empty radio. */
    unnamedAccount: "Tài khoản chưa rõ tên",
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
      "Chọn các nhãn cần đọc. Chỉ tiêu đề thư và tệp đính kèm phù hợp trong những nhãn đó được đọc; không nhãn nào khác được đọc.",
    leadDrive:
      "Chọn thư mục hoặc tài liệu cần đọc. Google chỉ cho phép đọc đúng những gì bạn chọn ở đây.",
    leadXero:
      "Chọn tổ chức Xero cần đọc, và những loại dữ liệu nào. Một lần cấp quyền có thể thấy nhiều tổ chức; chỉ tổ chức bạn chọn ở đây được đọc.",
    leadHubspot:
      "Chọn thêm những trường HubSpot cần đọc cho từng đối tượng, kể cả trường do chính portal của bạn tạo. Lựa chọn ở đây chỉ thêm vào các trường chuẩn, không bớt đi trường nào.",
    /**
     * HubSpot's empty choice is the NARROW reading, the opposite of every other list here, so
     * it is said in as many words as theirs are.
     */
    hubspotStandardHint:
      "Không chọn trường nào nghĩa là chỉ đọc các trường chuẩn, đúng như trước nay. Các trường chuẩn luôn được đọc, dù chọn gì.",
    /** Above each object's list: the spec's own properties, read whatever is ticked. */
    propertiesAlways: "Luôn đọc: {{properties}}",
    /** The runs of a property list. HubSpot reports whose a property is; nothing here infers it. */
    propertiesMine: "Trường do portal của bạn tạo",
    propertiesHubspot: "Trường sẵn có của HubSpot",
    /** A property the saved choice holds that HubSpot no longer lists. Shown so it can be unticked. */
    propertiesGone: "Không còn trong HubSpot",
    filterPropertiesLabel: "Lọc danh sách trường",
    filterPropertiesTotal_other: "{{count, number}} trường",
    filterPropertiesTallyRead: "Đang hiện {{shown, number}} trong {{total, number}} trường",
    noPropertyMatch: "Không có trường nào khớp với từ đã gõ.",
    noProperties: "HubSpot chưa liệt kê trường nào để chọn.",
    echoPropertiesStandard: "Chỉ các trường chuẩn",
    echoEveryProperty:
      "Các trường chuẩn và mọi trường đang có. Trường được tạo sau này sẽ không được đọc cho đến khi được chọn.",
    xeroEntitiesHint:
      "Không chọn loại dữ liệu nào nghĩa là đọc tất cả các loại. Đây là một lựa chọn có chủ đích, không phải bỏ trống.",
    organisationsHead: "Tổ chức",
    entitiesHead: "Loại dữ liệu",
    noOrganisations:
      "Tài khoản Xero đã cấp quyền không thấy tổ chức nào. Hãy kết nối lại bằng một tài khoản có quyền truy cập sổ sách.",
    chooseOrganisation: "Hãy chọn một tổ chức trước khi lưu.",
    wholeMailboxHint:
      "Không chọn nhãn nào nghĩa là đọc toàn bộ hòm thư. Đây là một lựa chọn có chủ đích, không phải bỏ trống.",
    /** Drive's depth choice, and the consequence said beneath it as the tick changes. */
    includeSubFolders: "Đọc cả thư mục con",
    willReadOneLevel:
      "Chỉ đọc tệp nằm trực tiếp trong thư mục đã chọn. Thư mục con không được đọc.",
    willReadDeep:
      "Đọc mọi tệp trong thư mục đã chọn, kể cả tệp nằm trong các thư mục con, sâu đến đâu cũng đọc.",
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
    echoChosen_other: "Tiêu đề thư và tệp đính kèm phù hợp trong {{count, number}} nhãn đã chọn",
    /**
     * Every entry ticked: a CLOSED list, the opposite of none ticked, so it gets words of its own
     * rather than the open sentence or a count a reader would have to check against the list.
     */
    echoEveryLabel:
      "Chỉ tiêu đề thư và tệp đính kèm phù hợp trong các nhãn đang có. Thư không mang nhãn nào trong số đó sẽ không được đọc, và nhãn được tạo sau này không nằm trong lựa chọn này.",
    echoEveryFileType: "Chỉ các loại tệp trong danh sách. Loại tệp khác sẽ không được đọc.",
    echoEveryEntity:
      "Chỉ các loại dữ liệu trong danh sách: {{entities}}. Loại dữ liệu được bổ sung sau này sẽ không được đọc cho đến khi được chọn.",
    selectAll: "Chọn tất cả",
    clearAll: "Bỏ chọn tất cả",
    pickFromDrive: "Chọn từ Google Drive",
    openingDrive: "Đang mở Google Drive…",
    pickerFailed: "Không mở được Google Drive. Hãy thử lại.",
    /**
     * Beside each Drive pick. The Picker only ever adds, so this is how one comes off; the
     * named form is its accessible name, so a screen reader hears WHICH pick it removes.
     */
    removePick: "Bỏ",
    removePickNamed: "Bỏ {{name}} khỏi lựa chọn",
    nothingToChoose: "Chưa có mục nào để chọn.",
    save: "Lưu lựa chọn",
    saving: "Đang lưu…",
    notSaved: "Không lưu được lựa chọn.",
    pickerUnavailable:
      "Bộ chọn của Google chưa sẵn sàng. Hãy tải lại trang; nếu vẫn vậy, kết nối Google Drive chưa được cấu hình.",
    fileTypesHead: "Loại tệp",
    anyFileTypeHint:
      "Không chọn loại tệp nào nghĩa là đọc mọi loại tệp. Đây là một lựa chọn có chủ đích, không phải bỏ trống.",
    fileTypesCustomLabel: "Thêm loại tệp khác",
    fileTypesCustomPlaceholder: "vd: image/png hoặc .oa",
    fileTypesCustomAdd: "Thêm",
    fileTypesCustomInvalid:
      "Nhập loại tệp theo dạng loại/loại-con, ví dụ image/png, hoặc một đuôi tệp bắt đầu bằng dấu chấm, ví dụ .oa.",
  },

  scope: {
    driveFolders_other: "Tệp phù hợp trong {{count, number}} thư mục đã chọn",
    /** The same reading, to the bottom of the tree. The card must tell the two apart. */
    driveFoldersDeep_other:
      "Tệp phù hợp trong {{count, number}} thư mục đã chọn và mọi thư mục con",
    driveFiles_other: "{{count, number}} tài liệu đã chọn",
    gmailWholeMailbox: "Tiêu đề thư và tệp đính kèm phù hợp, toàn bộ hòm thư",
    gmailLabels: "Tiêu đề thư và tệp đính kèm phù hợp trong {{labels}}",
    /** Xero's entities, by the spec's ids. The ids are recorded; these are the words. */
    xeroContacts: "Liên hệ",
    xeroInvoices: "Hóa đơn",
    xeroPayments: "Thanh toán",
    xeroCreditNotes: "Giấy báo có",
    xeroAll: "Mọi loại dữ liệu: liên hệ, hóa đơn, thanh toán, giấy báo có",
    xeroEntities: "{{entities}}",
    /** HubSpot's objects, by the spec's ids. The ids are recorded; these are the words. */
    hubspotCompanies: "Công ty",
    hubspotContacts: "Liên hệ",
    hubspotDeals: "Giao dịch",
    /** Nothing chosen: the spec's own properties, which is what HubSpot has always read. */
    hubspotStandard: "Các trường chuẩn của công ty, liên hệ và giao dịch",
    hubspotChosen_other: "Các trường chuẩn, cùng {{count, number}} trường chọn thêm",
    anyFileType: "Mọi loại tệp",
    fileTypesChosen_other: "Đã chọn {{count, number}} loại tệp",
    fileTypePdf: "PDF",
    fileTypeDocx: "Tài liệu Word (.docx)",
    fileTypeDoc: "Tài liệu Word (.doc)",
    fileTypeGoogleDoc: "Google Tài liệu",
    fileTypeXlsx: "Bảng tính Excel (.xlsx)",
    fileTypeXlsm: "Bảng tính Excel có macro (.xlsm)",
    fileTypeXls: "Bảng tính Excel (.xls)",
    fileTypeGoogleSheet: "Google Trang tính",
    fileTypeGoogleSlides: "Google Trang trình bày",
    fileTypeCsv: "Tệp CSV",
    fileTypeTxt: "Văn bản thuần",
    fileTypeMarkdown: "Markdown (.md)",
    fileTypeHtml: "Trang web (.html)",
    fileTypeMhtml: "Trang web lưu trọn gói (.mhtml)",
    fileTypeEml: "Thư điện tử lưu thành tệp (.eml)",
    fileTypeXml: "XML, gồm báo cáo XBRL (.xml)",
    fileTypeJson: "JSON",
    fileTypeOpenAttestation: "Hồ sơ OpenAttestation có chữ ký số (.oa)",
    fileTypeJpeg: "Ảnh JPEG",
    fileTypePng: "Ảnh PNG",
    fileTypeWebp: "Ảnh WebP",
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
    custom: "Tuỳ chỉnh (cron)",
    pausedNoNext: "Không chạy khi đang tạm dừng",
    /** The scheduler asks every `{{minutes}}`; a due time already past means its next ask. */
    dueNow: "Ở lượt kế tiếp, trong vòng {{minutes}} phút",
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
    loadingOlder: "Đang tải…",
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

    /**
     * Bảng tổng hợp lý do — thứ trả lời câu "245 bị từ chối là những gì".
     *
     * Con số vẫn nằm trên sơ đồ như trước, nhưng lý do thì trước đây không hiện ở đâu cả, nên
     * muốn biết phải SSH vào máy chủ. Bảng này giữ mãi, kể cả sau khi chi tiết từng tài liệu
     * đã bị dọn. Xem ADR 0039.
     */
    rollupHead: "Vì sao bị từ chối",
    rollupCaption_other: "{{count, number}} lý do",
    colCount: "Số lượng",
    reasonRecords: "Xem các tệp bị từ chối",
    refusalsPrunedNote:
      "Chi tiết từng tài liệu đã được dọn sau {{days}} ngày. Bảng tổng hợp theo lý do vẫn còn nguyên.",
    reasonActs: "Cần xử lý",
    reasonBenign: "Không cần xử lý",

    /** Hàng đợi tại lúc lần chạy này lấy phần việc của nó — không phải hàng đợi hôm nay. */
    backlogHead: "Hàng đợi",
    backlogNote_other:
      "Còn {{count, number}} tài liệu chờ đọc khi lần chạy này bắt đầu. Mỗi lần chạy đọc tối đa 500 tài liệu.",
    backlogEmpty: "Không còn tài liệu nào chờ đọc khi lần chạy này bắt đầu.",
    release: "Bản dựng",

    /**
     * Lời cho từng mã lý do mà worker ghi lại.
     *
     * Mã gốc vẫn được in bằng phông mono bên cạnh câu chữ: người đọc cần hiểu trang này mà
     * không phải học thuộc bộ mã, còn người báo lỗi cho lập trình viên thì cần đúng mã.
     */
    reason: {
      imageTooSmall: "Ảnh quá nhỏ để là một tài liệu",
      imageTooSmallNote:
        "Hầu hết là logo, ảnh chữ ký hoặc biểu tượng ở chân thư. Không cần làm gì.",
      ocrFoundNothing: "Đã đọc hết trang nhưng không thấy chữ nào",
      ocrFoundNothingNote: "Thường là trang trắng hoặc ảnh không chứa chữ. Không cần làm gì.",
      noBytes: "Tài liệu không có nội dung",
      noBytesNote: "Nguồn trả về một tệp rỗng. Không cần làm gì.",
      legacyDoc: "Tệp .doc từ Word 95 trở về trước, không đọc",
      legacyDocNote:
        "Chữ trong tệp này theo bảng mã của máy đã lưu nó, nên đọc thì chỉ là đoán. Muốn đọc, hãy mở bằng Word và lưu lại thành .docx.",
      legacyXls: "Định dạng .xls cũ, không đọc",
      legacyXlsNote:
        "Chưa có trình đọc cho bảng tính nhị phân trước 2007 — một quyết định đã cân nhắc, không phải lỗi.",
      unsupportedType: "Chưa có trình đọc cho loại tệp này",
      unsupportedTypeNote:
        "Tài liệu sẽ tự được đọc lại khi có trình đọc phù hợp. Không cần làm gì.",
      pdfPasswordProtected: "Tệp PDF có mật khẩu mở, không đọc được",
      pdfPasswordProtectedNote:
        "Tệp gốc vẫn được lưu nguyên vẹn. Muốn đọc nội dung, hãy xin người gửi bản không đặt mật khẩu.",
      docPasswordProtected: "Tài liệu Word có mật khẩu mở, không đọc được",
      docPasswordProtectedNote:
        "Tệp gốc vẫn được lưu nguyên vẹn. Muốn đọc nội dung, hãy xin người gửi bản không đặt mật khẩu.",
      pdftotextFailed: "pdftotext chạy lỗi trên tệp này",
      pdftotextFailedNote: "Tệp PDF có thể hỏng. Đáng kiểm tra nếu lặp lại nhiều lần.",
      pdftoppmFailed: "Không dựng được trang PDF thành ảnh để OCR",
      pdftoppmFailedNote: "Tệp PDF có thể hỏng. Đáng kiểm tra nếu lặp lại nhiều lần.",
      tesseractFailed: "tesseract chạy lỗi trên tệp này",
      tesseractFailedNote: "Ảnh có thể hỏng. Đáng kiểm tra nếu lặp lại nhiều lần.",
      ocrOutOfTime: "Hết thời gian trước khi đọc xong trang đầu",
      ocrOutOfTimeNote:
        "Tài liệu quá nặng, hoặc worker đang quá tải. Tài liệu sẽ được đọc lại ở lần chạy sau.",
      xlsxUnreadable: "Không mở được bảng tính",
      xlsxUnreadableNote: "Tệp .xlsx có thể hỏng.",
      docxUnreadable: "Không mở được tài liệu Word",
      docxUnreadableNote: "Tệp .docx có thể hỏng.",
      docUnreadable: "Không mở được tài liệu Word",
      docUnreadableNote: "Tệp .doc có thể hỏng.",
      lakeUnreadable: "Hồ dữ liệu không trả về nội dung tệp",
      lakeUnreadableNote:
        "Danh mục nói tệp có, hồ dữ liệu nói không. Đây là sai lệch cần kiểm tra ngay.",
      extractorMissing: "Thiếu chương trình {{program}} trong worker",
      extractorMissingNote:
        "Mọi tệp cần {{program}} sẽ còn bị từ chối cho tới khi image có lại chương trình này.",
      unknown: "Mã lý do chưa có diễn giải",
      unknownNote: "Giao diện chưa đặt lời cho mã này. Mã gốc ở ngay bên cạnh.",
    },

    stepsHead: "Các bước dbt",
    colStep: "Bước",
    colStatus: "Trạng thái",
    colFailures: "Dòng lỗi",
    colTook: "Mất",
    nothingRecorded: "Lần chạy này chưa ghi nhận gì thêm.",

    /**
     * Dải đồng hồ đo phía trên sổ diễn biến: mỗi loại dữ liệu đang đọc một dòng, cập nhật tại
     * chỗ. Không dòng nào ở đây là "việc đã xảy ra" — chúng là số đang chạy, nên chúng không
     * nằm trong sổ. ADR 0032.
     */
    gauge: {
      head: "Đang đọc",
      share: "{{share}}%",
      noTotal: "chưa biết tổng số",
      walked: "tìm thấy {{found}}, {{skipped}} đã có sẵn",
      reading: "{{entity}}: đã đọc {{figure}}",
    },

    feedHead: "Diễn biến",
    feedCount_one: "{{count}} mốc",
    feedCount_other: "{{count}} mốc",
    feedEmpty: "Lần chạy này chưa ghi mốc nào.",
    colWhen2: "Lúc",
    colWhat2: "Việc",
    /**
     * Mỗi sự kiện worker ghi lại là MỘT câu trọn vẹn ở đây.
     *
     * Worker chỉ gửi một động từ trong danh sách cố định kèm mấy con số; toàn bộ lời văn
     * nằm ở đây, nên worker không cần biết tiếng nào. Tên loại dữ liệu (`messages`,
     * `files`) giữ nguyên như nguồn gọi -- người đọc sẽ gặp lại đúng chữ đó ở mục Hồ dữ
     * liệu. Con số đã được định dạng sẵn trước khi chèn vào, nên số thiếu hiện là MISSING
     * chứ không phải 0.
     */
    event: {
      runOpened: "Bắt đầu.",
      entityStarted: "Bắt đầu đọc {{entity}}.",
      workListed: "Cần đọc {{total}} {{entity}}.",
      workListedSkipping: "Có {{total}} {{entity}}, {{skipped}} đã có sẵn nên không đọc lại.",
      recordsRead: "Đã đọc {{read}} {{entity}}.",
      recordsReadOf: "Đã đọc {{read}}/{{total}} {{entity}}.",
      entityDone:
        "Xong {{entity}}: {{landed}} về, {{created}} mới, {{changed}} đổi, {{refused}} bị từ chối.",
      entityDoneSkipping:
        "Xong {{entity}}: {{landed}} về, {{created}} mới, {{changed}} đổi, {{refused}} bị từ chối, {{skipped}} đã có sẵn nên không đọc lại.",
      picksListed:
        "Đã xem {{folders}} thư mục được chọn, thấy {{matched}} tệp phù hợp. Thư mục con không được đọc.",
      picksListedDeep:
        "Đã xem {{listed}} thư mục nằm trong {{folders}} thư mục được chọn, thấy {{matched}} tệp phù hợp.",
      documentsLanded:
        "Tài liệu: {{created}} mới, {{unchanged}} không đổi, {{skipped}} bỏ qua, {{failed}} lỗi.",
      noModels: "Khách hàng này chưa có mô hình nào, nên không có gì để dựng.",
      dbtFinished:
        "dbt dựng {{models}} mô hình, chạy {{tests}} kiểm tra, {{testsFailed}} không đạt.",
      runClosedOk: "Kết thúc, thành công.",
      runClosedFailed: "Kết thúc, thất bại.",
      runFailed: "Lần chạy hỏng ({{errorType}}). Lý do đầy đủ ở phần Lỗi phía trên.",
      runStopped:
        "Dừng giữa chừng vì worker tắt, thường do triển khai bản mới. Những gì đã về được giữ lại: {{created}} mới, {{changed}} đổi, {{refused}} bị từ chối. Lần chạy sau tiếp tục từ đây.",
      truncated: "Đã ghi {{at}} dòng; từ đây chỉ ghi cảnh báo và lỗi.",
      unknown: "Sự kiện {{event}}.",
    },

    /** The graph beside the feed: the run's own shape, not what it said about itself. */
    flow: {
      head: "Sơ đồ",
      models: "Mô hình",
      modelsNone: "Chưa có mô hình",
      modelsSummary: "{{models}} mô hình · {{tests}} kiểm tra",
      modelsSummaryFailed: "{{models}} mô hình · {{tests}} kiểm tra · {{testsFailed}} không đạt",
      outcome: "Kết quả",
      entityDone: "Xong",
      entityActive: "Đang xử lý",
      entityInterrupted: "Dừng ở đây",
      /* The unit matters on the rail: a datum hangs under the line on its own, where a
       bare "0" is a stray digit rather than a count of anything. `landed` carries the
       digits already grouped for the reader, or the em dash when there is no count at
       all; `count` is there only to choose the plural form English needs. */
      entityLanded_other: "{{landed}} bản ghi",
      entityLandedRefused: "{{landed}} bản ghi · {{refused}} bị từ chối",
      chainedFrom: "Nối từ lần đồng bộ {{source}}",
      chainedTo: "Nối sang việc dựng mô hình",
    },
  },

  models: {
    head: "Mô hình",
    title: "Mô hình dữ liệu",
    lead: "Các mô hình dbt của {{tenantId}}, soạn ngay trong trình duyệt. Lưu chỉ cất giữ; Dựng mới chạy SQL.",
    notLoaded: "Không tải được các mô hình của {{tenantId}}.",
    emptyTitle: "Chưa có mô hình nào",
    emptyBody:
      "Một mô hình là một câu SELECT trên raw.records, dựng thành bảng trong lược đồ phân tích của khách hàng này. Hãy tạo mô hình đầu tiên từ mẫu bên dưới.",
    emptyBodyViewer:
      "Một mô hình là một câu SELECT trên raw.records, dựng thành bảng trong lược đồ phân tích của khách hàng này. Quản trị viên có thể tạo mô hình đầu tiên.",
    caption_other: "{{count, number}} mô hình",
    colName: "Tên",
    colUpdated: "Cập nhật",
    colBuild: "Lần dựng gần nhất",
    buildOk: "Dựng thành công",
    buildFailed: "Dựng lỗi",
    neverBuilt: "Chưa dựng",
    buildOther: "{{status}}",
    newHead: "Tạo mô hình mới",
    newLead:
      "Mô hình mới bắt đầu từ một ví dụ hoàn chỉnh: bảng deals của HubSpot, chiếu ra từ raw.records. Đổi bộ lọc và các cột là thành mô hình của bạn.",
    nameLabel: "Tên mô hình",
    nameHint: "Chữ thường, số và gạch dưới; bắt đầu bằng chữ. Đây cũng là tên bảng được dựng.",
    nameInvalid: "Tên mô hình chỉ gồm chữ thường, số và gạch dưới, và bắt đầu bằng chữ.",
    create: "Tạo",
    creating: "Đang tạo…",
    notCreated: "Chưa tạo được mô hình",
    editorNotLoaded: "Không tải được mô hình {{name}}.",
    backToList: "Mọi mô hình",
    unsaved: "Có thay đổi chưa lưu.",
    savedNote: "Đã lưu. Bảng chỉ đổi khi bạn Dựng.",
    sqlLabel: "SQL của mô hình",
    readOnlyNote: "Chỉ quản trị viên mới sửa được mô hình. Bạn đang xem bản đã lưu.",
    save: "Lưu",
    saving: "Đang lưu…",
    notSaved: "Chưa lưu được",
    build: "Dựng",
    building: "Đang dựng…",
    buildHint: "Dựng chạy dbt cho riêng mô hình này, với bản đã lưu. Hãy lưu trước.",
    notBuilt: "Chưa dựng được",
    buildOkHead: "Dựng thành công",
    buildFailedHead: "Dựng thất bại",
    testsFailed_other: "{{count, number}} kiểm tra không đạt. Xem từng bước trong Nhật ký.",
    openInJournal: "Xem trong Nhật ký",
    previewHead: "Những dòng đầu",
    previewEmpty: "Bảng đã dựng nhưng chưa có dòng nào.",
    testsHead: "Kiểm tra",
    testsLead:
      "Với mỗi cột, chọn kiểm tra dbt sẽ chạy sau khi dựng. Dòng không đạt được giữ ở lược đồ dq, ngoài tầm với của báo cáo.",
    colColumn: "Cột",
    colNotNull: "Không rỗng",
    colUnique: "Duy nhất",
    removeColumn: "Bỏ",
    addColumnLabel: "Thêm cột",
    addColumnHint: "Tên cột như trong câu SELECT. Gợi ý lấy từ lần dựng gần nhất.",
    addColumn: "Thêm",
    noTests: "Chưa có kiểm tra nào.",
    referenceHead: "Tham khảo",
    referenceLead: "Nguồn và các macro mà mọi mô hình đều dùng được. Chỉ đọc.",
    sourcesHead: "sources.yml",
    macrosHead: "Macro",
    deleteHead: "Xoá mô hình",
    deleteLead:
      "Xoá {{name}} khỏi danh sách mô hình. Bảng đã dựng vẫn còn cho đến lần dựng tiếp theo.",
    deleteConfirm: "Xoá {{name}}",
    deleting: "Đang xoá…",
    notDeleted: "Chưa xoá được",
  },

  /** A query result as a table: the same words for a preview, a failing-rows read, a question. */
  result: {
    caption_other: "{{count, number}} dòng",
    truncated: "Còn nhiều dòng hơn; chỉ hiện {{count, number}} dòng đầu.",
    empty: "Không có dòng nào.",
    yes: "Có",
    no: "Không",
  },

  /** How a question is drawn. The type names are the reader's words for the shapes. */
  chart: {
    head: "Vẽ kết quả",
    typeLabel: "Kiểu biểu đồ",
    xLabel: "Nhãn (trục ngang)",
    yLabel: "Giá trị được vẽ",
    seriesLabel: "Tách theo",
    none: "Tự chọn",
    maxLabel: "Giá trị tối đa",
    table: "Bảng",
    number: "Con số",
    bar: "Cột",
    line: "Đường",
    area: "Miền",
    pie: "Tròn",
    doughnut: "Vành khuyên",
    scatter: "Phân tán",
    bubble: "Bong bóng",
    radar: "Ra-đa",
    combo: "Kết hợp",
    funnel: "Phễu",
    gauge: "Đồng hồ",
    progress: "Tiến độ",
    pivot: "Bảng xoay",
    map: "Bản đồ",
    other: "Khác",
    noNumeric:
      "Kết quả không có cột số để vẽ. Hãy chọn một cột số làm giá trị, hoặc dùng kiểu Bảng.",
    noValue: "Không có giá trị.",
    mapNotLoaded: "Không tải được đường biên của bản đồ.",
    mapNeeds: "Bản đồ cần một cột nhãn là tên hoặc mã vùng, và một cột số làm giá trị.",
    unmatched_other: "{{count, number}} nhãn không khớp vùng nào trên bản đồ: {{names}}",
    regionLabel: "Vùng",
    regionVn: "Việt Nam — 34 tỉnh, thành",
    regionWorld: "Thế giới — các quốc gia",
    attributionVn:
      "Đường biên tỉnh: vietnamese-provinces-database (MIT), lấy từ Bản đồ tham chiếu đơn vị hành chính (sapnhap.bando.com.vn), Nhà xuất bản Tài nguyên Môi trường và Bản đồ Việt Nam.",
    attributionWorld:
      "Đường biên quốc gia: Natural Earth (thuộc phạm vi công cộng), qua gói world-atlas.",
    total: "Tổng",
    pivotNeeds: "Bảng xoay cần một cột nhãn và một cột giá trị; cột Tách theo là các cột của bảng.",
    totalsPartial: "Còn nhiều dòng hơn; các tổng này chỉ tính trên {{count, number}} dòng đầu.",
  },

  reports: {
    head: "Báo cáo",
    title: "Báo cáo",
    lead: "Câu hỏi, biểu đồ và bảng điều khiển của {{tenantId}}, đọc từ các mô hình đã dựng.",
    notLoaded: "Không tải được báo cáo của {{tenantId}}.",
    emptyTitle: "Chưa có báo cáo nào",
    emptyBody:
      "Một câu hỏi là một truy vấn trên các mô hình đã dựng — dựng bằng biểu mẫu hoặc viết SQL — và cách vẽ nó. Bảng điều khiển ghép nhiều câu hỏi với bộ lọc chung. Hãy đặt câu hỏi đầu tiên.",
    emptyBodyViewer:
      "Một câu hỏi là một truy vấn trên các mô hình đã dựng và cách vẽ nó. Thành viên có vai trò member trở lên có thể đặt câu hỏi đầu tiên.",
  },

  /** The Reports division's words: the lists, the builder, the run, the save. */
  bi: {
    questionsHead: "Câu hỏi",
    dashboardsHead: "Bảng điều khiển",
    questionsCaption_other: "{{count, number}} câu hỏi",
    dashboardsCaption_other: "{{count, number}} bảng điều khiển",
    noQuestions: "Chưa có câu hỏi nào.",
    noDashboards: "Chưa có bảng điều khiển nào.",
    newQuestion: "Câu hỏi mới",
    newDashboard: "Bảng điều khiển mới",
    colName: "Tên",
    colKind: "Kiểu",
    colChart: "Vẽ",
    colTiles: "Ô",
    colUpdated: "Cập nhật",
    kindVisual: "Biểu mẫu",
    kindSql: "SQL",
    questionNotLoaded: "Không tải được câu hỏi này.",
    backToReports: "Mọi báo cáo",
    nameLabel: "Tên câu hỏi",
    namePlaceholder: "Ví dụ: Doanh thu theo giai đoạn",
    untitled: "Câu hỏi chưa đặt tên",
    viewerNote: "Bạn có thể xem và chạy câu hỏi này. Sửa và lưu cần vai trò member.",
    viewerNew: "Đặt câu hỏi mới cần vai trò member.",
    builderHead: "Dựng câu hỏi",
    tableLabel: "Bảng",
    noTables:
      "Chưa có bảng nào trong lược đồ phân tích. Hãy dựng một mô hình ở mục Mô hình trước, hoặc viết SQL.",
    columnsHead: "Cột",
    countAll: "Đếm dòng",
    aggNone: "Giá trị",
    aggCount: "Đếm",
    aggSum: "Tổng",
    aggAvg: "Trung bình",
    aggMin: "Nhỏ nhất",
    aggMax: "Lớn nhất",
    filtersHead: "Bộ lọc",
    addFilter: "Thêm bộ lọc",
    removeFilter: "Bỏ",
    filterColumn: "Cột",
    filterOp: "Điều kiện",
    filterValue: "Giá trị",
    filterValues: "Các giá trị, cách nhau bằng dấu phẩy",
    filterFrom: "Từ",
    filterTo: "Đến",
    paramHint: "Gõ {{example}} làm giá trị để nhận từ bộ lọc của bảng điều khiển.",
    opEq: "bằng",
    opNeq: "khác",
    opLt: "nhỏ hơn",
    opLte: "không quá",
    opGt: "lớn hơn",
    opGte: "ít nhất",
    opContains: "chứa",
    opIn: "thuộc danh sách",
    opBetween: "trong khoảng",
    opIsNull: "trống",
    opNotNull: "không trống",
    groupHead: "Gộp theo",
    orderHead: "Sắp xếp theo",
    orderNone: "Không sắp xếp",
    orderAsc: "tăng dần",
    orderDesc: "giảm dần",
    limitLabel: "Số dòng tối đa",
    compiledHead: "SQL được dựng",
    switchToSql: "Chuyển sang viết SQL",
    switchHint: "Một chiều: sau khi chuyển, biểu mẫu không dựng lại được từ SQL.",
    sqlLabel: "SQL của câu hỏi",
    paramsHead: "Tham số",
    paramsLead:
      "Câu hỏi này cần giá trị cho các tham số dưới đây. Giá trị nằm trong địa chỉ trang, nên có thể gửi cho đồng nghiệp.",
    applyParams: "Áp dụng",
    paramMissing: "Hãy nhập giá trị cho mọi tham số trước khi chạy.",
    run: "Chạy",
    running: "Đang chạy…",
    notRun: "Chưa chạy được",
    resultHead: "Kết quả",
    save: "Lưu",
    saving: "Đang lưu…",
    notSaved: "Chưa lưu được",
    unsaved: "Có thay đổi chưa lưu.",
    savedNote: "Đã lưu.",
    deleteHead: "Xoá câu hỏi",
    deleteLead: "Xoá {{name}} khỏi báo cáo. Bảng điều khiển đang dùng nó sẽ hiện ô trống.",
    deleteConfirm: "Xoá câu hỏi",
    deleting: "Đang xoá…",
    notDeleted: "Chưa xoá được",
  },

  /** A dashboard: saved questions on a twelve-column grid under shared filters. */
  dashboard: {
    nameLabel: "Tên bảng điều khiển",
    namePlaceholder: "Ví dụ: Tổng quan doanh thu",
    untitled: "Bảng điều khiển chưa đặt tên",
    notLoaded: "Không tải được bảng điều khiển này.",
    viewerNote: "Bạn có thể xem bảng điều khiển này. Sửa cần vai trò member.",
    viewerNew: "Tạo bảng điều khiển mới cần vai trò member.",
    edit: "Sửa bố cục",
    done: "Xong sửa",
    emptyTitle: "Bảng điều khiển trống",
    emptyBody:
      "Thêm một câu hỏi đã lưu; mỗi câu hỏi là một ô trên lưới 12 cột. Bộ lọc ở đầu trang gắn vào tham số của từng câu hỏi.",
    emptyBodyViewer:
      "Chưa có ô nào trên bảng này. Thành viên có vai trò member trở lên có thể thêm câu hỏi.",
    filtersHead: "Bộ lọc",
    apply: "Áp dụng",
    clear: "Xoá bộ lọc",
    from: "Từ ngày",
    to: "Đến ngày",
    last7: "7 ngày qua",
    last30: "30 ngày qua",
    thisMonth: "Tháng này",
    thisYear: "Năm nay",
    filtersEditHead: "Bộ lọc chung",
    filtersEditLead:
      "Mỗi bộ lọc là một tham số mọi câu hỏi trên bảng có thể dùng. Khoảng ngày gắn vào {{from}} và {{to}}; chữ và số gắn vào {{name}}.",
    addFilter: "Thêm bộ lọc",
    removeFilter: "Bỏ",
    filterName: "Tên tham số",
    filterNameHint: "Chữ thường, số và gạch dưới; bắt đầu bằng chữ.",
    filterKind: "Kiểu",
    filterLabel: "Nhãn",
    kindDateRange: "Khoảng ngày",
    kindText: "Chữ",
    kindNumber: "Số",
    tilesHead: "Các ô",
    addQuestion: "Thêm câu hỏi",
    add: "Thêm",
    noneToAdd: "Mọi câu hỏi đã có trên bảng.",
    noQuestionsYet: "Chưa có câu hỏi nào để thêm. Hãy đặt câu hỏi ở mục Câu hỏi trước.",
    questionGone: "Câu hỏi này đã bị xoá.",
    waiting_other: "Ô này chờ giá trị cho {{names}}.",
    removeTile: "Bỏ ô",
    moveLeft: "Sang trái",
    moveRight: "Sang phải",
    moveUp: "Lên",
    moveDown: "Xuống",
    wider: "Rộng hơn",
    narrower: "Hẹp hơn",
    taller: "Cao hơn",
    shorter: "Thấp hơn",
    deleteHead: "Xoá bảng điều khiển",
    deleteLead: "Xoá {{name}}. Các câu hỏi trên đó vẫn còn trong báo cáo.",
    deleteConfirm: "Xoá bảng điều khiển",
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
    hubspotReads:
      "Công ty, liên hệ và giao dịch từ CRM của bạn, với các trường chuẩn cùng những trường bạn chọn thêm, và việc mỗi giao dịch thuộc công ty nào. HubSpot không lưu thời điểm sửa cho liên kết đó, nên thời điểm sửa phía nguồn của nó luôn để trống.",
    xeroReads: "Hóa đơn, thanh toán, giấy báo có và liên hệ từ một tổ chức bạn chọn.",
    gmailReads: "Tiêu đề thư và các loại tệp đính kèm bạn cho phép, từ hòm thư bạn kết nối.",
    driveReads:
      "Tài liệu trong các thư mục bạn chọn, theo loại tệp bạn cho phép. Không thư mục nào khác được đọc.",
  },

  /**
   * The interleaf: the assistant bound into the book as the reader's own sheet.
   *
   * `trợ lý` rather than a borrowed "assistant": the operators read Vietnamese first, and a
   * panel whose own name is in English is the screen-half-in-English this catalogue exists to
   * prevent. The printer's fist has no Vietnamese name and needs none -- it is a mark, and its
   * accessible name is the sentence below rather than a transliteration of a glyph.
   */
  assistant: {
    open: "Mở trợ lý",
    close: "Đóng trợ lý",
    title: "Trợ lý",
    lead: "Hỏi về dữ liệu của khách hàng này, hoặc nhờ trợ lý làm giúp một việc.",
    /** The empty state teaches the panel rather than saying it is empty. */
    emptyTitle: "Chưa có câu hỏi nào",
    emptyBody:
      "Hãy thử: “Hoá đơn tháng này về chưa?”, “Vì sao dòng này bị từ chối?”, hoặc “Các nguồn đang chạy thế nào?”.",
    /** The composer. A label, not a placeholder standing in for one. */
    askLabel: "Câu hỏi của bạn",
    askPlaceholder: "Hỏi về khách hàng này…",
    send: "Gửi",
    sending: "Đang trả lời…",
    stop: "Dừng",
    clear: "Xoá cuộc trò chuyện",
    /** Read to a screen reader while the answer is still being set. */
    working: "Trợ lý đang trả lời",
    /**
     * A figure the assistant set, numbered as a printed manual numbers one.
     *
     * The caption is an honesty device as much as a decoration: the reader can always tell
     * what the assistant set apart from what the application drew.
     */
    figure: "HÌNH {{number}}",
    /** A result that was shown live but is not kept. See `transcript.ts` on why. */
    foundNothing: "Không tìm thấy gì",
    figureRows_other: "{{count, number}} dòng",
    notKept: "Kết quả không được lưu lại. Hãy hỏi lại nếu bạn cần xem.",
    notKeptFailed: "Lần gọi này đã thất bại. Nội dung lỗi không được lưu lại.",
    /** The assistant read something; says which tool, never what it returned. */
    ranTool: "Đã tra: {{tool}}",
    /** A whole turn failed. Vermilion belongs to the errata slip, and this is one. */
    failedTitle: "Chưa trả lời được",
    failedBody: "Trợ lý chưa trả lời được câu hỏi này. Không có gì bị thay đổi.",
    retry: "Thử lại",
    /** No model configured. The reader cannot fix it; the sentence points at a person. */
    /**
     * A PROOF: the printer's trial impression, pulled before the press run.
     *
     * One sentence per action, interpolated with the real arguments, and it comes from HERE
     * rather than from the model -- asking the thing that proposed an action to also word the
     * confirmation of it is how a reader ends up striking a sentence that does not describe
     * what will happen.
     */
    proof: {
      head: "Xác nhận",
      strike: "Đồng ý",
      discard: "Bỏ",
      confirmLabel: "Nhập lại để xác nhận",
      confirmHint: "Hãy nhập “{{expected}}” để bật nút đồng ý.",
      revokeGrant:
        "Ngắt kết nối nguồn {{source}} của khách hàng {{tenantId}} và thu hồi quyền truy cập đã lưu. Việc đồng bộ sẽ dừng cho tới khi có người kết nối lại.",
      withdrawIngestKey:
        "Thu hồi khoá nạp dữ liệu {{id}} của khách hàng {{tenantId}}. Mọi nơi đang dùng khoá này sẽ bị từ chối ngay.",
      revokeInvitation:
        "Thu hồi lời mời {{id}} của khách hàng {{tenantId}}. Địa chỉ đó sẽ không đăng nhập được nữa.",
      deleteModel:
        "Xoá mô hình “{{name}}” của khách hàng {{tenantId}}. Câu SQL của mô hình sẽ mất theo.",
      struck: "Đã bỏ",
      runIngestNow: "Chạy đồng bộ nguồn {{source}} cho khách hàng {{tenantId}} ngay bây giờ.",
      setCadence: "Đổi tần suất đồng bộ của nguồn {{source}} thành “{{cadence}}”.",
      setCadenceCron:
        "Đặt lịch đồng bộ của nguồn {{source}} theo biểu thức cron “{{cron}}”, tính theo giờ Singapore.",
      invitePerson: "Mời {{email}} vào khách hàng {{tenantId}} với vai trò {{role}}.",
    },
    unconfiguredTitle: "Trợ lý chưa sẵn sàng",
    unconfiguredBody:
      "Bản triển khai này chưa được cấu hình trợ lý. Hãy báo người quản trị hệ thống.",
  },
};
