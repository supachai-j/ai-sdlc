#!/usr/bin/env bun
/**
 * Generates the course portal from content/ into docs/.
 * Single source of truth is YAML — never hand-edit the generated HTML.
 *
 *   bun tools/build-site.ts
 *
 * Emits assets/course-data.js so the client can compute progress without
 * re-parsing the pages.
 */
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
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
const isLab = (l: string) => /^LAB/.test(l.trim());
const pageOf = (m: Module) => m.href ?? `${m.id}.html`;
const ytId = (url: string) => /[?&]v=([A-Za-z0-9_-]{6,})/.exec(url)?.[1] ?? "";

const totalLessons = cur.modules.reduce((a, m) => a + m.lessons.length, 0);
const totalLabs = cur.modules.reduce((a, m) => a + m.lessons.filter(isLab).length, 0);
const totalHours = cur.modules.reduce((a, m) => a + m.hours, 0);
const videoCount = Object.values(videos).reduce((a, v) => a + (v?.length ?? 0), 0);
const STATUS_TAG: Record<string, string> = { new: "ใหม่", expanded: "ขยาย", core: "" };

/** Collected while rendering module pages, then written out for the client. */
const courseData: Record<string, { code: string; title: string; href: string; lessons: string[]; videos: string[] }> = {};

/** Content hash for cache-busting: without it a returning learner keeps the
 *  stylesheet and script their browser cached, and can end up running new
 *  markup against old CSS. */
const hash = (p: string) =>
  existsSync(p) ? createHash("sha1").update(readFileSync(p)).digest("hex").slice(0, 8) : "0";
const CSS_V = hash(join(OUT, "assets/style.css"));
const JS_V = hash(join(OUT, "assets/progress.js"));

function page(o: { title: string; nav: string; body: string }): string {
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
<link rel="stylesheet" href="assets/style.css?v=${CSS_V}">
</head>
<body>
<div class="wrap">
<header class="topbar">
  <a class="brand" href="index.html">Agent SDLC</a>
  <nav>
    <a href="index.html"${o.nav === "index" ? ' aria-current="page"' : ""}>ภาพรวม</a>
    <a href="course-th.html"${o.nav === "course" ? ' aria-current="page"' : ""}>หลักสูตร</a>
    <span id="nav-progress" class="nav-progress" hidden></span>
    <button id="theme" type="button" aria-label="สลับธีมสว่าง/มืด">THEME</button>
  </nav>
</header>
${o.body}
</div>
<script src="assets/course-data.js?v=${DATA_V}" defer></script>
<script src="assets/progress.js?v=${JS_V}" defer></script>
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

/** Click-to-load facade: 49 autoloaded iframes would make every page crawl. */
function videoBlock(id: string, collect?: string[]): string {
  const vs = videos[id] ?? [];
  if (!vs.length) return "";
  const items = vs.map((v) => {
    const vid = ytId(v.url);
    if (vid && collect) collect.push(vid);
    const when = v.when ? `<span class="when ${esc(v.when)}">${esc(v.when)}</span>` : "";
    const ch = v.channel ? `<span class="vid-ch">${esc(v.channel)}${v.lang === "en" ? " · EN" : ""}</span>` : "";
    const note = v.note ? `<span class="note">${esc(v.note)}</span>` : "";
    const thumb = vid
      ? `<button class="vid-play" type="button" data-yt="${vid}" data-title="${esc(v.title)}" aria-label="เล่นวิดีโอ ${esc(v.title)}">
           <img src="https://i.ytimg.com/vi/${vid}/hqdefault.jpg" alt="" loading="lazy" decoding="async">
           <span class="vid-icon" aria-hidden="true"></span>
         </button>`
      : "";
    const check = vid
      ? `<label class="vid-done"><input type="checkbox" data-video="${vid}"> ดูแล้ว</label>`
      : "";
    return `<li class="vid">
  ${thumb}
  <div class="vid-meta">
    <p class="vid-title">${when}<a href="${esc(v.url)}" target="_blank" rel="noopener noreferrer">${esc(v.title)}</a></p>
    ${ch}${note}${check}
  </div>
</li>`;
  }).join("\n");
  return `<div class="m-vids"><b>วิดีโอประกอบ · ${vs.length} คลิป</b><ul class="vid-list">${items}</ul></div>`;
}

function moduleBlock(m: Module, opts: { lessons: boolean }): string {
  const flagged = m.status !== "core";
  const tag = STATUS_TAG[m.status];
  const href = pageOf(m);
  const lessons = opts.lessons
    ? `<ol class="lessons">${m.lessons.map((l) => {
        const lab = isLab(l);
        const text = lab ? l.replace(/^LAB\s*([AB])?:?\s*/, "") : l;
        const suffix = /^LAB\s*([AB])/.exec(l)?.[1];
        const chip = lab ? `<span class="chip">LAB${suffix ? " " + suffix : ""}</span>` : "";
        return `<li${lab ? ' class="lab"' : ""}>${chip}${esc(text)}</li>`;
      }).join("")}</ol>`
    : "";
  return `<div class="module${flagged ? " flagged" : ""}" id="${m.id}" data-module="${m.id}">
  <div class="m-rail">
    <span class="m-code">${m.code}</span>
    <span class="m-stat">${m.lessons.length} บท<br>${m.hours} ชม.</span>
    ${tag ? `<span class="m-tag">${tag}${m.gap ? " " + m.gap : ""}</span>` : ""}
  </div>
  <div class="m-body">
    <h3><a href="${esc(href)}">${esc(m.title_th)}</a></h3>
    <div class="bar" data-bar="${m.id}"><span></span></div>
    <p class="m-goal">${esc(m.goal_th)}</p>
    ${lessons}
    <div class="m-out"><b>ผลลัพธ์</b>${esc(m.outcome_th)}</div>
    ${videoBlock(m.id)}
  </div>
</div>`;
}

function phases(opts: { lessons: boolean }): string {
  return cur.phases.map((p) => {
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
  }).join("\n");
}

// ── module pages: inject per-lesson completion + video embeds ────────────
mkdirSync(OUT, { recursive: true });
let writtenCount = 0;
const pending: { href: string; title: string; nav: string; body: string }[] = [];
for (const m of cur.modules) {
  const href = pageOf(m);
  const src = join(ROOT, "content/modules", href);
  if (!existsSync(src)) continue;

  let raw = readFileSync(src, "utf8");
  const lessonIds: string[] = [];
  const videoIds: string[] = [];

  // regular lessons — the .lnum span already carries a stable id like "02.05"
  raw = raw.replace(/<span class="lnum">([\d.]+)<\/span>(<h2>.*?<\/h2>)/g, (_x, num: string, h2: string) => {
    lessonIds.push(num);
    return `<span class="lnum">${num}</span>${h2}<label class="done"><input type="checkbox" data-lesson="${num}"><span>เรียนจบ</span></label>`;
  });
  // the lab block carries its number in the header strip
  raw = raw.replace(/<div class="lab-head">([\d.]+)([^<]*)<\/div>/g, (_x, num: string, rest: string) => {
    lessonIds.push(num);
    return `<div class="lab-head">${num}${rest}<label class="done"><input type="checkbox" data-lesson="${num}"><span>ทำแล็บแล้ว</span></label></div>`;
  });

  const inner = raw.replace(/^<div class="wrap">\n?/, "").replace(/<\/div>\s*$/, "");
  const vids = videoBlock(m.id, videoIds);
  const body = inner.replace(
    /(<div class="meta">[\s\S]*?<\/div>)/,
    `$1<div class="m-progress"><div class="bar" data-bar="${m.id}"><span></span></div><span class="bar-label" data-label="${m.id}"></span></div>`,
  ) + (vids ? `<section class="lesson"><div class="lhead"><span class="lnum">วิดีโอ</span><h2>วิดีโอประกอบโมดูลนี้</h2></div>${vids}</section>` : "");

  pending.push({ href, title: `${m.code} · ${m.title_th}`, nav: m.id, body });
  courseData[m.id] = { code: m.code, title: m.title_th, href, lessons: lessonIds, videos: videoIds };
  writtenCount++;
}

const courseDataJs = `window.COURSE=${JSON.stringify({ order: cur.modules.map((m) => m.id), modules: courseData })};\n`;
const DATA_V = createHash("sha1").update(courseDataJs).digest("hex").slice(0, 8);
for (const q of pending) writeFileSync(join(OUT, q.href), page({ title: q.title, nav: q.nav, body: q.body }));

// ── index ───────────────────────────────────────────────────────────────
const specRow = `<dl class="specrow">
  <div class="spec"><dt>โมดูล</dt><dd>${cur.modules.length}</dd></div>
  <div class="spec"><dt>บทเรียน</dt><dd>${totalLessons}</dd></div>
  <div class="spec"><dt>ชั่วโมง</dt><dd>~${Math.round(totalHours)}</dd></div>
  <div class="spec"><dt>แล็บ</dt><dd>${totalLabs}</dd></div>
  <div class="spec"><dt>วิดีโอ</dt><dd>${videoCount}</dd></div>
  <div class="spec"><dt>ระดับ</dt><dd><small>${esc(String(cur.course.level_th))}</small></dd></div>
</dl>`;

const gapRows = cur.gaps.map((g) => {
  const m = byId.get(g.module)!;
  return `<div class="gap">
  <div class="gap-id">${g.id}</div>
  <div class="gap-what"><h3>${esc(g.title_th)}</h3><a href="${esc(pageOf(m))}">${m.code} · ${m.lessons.length} บท →</a></div>
  <div class="gap-why">${esc(g.why_th)}</div>
</div>`;
}).join("\n");

writeFileSync(join(OUT, "index.html"), page({
  title: `${cur.course.title_th} — ภาพรวมหลักสูตร`,
  nav: "index",
  body: `<header class="masthead">
  <span class="eyebrow">หลักสูตรฉบับลงลึก</span>
  <h1>${esc(String(cur.course.title_th))}</h1>
  <p class="deck">${esc(String(cur.course.subtitle_th))} — <strong>${cur.modules.length} โมดูล ${totalLessons} บท</strong> เรียนเองได้ตามจังหวะ ดูวิดีโอในหน้าเว็บได้เลย และระบบจำไว้ว่าคุณเรียนถึงไหน</p>
  ${specRow}
</header>

<section id="progress-panel" class="panel" hidden>
  <div class="sechead"><span class="num">§00</span><h2>ความคืบหน้าของคุณ</h2></div>
  <div class="prog-top">
    <div class="ring" id="prog-ring"><svg viewBox="0 0 120 120" aria-hidden="true"><circle class="ring-bg" cx="60" cy="60" r="52"></circle><circle class="ring-fg" cx="60" cy="60" r="52"></circle></svg><span id="prog-pct">0%</span></div>
    <div class="prog-stats">
      <p id="prog-summary" class="prog-summary"></p>
      <p id="prog-next" class="prog-next"></p>
      <div class="prog-actions">
        <a id="prog-resume" class="btn" href="m01.html">เริ่มเรียน</a>
        <button id="prog-reset" class="btn ghost" type="button">ล้างความคืบหน้า</button>
      </div>
      <p class="prog-note">บันทึกไว้ในเบราว์เซอร์นี้เท่านั้น — เปลี่ยนเครื่องหรือล้างข้อมูลเว็บแล้วจะหาย</p>
    </div>
  </div>
  <div class="prog-grid" id="prog-grid"></div>
</section>

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

<p class="note"><b>วิธีใช้</b> — กด <em>เรียนจบ</em> ท้ายหัวข้อแต่ละบทเพื่อบันทึกความคืบหน้า วิดีโอกดเล่นได้ในหน้าเลยและติ๊ก <em>ดูแล้ว</em> ได้
· หน้าเว็บทั้งหมด generate จาก <code>content/curriculum.yaml</code> และ <code>content/videos.yaml</code></p>`,
}));

// ── full course listing ─────────────────────────────────────────────────
writeFileSync(join(OUT, "course-th.html"), page({
  title: `${cur.course.title_th} — หลักสูตรเต็ม`,
  nav: "course",
  body: `<header class="masthead">
  <span class="eyebrow">รายบทเรียนทั้งหมด</span>
  <h1>หลักสูตรเต็ม</h1>
  <p class="deck">${cur.modules.length} โมดูล · ${totalLessons} บท · ${totalLabs} แล็บ · ${videoCount} วิดีโอ · ~${Math.round(totalHours)} ชั่วโมง แถบใต้ชื่อโมดูลคือความคืบหน้าของคุณ</p>
  ${specRow}
</header>
<section style="padding-top:44px">${phases({ lessons: true })}</section>
<p class="note"><b>วิดีโอประกอบ</b> — อ้างอิงคลิปพร้อมลิงก์ไปต้นทางและเล่นผ่านโปรแกรมเล่นของ YouTube เอง เนื้อหาบทเรียนเขียนขึ้นเองทั้งหมด</p>`,
}));

writeFileSync(join(OUT, "404.html"), page({
  title: "ไม่พบหน้านี้", nav: "",
  body: `<header class="masthead"><span class="eyebrow">404</span><h1>ไม่พบหน้านี้</h1><p class="deck">กลับไปที่ <a href="index.html">ภาพรวมหลักสูตร</a> หรือ <a href="course-th.html">หลักสูตรเต็ม</a></p></header>`,
}));

writeFileSync(join(OUT, "assets/course-data.js"), courseDataJs);
writeFileSync(join(OUT, ".nojekyll"), "");

const trackedLessons = Object.values(courseData).reduce((a, m) => a + m.lessons.length, 0);
const trackedVideos = Object.values(courseData).reduce((a, m) => a + m.videos.length, 0);
console.log(`built → docs/`);
console.log(`  ${cur.modules.length} modules · ${totalLessons} lessons · ${totalLabs} labs · ${Math.round(totalHours)}h`);
console.log(`  ${writtenCount} module page(s) · ${videoCount} video link(s)`);
console.log(`  trackable: ${trackedLessons} lesson checkpoints · ${trackedVideos} videos`);
