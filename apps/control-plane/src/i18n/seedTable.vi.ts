/**
 * Why `seeds.save` refuses a table, in Vietnamese: the `seedTable` namespace of `vi.ts`, in a
 * file of its own like `modelCheck.vi.ts`, because it is one block of wording for one reader
 * (`seedRefusal` in `@undercroft/contracts`, ADR 0128). One sentence per problem, keyed by the
 * problem's code exactly.
 *
 * `{{row}}` is the index into `rows`, from 0, written `rows[3]` so an agent and a person read the
 * same row; `{{column}}` is the declared column's name. An agent relays these to the person who
 * keeps the table, so each says what to send instead.
 */

export const seedTable = {
  problem: {
    "too-many-columns":
      "Bảng tham chiếu có nhiều hơn {{max}} cột. Hãy tách nó thành vài bảng nhỏ hơn.",
    "too-many-rows":
      "Bảng tham chiếu có nhiều hơn {{max}} dòng. Bảng tham chiếu là bảng nhỏ do người giữ; dữ liệu lớn hơn nên được đưa vào hồ thô như một tài liệu.",
    "too-large":
      "Bảng tham chiếu vượt quá {{max}} byte khi lưu. Hãy bớt dòng hoặc cột, hoặc đưa dữ liệu vào hồ thô như một tài liệu.",
    "duplicate-column": "Có hai cột cùng tên {{column}}. Mỗi cột phải có một tên riêng.",
    "unknown-type":
      "Cột {{column}} có kiểu không dùng được. Các kiểu dùng được: text, integer, bigint, numeric(18,4), boolean, date, timestamptz.",
    "row-width":
      "Dòng rows[{{row}}] không có đúng {{columns}} ô, mỗi cột một ô. Hãy gửi null cho ô không có giá trị.",
    "reads-as-null":
      "rows[{{row}}], cột {{column}}: một ô văn bản trống, chỉ có khoảng trắng, hoặc ghi null sẽ được dbt nạp thành NULL chứ không phải chính văn bản đó. Hãy gửi null nếu ô không có giá trị.",
    "carriage-return":
      "rows[{{row}}], cột {{column}}: ô có ký tự \\r, mà dbt sẽ nạp thành \\n. Hãy dùng \\n để xuống dòng.",
    "unstorable-character":
      "rows[{{row}}], cột {{column}}: ô có ký tự NUL hoặc một nửa cặp ký tự UTF-16, không lưu được thành văn bản.",
    "cell-too-long":
      "rows[{{row}}], cột {{column}}: ô dài hơn {{max}} ký tự, giới hạn của trình đọc CSV mà dbt dùng.",
    "not-integer":
      "rows[{{row}}], cột {{column}}: không phải một số nguyên viết thường -- chỉ chữ số, có thể có dấu trừ, không có số 0 ở đầu. Nếu đây là một mã, hãy đặt kiểu text cho cột.",
    "out-of-range":
      "rows[{{row}}], cột {{column}}: số nằm ngoài khoảng mà kiểu của cột chứa được. Hãy chọn kiểu rộng hơn cho cột.",
    "not-decimal":
      "rows[{{row}}], cột {{column}}: không phải một số thập phân viết thường như -1234.5 -- dấu chấm thập phân, không có dấu phân cách hàng nghìn, không có số 0 ở đầu.",
    "too-many-digits":
      "rows[{{row}}], cột {{column}}: phần nguyên dài hơn 14 chữ số, nên numeric(18,4) không chứa được.",
    "too-many-decimals":
      "rows[{{row}}], cột {{column}}: có hơn 4 chữ số sau dấu chấm, mà numeric(18,4) sẽ làm tròn mất. Hãy gửi tối đa 4 chữ số thập phân.",
    "not-boolean": "rows[{{row}}], cột {{column}}: phải là true hoặc false.",
    "not-date":
      "rows[{{row}}], cột {{column}}: không phải một ngày có thật, viết dạng YYYY-MM-DD.",
    "not-timestamp":
      "rows[{{row}}], cột {{column}}: không phải một thời điểm dạng YYYY-MM-DDTHH:MM:SS kèm múi giờ, ví dụ 2026-10-13T09:00:00+07:00.",
    "no-offset":
      "rows[{{row}}], cột {{column}}: thời điểm không có múi giờ, nên Postgres sẽ đọc nó theo múi giờ của phiên, tức là đoán. Hãy thêm Z hoặc múi giờ như +07:00.",
  },
};
