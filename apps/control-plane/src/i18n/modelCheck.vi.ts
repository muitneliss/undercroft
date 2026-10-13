/**
 * What `models.check` says about a model's SQL, in Vietnamese: the `modelCheck` namespace of
 * `vi.ts`, in a file of its own because it is one block of wording for one checker
 * (`packages/db/src/services/modelCheck.ts`) and the catalogue had no room left for it. The keys
 * are `vi.ts`'s exactly: `vi.modelCheck` is this object, so `MessageKey` and the key-set test in
 * `i18n.test.ts` read it as if it had never moved.
 */

export const modelCheck = {
  finding: {
    "not-one-macro":
      "Một macro là đúng một khối {% macro tên(...) %} ... {% endmacro %}. Ngoài khối đó chỉ được có chú thích, và không có khối thứ hai.",
    "name-mismatch":
      "Định nghĩa mang tên {{subject}}, khác với tên đang dùng để lưu. Hãy đặt cả hai cùng một tên.",
    "reserved-name":
      "{{subject}} là tên đã được dành riêng: một macro trùng tên sẽ âm thầm thay thế macro mà dbt hoặc nền tảng đang dựa vào. Hãy chọn tên khác.",
    "forbidden-block":
      "Macro không được chứa khối {{subject}}. Khối đó thay đổi cách cả dự án được dựng, chứ không phải thứ để mô hình gọi.",
    "unbound-name":
      "{{subject}} không phải tham số của macro này, cũng không phải thứ dbt định nghĩa. dbt sẽ thay nó bằng chuỗi rỗng mà không báo lỗi.",
    empty: "Mô hình chưa có câu SQL nào.",
    semicolon:
      "Bỏ dấu chấm phẩy. dbt bọc mô hình trong CREATE TABLE ... AS, nên dấu chấm phẩy làm câu lệnh kết thúc sớm và bản dựng thất bại.",
    "not-select":
      "Mô hình phải là một câu truy vấn bắt đầu bằng select, with hoặc values. dbt tự tạo bảng từ kết quả của nó.",
    "write-statement":
      "Mô hình không được ghi dữ liệu: bỏ {{subject}}. Mô hình chỉ đọc; dbt tạo bảng từ câu select.",
    "select-into":
      "Bỏ select ... into. dbt tự tạo bảng cho mô hình; into sẽ tạo một bảng thứ hai ngoài tầm dbt.",
    "raw-direct":
      "Đọc raw.{{subject}} qua hàm source() của dbt, với nguồn undercroft, thay vì gọi thẳng -- để dbt biết mô hình phụ thuộc vào đâu.",
    "analytics-direct":
      "Đọc {{subject}} qua hàm ref() của dbt thay vì gọi thẳng theo schema, để dbt dựng mô hình kia trước mô hình này.",
    "unknown-source": "Không có nguồn {{subject}}. Các nguồn có sẵn nằm trong models.reference.",
    "unknown-ref": "Khách hàng này không có mô hình nào tên {{subject}}.",
    "self-ref": "Mô hình không thể đọc chính nó.",
    "report-parameter":
      "{{subject}} là tham số của một câu hỏi báo cáo. Mô hình không có tham số: dbt sẽ thay nó bằng chuỗi rỗng và bộ lọc biến mất mà không báo lỗi. Hãy thay bằng một giá trị cố định, hoặc bỏ bộ lọc đó.",
    "no-tombstone-filter":
      "Mô hình đọc records nhưng không nhắc đến deleted_at. Nếu không lọc deleted_at is null, bản ghi đã xoá ở nguồn sẽ hiện như còn sống.",
    "zero-default":
      "coalesce(…, 0) biến một giá trị thiếu thành số 0 trông như thật. Hãy để NULL, trừ khi 0 thực sự đúng nghĩa.",
    "top-level-limit":
      "limit ở ngoài cùng khiến mô hình chỉ lưu một phần dữ liệu. Chỉ giữ nếu thực sự muốn vậy.",
    "unknown-macro":
      "{{subject}} không phải macro của dự án này -- của nền tảng hay của riêng khách hàng -- cũng không phải hàm của dbt. Các macro có sẵn nằm trong models.reference.",
    "dynamic-reference":
      "Tên truyền vào {{subject}} không được viết thẳng ra, nên không kiểm tra được nó có tồn tại không.",
    "test-column-unmentioned":
      "Có kiểm thử cho cột {{subject}} nhưng câu SQL không nhắc đến cột đó.",
    "test-forbidden-call":
      "Kiểm thử SQL không được gọi {{subject}}(). Kiểm thử là đúng một câu select trả về các dòng vi phạm; mức nghiêm trọng khai báo bằng severity của kiểm thử.",
    "test-model-unread":
      "Kiểm thử SQL phải đọc chính mô hình của nó, {{subject}}, qua ref(), để dbt chạy nó sau khi dựng mô hình đó và cùng với mô hình đó.",
    "test-name-too-long":
      "Tên {{subject}} dài quá 63 ký tự, Postgres sẽ cắt bớt. Hãy đặt tên kiểm thử ngắn hơn.",
  },
  /** A finding inside one of the model's tests rather than its SQL: which test, then what. */
  inTest: "Kiểm thử {{test}}: {{message}}",
  unverified: {
    compiles: "Câu SQL có biên dịch và chạy được không: chỉ bản dựng mới biết.",
    "payload-keys": "Các khoá đọc từ payload có thật sự tồn tại trong dữ liệu không.",
    "column-types": "Mỗi cột ra kiểu gì, và phép ép kiểu có đúng với mọi dòng không.",
    "tests-pass": "Các kiểm thử có qua không: chỉ bản dựng mới chạy chúng.",
    "function-effects":
      "Các hàm được gọi làm gì: quyền của tài khoản dbt của khách hàng quyết định điều đó.",
  },
};
