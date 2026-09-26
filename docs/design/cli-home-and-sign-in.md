# The CLI's home page and sign-in, drawn in text

**Status:** built. **Date:** 2026-09-25.

Every frame below was captured from the built CLI in a pseudo-terminal, 80 columns wide
unless stated. The server was the suite's in-process control plane (`startControlPlane()`),
which is why it shows a `localhost` origin and an `example.test` address.

## The idea

The web UI is a boxed-software reference manual lying open (`apps/ui/src/index.css`).
The terminal gets the same book, set in type. Run `undercroft` on its own at a terminal and
you get:

- **the title page** while you are signed out, with the sign-in form written on it. The home
  page and the login are one screen, not two.
- **the contents page** once you are signed in: the book's running head, then every topic
  with a dot leader to the number of commands under it, the way a printed manual lists its
  chapters.

Five rules hold on every page (`apps/cli/src/services/typeset.ts` states them for a reader of
the code):

- **Every stroke is 7-bit ASCII.** The mark, the rule, the leaders and the code's cells are
  drawn in characters every terminal has, so the page looks the same over a serial console,
  in `LANG=C` and in a modern emulator. Only the words use the locale's letters.
- **One ink.** The mark is set in the terminal's own foreground, as `Mark.tsx` takes
  `currentColor`. It never claims a hue.
- **Red is held back for errata.** Only a failure (_đính chính_ / _erratum_) is red. A
  cancel is the person's own choice, so it is dim.
- **Rank comes from form, not colour.** Position, capitals, leaders and spacing carry the
  hierarchy; bold and dim only repeat it. `NO_COLOR` and `--no-color` lose nothing.
- **Motion is stepped** (ADR 0014), and there is one moment of it: the mark being cut, on the
  title page (see "The cut" below).

## What does not change

- **Agent mode draws none of this.** `--agent`, `--json` or a piped stream get exactly the
  output they got before: a bare piped `undercroft` still prints oclif's help, and
  `cli.test.ts` pins that. `home` is a hidden command that `main.ts` routes a bare run to in
  human mode only; an agent that names it gets `UNKNOWN_COMMAND`. The `undercroft`
  skill always passes `--agent`, so it sees no difference.
- `--no-input` still draws the page, and never prompts.
- `--help`, `--version`, `describe`, every procedure command and the exit codes are as they
  were.
- Flag names, command names and error codes are never translated. In an error, the code is
  still the first word after the label, so grepping a log for it keeps working.

## Screens

### Home, signed out: the title page and the sign-in form

```text
   .##################.     U N D E R C R O F T
   #######""""""#######
   #####"   ..   "#####     Mọi thao tác của giao diện web, qua cùng một API.
   ###"  .######.  "###
   ###  .##    ##.  ###
   ###"""##    ##"""###
   ###   ##    ##   ###
   ###   ##    ##   ###     Ấn bản 1.34.1
   ###___##____##___###     http://localhost:64695  hồ sơ prod
   '##################'     Chưa đăng nhập

   Cho tác tử . . . . . . . . . . . . . . . . . . undercroft describe --agent
   In English . . . . . . . . . . . . . . . . . . . . .  undercroft --lang en

┌  Đăng nhập vào http://localhost:64695
│
◆  Địa chỉ email
│  _
└
```

- The name sits on the top line of the mark, and the imprint (edition, server, session
  state) sits on its bottom line, where a publisher's imprint goes on a title page.
- The form is the only way in for a person, so it is not listed again as a line. The line
  for agents is listed, because an agent never sees this page.
- The language switch is labelled in the _other_ language ("In English", "Tiếng Việt"), so
  someone who cannot read the current one can still find it.

With `--no-input` the form is left off and "Đăng nhập · undercroft auth login" is listed
among the lines instead.

### Home, first contact: no server named

```text
   .##################.     U N D E R C R O F T
   #######""""""#######
   #####"   ..   "#####     Mọi thao tác của giao diện web, qua cùng một API.
   ###"  .######.  "###
   ###  .##    ##.  ###
   ###"""##    ##"""###
   ###   ##    ##   ###
   ###   ##    ##   ###
   ###___##____##___###     Ấn bản 1.34.1
   '##################'     Chưa chọn máy chủ

   1  Chọn máy chủ  . . . . . undercroft config set-profile <tên> --url <url>
   2  Đăng nhập . . . . . . . . . . . . . . . . . . . . undercroft auth login

   Mọi lệnh . . . . . . . . . . . . . . . . . . . . . . . undercroft describe
   In English . . . . . . . . . . . . . . . . . . . . .  undercroft --lang en
```

Numbered because the order matters: there is nothing to sign in to until a server is chosen.
Nothing is asked here. A server URL and a profile name are the person's decision, and the CLI
does not invent a profile name for them. A profile or URL that is named but wrong is an
error, not first contact, and gets its erratum.

### The code

```text
┌  Đăng nhập vào http://localhost:64695
│
◇  Địa chỉ email
│  operator@example.test
│
●  Nếu operator@example.test có quyền truy cập, một mã đã được gửi tới đó.
│
◆  Mã sáu chữ số trong email
│  +---+---+---+---+---+---+
│  | 4 | 8 | 1 | _ |   |   |
│  +---+---+---+---+---+---+
│  Dán cả sáu số cũng được.
└
```

- Six cells, digits only. Pasting the code fills every cell, with any spaces or dashes in it
  dropped. Enter only submits six digits; anything else is refused in place ("Mã gồm đúng
  sáu chữ số."), so the code is not spent on a request the server would reject.
- The code is masked once submitted, so it does not stay readable in the scrollback.
- The code-sent line keeps the server's neutrality ("if … has access"), because the server
  answers the same whether or not the address may sign in. It no longer says "Run again with
  --code", which was wrong in the interactive path: the CLI asks for the code right after.
  The agent-mode sentence, where rerunning with `--code` is the next step, is unchanged.

### A rejected code, then signed in

```text
┌  Đăng nhập vào http://localhost:64695
│
◇  Địa chỉ email
│  operator@example.test
│
●  Nếu operator@example.test có quyền truy cập, một mã đã được gửi tới đó.
│
◇  Mã sáu chữ số trong email
│  ******
│
■  ĐÍNH CHÍNH  AUTHENTICATION_REQUIRED
│  Mã không được chấp nhận. Hãy yêu cầu mã mới.
│
◇  Làm gì tiếp?
│  Gửi mã mới tới operator@example.test
│
●  Nếu operator@example.test có quyền truy cập, một mã đã được gửi tới đó.
│
◇  Mã sáu chữ số trong email
│  ******
│
└  Đã đăng nhập vào http://localhost:64695 với operator@example.test.
```

A rejected code does not end the run. The person chooses: a new code to the same address,
a different address, or quit. Started from `undercroft`, the contents page follows the last
line. Started from `undercroft auth login`, the run ends there. The same flow runs for
`undercroft auth login` at a terminal without `--code`.

When the server cannot be reached, or a code is refused for any other reason, the erratum is
written on the rail, the rail is closed, and the run ends with that failure's exit code.

### Home, signed in: the contents page

```text
   #"# UNDERCROFT 1.34.1                         http://localhost:64695  prod
                                               operator@example.test  chỉ đọc
   --------------------------------------------------------------------------

   MỤC LỤC                                                               lệnh

   connections   Các nguồn dữ liệu và quyền truy cập của chúng. . . . . .   8
   runs          Các lần chạy.  . . . . . . . . . . . . . . . . . . . . .   4
   lake          Hồ dữ liệu thô.  . . . . . . . . . . . . . . . . . . . .   6
   models        Các mô hình dbt. . . . . . . . . . . . . . . . . . . . .   6
   dq            Chất lượng dữ liệu.  . . . . . . . . . . . . . . . . . .   1
   bi            Báo cáo: câu hỏi, bảng điều khiển và lược đồ.  . . . . .   4
     questions   Các câu hỏi đã lưu.  . . . . . . . . . . . . . . . . . .   5
     dashboards  Các bảng điều khiển. . . . . . . . . . . . . . . . . . .   4
   tenants       Khách hàng.  . . . . . . . . . . . . . . . . . . . . . .   4
   people        Người có quyền truy cập và lời mời.  . . . . . . . . . .   6
   keys          Khoá nạp dữ liệu.  . . . . . . . . . . . . . . . . . . .   3

   PHỤ LỤC

   auth          Đăng nhập, đăng xuất và phiên của bạn. . . . . . . . . .   3
   session       Phiên hiện tại.  . . . . . . . . . . . . . . . . . . . .   3
   account       Tài khoản của bạn.
     tokens      Token truy cập cá nhân, cho tác tử kết nối qua MCP.  . .   3
   config        Hồ sơ môi trường của CLI, và cấu hình công khai của
                 máy chủ. . . . . . . . . . . . . . . . . . . . . . . . .   4

   undercroft <chủ đề> --help   undercroft describe <lệnh>
```

With writes allowed on the profile, only the running head changes:

```text
   #"# UNDERCROFT 1.34.1                         http://localhost:64695  prod
                                              operator@example.test  ĐƯỢC GHI
```

- The contents page is drawn only after `session.me` answers. A session file is not evidence
  of a session: one the server has ended is treated as signed out and gets the title page.
- Write permission is shown by form: "chỉ đọc" plain, "ĐƯỢC GHI" in bold capitals. Never red,
  because allowed writes are not an error.
- Topics follow the pipeline (sources, runs, the raw lake, models, quality, reports), then
  administration. The appendix holds your own access and the CLI's machinery: signing in,
  the session, your account and its tokens, the profiles. The order is typed against
  `TopicKey`, so a new router namespace is a `tsc` error until someone places it.
- A topic whose commands all sit in its sub-topics (`account`) is a heading: no leader and
  no count, because a "0" would read as an empty chapter.
- The counts are the commands directly under each topic, taken from the command table when
  the CLI runs. Each sentence is the existing `topics.*` string.

### An error from any command

In human mode, on stderr:

```text
   x ĐÍNH CHÍNH  NOT_FOUND
     Không tìm thấy.
     Mã truy vết: 41b44321219a4e348f77575454585a52 — ghi kèm mã này khi báo
     lỗi.
```

The label and marker are red, the code bold, the trace id dim and wrapped at the page's
width. On the sign-in rail the same erratum uses Clack's own error symbol, in red.

### Narrow terminals (under 60 columns)

The mark is dropped, the title page stacks into one column, and the contents page drops the
sentences but keeps the leaders and counts. At 50 columns:

```text
   U N D E R C R O F T

   Mọi thao tác của giao diện web, qua cùng một
   API.

   Ấn bản 1.34.1
   http://localhost:64695  hồ sơ prod
   Chưa đăng nhập

   Đăng nhập  . . . . . . . undercroft auth login
   Cho tác tử . . . . undercroft describe --agent
   Mọi lệnh . . . . . . . . . undercroft describe
   In English . . . . . . .  undercroft --lang en
```

```text
   #"# UNDERCROFT 1.34.1
   http://localhost:64695  prod
   operator@example.test  chỉ đọc
   ----------------------------------------------

   MỤC LỤC                                   lệnh

   connections  . . . . . . . . . . . . . . .   8
   runs . . . . . . . . . . . . . . . . . . .   4
   lake . . . . . . . . . . . . . . . . . . .   6
   models . . . . . . . . . . . . . . . . . .   6
   dq . . . . . . . . . . . . . . . . . . . .   1
   bi . . . . . . . . . . . . . . . . . . . .   4
     questions  . . . . . . . . . . . . . . .   5
     dashboards . . . . . . . . . . . . . . .   4
   tenants  . . . . . . . . . . . . . . . . .   4
   people . . . . . . . . . . . . . . . . . .   6
   keys . . . . . . . . . . . . . . . . . . .   3

   PHỤ LỤC

   auth . . . . . . . . . . . . . . . . . . .   3
   session  . . . . . . . . . . . . . . . . .   3
   account
     tokens . . . . . . . . . . . . . . . . .   3
   config . . . . . . . . . . . . . . . . . .   4

   undercroft <chủ đề> --help
   undercroft describe <lệnh>
```

### English (`--lang en`)

```text
   .##################.     U N D E R C R O F T
   #######""""""#######
   #####"   ..   "#####     Everything the web UI does, through the same API.
   ###"  .######.  "###
   ###  .##    ##.  ###
   ###"""##    ##"""###
   ###   ##    ##   ###
   ###   ##    ##   ###     Edition 1.34.1
   ###___##____##___###     http://localhost:64695  profile prod
   '##################'     Not signed in

   For agents . . . . . . . . . . . . . . . . . . undercroft describe --agent
   Tiếng Việt . . . . . . . . . . . . . . . . . . . . .  undercroft --lang vi

┌  Sign in to http://localhost:64695
│
◆  Email address
│  _
└
```

```text
   #"# UNDERCROFT 1.34.1                         http://localhost:64695  prod
                                             operator@example.test  read-only
   --------------------------------------------------------------------------

   CONTENTS                                                          commands

   connections   Data sources and their grants. . . . . . . . . . . . . .   8
   runs          Runs.  . . . . . . . . . . . . . . . . . . . . . . . . .   4
   lake          The raw lake.  . . . . . . . . . . . . . . . . . . . . .   6
   models        dbt models.  . . . . . . . . . . . . . . . . . . . . . .   6
   dq            Data quality.  . . . . . . . . . . . . . . . . . . . . .   1
   bi            Reports: questions, dashboards and the schema. . . . . .   4
     questions   Saved questions. . . . . . . . . . . . . . . . . . . . .   5
     dashboards  Dashboards.  . . . . . . . . . . . . . . . . . . . . . .   4
   tenants       Customers. . . . . . . . . . . . . . . . . . . . . . . .   4
   people        Who has access, and invitations. . . . . . . . . . . . .   6
   keys          Ingest keys. . . . . . . . . . . . . . . . . . . . . . .   3

   APPENDIX

   auth          Signing in and out, and your session.  . . . . . . . . .   3
   session       The current session. . . . . . . . . . . . . . . . . . .   3
   account       Your own account.
     tokens      Personal access tokens, for an agent connecting over
                 MCP. . . . . . . . . . . . . . . . . . . . . . . . . . .   3
   config        The CLI's environment profiles, and the server's
                 public configuration.  . . . . . . . . . . . . . . . . .   4

   undercroft <topic> --help   undercroft describe <command>
```

### The cut

Three frames, 80 ms each, with no easing: the solid block, the outer order cut out, then the
ring filled back and the core cut out, which are the three orders `Mark.tsx` describes. The
mark is rasterized from `Mark.tsx`'s own path. It plays only on the title page, in human mode,
not under `--quiet`, not when `CI` is set, and not when the page is too narrow to carry the
mark. The contents page never animates.

```text
   .##################.    .##################.    .##################.
   ####################    #######""""""#######    #######""""""#######
   ####################    #####"        "#####    #####"   ..   "#####
   ####################    ###"            "###    ###"  .######.  "###
   ####################    ###              ###    ###  .##    ##.  ###
   ####################    ###              ###    ###"""##    ##"""###
   ####################    ###              ###    ###   ##    ##   ###
   ####################    ###              ###    ###   ##    ##   ###
   ####################    ###______________###    ###___##____##___###
   '##################'    '##################'    '##################'
```

## Type and colour

| Element                             | Style                        | Under `NO_COLOR`                 |
| ----------------------------------- | ---------------------------- | -------------------------------- |
| Mark                                | the terminal's foreground    | unchanged                        |
| Name (`U N D E R C R O F T`)        | bold                         | the spaced capitals carry it     |
| Imprint: edition, server, profile   | dim                          | its place at the foot carries it |
| "ĐƯỢC GHI" / "WRITES ON"            | bold                         | the capitals carry it            |
| Dot leaders, the `lệnh` column head | dim                          | unchanged                        |
| A command to type, a topic name     | bold                         | its column carries it            |
| Error label and marker              | red, bold. **The only red.** | the word "ĐÍNH CHÍNH" carries it |
| Trace id, cancel line               | dim                          | unchanged                        |

The prompt rail itself (`┌ │ ◆ ◇ └`) is Clack's, in Clack's colours, as it is for every
other prompt the CLI asks. One known deviation: when a person presses Ctrl-C inside Clack's
own email or choice prompt, Clack marks that prompt line with its red cancel symbol; the
closing line the CLI writes after it is dim.

## Measure and grid

- **Margin:** 3 columns, the column Clack starts its prompt text in, so the page and the rail
  share a left edge.
- **Width:** at most 77 columns, never stretched on a wide terminal, read from
  `stdout.columns` (80 when unknown). Below 60 columns the narrow layout is used.
- **Leaders:** the dots sit on fixed alternate columns, so they line up down the page, as
  typeset leaders do. The right-hand column is flush at column 77.
- **Text width** is measured as display width after NFC normalisation, never as `.length`.

## Where it lives

| File                                      | What it owns                                                |
| ----------------------------------------- | ----------------------------------------------------------- |
| `apps/cli/src/services/typeset.ts`        | spans, tones, wrap, leaders, the measure; the rules above   |
| `apps/cli/src/services/titlePage.ts`      | the mark, the cut's frames, the title page                  |
| `apps/cli/src/services/contentsPage.ts`   | topic order and counts, the running head, the contents page |
| `apps/cli/src/services/erratum.ts`        | how a failure reads on stderr in human mode                 |
| `apps/cli/src/handlers/home.ts`           | which page to draw; the session check; the cut              |
| `apps/cli/src/handlers/terminalSignIn.ts` | the sign-in steps at a terminal, including the retry        |
| `apps/cli/src/handlers/prompts.ts`        | the six-cell code prompt and the lines written on the rail  |
| `apps/cli/src/main.ts`                    | routing a bare human run to `home`; writing the erratum     |

The words are in `apps/cli/src/i18n/{vi,en}.ts`, under `page` and `login`.

## Decisions

1. **Sign-in on the home page.** Yes: `undercroft` asks for the email under the title page.
2. **Retry after a rejected code.** Yes: new code, other address, or quit.
3. **The cut.** Kept, on the title page only.
4. **Strict 7-bit ASCII for every stroke.** Yes. An earlier draft drew the mark in block
   characters; the built pages use ASCII throughout, and the fact separators that were `·`
   are two spaces.
5. **The error label.** "ĐÍNH CHÍNH" / "ERRATUM", the manual's own word.

None of the five changes agent mode, so none changes what the `undercroft` skill sees.
