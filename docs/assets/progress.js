/* Per-viewer learning progress. Stored in this browser only — there is no
   backend, so every read and write is guarded: private windows and blocked
   site data throw on access rather than returning null. */
(function () {
  "use strict";

  var KEY = "ai-sdlc:progress:v1";
  var COURSE = window.COURSE || { order: [], modules: {} };

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return { lessons: {}, videos: {} };
      var p = JSON.parse(raw);
      return { lessons: p.lessons || {}, videos: p.videos || {} };
    } catch (e) {
      return { lessons: {}, videos: {} };
    }
  }

  function save(p) {
    try {
      p.updated = new Date().toISOString();
      localStorage.setItem(KEY, JSON.stringify(p));
    } catch (e) {
      /* storage unavailable — the page still works, it just won't remember */
    }
  }

  var state = load();

  /* ── stats ─────────────────────────────────────────────── */
  function moduleStats(id) {
    var m = COURSE.modules[id];
    if (!m) return { done: 0, total: 0, pct: 0 };
    var done = 0;
    for (var i = 0; i < m.lessons.length; i++) {
      if (state.lessons[m.lessons[i]]) done++;
    }
    return {
      done: done,
      total: m.lessons.length,
      pct: m.lessons.length ? Math.round((done / m.lessons.length) * 100) : 0
    };
  }

  function overall() {
    var done = 0, total = 0, mods = 0;
    for (var i = 0; i < COURSE.order.length; i++) {
      var s = moduleStats(COURSE.order[i]);
      done += s.done; total += s.total;
      if (s.total && s.done === s.total) mods++;
    }
    var vids = 0;
    for (var k in state.videos) if (state.videos[k]) vids++;
    return { done: done, total: total, pct: total ? Math.round((done / total) * 100) : 0, modules: mods, videos: vids };
  }

  /** First unfinished lesson, so "continue" lands somewhere useful. */
  function nextUp() {
    for (var i = 0; i < COURSE.order.length; i++) {
      var id = COURSE.order[i], m = COURSE.modules[id];
      if (!m) continue;
      for (var j = 0; j < m.lessons.length; j++) {
        if (!state.lessons[m.lessons[j]]) {
          return { module: id, code: m.code, title: m.title, href: m.href, lesson: m.lessons[j] };
        }
      }
    }
    return null;
  }

  /* ── rendering ─────────────────────────────────────────── */
  function paintBars() {
    document.querySelectorAll("[data-bar]").forEach(function (el) {
      var s = moduleStats(el.getAttribute("data-bar"));
      var fill = el.querySelector("span");
      if (fill) fill.style.width = s.pct + "%";
      el.classList.toggle("complete", s.total > 0 && s.done === s.total);
      el.setAttribute("title", s.done + "/" + s.total + " บท");
    });
    document.querySelectorAll("[data-label]").forEach(function (el) {
      var s = moduleStats(el.getAttribute("data-label"));
      el.textContent = s.done + " / " + s.total + " บท" + (s.done === s.total && s.total ? " · จบแล้ว" : "");
    });
  }

  function paintNav() {
    var el = document.getElementById("nav-progress");
    if (!el || !COURSE.order.length) return;
    var o = overall();
    el.textContent = o.pct + "%";
    el.title = "เรียนไปแล้ว " + o.done + " จาก " + o.total + " บท";
    el.hidden = false;
  }

  function paintPanel() {
    var panel = document.getElementById("progress-panel");
    if (!panel || !COURSE.order.length) return;
    panel.hidden = false;

    var o = overall();
    var pctEl = document.getElementById("prog-pct");
    if (pctEl) pctEl.textContent = o.pct + "%";

    var ring = document.querySelector("#prog-ring .ring-fg");
    if (ring) {
      var C = 2 * Math.PI * 52;
      ring.style.strokeDasharray = C + " " + C;
      ring.style.strokeDashoffset = C * (1 - o.pct / 100);
    }

    var sum = document.getElementById("prog-summary");
    if (sum) {
      sum.innerHTML = o.done === 0
        ? "ยังไม่ได้เริ่ม — กด <em>เรียนจบ</em> ท้ายหัวข้อแต่ละบทเพื่อบันทึกความคืบหน้า"
        : "<strong>" + o.done + " / " + o.total + "</strong> บท · <strong>" + o.modules + " / " +
          COURSE.order.length + "</strong> โมดูลจบแล้ว · ดูวิดีโอไปแล้ว <strong>" + o.videos + "</strong> คลิป";
    }

    var next = nextUp();
    var nextEl = document.getElementById("prog-next");
    var resume = document.getElementById("prog-resume");
    if (next) {
      if (nextEl) nextEl.innerHTML = "บทถัดไป — <span class='mono'>" + next.lesson + "</span> ใน " + next.code + " " + next.title;
      if (resume) { resume.href = next.href; resume.textContent = o.done ? "เรียนต่อ" : "เริ่มเรียน"; }
    } else {
      if (nextEl) nextEl.textContent = "เรียนครบทุกบทแล้ว — กลับไปทบทวน M12 ทุกไตรมาสตามที่หลักสูตรแนะนำ";
      if (resume) { resume.href = "m12-evals.html"; resume.textContent = "ทบทวน M12"; }
    }

    var grid = document.getElementById("prog-grid");
    if (grid) {
      grid.innerHTML = COURSE.order.map(function (id) {
        var m = COURSE.modules[id], s = moduleStats(id);
        if (!m) return "";
        var cls = s.total && s.done === s.total ? "done" : s.done ? "partial" : "";
        return '<a class="pcard ' + cls + '" href="' + m.href + '">' +
          '<span class="pcode">' + m.code + '</span>' +
          '<span class="ptitle">' + m.title + '</span>' +
          '<span class="bar" data-bar="' + id + '"><span></span></span>' +
          '<span class="pnum">' + s.done + "/" + s.total + '</span></a>';
      }).join("");
      paintBars();
    }
  }

  function paintAll() { paintBars(); paintNav(); paintPanel(); }

  /* ── wiring ────────────────────────────────────────────── */
  document.querySelectorAll("input[data-lesson]").forEach(function (box) {
    var id = box.getAttribute("data-lesson");
    box.checked = !!state.lessons[id];
    box.closest(".done") && box.closest(".done").classList.toggle("on", box.checked);
    box.addEventListener("change", function () {
      if (box.checked) state.lessons[id] = 1; else delete state.lessons[id];
      save(state);
      box.closest(".done") && box.closest(".done").classList.toggle("on", box.checked);
      paintAll();
    });
  });

  document.querySelectorAll("input[data-video]").forEach(function (box) {
    var id = box.getAttribute("data-video");
    box.checked = !!state.videos[id];
    box.addEventListener("change", function () {
      if (box.checked) state.videos[id] = 1; else delete state.videos[id];
      save(state);
      paintAll();
    });
  });

  /* Facade → real player only on click, so a page with ten clips stays light. */
  document.querySelectorAll(".vid-play").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var id = btn.getAttribute("data-yt");
      var frame = document.createElement("iframe");
      frame.src = "https://www.youtube-nocookie.com/embed/" + id + "?autoplay=1&rel=0";
      frame.title = btn.getAttribute("data-title") || "วิดีโอ";
      frame.loading = "lazy";
      frame.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture";
      frame.allowFullscreen = true;
      frame.className = "vid-frame";
      // let the player take the whole row — the 200px thumbnail column is unwatchable
      var row = btn.closest(".vid");
      if (row) row.classList.add("playing");
      btn.replaceWith(frame);
      // watching counts as watched, but the viewer can still untick it
      var box = frame.parentElement && frame.parentElement.querySelector("input[data-video][data-video='" + id + "']");
      if (box && !box.checked) { box.checked = true; state.videos[id] = 1; save(state); paintAll(); }
    });
  });

  var reset = document.getElementById("prog-reset");
  if (reset) {
    reset.addEventListener("click", function () {
      if (!confirm("ล้างความคืบหน้าทั้งหมดในเบราว์เซอร์นี้?")) return;
      state = { lessons: {}, videos: {} };
      save(state);
      document.querySelectorAll("input[data-lesson],input[data-video]").forEach(function (b) { b.checked = false; });
      document.querySelectorAll(".done").forEach(function (d) { d.classList.remove("on"); });
      paintAll();
    });
  }

  paintAll();
})();
