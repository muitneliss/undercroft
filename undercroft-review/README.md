# Undercroft — operator and reader paths, review r5

**Design proposal with a runnable synthetic prototype. Not a production patch; nothing here is meant to be merged into `apps/ui`.**

An interactive review of three paths through the book. An admin checks one account's data: Sources → Journal → Raw lake → Models. A reader follows a dashboard into its questions and takes the figures out: Reports. An admin manages who belongs to a customer and with which role: People and Customers. The design contract it illustrates is `docs/design/operator-and-reader-paths.md` in the accompanying pull request, which refers to one feature request per path.

All seven divisions are clickable. The reasoning behind Customers, Reports and People is in `docs/THREE-DIVISIONS.md` and `docs/REPORTS-RESEARCH.md`. Where the prototype shows more than a feature request asks for (a customer detail page, printing, the question and dashboard editors), that part is illustration, not a request. Where it shows less, the list below says so.

The prototype keeps the book shell, the seven divisions, the original mark and homepage wordmark, the bundled fonts (checked byte for byte against the repository, `docs/BRAND-ALIGNMENT.md`), VI/EN, status marks and stepped motion. Every customer, account, run, record, model, report and person is synthetic.

## Mở để duyệt

1. Giữ nguyên thư mục này và mở `index.html` trong trình duyệt. Không tách riêng HTML khỏi `assets/`.
2. Nếu trình duyệt chặn mở file cục bộ: chạy `node preview.cjs` tại thư mục này rồi mở `http://127.0.0.1:8772`.
3. Chọn VI/EN ở header. Mở **Công cụ kiểm thử bản mẫu** cuối trang để đổi vai trò, thử lỗi lần ghi tiếp theo hoặc phản hồi chậm.
4. Tải lại để khôi phục fixture. Lưu, dựng, đọc và xoá chỉ đổi bộ nhớ của tab; không có dữ liệu nào gửi đi.

## Five-minute review

| Start | Try | What to judge |
|---|---|---|
| Sources → a Gmail card → Runs | Back, Forward, paste the address in a new tab | The Journal stays narrowed to that one account |
| Journal → `CASE-0101` | Read "Scope at start"; press a Created count; open `CASE-0100` | The run's own scope; the records it wrote, with later rewrites counted; an em dash for an older run |
| Sources → Drive → Change what syncs | Untick a folder → Review | The statement says what the next complete read does to held items; nothing is erased |
| Sources → Gmail → Change what syncs | Untick a label → Review | Held messages stay live |
| Models → List | Press "Never built", then Back | The counts add up; the filter lives in the address |
| Models → Lineage | Select `customer_health_daily`, then `churn_watch`, then `legacy_rollup` | Upstream chain only; missing dependency kept; "upstream not declared" instead of a guessed edge |
| Test controls | Switch to Member, then Viewer | No write plates on Sources; run counts are plain figures; no raw payload |
| Reports → Business performance | Filter Services → open a point → Back | Totals follow the filter; the filter survives the trip |
| People → Demo Operator | Look for a lower role or Remove | Neither is offered; the row says it is the last administrator |
| People → Demo Analyst | Choose Administrator, then reopen Demo Operator | Choosing saves in one step; both admins now offer a role and Remove |
| People → Open invitations | Press Withdraw invitation… | Nothing is withdrawn until a second press that names the address |

## What the prototype does not draw

Some requirements are stated in the design contract but not drawn in this harness. Judge them from the contract:

- Gauge and progress with no bound set. The harness draws 5 of the 16 chart types, not these two.
- A pivot's own totals. The receivables dashboard shows the rule on a grouped sum ("Not totalled: an amount is missing"), not on a pivot.
- The row-limit notice before a CSV download. Fixture results are small.

## Contents

- `index.html`, `assets/`: portable interaction harness; no build step, CDN, API or analytics.
- `docs/INTEGRATION-PLAN.md`: existing components, contracts, routes and state ownership to build on.
- `docs/DECISIONS.md`: decisions for the maintainer.
- `docs/THREE-DIVISIONS.md`, `docs/REPORTS-RESEARCH.md` (Vietnamese): the reasoning behind Customers, Reports and People.
- `docs/BRAND-ALIGNMENT.md`: mark and font provenance.
- `docs/QA.md`: what was verified, with observed results, and what was not.
- `screenshots/`: synthetic-only captures.
- `tests/domain.test.cjs`, `tests/workspace.test.cjs`: dependency-free checks (`node --test tests/*.test.cjs`).
- `tests/browser-qa.cjs`, `tests/browser-qa-workspace.cjs`: the browser scenarios recorded in `docs/QA.md`.

## Reference state

Checked against `muitneliss/undercroft` at `116a41e` (release 1.53.0), 2026-09-29. "r5" is a prototype revision, not an Undercroft release. No application, database, API, migration or repository file was changed.

The harness uses plain HTML, hash navigation and in-memory fixtures so it is easy to review. **Do not paste its renderer, fixtures or CSS into the application.** Accepted behaviour belongs in the existing React Router / tRPC React Query / Zustand / i18next architecture, reusing the original shell and controls.

Fonts and upstream attribution are preserved in `assets/fonts/README.md`, `assets/fonts/OFL.txt` and `UPSTREAM-LICENSE.txt`. See `THIRD-PARTY-NOTICES.md`.
