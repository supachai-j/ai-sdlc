#!/usr/bin/env bun
/**
 * Generates the course portal from content/ into docs/.
 * Single source of truth is YAML — never hand-edit the generated HTML.
 *
 *   bun tools/build-site.ts
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const OUT = join(ROOT, "docs");

interface Module {
  id: string; code: string; title_th: string; hours: number;
  status: "core" | "new" | "expanded"; gap?: string; written?: boolean; href?: string;
  goal_th: string; outcome_th: string; lessons: string[];
}
interface Phase { id: string; num: string; name_th: string; modules: string[] }
interface Gap { id: string; title_th: string; module: string; why_th: string }
interface Video { title: string; url: string; channel?: string; lang?: string; when?: string; note?: string }

const cur = Bun.YAML.parse(readFileSync(join(ROOT, "content/curriculum.yaml"), "utf8")) as {
  course: Record<string, string | number>; phases: Phase[]; modules: Module[]; gaps: Gap[];
};
const videos = (Bun.YAML.parse(readFileSync(join(ROOT, "content/videos.yaml"), "utf8")) ??
  {}) as Record<string, Video[] | null>;

const byId = new Map(cur.modules.map((m) => [m.id, m]));
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const totalLessons = cur.modules.reduce((a, m) => a + m.lessons.length, 0);
const totalLabs = cur.modules.reduce((a, m) => a + m.lessons.filter(isLab).length, 0);
const totalHours = cur.modules.reduce((a, m) => a + m.hours, 0);
const videoCount = Object.values(videos).reduce((a, v) => a + (v?.length ?? 0), 0);

function isLab(l: string) { return /^LAB/.test(l.trim()); }

const STATUS_TAG: Record<string, string> = { new: "ใหม่", expanded: "ขยาย", core: "" };

/** Page shell. The theme script runs before paint so the toggle never flashes. */
function page(o: { title: string; nav: string; body: string; extraCss?: string }): string {
  return `<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(o.title)}</title>
<script>try{var t=localStorage.getItem("theme");if(t)document.documentElement.dataset.theme=t}catch(e){}</script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans+Thai:wght@400;500;600;700&display=swap">
<link rel="stylesheet" href="assets/style.css">
${o.extraCss ? `<style>${o.extraCss}</style>` : ""}
</head>
<body>
<div class="wrap">
<header class="topbar">
  <a class="brand" href="index.html">Agent SDLC</a>
  <nav>
    <a href="index.html"${o.nav === "index" ? ' aria-current="page"' : ""}>ภาพรวม</a>
    <a href="course-th.html"${o.nav === "course" ? ' aria-current="page"' : ""}>หลักสูตร</a>
    <a href="m12-evals.html"${o.nav === "m12" ? ' aria-current="page"' : ""}>M12 Evals</a>
    <button id="theme" type="button" aria-label="สลับธีมสว่าง/มืด">THEME</button>
  </nav>
</header>
${o.body}
</div>
<script>
document.getElementById("theme").addEventListener("click",function(){
  var d=document.documentElement;
  var dark=d.dataset.theme?d.dataset.theme==="dark":matchMedia("(prefers-color-scheme:dark)").matches;
  d.dataset.theme=dark?"light":"dark";
  try{localStorage.setItem("theme",d.dataset.theme)}catch(e){}
});
</script>
</body>
</html>`;
}

function videoBlock(id: string): string {
  const vs = videos[id] ?? [];
  if (!vs.length) {
    return `<div class="m-vids"><b>วิดีโอประกอบ</b><span class="empty">ยังไม่มี — เพิ่มได้ที่ content/videos.yaml แล้วรัน bun run build:site</span></div>`;
  }
  const items = vs
    .map((v) => {
      const when = v.when ? `<span class="when ${esc(v.when)}">${esc(v.when)}</span>` : "";
      const note = v.note ? `<span class="note">${esc(v.note)}</span>` : "";
      const ch = v.channel ? ` · ${esc(v.channel)}${v.lang === "en" ? " (EN)" : ""}` : "";
      return `<li>${when}<a href="${esc(v.url)}" target="_blank" rel="noopener noreferrer">${esc(v.title)}</a>${ch}${note}</li>`;
    })
    .join("\n");
  return `<div class="m-vids"><b>วิดีโอประกอบ · ${vs.length} คลิป</b><ul>${items}</ul></div>`;
}

function moduleBlock(m: Module, opts: { lessons: boolean }): string {
  const flagged = m.status !== "core";
  const tag = STATUS_TAG[m.status];
  const title = m.written
    ? `<a href="${esc(m.href ?? m.id + ".html")}">${esc(m.title_th)}</a>`
    : esc(m.title_th);
  const lessons = opts.lessons
    ? `<ol class="lessons">${m.lessons
        .map((l) => {
          const lab = isLab(l);
          const text = lab ? l.replace(/^LAB\s*([AB])?:?\s*/, "") : l;
          const chip = lab ? `<span class="chip">LAB${/^LAB\s*([AB])/.exec(l)?.[1] ? " " + /^LAB\s*([AB])/.exec(l)![1] : ""}</span>` : "";
          return `<li${lab ? ' class="lab"' : ""}>${chip}${esc(text)}</li>`;
        })
        .join("")}</ol>`
    : "";
  return `<div class="module${flagged ? " flagged" : ""}" id="${m.id}">
  <div class="m-rail">
    <span class="m-code">${m.code}</span>
    <span class="m-stat">${m.lessons.length} บท<br>${m.hours} ชม.</span>
    ${tag ? `<span class="m-tag">${tag}${m.gap ? " " + m.gap : ""}</span>` : ""}
  </div>
  <div class="m-body">
    <h3>${title}</h3>
    <p class="m-goal">${esc(m.goal_th)}</p>
    ${lessons}
    <div class="m-out"><b>ผลลัพธ์</b>${esc(m.outcome_th)}</div>
    ${videoBlock(m.id)}
  </div>
</div>`;
}

function phases(opts: { lessons: boolean }): string {
  return cur.phases
    .map((p) => {
      const ms = p.modules.map((id) => byId.get(id)!).filter(Boolean);
      const lc = ms.reduce((a, m) => a + m.lessons.length, 0);
      const hr = ms.reduce((a, m) => a + m.hours, 0);
      return `<div class="phase">
  <div class="phase-bar">
    <span class="p-num">PHASE ${p.num}</span>
    <span class="p-name">${esc(p.name_th)}</span>
    <span class="p-meta">${ms[0]!.code}–${ms[ms.length - 1]!.code} · ${lc} บท · ${hr}h</span>
  </div>
  ${ms.map((m) => moduleBlock(m, opts)).join("\n")}
</div>`;
    })
    .join("\n");
}

const specRow = `<dl class="specrow">
  <div class="spec"><dt>โมดูล</dt><dd>${cur.modules.length}</dd></div>
  <div class="spec"><dt>บทเรียน</dt><dd>${totalLessons}</dd></div>
  <div class="spec"><dt>ชั่วโมง</dt><dd>~${Math.round(totalHours)}</dd></div>
  <div class="spec"><dt>เฟส</dt><dd>${cur.phases.length}</dd></div>
  <div class="spec"><dt>แล็บ</dt><dd>${totalLabs}</dd></div>
  <div class="spec"><dt>ระดับ</dt><dd><small>${esc(String(cur.course.level_th))}</small></dd></div>
</dl>`;

// ── index.html ───────────────────────────────────────────
const gapRows = cur.gaps
  .map((g) => {
    const m = byId.get(g.module)!;
    return `<div class="gap">
  <div class="gap-id">${g.id}</div>
  <div class="gap-what"><h3>${esc(g.title_th)}</h3><a href="course-th.html#${m.id}">${m.code} · ${m.lessons.length} บท →</a></div>
  <div class="gap-why">${esc(g.why_th)}</div>
</div>`;
  })
  .join("\n");

writeFileSync(
  join(OUT, "index.html"),
  page({
    title: `${cur.course.title_th} — ภาพรวมหลักสูตร`,
    nav: "index",
    body: `<header class="masthead">
  <span class="eyebrow">หลักสูตรฉบับลงลึก</span>
  <h1>${esc(String(cur.course.title_th))}</h1>
  <p class="deck">${esc(String(cur.course.subtitle_th))} — <strong>${cur.modules.length} โมดูล ${totalLessons} บท</strong> เน้นกลไก การวัดผล และการใช้จริงในทีม มากกว่าการสาธิตเครื่องมือ</p>
  ${specRow}
</header>

<section>
  <div class="sechead"><span class="num">§01</span><h2>ช่องว่าง ${cur.gaps.length} จุดที่เติมเข้าไป</h2></div>
  <p class="lede">แต่ละจุดไม่ได้เพิ่มเพราะ “มีก็ดี” แต่เพราะ<strong>ถ้าไม่มี เวิร์กโฟลว์จะพังตอนขยายเข้าทีมหรือเข้าโปรดักชัน</strong> เรียงตามความเสียหายที่เกิดถ้าข้าม</p>
  <div class="gaps">${gapRows}</div>
</section>

<section>
  <div class="sechead"><span class="num">§02</span><h2>โครงหลักสูตร</h2></div>
  <p class="lede">เรียงตามลำดับการพึ่งพา แต่ละเฟสสมมติว่าเฟสก่อนหน้าผ่านแล้ว — <a href="course-th.html">ดูรายบทเรียนทั้ง ${totalLessons} บท →</a></p>
  ${phases({ lessons: false })}
</section>

<p class="note"><b>สถานะ</b> — เนื้อหาเต็มเขียนแล้ว ${cur.modules.filter((m) => m.written).length} โมดูล จาก ${cur.modules.length}
· วิดีโอประกอบใส่แล้ว ${videoCount} คลิป
· หน้าเว็บทั้งหมดถูก generate จาก <code>content/curriculum.yaml</code> และ <code>content/videos.yaml</code> อย่าแก้ HTML ตรง ๆ</p>`,
  }),
);

// ── course-th.html ───────────────────────────────────────
writeFileSync(
  join(OUT, "course-th.html"),
  page({
    title: `${cur.course.title_th} — หลักสูตรเต็ม`,
    nav: "course",
    body: `<header class="masthead">
  <span class="eyebrow">รายบทเรียนทั้งหมด</span>
  <h1>หลักสูตรเต็ม</h1>
  <p class="deck">${cur.modules.length} โมดูล · ${totalLessons} บท · ${totalLabs} แล็บ · ~${Math.round(totalHours)} ชั่วโมง โมดูลที่มีแถบสีคือส่วนที่เติมเข้ามาหรือขยายจากโครงคอร์สทั่วไปอย่างมีนัยสำคัญ</p>
  ${specRow}
</header>
<section style="padding-top:44px">${phases({ lessons: true })}</section>
<p class="note"><b>วิดีโอประกอบ</b> — ช่องใต้แต่ละโมดูลรับลิงก์จาก <code>content/videos.yaml</code>
เราอ้างอิงคลิปเป็นสื่อเสริมพร้อมลิงก์ไปต้นทางเท่านั้น ไม่ถอดเนื้อหาคลิปมาเป็นบทเรียน — เนื้อหาบทเรียนเขียนขึ้นเอง</p>`,
  }),
);

// ── module pages ─────────────────────────────────────────
let writtenCount = 0;
for (const m of cur.modules) {
  const href = m.href ?? `${m.id}.html`;
  const src = join(ROOT, "content/modules", href);
  if (!existsSync(src)) continue;
  const raw = readFileSync(src, "utf8");
  const inner = raw.replace(/^<div class="wrap">\n?/, "").replace(/<\/div>\s*$/, "");
  writeFileSync(join(OUT, href), page({ title: `${m.code} · ${m.title_th}`, nav: m.id, body: inner }));
  writtenCount++;
}

writeFileSync(join(OUT, ".nojekyll"), "");
writeFileSync(
  join(OUT, "404.html"),
  page({ title: "ไม่พบหน้านี้", nav: "", body: `<header class="masthead"><span class="eyebrow">404</span><h1>ไม่พบหน้านี้</h1><p class="deck">กลับไปที่ <a href="index.html">ภาพรวมหลักสูตร</a> หรือ <a href="course-th.html">หลักสูตรเต็ม</a></p></header>` }),
);

console.log(`built → docs/`);
console.log(`  ${cur.modules.length} modules · ${totalLessons} lessons · ${totalLabs} labs · ${Math.round(totalHours)}h`);
console.log(`  ${writtenCount} module page(s) written · ${videoCount} video link(s)`);
