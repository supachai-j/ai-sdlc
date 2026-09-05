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

interface EnStrings {
  course: Record<string, string>;
  phases: Record<string, string>;
  gaps: Record<string, { title: string; why: string }>;
  modules: Record<string, { title: string; goal: string; outcome: string; lessons: string[] }>;
  ui: Record<string, string>;
}
const en = Bun.YAML.parse(readFileSync(join(ROOT, "content/curriculum-en.yaml"), "utf8")) as EnStrings;

const byId = new Map(cur.modules.map((m) => [m.id, m]));

// Parity guard. The Thai structure is the source of truth; the English strings
// and the authored bodies must agree with it. A silent mismatch here shipped a
// page whose lesson count disagreed with its own syllabus, so it now fails the
// build instead.
for (const m of cur.modules) {
  const e = en.modules[m.id];
  if (!e) throw new Error(`missing English strings for ${m.id}`);
  if (e.lessons.length !== m.lessons.length) {
    throw new Error(`${m.code}: curriculum.yaml has ${m.lessons.length} lessons but curriculum-en.yaml has ${e.lessons.length}`);
  }
}
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

function page(o: { title: string; nav: string; body: string; lang?: "th" | "en" }): string {
  const L = o.lang ?? "th";
  const home = L === "en" ? "index-en.html" : "index.html";
  const list = L === "en" ? "course-en.html" : "course-th.html";
  const t = (k: string, thai: string) => (L === "en" ? en.ui[k] ?? thai : thai);
  const other = L === "en"
    ? `<a class="lang" href="index.html" hreflang="th">ไทย</a>`
    : `<a class="lang" href="index-en.html" hreflang="en">EN</a>`;
  return `<!doctype html>
<html lang="${L}">
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
  <a class="brand" href="${home}">Agent SDLC</a>
  <nav>
    <a href="${home}"${o.nav === "index" ? ' aria-current="page"' : ""}>${t("overview", "ภาพรวม")}</a>
    <a href="${list}"${o.nav === "course" ? ' aria-current="page"' : ""}>${t("syllabus", "หลักสูตร")}</a>
    <a href="slides/training-th.html" target="_blank" rel="noopener">${t("slides", "สไลด์")}</a>
    ${other}
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
        <button id="prog-export" class="btn ghost" type="button">บันทึกเป็นไฟล์</button>
        <label class="btn ghost" for="prog-import">นำเข้าไฟล์<input id="prog-import" type="file" accept="application/json,.json" hidden></label>
        <button id="prog-reset" class="btn ghost" type="button">ล้างความคืบหน้า</button>
      </div>
      <p class="prog-note">บันทึกไว้ในเบราว์เซอร์นี้เท่านั้น — ถ้าจะย้ายเครื่องให้กด <strong>บันทึกเป็นไฟล์</strong> แล้วไปกด <strong>นำเข้าไฟล์</strong> ที่อีกเครื่อง (ระบบจะรวมกับของเดิม ไม่ทับ)</p>
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


// ── English structural pages ────────────────────────────────────────────
// Lesson bodies stay in Thai; these mirror structure, goals and outcomes so a
// non-Thai reader can evaluate and navigate the course.
const enModule = (m: Module, withLessons: boolean) => {
  const e = en.modules[m.id]!;
  const flagged = m.status !== "core";
  const tag = m.status === "new" ? "NEW" : m.status === "expanded" ? "EXPANDED" : "";
  const lessons = withLessons
    ? `<ol class="lessons">${e.lessons.map((l) => {
        const lab = /^LAB/.test(l);
        const text = lab ? l.replace(/^LAB\s*([AB])?:?\s*/, "") : l;
        const suffix = /^LAB\s*([AB])/.exec(l)?.[1];
        const chip = lab ? `<span class="chip">LAB${suffix ? " " + suffix : ""}</span>` : "";
        return `<li${lab ? ' class="lab"' : ""}>${chip}${esc(text)}</li>`;
      }).join("")}</ol>`
    : "";
  return `<div class="module${flagged ? " flagged" : ""}" id="${m.id}" data-module="${m.id}">
  <div class="m-rail">
    <span class="m-code">${m.code}</span>
    <span class="m-stat">${m.lessons.length} lessons<br>${m.hours} h</span>
    ${tag ? `<span class="m-tag">${tag}${m.gap ? " " + m.gap : ""}</span>` : ""}
  </div>
  <div class="m-body">
    <h3><a href="${esc(pageOf(m))}">${esc(e.title)}</a></h3>
    <div class="bar" data-bar="${m.id}"><span></span></div>
    <p class="m-goal">${esc(e.goal)}</p>
    ${lessons}
    <div class="m-out"><b>${esc(en.ui.outcome!)}</b>${esc(e.outcome)}</div>
  </div>
</div>`;
};

const enPhases = (withLessons: boolean) => cur.phases.map((ph) => {
  const ms = ph.modules.map((id) => byId.get(id)!).filter(Boolean);
  const lc = ms.reduce((a, m) => a + m.lessons.length, 0);
  const hr = ms.reduce((a, m) => a + m.hours, 0);
  return `<div class="phase">
  <div class="phase-bar">
    <span class="p-num">PHASE ${ph.num}</span>
    <span class="p-name">${esc(en.phases[ph.id]!)}</span>
    <span class="p-meta">${ms[0]!.code}–${ms[ms.length - 1]!.code} · ${lc} lessons · ${hr}h</span>
  </div>
  ${ms.map((m) => enModule(m, withLessons)).join("\n")}
</div>`;
}).join("\n");

const enSpecRow = `<dl class="specrow">
  <div class="spec"><dt>${esc(en.ui.modules!)}</dt><dd>${cur.modules.length}</dd></div>
  <div class="spec"><dt>${esc(en.ui.lessons!)}</dt><dd>${totalLessons}</dd></div>
  <div class="spec"><dt>${esc(en.ui.hours!)}</dt><dd>~${Math.round(totalHours)}</dd></div>
  <div class="spec"><dt>${esc(en.ui.labs!)}</dt><dd>${totalLabs}</dd></div>
  <div class="spec"><dt>${esc(en.ui.videos!)}</dt><dd>${videoCount}</dd></div>
  <div class="spec"><dt>${esc(en.ui.level!)}</dt><dd><small>${esc(en.course.level!)}</small></dd></div>
</dl>`;

const enGapRows = cur.gaps.map((g) => {
  const m = byId.get(g.module)!;
  const e = en.gaps[g.id]!;
  return `<div class="gap">
  <div class="gap-id">${g.id}</div>
  <div class="gap-what"><h3>${esc(e.title)}</h3><a href="${esc(pageOf(m))}">${m.code} · ${m.lessons.length} lessons →</a></div>
  <div class="gap-why">${esc(e.why)}</div>
</div>`;
}).join("\n");

writeFileSync(join(OUT, "index-en.html"), page({
  lang: "en", nav: "index",
  title: `${cur.course.title_th} — Course overview`,
  body: `<header class="masthead">
  <span class="eyebrow">Deep edition</span>
  <h1>${esc(String(cur.course.title_th))}</h1>
  <p class="deck">${esc(en.course.subtitle!)} — <strong>${cur.modules.length} modules, ${totalLessons} lessons</strong>, self-paced, with videos playable inline and your progress remembered.</p>
  ${enSpecRow}
</header>

<section id="progress-panel" class="panel" hidden>
  <div class="sechead"><span class="num">§00</span><h2>${esc(en.ui.your_progress!)}</h2></div>
  <div class="prog-top">
    <div class="ring" id="prog-ring"><svg viewBox="0 0 120 120" aria-hidden="true"><circle class="ring-bg" cx="60" cy="60" r="52"></circle><circle class="ring-fg" cx="60" cy="60" r="52"></circle></svg><span id="prog-pct">0%</span></div>
    <div class="prog-stats">
      <p id="prog-summary" class="prog-summary"></p>
      <p id="prog-next" class="prog-next"></p>
      <div class="prog-actions">
        <a id="prog-resume" class="btn" href="m01.html">${esc(en.ui.start!)}</a>
        <button id="prog-export" class="btn ghost" type="button">${esc(en.ui.export!)}</button>
        <label class="btn ghost" for="prog-import">${esc(en.ui.import!)}<input id="prog-import" type="file" accept="application/json,.json" hidden></label>
        <button id="prog-reset" class="btn ghost" type="button">${esc(en.ui.reset!)}</button>
      </div>
      <p class="prog-note">Stored in this browser only. To move devices, save to a file here and load it there — imports merge, they never overwrite.</p>
    </div>
  </div>
  <div class="prog-grid" id="prog-grid"></div>
</section>

<section>
  <div class="sechead"><span class="num">§01</span><h2>${esc(en.ui.gaps_heading!)}</h2></div>
  <p class="lede">None of these were added because they were nice to have. Each one is where a workflow breaks once a team depends on it — ordered by the damage of skipping it.</p>
  <div class="gaps">${enGapRows}</div>
</section>

<section>
  <div class="sechead"><span class="num">§02</span><h2>${esc(en.ui.structure_heading!)}</h2></div>
  <p class="lede">Ordered by dependency; each phase assumes the one before it. <a href="course-en.html">${esc(en.ui.full_syllabus!)} →</a></p>
  ${enPhases(false)}
</section>

<p class="note"><b>A note on language</b> — ${esc(en.ui.body_note!)}</p>`,
}));

writeFileSync(join(OUT, "course-en.html"), page({
  lang: "en", nav: "course",
  title: `${cur.course.title_th} — Full syllabus`,
  body: `<header class="masthead">
  <span class="eyebrow">Every lesson</span>
  <h1>Full syllabus</h1>
  <p class="deck">${cur.modules.length} modules · ${totalLessons} lessons · ${totalLabs} labs · ${videoCount} videos · ~${Math.round(totalHours)} hours. The bar under each module title is your progress.</p>
  ${enSpecRow}
</header>
<section style="padding-top:44px">${enPhases(true)}</section>
<p class="note"><b>A note on language</b> — ${esc(en.ui.body_note!)}</p>`,
}));

// ── teaching deck ───────────────────────────────────────────────────────
// Generated from the same YAML so the deck can never drift from the course.
mkdirSync(join(OUT, "slides"), { recursive: true });

const deckSlides: string[] = [];

deckSlides.push(`<section data-background-color="#14191D">
  <p class="eyebrow-s">หลักสูตรฉบับลงลึก</p>
  <h1>${esc(String(cur.course.title_th))}</h1>
  <p class="sub">${esc(String(cur.course.subtitle_th))}</p>
  <p class="stat">${cur.modules.length} โมดูล · ${totalLessons} บท · ${totalLabs} แล็บ · ~${Math.round(totalHours)} ชั่วโมง</p>
</section>`);

deckSlides.push(`<section>
  <h2>ปัญหาที่หลักสูตรนี้ตั้งใจแก้</h2>
  <p class="lead">คอร์สทั่วไปสอนให้ “ใช้ agent เป็น” ซึ่งพอสำหรับคนเดียว แต่ไม่พอเมื่อ<strong>ทีมทั้งทีมใช้พร้อมกันและของขึ้นโปรดักชัน</strong></p>
  <ul class="big">
    <li>ปรับ prompt ด้วยความรู้สึก เพราะไม่มีเครื่องวัด</li>
    <li>ต้นทุนบานโดยไม่รู้ว่าเงินไปไหน</li>
    <li>ทำงานได้เฉพาะกับโปรเจกต์ใหม่ ไม่ใช่โค้ดจริงที่มีอยู่</li>
    <li>เปิดสิทธิ์กว้างเพราะรำคาญ แล้วกลายเป็นช่องโหว่</li>
  </ul>
</section>`);

deckSlides.push(`<section>
  <h2>ช่องว่าง ${cur.gaps.length} จุด</h2>
  <p class="lead">แต่ละจุดเพิ่มเพราะถ้าไม่มี เวิร์กโฟลว์จะพังตอนขยาย — เรียงตามความเสียหายถ้าข้าม</p>
  <div class="gapgrid">
    ${cur.gaps.map((g) => {
      const m = byId.get(g.module)!;
      return `<div class="gapcell"><span class="gid">${g.id}</span><span class="gt">${esc(g.title_th)}</span><span class="gm">${m.code}</span></div>`;
    }).join("")}
  </div>
</section>`);

for (const g of cur.gaps.slice(0, 4)) {
  const m = byId.get(g.module)!;
  deckSlides.push(`<section>
  <p class="eyebrow-s">${g.id} · ${m.code} · ${m.lessons.length} บท</p>
  <h2>${esc(g.title_th)}</h2>
  <p class="lead">${esc(g.why_th)}</p>
</section>`);
}

deckSlides.push(`<section>
  <h2>โครงหลักสูตร</h2>
  <div class="phasegrid">
    ${cur.phases.map((p) => {
      const ms = p.modules.map((id) => byId.get(id)!).filter(Boolean);
      return `<div class="pcell">
        <span class="pn">PHASE ${p.num}</span>
        <span class="pnm">${esc(p.name_th.split(" — ")[0]!)}</span>
        <span class="pms">${ms.map((m) => m.code).join(" · ")}</span>
      </div>`;
    }).join("")}
  </div>
</section>`);

for (const ph of cur.phases) {
  const ms = ph.modules.map((id) => byId.get(id)!).filter(Boolean);
  deckSlides.push(`<section>
  <p class="eyebrow-s">PHASE ${ph.num}</p>
  <h2>${esc(ph.name_th)}</h2>
  <table class="mtable">
    <tbody>${ms.map((m) => `<tr>
      <td class="mc">${m.code}</td>
      <td class="mt">${esc(m.title_th)}${m.status !== "core" ? ` <span class="badge">${STATUS_TAG[m.status]}${m.gap ? " " + m.gap : ""}</span>` : ""}</td>
      <td class="mn">${m.lessons.length} บท</td>
    </tr>`).join("")}</tbody>
  </table>
</section>`);
}

deckSlides.push(`<section>
  <h2>เรียนยังไง</h2>
  <ul class="big">
    <li>อ่านบทเรียนในเว็บ กด <strong>เรียนจบ</strong> ท้ายแต่ละหัวข้อ</li>
    <li>ดูวิดีโอประกอบ ${videoCount} คลิปได้ในหน้าเลย</li>
    <li>ทำแล็บ ${totalLabs} ตัว — ทุกตัวมีเกณฑ์ผ่านที่วัดได้</li>
    <li>ความคืบหน้าเก็บในเบราว์เซอร์ ย้ายเครื่องได้ด้วยไฟล์</li>
  </ul>
  <p class="stat">supachai-j.github.io/ai-sdlc</p>
</section>`);

deckSlides.push(`<section data-background-color="#14191D">
  <h2 class="closing">ถ้าวัดไม่ได้<br>คุณกำลังปรับ prompt ด้วยความรู้สึก</h2>
  <p class="sub">เริ่มที่ M12 — ชุดวัด 20 งาน ใช้ตัดสินข้อถกเถียงจริงหนึ่งข้อ</p>
</section>`);

writeFileSync(join(OUT, "slides/training-th.html"), `<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(String(cur.course.title_th))} — สไลด์บรรยาย</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans+Thai:wght@400;500;600;700&display=swap">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/reveal.js/4.6.1/reveal.min.css">
<style>
:root{--ink:#14191D;--paper:#F1F3F4;--rule:#D3D9DC;--ink2:#47535C;--ink3:#7E8B93;
      --signal:#B04716;--steel:#2F5D7C;--good:#2C6A4A;
      --mono:"IBM Plex Mono",monospace;--sans:"IBM Plex Sans Thai",system-ui,sans-serif}
.reveal{font-family:var(--sans);font-size:26px;color:var(--ink)}
.reveal-viewport{background:var(--paper)}
.reveal .slides{text-align:left}
.reveal section{padding:0 20px}
.reveal h1{font-size:64px;font-weight:700;letter-spacing:-.02em;line-height:1.1;color:#F1F3F4;margin:0 0 24px;text-transform:none}
.reveal h2{font-size:44px;font-weight:700;letter-spacing:-.018em;line-height:1.18;margin:0 0 26px;text-transform:none;color:var(--ink)}
.reveal h2.closing{font-size:52px;color:#F1F3F4;line-height:1.22}
.eyebrow-s{font-family:var(--mono);font-size:16px;letter-spacing:.16em;text-transform:uppercase;color:var(--signal);margin:0 0 20px}
.sub{font-size:26px;color:#A2B0B8;max-width:34ch;margin:0 0 28px;line-height:1.55}
.lead{font-size:27px;color:var(--ink2);max-width:40ch;line-height:1.6;margin:0 0 28px}
.lead strong,.big strong{color:var(--ink);font-weight:600}
.stat{font-family:var(--mono);font-size:19px;color:var(--ink3);letter-spacing:.06em;margin:0}
section[data-background-color] .stat{color:#7E8B93}
ul.big{list-style:none;padding:0;margin:0;font-size:27px;line-height:1.6}
ul.big li{padding:13px 0 13px 34px;border-top:1px solid var(--rule);position:relative;color:var(--ink2)}
ul.big li:first-child{border-top:none}
ul.big li::before{content:"";position:absolute;left:0;top:24px;width:16px;height:2px;background:var(--signal)}
.gapgrid{display:grid;grid-template-columns:repeat(2,1fr);gap:1px;background:var(--rule);border:1px solid var(--rule)}
.gapcell{background:var(--paper);padding:15px 18px;display:flex;align-items:baseline;gap:12px}
.gid{font-family:var(--mono);font-size:16px;font-weight:600;color:var(--signal)}
.gt{font-size:21px;flex:1;line-height:1.35}
.gm{font-family:var(--mono);font-size:14px;color:var(--ink3)}
.phasegrid{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:var(--rule);border:1px solid var(--rule)}
.pcell{background:var(--paper);padding:18px;display:flex;flex-direction:column;gap:8px}
.pn{font-family:var(--mono);font-size:14px;letter-spacing:.14em;color:var(--signal)}
.pnm{font-size:21px;font-weight:600;line-height:1.3}
.pms{font-family:var(--mono);font-size:14px;color:var(--ink3)}
table.mtable{width:100%;border-collapse:collapse;font-size:23px}
table.mtable td{padding:12px 10px;border-bottom:1px solid var(--rule);vertical-align:baseline}
td.mc{font-family:var(--mono);font-weight:600;width:78px;color:var(--ink3)}
td.mt{line-height:1.35}
td.mn{font-family:var(--mono);font-size:16px;color:var(--ink3);text-align:right;white-space:nowrap}
.badge{font-family:var(--mono);font-size:13px;letter-spacing:.08em;text-transform:uppercase;
       color:var(--signal);border:1px solid var(--signal);padding:2px 6px;margin-left:8px;vertical-align:2px}
</style>
</head>
<body>
<div class="reveal"><div class="slides">
${deckSlides.join("\n")}
</div></div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/reveal.js/4.6.1/reveal.min.js"><\/script>
<script>
Reveal.initialize({width:1280,height:800,margin:.07,hash:true,slideNumber:"c/t",transition:"none"});
<\/script>
</body>
</html>`);


writeFileSync(join(OUT, ".nojekyll"), "");

for (const m of cur.modules) {
  const d = courseData[m.id];
  if (d && d.lessons.length !== m.lessons.length) {
    throw new Error(`${m.code}: curriculum.yaml lists ${m.lessons.length} lessons but the page has ${d.lessons.length} checkpoints`);
  }
}

const trackedLessons = Object.values(courseData).reduce((a, m) => a + m.lessons.length, 0);
const trackedVideos = Object.values(courseData).reduce((a, m) => a + m.videos.length, 0);
console.log(`built → docs/`);
console.log(`  ${cur.modules.length} modules · ${totalLessons} lessons · ${totalLabs} labs · ${Math.round(totalHours)}h`);
console.log(`  ${writtenCount} module page(s) · ${videoCount} video link(s)`);
console.log(`  trackable: ${trackedLessons} lesson checkpoints · ${trackedVideos} videos`);
console.log(`  deck: slides/training-th.html · ${deckSlides.length} slides`);
console.log(`  english: index-en.html · course-en.html`);
