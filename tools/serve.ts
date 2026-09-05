#!/usr/bin/env bun
// Local preview for docs/. Rebuild with `bun run build:site` after editing content/.
import { resolve, join } from "node:path";
const DOCS = resolve(import.meta.dir, "..", "docs");
const server = Bun.serve({
  port: Number(process.env.PORT ?? 4321),
  async fetch(req) {
    const p = new URL(req.url).pathname;
    const file = Bun.file(join(DOCS, p === "/" ? "index.html" : p));
    if (await file.exists()) return new Response(file);
    return new Response(Bun.file(join(DOCS, "404.html")), { status: 404 });
  },
});
console.log(`docs/ → http://localhost:${server.port}`);
