#!/usr/bin/env bun
/**
 * Static checks for the hand-authored SVG figures.
 *
 * Written after three real defects shipped in M01 — a label 29px past the
 * viewBox, an arrowhead overlapping the block it pointed at, and risk bars
 * whose widths did not increase with risk. A browser caught them only because
 * someone thought to look. These run every build instead.
 *
 * Geometry for shapes is exact. Text width cannot be measured without a
 * renderer, so it is estimated and reported as a warning, never an error —
 * an earlier estimate produced a false positive and a false alarm that fails
 * the build is worse than no check.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const DIR = join(ROOT, "content/modules");

interface Problem { file: string; fig: string; msg: string }
const errors: Problem[] = [];
const warnings: Problem[] = [];

/** Rough advance width per character, calibrated against browser getBBox()
 *  measurements of the Thai/Latin mix actually used in these figures. */
// Calibrated against getBBox() in a browser: of the first three warnings this
// produced, one was a real 7px overflow and two were false alarms, so the
// per-character widths were lowered until the real one still trips.
const CHAR_W: Record<number, number> = { 9.5: 4.6, 10: 4.8, 10.5: 5.0, 11: 5.1, 13: 6.0 };
const fontOf = (cls: string) =>
  /d-label-mono/.test(cls) ? 10.5 : /d-label-sm/.test(cls) ? 11 : /d-label-inv|d-label\b/.test(cls) ? 13 : 11;

function checkSvg(file: string, fig: string, vbW: number, vbH: number, body: string) {
  const add = (msg: string) => errors.push({ file, fig, msg });

  for (const m of body.matchAll(/<rect[^>]*?x="([\d.-]+)"[^>]*?y="([\d.-]+)"[^>]*?width="([\d.]+)"[^>]*?height="([\d.]+)"/g)) {
    const [x, y, w, h] = m.slice(1).map(Number);
    if (x! < -0.5 || y! < -0.5 || x! + w! > vbW + 0.5 || y! + h! > vbH + 0.5)
      add(`rect out of viewBox: x=${x} y=${y} w=${w} h=${h} → right=${x! + w!} bottom=${y! + h!} (box ${vbW}×${vbH})`);
  }
  // Partial overlap between two boxes is almost always a layout slip: one box grew
  // and ate its neighbour. Full containment is deliberate (grouping frames), so only
  // flag pairs that intersect without either containing the other. Caught m15 Figure 6.
  {
    type Box = { x: number; y: number; w: number; h: number };
    const boxes: Box[] = [];
    for (const m of body.matchAll(/<rect[^>]*?x="([\d.-]+)"[^>]*?y="([\d.-]+)"[^>]*?width="([\d.]+)"[^>]*?height="([\d.]+)"/g)) {
      const [x, y, w, h] = m.slice(1).map(Number) as number[];
      boxes.push({ x: x!, y: y!, w: w!, h: h! });
    }
    const contains = (a: Box, b: Box) =>
      a.x <= b.x + 0.5 && a.y <= b.y + 0.5 && a.x + a.w >= b.x + b.w - 0.5 && a.y + a.h >= b.y + b.h - 0.5;
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]!, b = boxes[j]!;
        const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
        const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        if (ox > 0.5 && oy > 0.5 && !contains(a, b) && !contains(b, a))
          add(`boxes overlap by ${ox.toFixed(0)}×${oy.toFixed(0)}px: (${a.x},${a.y} ${a.w}×${a.h}) vs (${b.x},${b.y} ${b.w}×${b.h})`);
      }
    }
  }

  for (const m of body.matchAll(/<circle[^>]*?cx="([\d.-]+)"[^>]*?cy="([\d.-]+)"[^>]*?r="([\d.]+)"/g)) {
    const [cx, cy, r] = m.slice(1).map(Number);
    if (cx! - r! < -0.5 || cy! - r! < -0.5 || cx! + r! > vbW + 0.5 || cy! + r! > vbH + 0.5)
      add(`circle out of viewBox: cx=${cx} cy=${cy} r=${r}`);
  }
  for (const m of body.matchAll(/<line[^>]*?x1="([\d.-]+)"[^>]*?y1="([\d.-]+)"[^>]*?x2="([\d.-]+)"[^>]*?y2="([\d.-]+)"/g)) {
    const v = m.slice(1).map(Number);
    if (v.some((n, i) => n! < -0.5 || n! > (i % 2 === 0 ? vbW : vbH) + 0.5))
      add(`line out of viewBox: ${v.join(",")}`);
  }
  // absolute M/H/V/L commands cover every path used in these figures
  for (const m of body.matchAll(/<path[^>]*?d="([^"]+)"/g)) {
    let x = 0, y = 0;
    for (const t of m[1]!.matchAll(/([MHVL])\s*([\d.-]+)(?:\s+([\d.-]+))?/g)) {
      const [cmd, a, b] = [t[1]!, Number(t[2]), t[3] === undefined ? undefined : Number(t[3])];
      if (cmd === "M" || cmd === "L") { x = a; y = b ?? y; }
      else if (cmd === "H") x = a; else if (cmd === "V") y = a;
      if (x < -1 || y < -1 || x > vbW + 1 || y > vbH + 1)
        { add(`path point out of viewBox: (${x}, ${y}) in "${m[1]!.slice(0, 40)}…"`); break; }
    }
  }

  for (const m of body.matchAll(/<text([^>]*)>([^<]*)<\/text>/g)) {
    const attrs = m[1]!, txt = m[2]!.trim();
    const x = Number(/x="([\d.-]+)"/.exec(attrs)?.[1] ?? 0);
    const y = Number(/y="([\d.-]+)"/.exec(attrs)?.[1] ?? 0);
    if (y > vbH + 0.5 || y < -0.5) add(`text y outside viewBox (${y} vs ${vbH}): "${txt.slice(0, 40)}"`);
    const anchor = /text-anchor="([a-z]+)"/.exec(attrs)?.[1] ?? "start";
    const est = txt.length * (CHAR_W[fontOf(attrs)] ?? 5.6);
    const right = anchor === "middle" ? x + est / 2 : anchor === "end" ? x : x + est;
    if (right > vbW + 8)
      warnings.push({ file, fig, msg: `text may overflow right edge (est ${Math.round(right)} > ${vbW}): "${txt.slice(0, 44)}"` });
  }

  if (!/role="img"/.test(body.slice(0, 400))) add("svg missing role=\"img\"");
  if (!/aria-label="/.test(body.slice(0, 400))) add("svg missing aria-label");
}

for (const f of readdirSync(DIR).filter((n) => n.endsWith(".html")).sort()) {
  const src = readFileSync(join(DIR, f), "utf8");

  const hard = [...src.matchAll(/(fill|stroke)="(#[0-9a-fA-F]{3,8})"/g)];
  for (const h of hard) errors.push({ file: f, fig: "-", msg: `hardcoded colour ${h[2]} — figures must take colour from theme tokens` });

  // A stray character in the <svg …> open tag (a typo'd ")" after aria-label, say)
  // renders fine in some browsers and silently breaks the tag in others. Nothing else
  // here reads that tag, so check it structurally: strip every attr="value" pair and
  // the tag name, and anything left over is malformed. Caught two of my own typos.
  for (const t of src.matchAll(/<svg\s([^>]*)>/g)) {
    const residue = t[1]!.replace(/[\w:-]+\s*=\s*"[^"]*"/g, "").trim();
    if (residue) errors.push({ file: f, fig: "-", msg: `malformed <svg> tag — unexpected ${JSON.stringify(residue)} in the open tag` });
  }

  const figs = [...src.matchAll(/<div class="fig">([\s\S]*?)<\/div>\s*(?=<\/section>|<section|<h3|<p |<div class="box|<div class="tw|<div class="refs)/g)];
  const caps = [...src.matchAll(/<b>Figure (\d+)<\/b>/g)].map((m) => Number(m[1]));
  const svgs = [...src.matchAll(/<svg viewBox="0 0 (\d+) (\d+)"([\s\S]*?)<\/svg>/g)];

  if (svgs.length !== caps.length)
    errors.push({ file: f, fig: "-", msg: `${svgs.length} svg but ${caps.length} "Figure n" captions — every figure needs a caption` });
  const dupes = caps.filter((n, i) => caps.indexOf(n) !== i);
  if (dupes.length) errors.push({ file: f, fig: "-", msg: `duplicate figure numbers: ${[...new Set(dupes)].join(", ")}` });

  svgs.forEach((m, i) => checkSvg(f, `Figure ${caps[i] ?? i + 1}`, Number(m[1]), Number(m[2]), m[3]!));
}

const bar = (n: number) => "─".repeat(n);
if (warnings.length) {
  console.log(`\n${bar(4)} diagram warnings (${warnings.length}) — verify in a browser, not blocking`);
  for (const w of warnings) console.log(`  ${w.file} ${w.fig}: ${w.msg}`);
}
if (errors.length) {
  console.error(`\n${bar(4)} diagram errors (${errors.length})`);
  for (const e of errors) console.error(`  ${e.file} ${e.fig}: ${e.msg}`);
  process.exit(1);
}
console.log(`diagrams ok · ${readdirSync(DIR).filter((n) => n.endsWith(".html")).length} modules checked${warnings.length ? ` · ${warnings.length} warning(s)` : ""}`);
