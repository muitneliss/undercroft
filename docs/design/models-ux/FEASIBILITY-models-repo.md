# Đối chiếu khả năng repo với PLAN/SPEC Models

Ngày kiểm tra: 10/10/2026. Clone đọc-only nhánh main, commit **69d69280390fbfbc07f5be8233e91d34687168fa**, release **v1.73.0**. Footer web kiểm tra trước đó cùng số phiên bản; chưa chứng minh deployment chạy đúng SHA. Không sửa code repo, không chạy build hay truy vấn production. Đây là phân tích code, không phải kết quả nghiệm thu tính năng mới.

## 1. Kết luận khả thi

Kiến trúc List → hồ sơ đọc → Lineage tập trung khả thi trên nền hiện có. Không cần thay nền tảng hoặc mặc định thay ELK. Nhưng trải nghiệm có ngữ nghĩa nghiệp vụ đầy đủ cần nguồn metadata mới; không thể coi tất cả là việc frontend.

## 2. Ma trận khả năng

| Yêu cầu trong plan | Bằng chứng code hiện có | Công việc thực sự |
|---|---|---|
| Gọn List, tìm/lọc/sort, trạng thái | models.list trả toàn bộ tên, updatedAt/By, lastBuild; modelList.ts tìm và lọc client | Chủ yếu frontend; bổ sung pagination khi cần, không bắt buộc API search mới ngay |
| Hồ sơ đọc, SQL, tên cột, cấu hình test, link run | models.get, ModelDetail, ModelPanels/ModelFacts, runs.get | Frontend tổng hợp các API, giữ đường editor/journal |
| Schema gồm tên và kiểu cột | bi.schema → worker.readSchema → SchemaResponse | Dùng lại API theo quyền; không cần tạo schema reader mới. Nullable/PK/FK/mô tả chưa có trong shape này |
| Quan hệ raw ↔ model, macro, missing/undeclared | models.lineage, modelLineage.ts | Dữ liệu sẵn; thêm UI tập trung và bảng |
| Một bước, nhiều bước, mở nhánh, root khác selection | parentsOf/childrenOf/upstreamOf/downstreamOf/drawnGraph; UI hiện ghép root với selection | Viết thêm traversal giới hạn độ sâu, state và camera; chưa phải chức năng hoàn chỉnh sẵn có |
| Bảng tác động theo model, đường đi | Edges và traversal có sẵn; upstreamPaths hiện có giới hạn số đường | Frontend dùng scope/count chung; không gọi tổng đã khai báo là mọi ảnh hưởng thực tế |
| Lỗi graph | arrange() dùng ELK, catch lỗi layout trả null | Có cơ chế fallback nhưng cần cải thiện và chẩn đoán lỗi gốc; không kết luận ELK hỏng vì 207 node |
| Kiểm tra SQL trước chạy | models.check trả findings + unverified | Có thể đưa vào mục SQL, không gọi là SQL đã compile/chạy thành công |
| Dữ liệu mẫu | Build trả preview 50 dòng; bi.answer đọc riêng, member/admin, giới hạn và timeout | Có thể tái sử dụng BI query cho member/admin; viewer chỉ chạy saved question. Hợp đồng preview nhận model ID và resolve server như spec cần endpoint/wrapper mới, không nới quyền |
| Kết quả kiểm thử, lỗi, thời lượng | runs.get.steps và RunStepShape; dq.failures admin-only | Link/tóm tắt run làm ngay; tổng hợp test theo model cần ánh xạ chắc chắn, shape step chưa có modelId/dependency trực tiếp. Không gán tổng run cho model |
| Lần thử gần nhất và bản thành công gần nhất | LastBuild chỉ record mới nhất; app.model.columns giữ tên cột build thành công | Cần query/response bổ sung để có lastSuccessfulBuild rõ ràng. lastBuild.endedAt hiện là thời điểm kết thúc run, không phải timestamp kết thúc step model |
| Alias, mục đích, grain, đơn vị, owner nghiệp vụ | Model row không có; ADR 0112 xóa context, migration 500 drop table | Tính năng metadata mới, cần thiết kế người viết/nguồn/lifecycle. updatedBy không phải owner nghiệp vụ |
| Lớp, domain, family, Bronze/Silver/Gold | Model contract/row không có các trường này | Cần registry/config hoặc metadata có version; nhóm prefix có thể làm bằng UI nếu gọi đúng là nhóm theo tên, không coi là lớp nghiệp vụ |
| Nguồn nghiệp vụ Xero/HubSpot | Lineage chỉ raw/model/missing; tất cả source account cùng raw | Cần khai báo/mapping có bằng chứng; không lấy cạnh raw.records hoặc substring tên làm sự thật |
| Report/dashboard impact | bi.questions có definition visual.table hoặc SQL; dashboard có layout | Có nguyên liệu cho phần visual question → dashboard; chưa có lineage tích hợp. SQL question cần phân tích/khai báo và coverage rõ, không hứa đầy đủ |
| SQL lưu khác SQL đã build | Model row giữ SQL hiện tại, run step không giữ SQL hash | Cần lưu hash/phiên bản đúng lúc build. updatedAt không đủ; releaseTag là bản ứng dụng, không phải bản SQL |
| Freshness và chất lượng tổng quát | Timestamp run, raw ingestion và not_null/unique có sẵn | Chưa có SLA/freshness theo model hoặc registry metric chất lượng trong models API. Phải định nghĩa cột thời gian/ngưỡng, rồi thu thập |
| Cập nhật incremental/SCD, performance/cost | dbt project mặc định table, SQL có thể dùng config; có executionMs | Không có catalog chiến lược cập nhật, lịch sử, partition/cost/profile đầy đủ để UI lấy lên. Không nhầm incremental ingest với incremental model |
| AI thực hiện thay đổi | Router chung; MCP/CLI dùng quyền người dùng; skills model-builder discovery-first | External agent có nền tảng đọc/check/save/build theo quyền. Trợ lý trong web chỉ có catalogue hạn chế, cố ý không models.save/build |

## 3. Ràng buộc quan trọng: metadata nghiệp vụ đã bị gỡ có chủ đích

ADR 0112 (06/10/2026) thay thế ADR 0105 hoàn toàn. Tài liệu ghi các context cũ không được điền, mọi model bị đánh incomplete, và trạng thái approved không chứng minh dữ liệu đúng. Code hiện tại xác nhận không models.setContext, không context trong list/get; migration 500 xóa app.model_context.

Do đó, không tái tạo một form bắt điền/duyệt dài cho mọi model hoặc cảnh báo thiếu metadata trên mọi hàng. Nếu cần lớp/nghiệp vụ/alias theo mục tiêu UI mới, thiết kế một nguồn khai báo tối thiểu có chủ sở hữu, ưu tiên reuse cấu hình/tài liệu được duy trì; việc thay quyết định metadata phải được ghi rõ. Không coi migration 460 hay ADR 0105 còn trong repo là chức năng đang tồn tại.

Comment SQL hiển thị được dưới nhãn trích dẫn từ định nghĩa, nhưng trích comment không tự thành glossary đáng tin cậy. UI hồ sơ tối thiểu vẫn hữu ích với tên kỹ thuật, SQL, schema, tests, run và dependencies hiện có.

## 4. Điều chỉnh thứ tự triển khai

1. **Làm trên nền hiện có:** List gọn; hồ sơ kỹ thuật đọc; graph một bước và bảng chung scope; lối tắt SQL/run; đọc tên/kiểu cột qua bi.schema; kiểm tra SQL qua models.check.
2. **Bổ sung nhỏ, riêng rẽ:** preview theo model ID nếu giữ hợp đồng spec; lastSuccessfulBuild; snapshot/version/hash; ánh xạ test-model. Mỗi phần có hợp đồng quyền/dữ liệu riêng.
3. **Quyết định metadata mới:** lớp/nghiệp vụ/alias/grain/nguồn nghiệp vụ. Không chặn bước 1 và không hồi sinh nguyên cơ chế context bị gỡ.
4. **Sau đó:** report lineage, freshness policy, column lineage, profiling/cost nếu nhu cầu đã rõ.

Không đưa tỷ lệ phần trăm hoàn thành hay số ngày thực hiện: chưa đo effort, chưa chạy acceptance hoặc tái hiện lỗi layout bằng code.

## 5. Nguồn code đã kiểm tra

Các link cố định cùng commit, tránh main thay đổi sau audit:

- [Model service và shape list/get](https://github.com/muitneliss/undercroft/blob/69d69280390fbfbc07f5be8233e91d34687168fa/apps/control-plane/src/services/models.ts)
- [Model router, quyền và models.check](https://github.com/muitneliss/undercroft/blob/69d69280390fbfbc07f5be8233e91d34687168fa/apps/control-plane/src/handlers/modelsRouter.ts)
- [Model repo và lastBuildPerModel](https://github.com/muitneliss/undercroft/blob/69d69280390fbfbc07f5be8233e91d34687168fa/packages/db/src/repos/models.ts)
- [Lineage khai báo và giới hạn](https://github.com/muitneliss/undercroft/blob/69d69280390fbfbc07f5be8233e91d34687168fa/packages/db/src/services/modelLineage.ts)
- [Traversal UI](https://github.com/muitneliss/undercroft/blob/69d69280390fbfbc07f5be8233e91d34687168fa/apps/ui/src/lib/lineage.ts)
- [ELK và nhánh lỗi layout](https://github.com/muitneliss/undercroft/blob/69d69280390fbfbc07f5be8233e91d34687168fa/apps/ui/src/lib/lineageArrange.ts)
- [bi.schema/bi.answer và quyền](https://github.com/muitneliss/undercroft/blob/69d69280390fbfbc07f5be8233e91d34687168fa/apps/control-plane/src/handlers/biRouter.ts)
- [Preview sau build](https://github.com/muitneliss/undercroft/blob/69d69280390fbfbc07f5be8233e91d34687168fa/apps/worker/src/services/jobs.ts)
- [Shape schema, run step, preview](https://github.com/muitneliss/undercroft/blob/69d69280390fbfbc07f5be8233e91d34687168fa/packages/contracts/src/transformApi.ts)
- [ADR 0112: gỡ business context](https://github.com/muitneliss/undercroft/blob/69d69280390fbfbc07f5be8233e91d34687168fa/docs/adr/0112-a-model-carries-no-business-context.md)
- [Giới hạn trợ lý trong web](https://github.com/muitneliss/undercroft/blob/69d69280390fbfbc07f5be8233e91d34687168fa/apps/control-plane/src/services/assistant/writeTools.ts)
- [Router procedures được xuất ra MCP](https://github.com/muitneliss/undercroft/blob/69d69280390fbfbc07f5be8233e91d34687168fa/apps/control-plane/src/handlers/mcpTools.ts)
