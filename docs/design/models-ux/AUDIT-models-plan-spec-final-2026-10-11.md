# Audit cuối PLAN/SPEC Models — v1.8

Ngày: 11/10/2026. Phạm vi: rà soát tài liệu, phản hồi minh họa và code shell/formatter ở checkout `bc5e774`. Không sửa ứng dụng, không dựng prototype, không chạy lại benchmark hoặc điều tra production trong lượt này.

**Kết quả:** hướng hai tab, hồ sơ dùng chung và danh sách phân nhóm được giữ. Các điểm mâu thuẫn/thiếu hợp đồng dưới đây đã sửa trong [PLAN v1.8](./PLAN-models-ux.md) và [SPEC v1.8](./SPEC-models-ux.md). Sẵn sàng làm căn cứ triển khai sau các cổng đã ghi; không đồng nghĩa 118 acceptance case đã đạt trên ứng dụng.

## 1. Phát hiện và chỉnh sửa

| Vấn đề | Nguy cơ nếu giữ nguyên | Chỉnh sửa đã ghi |
|---|---|---|
| Chỉ nói giữ branding, chưa khóa header/menu | Người thi công thay shell bằng header tối giản trong minh họa | SHELL-01–06: tái sử dụng Book/TabRail, giới hạn thay đổi trong nội dung Models; có baseline và kiểm tra hồi quy |
| Ảnh đang chọn Raw Lake, yêu cầu giữ hiệu ứng chưa có tiêu chí | Đóng băng active sai route hoặc chỉ giống ảnh tĩnh nhưng mất chuyển động | Active theo route; giữ hover/tab/punch/leaf-turn và trigger theo tenant/phân khu, kiểm tra motion riêng |
| Các breakpoint nội dung có thể bị áp lên shell | Rail mobile mất hành vi hiện hữu, CSS rò sang trang khác | Shell giữ breakpoint 760 px ở checkout này; 768/1.000 px chỉ áp dụng nội dung mới; CSS scoped |
| Bảng phân bổ §2.3 vẫn yêu cầu lần chạy ở List | Cột trạng thái xuất hiện lại dù đã chốt bỏ | List ba cột; chỉ dấu cần chú ý hoặc nhãn phục vụ lọc/sort ở dòng phụ |
| Sort theo lần chạy nhưng đã bỏ cột thời gian | Người dùng không biết vì sao hàng được xếp như vậy | build_desc hiện mốc bắt đầu có nhãn; không dùng endedAt/SQL updatedAt thay khóa sort |
| Chưa có group summary trong hợp đồng dữ liệu | Nhóm 25 hàng sau khi đã cắt trang, count nhóm sai và nhóm rải rác | Nhóm/sort toàn tập trước paginate; thêm DiscoveryGroupSummary cùng revision; client index complete vẫn được phép |
| Nguồn partial và nhiều nguồn đều có thể khớp hai quy tắc | Một model bị nhân đôi hoặc có vẻ nguồn đã đầy đủ | Thứ tự ưu tiên lỗi/unsupported/partial/complete; complete mới chia 0/1/nhiều; physical raw có nhãn riêng |
| “Tổng nhóm hiển thị” không rõ là trang hay toàn query | Cộng các nhóm trên một trang thành tổng tenant | Tổng mọi nhóm của query mới bằng kết quả distinct; page count và group count tách nhãn |
| Thu nhóm chưa định danh state/focus đủ rõ | Trang sau bị thu theo trang trước, focus biến mất | Key theo context/page/group ID; Back phục hồi; query mới mở nhóm; giữ focus trên nút nhóm |
| Upstream gọi Đầu vào, cột Vai trò dùng cho quan hệ | Nhầm vị trí so với root với lớp dữ liệu | Phía trước/Phía sau, cột Quan hệ với trung tâm; lớp vẫn Đầu vào/Biến đổi/Đầu ra |
| Xem tác động vừa giữ depth cũ vừa có nghĩa toàn downstream | Hai nút cùng nhãn trả phạm vi khác nhau | Xem tác động luôn down/all/table; đổi hướng giữ độ sâu qua Đổi phạm vi |
| Múi giờ mô tả quá rộng, ví dụ minh họa không phải formatter thật | Đổi VI/EN hoặc máy làm thời gian chạy lệch lịch | Giữ formatter Asia/Singapore và formatMoney; múi giờ nghiệp vụ là metadata riêng |
| Tài liệu còn nói chưa có minh họa phân nhóm | Hiểu sai tiến độ và làm lại phần đã duyệt | Ghi minh họa đã được xem/phản hồi tốt, tách rõ những hành vi chưa được chứng minh |

## 2. Bảo toàn hình thức và hiệu ứng: căn cứ code

- [Book.tsx](../../../apps/ui/src/components/Book.tsx): running header, định danh tenant, tài khoản, ngôn ngữ, trợ lý chung, sign-out; leaf key theo tenant/phân khu, nội dung trong `main.leaf__page`.
- [TabRail.tsx](../../../apps/ui/src/components/TabRail.tsx) và [divisions.ts](../../../apps/ui/src/lib/divisions.ts): thứ tự, màu và tỷ lệ tab, route active, trạng thái locked; mobile tự đưa tab hiện tại vào vùng nhìn thấy.
- [index.css](../../../apps/ui/src/index.css): `leaf-turn`, `punch-through`, hover transform, `--hinge`/`--turn`, nền/font và reduced motion; rail mobile ở chân trang.
- [when.ts](../../../apps/ui/src/lib/when.ts), [quy tắc i18n](../../../.claude/rules/i18n.md) và [money](../../../.claude/rules/money.md): múi giờ/formatter dùng chung, không đổi theo locale hoặc ví dụ giả lập.

Ảnh người dùng là tham chiếu hình thức, không phải bằng chứng kiểm thử motion. Không lưu ảnh có tenant/email thật vào repository. Baseline triển khai phải dùng dữ liệu tổng hợp và cùng điều kiện trước/sau; không cần sửa shell để đạt thiết kế Models mới.

## 3. Những gì giữ, những gì chưa làm

| Hạng mục | Trạng thái sau audit |
|---|---|
| Hai tab cấp cao; hồ sơ bốn mục; phân nhóm List | Giữ hướng đã được phản hồi tốt; hợp đồng trong spec đã thống nhất |
| Không thêm nút AI trong Models | Giữ; không xóa nút trợ lý chung ở header |
| Màu/hiệu ứng/header hiện hữu | Yêu cầu bắt buộc mới đã có AC; chưa thực hiện visual regression vì chưa đổi app |
| Chọn tất cả/bỏ chọn/giữ lựa chọn/xem bảng | Hợp đồng giữ nguyên; minh họa phân nhóm gần nhất không chứng minh AC-75–82. Cần hoàn tất phần minh họa này trước cổng prototype đã ghi trong Plan |
| URL, quyền, lỗi, coverage partial/rỗng, pagination server | Đã có hợp đồng; còn cần kiểm thử khi triển khai, không suy pass từ mock chạy local |
| Alias/grain/lớp/nghiệp vụ/nguồn và chỉ số engineer | Chỉ bật theo capability/provenance; chưa có nguồn thì fallback. Nguồn duy trì metadata là công việc kỹ thuật cần chốt, không giả định API cũ còn tồn tại |
| Lag 200+ model | Giữ cổng Worker/scope/budget/timeout/cache và baseline browser/API; số đo replay lịch sử không chứng minh đã sửa production |
| Prototype, commit hoặc deploy mới | Không thực hiện trong lượt audit này |

Không mở rộng thêm dashboard, wizard, taxonomy editor, bulk Build/Delete, report/column lineage hoặc nút AI. Không đổi thư viện chỉ vì số lượng model và không bỏ hiệu ứng chung để bù việc graph chậm.

## 4. Kiểm tra tài liệu và bàn giao

- PLAN/SPEC cùng phiên bản 1.8; giữ AC-01–108 và bổ sung AC-109–118, không đổi số ID cũ.
- Rà soát liên kết nội bộ, ID acceptance, chỗ tham chiếu phiên bản và `git diff --check`; đồng bộ bản giao trong `outputs/` từ bản chuẩn trong repository.
- Bản minh họa chỉ quyết định bố cục/tương tác đã cho xem; SPEC là hợp đồng, shell thật là nguồn giao diện chung. Khác biệt còn lại của minh họa được công bố ở bảng trên, không coi là tính năng production.
- Không chạy bộ test ứng dụng cho thay đổi chỉ tài liệu này. Checks repository, visual regression và đo hiệu năng là điều kiện khi thi công/phát hành, chưa có kết quả mới để công bố.
