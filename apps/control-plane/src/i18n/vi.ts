/**
 * Vietnamese, for everything the control plane says to a person.
 *
 * Small, and it should stay small. Almost nothing this server produces is read by a human:
 * the API answers a TypeScript client in codes and shapes. What is here is the exception --
 * five emails, and the handful of refusals whose message reaches a browser verbatim.
 *
 * Mirrors `apps/ui/src/i18n/vi.ts` in shape and rules but not in content, deliberately. A
 * shared catalogue would put the UI's several hundred keys into the server bundle so that
 * six of them could be reused, and would let a copy edit on a screen quietly change the
 * wording of an email.
 *
 * `vi.ts` is the source of truth for which keys exist; `en.ts` answers them, and `index.ts`
 * pins that with a type annotation.
 */

export const vi = {
  /**
   * The words every posted leaf shares: the colophon, and the vocabulary of the schedule.
   *
   * These are LABELS, not sentences, which is why they are shared where a sentence never
   * would be. Each stands alone in a cell of the schedule and is never joined to anything,
   * so the word-order argument in `.claude/rules/i18n.md` does not reach them -- and the
   * alternative, "Nguồn" written out in four places, is four places for it to drift from
   * the column heading on the screen that shows the same fact.
   */
  email: {
    colophon: "Undercroft gửi thư này tự động. Không cần trả lời.",
    customer: "Khách hàng",
    source: "Nguồn",
    /** Which mailbox or Drive account, when a source may hold several. ADR 0043. */
    account: "Tài khoản",
    address: "Địa chỉ",
    when: "Lúc",
    expires: "Hết hạn",
    key: "Khoá",
    /** The mark at the head of the correction slip, as the interface prints it. */
    errata: "Đính chính",
  },

  invitation: {
    subject: "Bạn đã có quyền truy cập Undercroft",
    /**
     * Carries no token and no link that grants anything. The invitation is keyed by the
     * address, so this is a nudge to go and sign in, not a credential -- which is why it is
     * safe to email and why losing it costs nothing but a conversation.
     */
    heading: "Lời mời vào Undercroft",
    lead: "Bạn đã được cấp quyền truy cập {{tenantId}}.",
    howToSignIn:
      "Hãy đăng nhập bằng đúng địa chỉ này, bằng Google hoặc bằng cách yêu cầu mã dùng một lần.",
    action: "Đăng nhập",
    ignore:
      "Nếu bạn không chờ đợi email này, bạn có thể bỏ qua; sẽ không có gì xảy ra cho đến khi bạn đăng nhập.",
  },

  signInCode: {
    subject: "Mã đăng nhập Undercroft của bạn",
    heading: "Mã đăng nhập của bạn",
    lead: "Dùng mã này để đăng nhập vào Undercroft.",
    expiry: "Mã hết hạn sau {{minutes}} phút.",
    ignore: "Nếu bạn không yêu cầu đăng nhập, bạn có thể bỏ qua email này.",
  },

  /**
   * A run that failed, to the customer's administrators. Names the source, the time and the
   * run's own reason, links into the journal, and says that repeats are held for a day --
   * so an inbox with one message in it is not read as one failure.
   *
   * This is the one message set as an errata slip, because it is the one that IS a
   * correction: the reason rides on vermilion and nothing else in the family does.
   */
  runFailed: {
    subject: "Đồng bộ {{source}} cho {{tenantId}} không thành công",
    /**
     * A model build is not a sync, so it gets its own whole sentence rather than being
     * spliced into `subject` where a source's name goes. Spliced, it read "Đồng bộ dựng mô
     * hình cho …" here and "The the model build sync for …" in English: a fragment only fits
     * the sentence of the language it was written for. `.claude/rules/i18n.md`.
     */
    modelsSubject: "Dựng mô hình cho {{tenantId}} không thành công",
    /**
     * What a transform run is called in the schedule's source cell: a label standing alone,
     * never joined into a sentence -- the subject has `modelsSubject` for that.
     */
    models: "Dựng mô hình",
    noReason: "không ghi nhận lý do",
    /**
     * Wordless about WHICH source, deliberately: the same message covers a model build,
     * where "{{source}} không chạy xong" would read as "dựng mô hình không chạy xong". The
     * schedule below names it, in the cell where a name belongs.
     */
    heading: "Lần chạy đã thất bại",
    lead: "Những gì lần chạy này lẽ ra cập nhật sẽ không thay đổi cho đến khi có một lần chạy thành công.",
    action: "Xem nhật ký",
    repeats:
      "Nếu lỗi tiếp diễn, bạn sẽ không nhận thêm email về nguồn này trong 24 giờ; một lần chạy thành công sẽ đặt lại khoảng thời gian đó.",
  },

  /**
   * A sync's status as a card in the operators' Lark group. A failure's card is headed by
   * `runFailed.subject`, the same sentence the email carries, so the group and the inbox name
   * one event alike; what is here is only what the email never says.
   */
  syncCard: {
    /** A label standing alone in a card's fact cell, before the run's own reason. */
    reason: "Lý do",
    failingSince: "Lỗi từ lúc",
    recovered: "Đồng bộ {{source}} cho {{tenantId}} đã chạy lại bình thường",
    /** Its own whole sentence, for the reason `runFailed.modelsSubject` is one. */
    modelsRecovered: "Dựng mô hình cho {{tenantId}} đã chạy lại bình thường",
  },

  grantExpiring: {
    subject: "Quyền truy cập {{source}} của {{tenantId}} sắp hết hạn",
    heading: "Quyền truy cập sắp hết hạn",
    lead: "Hãy kết nối lại nguồn này trước lúc đó để việc đồng bộ không bị gián đoạn.",
    action: "Kết nối lại",
  },

  keyExpiring: {
    subject: "Khoá ghi dữ liệu “{{label}}” của {{tenantId}} sắp hết hạn",
    heading: "Khoá ghi dữ liệu sắp hết hạn",
    lead: "Hãy tạo khoá mới ở mục Nguồn dữ liệu và cập nhật cho bên đang dùng khoá này.",
    action: "Đến Nguồn dữ liệu",
  },

  error: {
    notInvited:
      "Địa chỉ đó chưa được mời. Hãy đề nghị quản trị viên gửi lời mời, và đăng nhập bằng đúng địa chỉ đã nhận lời mời.",
    alreadyMember: "{{email}} đã có quyền truy cập với vai trò {{role}}.",
    noOpenInvitation: "Không có lời mời nào đang mở với id đó.",
    notMember: "{{email}} không có quyền truy cập khách hàng này.",
    lastAdmin:
      "{{email}} là quản trị viên duy nhất của khách hàng này. Hãy cấp vai trò admin cho người khác trước, để khách hàng không bị bỏ lại mà không còn ai quản lý được quyền truy cập.",
    requiresRole: "Thao tác này cần vai trò {{role}}.",
    /**
     * Says what is missing without naming the variable that grants it. An operator reading
     * this cannot fix it themselves -- somebody with access to the deployment's environment
     * has to -- so the sentence points at a person rather than at a setting.
     */
    requiresSuperadmin: "Thao tác này cần quyền quản trị toàn hệ thống.",
    tenantExists: "Mã khách hàng {{tenantId}} đã được dùng cho một khách hàng khác.",
    /**
     * Two references that differ only in case or punctuation fold to one database login.
     * The sentence names the fix -- a reference that differs in more than that -- rather
     * than the mechanism, which the operator cannot see.
     */
    tenantRoleCollision:
      "Mã khách hàng {{tenantId}} quá giống mã của một khách hàng khác (chỉ khác chữ hoa/thường hoặc dấu). Hãy chọn một mã khác hẳn.",
    modelNameTaken: "Đã có một mô hình tên {{name}}. Hãy mở mô hình đó để sửa, hoặc chọn tên khác.",
    buildInProgress:
      "Đang có một lần dựng mô hình cho khách hàng này. Hãy đợi lần đó xong rồi thử lại.",
    buildNotStarted:
      "Không dựng được mô hình. Dịch vụ xử lý không phản hồi; hãy thử lại sau ít phút.",
    dqNotRead: "Không đọc được các dòng không đạt kiểm tra của bước này.",
    /** Postgres's own sentence follows the colon; it quotes the author's SQL and nothing else. */
    queryFailed: "Câu truy vấn không chạy được: {{message}}",
    queryNotRun:
      "Không chạy được câu truy vấn. Dịch vụ xử lý không phản hồi; hãy thử lại sau ít phút.",
    /**
     * Its own key rather than `queryNotRun`, because the reader was not running a query.
     * Somebody who typed a word into a search box and is told their "query" failed looks for
     * SQL they never wrote.
     */
    searchNotRun: "Không tìm kiếm được. Dịch vụ xử lý không phản hồi; hãy thử lại sau ít phút.",
    paramMissing: "Câu hỏi cần một giá trị cho {{name}}. Hãy đặt bộ lọc đó rồi chạy lại.",
    workerUnavailable:
      "Hiện chưa lấy được danh sách từ Google. Dịch vụ xử lý không phản hồi; hãy thử lại sau ít phút.",
    /**
     * Names the remedy, because there is one and it belongs to the reader.
     *
     * This case used to be worded as `workerUnavailable` -- "the service is not
     * responding" -- for a grant that Google had refused. An administrator told that waits,
     * retries, and eventually reports an outage; what was needed was a reconnect with the
     * Gmail permission left ticked.
     *
     * Names the source rather than Gmail since Drive browses too (ADR 0047): a Drive grant made
     * before it carries `drive.file`, and its remedy is the same reconnect, to a consent that
     * now asks for read access.
     */
    scopeInsufficient:
      "Kết nối {{source}} hiện chưa đủ quyền để đọc danh sách này. Hãy kết nối lại nguồn này và giữ nguyên dấu tích ở mọi quyền được hỏi trên màn hình cấp quyền.",
    /** The worker answered and said no, for a reason retrying will not change. */
    browseRefused: "Dịch vụ xử lý không lấy được danh sách cho nguồn {{source}}.",
    /** A source whose scope is not chosen from a list at all -- not a fault anywhere. */
    browseUnsupported: "Nguồn {{source}} không có danh sách nào để chọn phạm vi đọc.",
    scopeNotUnderstood: "Không đọc được lựa chọn cho nguồn {{source}}.",
    /**
     * HubSpot's `scope-insufficient`. Worded apart from Google's because the remedy is: a
     * private app has no consent screen to leave ticked, it has read permissions an admin grants
     * in HubSpot. The permission names stay as HubSpot spells them -- they are what gets searched.
     */
    propertiesInsufficient:
      "Mã truy cập HubSpot hiện chưa đủ quyền để đọc danh sách trường. Trong HubSpot, hãy cấp cho private app quyền đọc công ty, liên hệ và giao dịch (crm.objects.companies.read, crm.objects.contacts.read, crm.objects.deals.read), rồi dán lại mã truy cập nếu HubSpot cấp mã mới.",
    /**
     * Points at a person, not at a variable, for the same reason `requiresSuperadmin` does:
     * the administrator reading this cannot fix it from any screen, and naming the
     * environment key would describe our deployment to a customer.
     *
     * It does name the provider, `Google` or `Xero`: that is the button the reader pressed,
     * not a fact about our deployment, and a sentence fixed to one provider told an admin who
     * pressed Connect Xero that Google was not set up (issue 211).
     */
    ingestNotConfigured:
      "Bản triển khai này chưa được cấu hình để kết nối tài khoản {{provider}}. Hãy báo người quản trị hệ thống.",
    sourceNotConnectable: "Nguồn {{source}} chưa kết nối tự động được.",
    /** Names the state rather than a fault: the run the reader wants is already on screen. */
    runInProgress: "Nguồn {{source}} đang được đồng bộ. Hãy đợi lần chạy này xong.",
    runNotStarted: "Chưa chạy được đồng bộ. Dịch vụ xử lý không phản hồi; hãy thử lại sau ít phút.",
    /** The worker answered and said no: a source not connected, or one this build cannot run. */
    runRefused: "Dịch vụ xử lý từ chối chạy đồng bộ cho nguồn {{source}}.",
    /**
     * The provider turned the pasted token away. Names what to check -- the token and its
     * scopes -- because the person reading this is the one who pasted it.
     */
    tokenRejected:
      "{{source}} không chấp nhận mã này. Hãy kiểm tra lại mã đã dán và các quyền của ứng dụng riêng, rồi thử lại.",
    tokenNotStored: "Chưa lưu được mã cho nguồn {{source}}. Dịch vụ xử lý đã từ chối.",
    /**
     * No model key in the environment. Like `ingestNotConfigured`, it points at a person
     * rather than at a setting: the reader cannot fix this from any screen, and naming the
     * environment key would describe our deployment to a customer.
     */
    assistantUnconfigured:
      "Trợ lý chưa được cấu hình cho bản triển khai này. Hãy báo người quản trị hệ thống.",
    /**
     * The browser sent a body this route cannot read. Worded for the reader rather than for a
     * developer, because it is the reader who sees it, and it says the question was not
     * delivered -- which is the part that matters to them.
     */
    assistantBadRequest: "Chưa gửi được câu hỏi. Hãy tải lại trang rồi thử lại.",
    /**
     * The per-conversation ceiling. Names the way out -- clear the conversation -- because a
     * limit with no next action reads as a fault.
     */
    assistantThreadFull:
      "Cuộc trò chuyện này đã quá dài. Hãy xoá nội dung trò chuyện để bắt đầu lại.",
  },
};
