# Bắt đầu dùng Undercroft qua AI · Onboarding a new person

Trang này đưa một người mới từ "chưa có quyền" đến "trợ lý AI của tôi làm việc được trong
Undercroft". Nó chỉ nói **làm gì, theo thứ tự nào**. Lệnh và chi tiết từng bước nằm trong các
runbook mà nó dẫn tới. _English follows the Vietnamese._

## Tiếng Việt

### 1. Quản trị viên mời người đó

Người dùng chỉ đăng nhập được khi đã được mời. Quản trị viên mời họ ở trang **People** của
khách hàng, bằng đúng địa chỉ email họ sẽ dùng, và chọn vai trò:

| Vai trò  | Làm được                                                                    |
| -------- | --------------------------------------------------------------------------- |
| `viewer` | xem nguồn, lần chạy, model, báo cáo                                         |
| `member` | như trên, và lưu câu hỏi báo cáo, dashboard                                 |
| `admin`  | như trên, và đọc raw lake, lưu và dựng model, kết nối nguồn, mời người khác |

Người muốn dựng model cần vai trò `admin`. Nếu hệ thống chưa có ai để mời người đầu tiên, xem
[Bootstrap the first admin](sign-in-setup.md#7-bootstrap-the-first-admin).

### 2. Người đó đăng nhập một lần trên web

Họ mở trang Undercroft và đăng nhập bằng Google hoặc mã gửi qua email. Làm vậy để chắc rằng lời
mời đúng địa chỉ, trước khi nối trợ lý AI.

### 3. Chọn "cửa" theo nơi họ dùng AI

| Họ dùng                                   | Làm gì                                                                                                                                               | Có skill không                                             |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| **claude.ai** hoặc **Claude Desktop**     | Thêm _custom connector_ với địa chỉ `https://<control plane>/mcp`, rồi đăng nhập và chọn quyền trên trang đồng ý. [Hướng dẫn](mcp-setup.md#claudeai) | Chỉ có công cụ. Các host của Claude chưa đọc skill qua MCP |
| **Claude Code**                           | Thêm server MCP ([hướng dẫn](mcp-setup.md#claude-code)), rồi cài skill ([hướng dẫn](agent-skills.md#installing-them))                                | Có                                                         |
| **Codex** hoặc trợ lý chạy trong terminal | Cài skill ([hướng dẫn](agent-skills.md#installing-them)). Skill tự cài CLI và hướng dẫn đăng nhập ([CLI cho trợ lý](cli.md#as-an-agent))             | Có                                                         |

### 4. Bắt đầu với quyền chỉ đọc

- Khi đăng nhập qua connector hoặc tạo token, **chọn "Chỉ đọc"** cho những ngày đầu. Trợ lý chỉ
  được đưa các công cụ đọc, nên không thể lỡ tay sửa gì.
- Khi cần lưu model, lưu báo cáo hay chạy đồng bộ, **kết nối lại và chọn quyền ghi**.
- Mọi kết nối và token đều **thu hồi được ở trang Tài khoản**, và có hiệu lực ngay ở lần gọi kế
  tiếp. Xem [What a token is](mcp-setup.md#what-a-token-is).

### 5. Buổi làm việc đầu tiên

Gợi ý vài câu để gõ cho trợ lý (thay `CASE-0042` bằng mã khách hàng của họ):

- "Kiểm tra giúp tôi dữ liệu của CASE-0042 đồng bộ có ổn không, nguồn nào đang lỗi."
- "Có bao nhiêu deal đang mở, tổng giá trị bao nhiêu? Có bao nhiêu deal không có số tiền?"
- "Tạo cho tôi một model deal để làm báo cáo hàng tuần." Khi có skill, trợ lý sẽ hỏi rõ yêu
  cầu, kiểm tra SQL, và hỏi trước khi lưu và trước khi dựng.

Ba thói quen tốt:

- **Hỏi số dòng bị thiếu** mỗi khi trợ lý cộng một con số. Thiếu không có nghĩa là 0.
- **Sau khi đồng bộ, bảo trợ lý kiểm tra cả lần chạy và bản dựng lại model đi kèm**, trước khi
  tin số liệu.
- **Nếu trợ lý báo lỗi kèm mã truy vết (`traceId`), chụp lại gửi quản trị viên.** Đó là cách
  nhanh nhất để tìm nguyên nhân.

## English

### 1. An admin invites them

Sign-in is invite-only. An admin invites the person from the customer's **People** page, with
the exact email address they will use, and picks a role:

| Role     | Can                                                                                |
| -------- | ---------------------------------------------------------------------------------- |
| `viewer` | see sources, runs, models and reports                                              |
| `member` | all of that, and save report questions and dashboards                              |
| `admin`  | all of that, and read the raw lake, save and build models, connect sources, invite |

Building models needs `admin`. If nobody can invite the first person yet, see
[Bootstrap the first admin](sign-in-setup.md#7-bootstrap-the-first-admin).

### 2. They sign in once on the web

They sign in with Google or an emailed code. This proves the invitation matches their
address before any agent is involved.

### 3. Pick their door by where they use AI

| They use                            | Do                                                                                                                                                 | Skills                                                   |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| **claude.ai** or **Claude Desktop** | Add a custom connector for `https://<control plane>/mcp`, sign in and choose a grant on the consent page. [Steps](mcp-setup.md#claudeai)           | Tools only; Claude hosts do not read skills over MCP yet |
| **Claude Code**                     | Add the MCP server ([steps](mcp-setup.md#claude-code)), then install the skills ([steps](agent-skills.md#installing-them))                         | Yes                                                      |
| **Codex** or another terminal agent | Install the skills ([steps](agent-skills.md#installing-them)); the skill installs the CLI and walks sign-in ([CLI for agents](cli.md#as-an-agent)) | Yes                                                      |

### 4. Start read-only

- Choose **Read only** on the consent page, or mint a `read` token, for the first days. The
  agent is then offered only the tools that read.
- Reconnect with a write grant when they need to save models or reports, or to trigger a sync.
- Every connection and token is revoked on the account page, effective at the next call. See
  [What a token is](mcp-setup.md#what-a-token-is).

### 5. A first session

Prompts to try (replace `CASE-0042` with their customer's id):

- "Check whether CASE-0042's data is syncing, and which source is failing."
- "How many deals are open, and what is their total value? How many have no amount?"
- "Build me a deals model for a weekly report." With the skills, the agent interviews them
  first, checks the SQL, and asks before it saves and again before it builds.

Three good habits:

- **Ask how many rows were missing** whenever the agent sums an amount. Missing is not zero.
- **After a sync, have the agent check the run and the model rebuild it started** before
  trusting the numbers.
- **When the agent reports an error with a `traceId`, send it to the admin.** It is how the
  operator finds the cause.
