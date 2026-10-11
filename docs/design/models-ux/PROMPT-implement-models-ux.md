# Prompt giao thi công prototype Models

Đây là lệnh để sử dụng khi người dùng yêu cầu bắt đầu thi công. Việc đọc hoặc sửa tài liệu này không tự cấp phép thực hiện lệnh. Mặc định chỉ làm prototype local; tích hợp dữ liệu thật là nhiệm vụ riêng.

**Nếu tiếp nhận prototype đã có:** bắt đầu ở [README.md](README.md), đọc full source theo SOURCE-INVENTORY và chạy nguyên bản trước. Không bắt đầu dựng lại từ scaffold hoặc ảnh. Tái sử dụng phần tương thích; phần cần viết lại phải chỉ ra file/symbol, lý do và bằng chứng hành vi không lệch. Picker dùng inline, không modal; metadata nghiệp vụ có điều kiện theo ADR 0112. Quy trình review không tự cấp phép tích hợp production.

---

Hãy thi công **prototype local hoàn chỉnh cho khu vực Models của Undercroft** theo bộ tài liệu trong `docs/design/models-ux/`. Làm đến khi các luồng chính chạy được và có bằng chứng kiểm tra, không dừng ở kế hoạch, scaffold hoặc màn hình tĩnh.

## Đọc và áp dụng

1. Đọc `AGENTS.md`/`CLAUDE.md` và các rule áp dụng cho đường dẫn sẽ sửa.
2. Đọc `SPEC-models-ux.md` baseline 2.0: đây là nguồn chuẩn về sản phẩm. Toàn bộ 118 AC nằm ở §12.2; giữ nguyên ID để báo cáo kết quả.
3. Làm theo P0–P5 của `PLAN-models-ux.md`; đọc/cập nhật `IMPLEMENTATION-STATUS-models-ux.md` để tiếp tục đúng việc còn lại.
4. Chỉ đọc AUDIT/FEASIBILITY khi cần bằng chứng nguyên nhân hoặc khả năng cũ. Không triển khai một yêu cầu đã bỏ chỉ vì nó xuất hiện trong audit hoặc bản minh họa.

Không cần suy thiết kế từ lịch sử chat. Chỉ dẫn mới của người dùng có ưu tiên; nếu đổi phạm vi, cập nhật SPEC/PLAN liên quan trước khi triển khai phần thay đổi. Nếu chưa rõ một lựa chọn kỹ thuật có thể đảo ngược, tự chọn theo codebase và ghi lý do; không xin xác nhận từng bước.

## Phạm vi bắt buộc

- Tái sử dụng nguyên shell `Book`/`TabRail` và running header. Giữ màu bảy phân khu, font, tỷ lệ, khoảng cách, logo, định danh tenant, tài khoản, VI/EN, trợ lý chung, sign-out, hover/active, punch-through, leaf-turn, reduced motion và responsive. Không lấy header/CSS của HTML minh họa thay ứng dụng thật. Chỉ thay nội dung Models; tab Models active theo route.
- Hai tab cấp cao: **Danh sách / Dòng dữ liệu**. Hồ sơ là trang dùng chung bên trong, có **Hiểu dữ liệu / Dữ liệu / SQL & cấu hình / Vận hành**.
- Danh sách ba cột Nhóm / Model / Khám phá. Tất cả nhóm theo lớp; Đầu vào theo nguồn; Biến đổi theo nghiệp vụ; Đầu ra theo chủ đề; Chưa phân lớp theo nhóm kỹ thuật có thật. Không lặp vai trò/lần chạy thường trực. Nhóm trước phân trang, 25 model/trang, count toàn query, mỗi ID đúng một hàng; thu/mở, tìm/lọc, sort, Back giữ ngữ cảnh.
- Lineage có root rõ, mặc định hai phía một bước; graph/bảng cùng scope. Phân lớp không sửa dependency. Không tự layout toàn tenant; không ghép cạnh giả qua node bị ẩn. Có picker, panel, mở/thu nhánh, refocus, camera, toàn bộ tác động down/all/table và Hoàn tác một bước.
- Chọn nhiều có chọn trang/chọn tất cả kết quả/bỏ chọn/Chỉ xem đã chọn; giữ lựa chọn qua từ khóa/trang, draft có Hủy. Vượt ngân sách vẽ vẫn xem đủ tập chọn bằng bảng. Không cắt ngầm lựa chọn và không chạy layout mỗi tick.
- Hồ sơ có tình huống đủ/thiếu metadata, build lỗi còn dữ liệu cũ, chưa có kết quả test/freshness. Chạy thành công không đồng nghĩa dữ liệu đúng/mới. Preview chỉ theo hành động rõ. SQL/editor/journal và formatter/quyền hiện hữu giữ nguyên.

Không thêm nút AI trong Models, taxonomy editor, bulk Build/Delete, dashboard mới, report/column lineage hoặc nâng dependency không liên quan.

## Dữ liệu, kiến trúc và giới hạn tác động

- Dùng **250 model hoàn toàn tổng hợp**, bộ scale test tới 1.000; không sao chép dữ liệu hoặc topology tenant thật. Có fan-out 100, nhóm 58, merge/cycle, nhiều nguồn, nguồn partial/complete rỗng, metadata thiếu và raw root.
- Fixture đi qua adapter tách khỏi component; dùng đường thực thi grouping/scope/layout của prototype để phép đo có ý nghĩa. Không tạo một graph đơn giản riêng chỉ để benchmark đẹp.
- UI state thuộc Zustand; server state thuộc tRPC cache. Dùng EntityRef và revision theo tenant/quyền. Không sao chép hoặc duy trì state song song chỉ vì minh họa từng làm vậy.
- Không suy alias/grain/nguồn/lớp/test từ tên hoặc prefix. Những tình huống fixture có nhãn giả lập. API/field chưa có thì dùng fallback của SPEC; không dựng endpoint giả rồi tuyên bố đã tích hợp.
- Không kết nối hoặc ghi production, chạy migration, build model thật, commit/push/merge/deploy trong nhiệm vụ này. Giữ thay đổi hiện có ngoài phạm vi. Nếu cần thao tác nằm ngoài quyền đã được giao, hoàn tất phần local độc lập trước rồi nêu đúng việc cần quyết định.
- Dùng Taskfile và kiểm tra repository theo quy tắc hiện hữu; không thay toolchain để né gate. CSS scoped theo Models, không override shell/global tokens. Tất cả nhãn qua VI/EN; thời gian/tiền dùng formatter chung.

## Trình tự và chứng minh chất lượng

1. Xác minh checkout, baseline shell và capability trước khi sửa. Ghi vào STATUS, không chép trạng thái thực hiện vào SPEC.
2. Dựng adapter/fixture/state và logic scope/grouping; dựng List/hồ sơ, rồi bảng/bộ chọn, sau đó graph. Bảng phải hoạt động khi engine lỗi.
3. Tác vụ layout chạy Worker thật, có timeout/hủy/stale-result/cache bounded. List/Bảng/mobile không dùng graph thì không chạy ELK ẩn. Highlight node không layout lại.
4. Kiểm thử logic và luồng có rủi ro bằng seam thật phù hợp repository. Không viết test chỉ chép lại implementation hoặc đổi fixture để bỏ lỗi.
5. Đo theo SPEC §14 trên điều kiện công bố; ghi cold/warm và fetch/index/layout/render riêng. Không gọi mock loading hoặc Worker là bằng chứng production đã nhanh.
6. Kiểm tra shell trước/sau, motion riêng, mobile/zoom 200%, VI/EN, focus/bàn phím, một phân khu ngoài Models, URL/back/forward và stale responses.
7. Ghi mỗi AC là pass/fail/not-run/not-applicable, môi trường fixture/integrated và bằng chứng. Tính năng cốt lõi thiếu không được đánh not-applicable. Prototype không chứng minh enforcement quyền server hoặc latency production.
8. Sửa mọi lỗi luồng chính phát hiện được. Nếu bị giới hạn môi trường, ghi command/lỗi và phần chưa xác minh; không tuyên bố toàn bộ đạt.

## Điều kiện hoàn thành và phản hồi bàn giao

Chỉ báo prototype hoàn thành khi List → hồ sơ → Lineage → chọn nhiều → Bảng → Back chạy được, header/hiệu ứng không đổi, mọi tương tác bắt buộc có xử lý trạng thái lỗi và các checks áp dụng có kết quả. Không dùng nút không làm gì để giả hoàn thành; phần ngoài capability có nhãn và fallback đúng spec.

Bàn giao ngắn gọn:

- URL local và lệnh chạy lại qua Taskfile.
- Các luồng đã làm, liên kết file chính và ảnh/bằng chứng tương tác.
- Kết quả checks, số đo theo môi trường và liên kết STATUS theo AC.
- Sai khác, phần chưa kiểm chứng và hạn chế thực tế; phân biệt prototype với tích hợp thật.

Không tự chuyển sang tích hợp production sau khi bàn giao prototype.
