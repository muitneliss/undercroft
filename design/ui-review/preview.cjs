// Optional read-only local preview. It serves only this package, on loopback.
const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const root = __dirname;
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".md": "text/plain; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};
const server = http.createServer(async (req, res) => {
  try {
    if (!["GET", "HEAD"].includes(req.method)) {
      res.writeHead(405);
      res.end();
      return;
    }
    const requested = decodeURIComponent(
      new URL(req.url, "http://localhost").pathname,
    );
    const target = path.resolve(
      root,
      "." + (requested === "/" ? "/index.html" : requested),
    );
    if (!target.startsWith(root + path.sep) || !mime[path.extname(target)]) {
      res.writeHead(403);
      res.end();
      return;
    }
    const content = await fs.readFile(target);
    res.writeHead(200, {
      "Content-Type": mime[path.extname(target)],
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(req.method === "HEAD" ? undefined : content);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
});
server.on("error", (error) => {
  console.error("Preview failed:", error.message);
  process.exitCode = 1;
});
server.listen(8772, "127.0.0.1", () =>
  console.log("Open http://127.0.0.1:8772 — Ctrl+C to stop."),
);
