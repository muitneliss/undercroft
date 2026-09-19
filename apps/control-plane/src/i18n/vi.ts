/**
 * Vietnamese, for everything the control plane says to a person.
 *
 * Small, and it should stay small. Almost nothing this server produces is read by a human:
 * the API answers a TypeScript client in codes and shapes. What is here is the exception --
 * two emails, and the handful of refusals whose message reaches a browser verbatim.
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
  invitation: {
    subject: "Bạn đã có quyền truy cập Undercroft",
    /**
     * Carries no token and no link that grants anything. The invitation is keyed by the
     * address, so this is a nudge to go and sign in, not a credential -- which is why it is
     * safe to email and why losing it costs nothing but a conversation.
     */
    body: [
      "Bạn đã được cấp quyền truy cập {{tenantId}} trong Undercroft.",
      "",
      "Hãy đăng nhập tại {{publicUrl}} — dùng đúng địa chỉ này ({{email}}), bằng Google hoặc bằng cách yêu cầu mã dùng một lần.",
      "",
      "Nếu bạn không chờ đợi email này, bạn có thể bỏ qua; sẽ không có gì xảy ra cho đến khi bạn đăng nhập.",
    ].join("\n"),
  },

  signInCode: {
    subject: "Mã đăng nhập Undercroft của bạn",
    body: [
      "Mã đăng nhập của bạn là {{otp}}",
      "",
      "Mã hết hạn sau {{minutes}} phút. Nếu bạn không yêu cầu đăng nhập, bạn có thể bỏ qua email này.",
    ].join("\n"),
  },

  error: {
    notInvited:
      "Địa chỉ đó chưa được mời. Hãy đề nghị quản trị viên gửi lời mời, và đăng nhập bằng đúng địa chỉ đã nhận lời mời.",
    alreadyMember: "{{email}} đã có quyền truy cập với vai trò {{role}}.",
    noOpenInvitation: "Không có lời mời nào đang mở với id đó.",
    requiresRole: "Thao tác này cần vai trò {{role}}.",
    /**
     * Says what is missing without naming the variable that grants it. An operator reading
     * this cannot fix it themselves -- somebody with access to the deployment's environment
     * has to -- so the sentence points at a person rather than at a setting.
     */
    requiresSuperadmin: "Thao tác này cần quyền quản trị toàn hệ thống.",
    tenantExists: "Mã khách hàng {{tenantId}} đã được dùng cho một khách hàng khác.",
    workerUnavailable:
      "Hiện chưa lấy được danh sách từ Google. Dịch vụ xử lý không phản hồi; hãy thử lại sau ít phút.",
    /**
     * Names the remedy, because there is one and it belongs to the reader.
     *
     * This case used to be worded as `workerUnavailable` -- "the service is not
     * responding" -- for a grant that Google had refused. An administrator told that waits,
     * retries, and eventually reports an outage; what was needed was a reconnect with the
     * Gmail permission left ticked.
     */
    scopeInsufficient:
      "Kết nối Google hiện chưa đủ quyền để đọc danh sách này. Hãy ngắt kết nối rồi kết nối lại, và giữ nguyên dấu tích ở quyền đọc Gmail trên màn hình của Google.",
    /** The worker answered and said no, for a reason retrying will not change. */
    browseRefused: "Dịch vụ xử lý không lấy được danh sách cho nguồn {{source}}.",
    scopeNotUnderstood: "Không đọc được lựa chọn cho nguồn {{source}}.",
    /**
     * Points at a person, not at a variable, for the same reason `requiresSuperadmin` does:
     * the administrator reading this cannot fix it from any screen, and naming the
     * environment key would describe our deployment to a customer.
     */
    ingestNotConfigured:
      "Bản triển khai này chưa được cấu hình để kết nối tài khoản Google. Hãy báo người quản trị hệ thống.",
    sourceNotConnectable: "Nguồn {{source}} chưa kết nối tự động được.",
  },
};
