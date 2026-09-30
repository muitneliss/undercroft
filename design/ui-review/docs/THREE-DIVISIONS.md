# Khách hàng, Báo cáo, Người dùng (bản mẫu r5)

Prototype thống nhất bảy tab. Hợp đồng thiết kế đi kèm (`docs/design/operator-and-reader-paths.md` trong pull request) phủ cả bảy tab. Báo cáo có một feature request riêng; Người dùng và Khách hàng chung một feature request. Phần bản mẫu làm nhiều hơn yêu cầu (trang chi tiết hồ sơ, in, trình biên tập câu hỏi và dashboard) chỉ để minh hoạ.

## Mở duyệt

Mở `index.html` cùng thư mục assets, hoặc chạy `node preview.cjs` và vào `http://127.0.0.1:8772/#reports`. Chuyển VI/EN ngay trong header. Bản mẫu dùng CASE-0042 cho hồ sơ có dữ liệu; hai hồ sơ còn lại cố ý rỗng để thử không trộn tenant.

| Phần       | Lớp ngoài                              | Lớp bên trong đã làm                                                                                                                                                                          |
| ---------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Khách hàng | Tìm tên/mã, lọc vai trò, hồ sơ đang mở | Chi tiết hồ sơ, sửa tên, tạo khách hàng với quyền nền tảng, chuyển hồ sơ độc lập                                                                                                              |
| Báo cáo    | Danh mục dashboard / câu hỏi, tìm kiếm | Dashboard doanh thu, công nợ, thiếu dữ liệu; câu hỏi chart/table/definition; bộ lọc; điểm → hàng kết quả; CSV; print; editor câu hỏi và dashboard; lưu/bỏ/xóa                                 |
| Người dùng | Thành viên / lời mời / so sánh quyền   | Chi tiết thành viên, chọn vai trò là lưu, quản trị cuối không có lựa chọn hạ quyền hay gỡ, bảng quyền cạnh form mời, mời, kiểm tra trùng, thu hồi lời mời và gỡ thành viên có xác nhận inline |

## Kịch bản duyệt nhanh

1. **Báo cáo → Nhịp kinh doanh:** lọc Dịch vụ, mở một điểm, đọc bảng, quay về. Dịch vụ phải còn được chọn.
2. **Báo cáo → Công nợ phải thu:** ô Current không được cộng thành một số đủ khi một hóa đơn thiếu amount. Đọc bảng để nhận ra hóa đơn đó.
3. **Câu hỏi → Biên tập:** thử chọn Line cho bộ nhóm; prototype từ chối vì không có trục thời gian. Nhập SQL tùy ý: không được nhận kết quả giả. Lưu được định nghĩa nhưng chưa có kết quả.
4. **Người dùng → Demo Operator:** dòng ghi "quản trị viên cuối cùng", không có ô chọn vai trò, không có nút gỡ. Sang Demo Analyst, chọn Quản trị: lưu ngay; quay lại Demo Operator thì có đủ ô chọn và nút gỡ. Thu hồi lời mời phải bấm lần hai, nút lần hai ghi địa chỉ.
5. **Mời người dùng:** dùng email @example.test; lời mời được thêm nhưng người đó chưa trở thành thành viên và không có email thật gửi đi.
6. **Khách hàng → Atlas Example:** không được nhìn thấy báo cáo/dữ liệu của Demo Co. Quay lại CASE-0042 để tiếp tục.
7. **Công cụ kiểm thử → Thành viên:** được biên tập báo cáo; không được mời người dùng. Viewer không có editor báo cáo.
8. **Công cụ kiểm thử → Trả lỗi một lần:** thử lưu câu hỏi hoặc tên; lỗi phải giữ bản nháp và không báo thành công.

## Đường tích hợp thật

| Prototype     | Route/component hiện có                             | Dữ liệu / quyền                                                 | Điểm cần duyệt                                                                                                    |
| ------------- | --------------------------------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| customers     | `/tenants`, Tenants, CustomerIndex                  | `tenants.list`, session.me                                      | Search/filter dùng danh sách đã được server cho phép; không dựng health score từ dữ liệu thiếu                    |
| customer/:id  | TenantOverview / DisplayNameForm                    | `tenants.get`, `tenants.rename` admin                           | Trang hồ sơ là tổ chức UI đề xuất; có thể giữ đổi tên tại Sources như hiện nay, không tạo hai owner cho cùng form |
| customer-new  | Tenants / AddTenantPanel                            | `tenants.create` superadmin                                     | Mã CASE cố định trong fixture; production giữ validator TenantId, không tự siết chỉ còn CASE-xxxx                 |
| reports       | Reports, DashboardBand, QuestionBand                | `bi.questions.list`, `bi.dashboards.list`                       | Ngày sửa không phải freshness; thumbnail là loại chart, không chạy hàng loạt query cho catalogue                  |
| dashboard/:id | Dashboard, QuestionCard, DashboardFilters           | `bi.questions.answer`, dashboard save/delete                    | Giữ filter values vào link câu hỏi; giữ bộ lọc hỗ trợ và grid 12 cột, chỉ ưu tiên bố cục đọc                      |
| question/:id  | Question, QuestionBands, QuestionResult, ChartFrame | `bi.answer` member; `bi.runQuestion` viewer; save/delete member | Reuse compiled SQL, chartData, formatter; không paste SVG renderer mẫu                                            |
| people        | People, Roster                                      | people.members/invitations; mutations admin                     | Không tự thêm last login / activity log khi API không có; không suy email sent từ invitation tồn tại              |
| member detail | Roster + panel inline                               | setRole/removeMember                                            | Last-admin guard vẫn do server quyết định; UI giải thích trước thao tác                                           |

State khi triển khai: server trong tRPC React Query; draft trong Zustand theo tenant + object; route/view/filter trong React Router URL; toàn bộ lời UI trong i18next. Không thêm state framework, chart runtime hoặc tầng quyền khác.

## Giới hạn của bản mẫu

- Tất cả hành động chỉ thay đổi bộ nhớ tab; reload khôi phục mẫu. Các vai trò là chế độ thử, không phải authentication.
- Dữ liệu doanh thu là tổng theo tháng; công nợ là snapshot cố định. Không dùng chung bộ lọc ngày theo cách gây hiểu nhầm hai grain này.
- Customer index không có health score/counters toàn nền tảng vì list API chưa cung cấp chúng.
- Editor câu hỏi dùng preset dữ liệu, không tái tạo đầy đủ query builder production. 5 renderer mẫu, 16 kiểu giữ trong kế hoạch tích hợp.
- Dashboard editor mẫu thêm/bỏ/đổi thứ tự, không thay thế toàn bộ controls vị trí/kích thước/filter definition đang có.
- Dòng dữ liệu (lineage) chỉ vẽ quan hệ khai báo: model → model và bảng hồ thô → model. Không có cạnh từ mô hình sang báo cáo, câu hỏi hay dashboard; muốn có cần một hợp đồng khai báo riêng.
- Không có public sharing, gửi email, scheduled report, API write hoặc upload GitHub trong lượt này.

Nghiên cứu có nguồn, các lựa chọn bị loại và roadmap: `REPORTS-RESEARCH.md`.
