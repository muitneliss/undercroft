---
title: "MCP server cho dữ liệu doanh nghiệp: AI agent đúng quyền"
description: "MCP server cho dữ liệu doanh nghiệp giúp AI agent dùng dữ liệu Xero, Gmail, Drive và HubSpot qua Undercroft, với quyền người dùng và read/write grant."
translationKey: "ai-agent-mcp"
pubDate: "2026-09-29"
tags: ["MCP", "AI", "Integration", "Open-source"]
keywords:
  [
    "MCP server cho dữ liệu doanh nghiệp",
    "MCP server là gì",
    "AI agent",
    "hỏi đáp dữ liệu bằng AI",
    "Undercroft",
    "Claude MCP Xero",
  ]
hero: "../../../assets/posts/ai-agent-mcp/hero.png"
heroAlt: "Sơ đồ MCP server cho dữ liệu doanh nghiệp đưa yêu cầu của AI agent qua Bearer token, grant và Undercroft router đến dữ liệu của tenant"
---

**MCP server cho dữ liệu doanh nghiệp** cần trả lời hai câu hỏi: AI agent đọc được gì, và được phép thay đổi gì? Với Undercroft, Claude, ChatGPT hoặc một AI agent có kết nối phù hợp làm việc trên dữ liệu đã ingest từ Xero, Gmail, Google Drive và HubSpot. Quyền truy cập gắn với người dùng Undercroft, rồi được giới hạn thêm bằng read hoặc write grant.

Điều này hữu ích khi đội finance cần kiểm tra số liệu, còn đội ops muốn xem một lần sync đã đọc đủ nguồn chưa. Nhưng cần phân biệt MCP, CLI, skills và assistant có sẵn trong ứng dụng: chúng dùng chung các kiểm tra quyền của router, còn cơ chế xác nhận thay đổi không hoàn toàn giống nhau.

## MCP server là gì trong Undercroft?

MCP là Model Context Protocol, giao thức để client khám phá và gọi tool. Undercroft phục vụ MCP tại `/mcp` trên control plane. Mỗi tool tương ứng với một procedure của router; chẳng hạn `runs.list` thành `runs_list`. Input dùng schema của chính procedure đó.

Một lần gọi MCP đi qua `appRouter.createCaller(ctx)`, nên vẫn chịu kiểm tra role và tenant như các thao tác trong ứng dụng. Các procedure quản lý credential của tài khoản không được cung cấp qua MCP. AI agent không nhận một kết nối Postgres có quyền vượt người dùng.

[Undercroft là dự án open-source](https://github.com/muitneliss/undercroft). Dữ liệu nguồn đi vào raw data lake bất biến; người dùng viết dbt model để tạo dữ liệu phục vụ report và dashboard. MCP bổ sung cách thao tác với platform, không tự định nghĩa doanh thu hay cách đối chiếu chứng từ.

## MCP server cho dữ liệu doanh nghiệp đọc Xero, Gmail và Drive thế nào?

Phải kết nối nguồn, chọn phạm vi rồi ingest trước. Consent cho AI agent vào Undercroft khác với consent cho Undercroft đọc tài khoản nguồn. Đăng nhập MCP không đồng nghĩa với việc đã cấp quyền đọc Gmail.

| Nguồn        | Điều cần thiết lập                                                |
| ------------ | ----------------------------------------------------------------- |
| Xero         | OAuth, organisation được chọn và các entity mà scope cho phép đọc |
| Gmail        | Tài khoản đã kết nối và các label được chọn                       |
| Google Drive | Tài khoản đã kết nối, file hoặc folder được chọn để ingest        |
| HubSpot      | Private app token có read scope cho các object cần dùng           |

Khi dữ liệu đã được lưu, AI agent có thể xem run, tìm model và đọc report trong phạm vi role cho phép. Với câu hỏi thiếu số liệu, nên kiểm tra run gần nhất và nguồn nào chưa được đọc trước khi yêu cầu giải thích kết quả kinh doanh.

Việc nối deal trong HubSpot với invoice trong Xero vẫn cần quy tắc rõ ràng trong dbt model. Có thể đọc thêm về [tích hợp Xero vào Postgres](/tich-hop-xero-postgres/) và [report từ Xero bằng SQL, dbt](/bao-cao-xero-sql-dbt/). Với chứng từ, bài về [Google Drive, OCR và tìm kiếm](/tich-hop-google-drive-ocr/) giải thích phần dữ liệu đầu vào.

## Kết nối Claude, ChatGPT hoặc AI agent khác ra sao?

Client hỗ trợ remote MCP kết nối đến `/mcp` của deployment. Undercroft hỗ trợ OAuth và personal access token; runbook có hướng dẫn cho claude.ai, Claude Desktop và Claude Code. Với ChatGPT hoặc host khác, cần dùng luồng remote MCP mà host đó hỗ trợ, đồng thời kiểm tra riêng khả năng hiển thị widget và đọc skills.

Qua OAuth, client đưa người dùng đến trang đăng nhập của Undercroft, rồi đến trang consent. Đăng nhập bằng địa chỉ đã được mời, chọn read only nếu chỉ cần tra cứu. Connected app xuất hiện trên trang tài khoản; revoke tại đó chặn lần gọi tiếp theo.

Ví dụ dưới đây dùng lệnh được ghi trong runbook cho Claude Code. Domain minh họa phải được thay bằng origin thật của deployment:

```sh
claude mcp add --transport http undercroft https://undercroft.example.test/mcp
```

Sau đó mở `/mcp` trong Claude Code, chọn `undercroft` và authenticate. Nếu client chỉ gửi được header, người dùng có thể tạo personal access token tại `/account`, chọn grant và thời hạn, rồi cấu hình `Authorization: Bearer`. Token chỉ hiện một lần; cookie đăng nhập không đủ để gọi `/mcp`.

## Read/write grant khác gì với role của người dùng?

Role quyết định người dùng được làm gì trong từng tenant. Grant có thể thu hẹp quyền đó, không thể mở rộng nó. Một token thuộc về người dùng có thể tới các tenant họ là thành viên, với role tương ứng; token không chỉ giới hạn ở tenant đang mở lúc tạo.

Grant `read` chỉ cung cấp tool được phân loại là read. Grant `write` cho phép gọi thêm thao tác thay đổi, nhưng router vẫn kiểm tra role. Viewer không thành admin chỉ vì chọn write. Việc kiểm tra grant diễn ra cả khi gọi tool, không chỉ khi liệt kê tool.

Có một trường hợp dễ nhầm: `lake_query` cần write grant dù SQL chỉ đọc dữ liệu. Undercroft xem việc chạy SQL do admin viết trên raw data lake là thao tác cần cho phép rõ ràng. Read grant không có nghĩa là được chạy mọi câu SQL.

Credential không thể tự tạo credential khác để nâng quyền. Khi người dùng bị gỡ quyền truy cập, credential cũng mất quyền ở request tiếp theo. Với tenant không thuộc phạm vi của người gọi, câu trả lời là `NOT_FOUND`, tránh tiết lộ tenant đó có tồn tại hay không.

## Injection gate ngăn một email ra lệnh cho assistant thế nào?

Assistant có sẵn trong Undercroft cần hai điều kiện cho mutation: người dùng xác nhận proof của thay đổi, và injection gate độc lập đồng ý rằng người dùng đã yêu cầu hành động đó. Proof trình bày thao tác cùng arguments để kiểm tra; câu xác nhận do ứng dụng định nghĩa, không để model tự viết.

![Mutation của assistant có sẵn phải qua proof được người dùng xác nhận và injection gate chỉ đọc lời người dùng; một kiểm tra không đạt thì yêu cầu bị từ chối](../../../assets/posts/ai-agent-mcp/flow.png)

Injection gate chỉ xét lời người dùng, loại toàn bộ tool results khỏi phần đánh giá. Ví dụ, email chứa câu “disconnect nguồn này” vẫn là dữ liệu của người gửi email, không tự trở thành yêu cầu của người đang dùng assistant.

Gate không được cấu hình hoặc không trả lời thì mutation bị từ chối. Approval secret cũng cần được cấu hình để ký xác nhận chống sửa đổi; thiếu secret thì approval không có chữ ký. Đây là giới hạn được ghi trong [hướng dẫn thiết lập assistant](https://github.com/muitneliss/undercroft/blob/main/docs/runbook/assistant-setup.md).

Hai kiểm tra trong hình thuộc assistant có sẵn. MCP client bên ngoài dùng grant, role và cơ chế xác nhận của host; CLI dùng opt-in theo profile. Không nên hiểu rằng mọi mutation từ Claude hay ChatGPT đều đi qua injection gate này.

## Khi nào đội kỹ thuật nên dùng CLI và skills?

Nếu host đã có tool của Undercroft qua MCP, skill ưu tiên dùng chúng. Khi không có MCP nhưng AI agent chạy được command, skill dùng CLI. CLI đăng nhập theo người dùng và gọi `/trpc` qua HTTP, không dùng DSN hay service token để đi thẳng vào database.

Mỗi environment profile có `allowWrites`, mặc định tắt. Chỉ người dùng tại terminal mới bật được; AI agent thử bật trong agent mode sẽ nhận `HUMAN_REQUIRED`. Một URL truyền riêng qua `--url` không cho phép write. Agent mode trả về một JSON envelope để kiểm tra kết quả và mã lỗi.

Skills hướng dẫn thứ tự làm việc, thay vì cấp thêm quyền:

1. Đọc input schema và xác định operation thật sự có sẵn.
2. Lấy tenant ID, run ID, source hoặc model từ kết quả đọc, không tự dựng tên.
3. Nêu thay đổi dự kiến; với CLI, chạy `--dry-run` trước write.
4. Xin xác nhận cho đúng hành động destructive và báo lại kết quả platform trả về.

Workflow `undercroft-model-builder` hỏi rõ nhu cầu, đọc lake, soạn dbt model rồi chạy `models.check`. Nó hỏi trước khi save và trước khi build. Check trả errors, warnings và những gì chưa kiểm chứng; không bảo đảm SQL compile hay test sẽ pass.

[Runbook về agent skills](https://github.com/muitneliss/undercroft/blob/main/docs/runbook/agent-skills.md) hướng dẫn cài qua `npx skills`. MCP Skills extension cũng phục vụ cùng các file cho host hỗ trợ; chỉ kết nối MCP chưa đủ để kết luận workflow đã được nạp.

## Hỏi đáp dữ liệu bằng AI cần kiểm tra kết quả gì?

Yêu cầu AI agent chỉ ra tenant, nguồn, run và model làm căn cứ. Một saved question đọc model đã build, nên kết quả không mới hơn lần build đó. Cần kiểm tra thời điểm sync và build trước khi dùng câu trả lời cho công việc.

MCP giữ kết quả đầy đủ trong `structuredContent`, nhưng phần text giới hạn mỗi list ở 50 mục và tổng text ở 60 KB, có thông báo khi cắt. AI agent không được xem một list bị cắt là toàn bộ dữ liệu. Với số tiền, giữ nguyên currency và phần thiếu; không biến giá trị chưa đọc được thành số không.

## Câu hỏi thường gặp

### Có thể dùng Claude MCP với dữ liệu Xero không?

Có, sau khi Xero được kết nối và dữ liệu đã ingest vào Undercroft. Claude chỉ gọi được các tool mà role và grant của người dùng cho phép.

### ChatGPT có dùng cùng MCP server được không?

Có thể dùng endpoint khi cấu hình ChatGPT hỗ trợ remote MCP tương thích. Cần kiểm tra riêng khả năng gọi tool, hiển thị widget và đọc skills của host.

### Chỉ muốn hỏi dữ liệu thì có cần write grant không?

Có thể bắt đầu với read grant để dùng các tool được phân loại là read. Riêng `lake_query` vẫn cần write grant và role phù hợp dù câu SQL chỉ đọc.

### Assistant nào cũng tạo được dbt model phải không?

AI agent bên ngoài có thể dùng model-builder skill qua MCP hoặc CLI khi đủ quyền. Assistant có sẵn trong Undercroft không author hay build dbt model, và chỉ soạn lake SQL để người dùng kiểm tra rồi chạy.
