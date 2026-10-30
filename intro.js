/* B&C McKeown — intro splash.
   A brief collage of photos from across the range behind the wordmark,
   shown once per visit.
   Entirely self-contained: delete this file and the site behaves exactly as
   before (the <script> tag pointing at it simply finds nothing). */
(function () {
  "use strict";

  var KEY = "bcIntroSeen";
  // A mix of the whole range: decking, cladding, fencing, garden rooms,
  // granite and paving, with roofing as one part of it. They fill a 4 x 4 grid
  // a column at a time, top to bottom; a TALL photo takes two rows, so each
  // column is one tall and two short and the wall has no gaps.
  var PHOTOS = [
    "tile-gardenroom.jpg", "tile-cladding.jpg", "tile-paving.jpg",
    "tile-stone.jpg", "tile-roofing.jpg", "g-decking.jpg",
    "tile-granite.jpg", "tile-fencing.jpg", "tile-decking.jpg",
    "g-steps.jpg", "g-setts.jpg", "cat-roofing.jpg"
  ];
  var TALL = ["tile-cladding.jpg", "tile-stone.jpg", "tile-decking.jpg", "g-setts.jpg"];

  function seen() {
    try { return window.sessionStorage.getItem(KEY) === "1"; } catch (e) { return false; }
  }
  function markSeen() {
    try { window.sessionStorage.setItem(KEY, "1"); } catch (e) { /* private mode: fine */ }
  }
  function reduced() {
    try {
      return typeof window.matchMedia === "function"
        && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch (e) { return false; }
  }

  // Once per visit, and never for people who asked the web to sit still.
  if (seen() || reduced()) return;
  markSeen();

  var root = document.documentElement;
  root.classList.add("bc-intro");

  // Cover the page instantly, before the body even exists, so nothing flashes.
  var style = document.createElement("style");
  style.textContent = [
    "html.bc-intro body{overflow:hidden}",
    "html.bc-intro::after{content:'';position:fixed;inset:0;background:#0e1013;z-index:2147483646}",

    ".bc-splash{position:fixed;inset:0;z-index:2147483647;background:#0e1013;overflow:hidden;",
    "display:grid;place-items:center;cursor:pointer;-webkit-tap-highlight-color:transparent;",
    "transition:opacity 520ms cubic-bezier(.4,0,.2,1),transform 620ms cubic-bezier(.4,0,.2,1)}",
    ".bc-splash.is-out{opacity:0;transform:scale(1.035)}",

    /* the collage: a tilted wall of photos in full colour */
    ".bc-wall{position:absolute;inset:-12%;display:grid;gap:10px;",
    "grid-template-columns:repeat(4,1fr);grid-template-rows:repeat(4,1fr);grid-auto-flow:column;",
    "transform:rotate(-6deg);",
    "animation:bcDrift 2.6s cubic-bezier(.16,.84,.28,1) forwards}",
    ".bc-wall figure{margin:0;overflow:hidden;background:#1a1d21;opacity:0;",
    "animation:bcTile 900ms cubic-bezier(.16,.84,.28,1) forwards}",
    ".bc-wall img{width:100%;height:100%;object-fit:cover;display:block;",
    "filter:saturate(1.08) contrast(1.04)}",
    ".bc-wall .is-tall{grid-row:span 2}",

    /* dark only behind the wordmark so it always reads; the photos stay bright */
    ".bc-shade{position:absolute;inset:0;",
    "background:radial-gradient(ellipse 44% 30% at 50% 50%,rgba(14,16,19,.82) 0%,rgba(14,16,19,.6) 45%,rgba(14,16,19,.14) 80%,rgba(14,16,19,.06) 100%)}",

    ".bc-mark{position:relative;text-align:center;color:#fff;padding:0 24px}",
    ".bc-word{font-family:Teko,'Arial Narrow',Impact,sans-serif;font-weight:600;",
    "text-transform:uppercase;line-height:.92;font-size:clamp(54px,13vw,128px);",
    "letter-spacing:.32em;margin-right:-.32em;opacity:0;",
    "animation:bcWord 1050ms cubic-bezier(.16,.84,.28,1) 120ms forwards}",
    ".bc-word .bc-bc{color:#8bc24a}",
    ".bc-word .bc-roof{display:inline-block;height:0.636em;width:0.636em;",
    "margin:0 0.02em;vertical-align:baseline;color:#fff}",
    ".bc-rule{height:2px;width:min(260px,52vw);margin:18px auto 14px;background:#e6b65c;",
    "transform:scaleX(0);animation:bcRule 760ms cubic-bezier(.16,.84,.28,1) 520ms forwards}",
    ".bc-sub{font-family:Outfit,'Segoe UI',sans-serif;font-size:12px;font-weight:600;",
    "letter-spacing:.34em;text-transform:uppercase;color:#e4e7ea;opacity:0;",
    "text-shadow:0 1px 10px rgba(0,0,0,.7);",
    "animation:bcFade 700ms ease 720ms forwards}",

    "@keyframes bcDrift{from{transform:rotate(-6deg) scale(1.12)}to{transform:rotate(-6deg) scale(1)}}",
    "@keyframes bcTile{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:none}}",
    "@keyframes bcWord{from{opacity:0;letter-spacing:.32em}to{opacity:1;letter-spacing:.04em}}",
    ".bc-logo{display:block;width:min(680px,78vw);height:auto;margin:0 auto;opacity:0;",
    "filter:drop-shadow(0 2px 16px rgba(0,0,0,.6));",
    "transform:scale(1.04);animation:bcLogo 1050ms cubic-bezier(.16,.84,.28,1) 120ms forwards}",
    "@keyframes bcLogo{to{opacity:1;transform:none}}",
    "@keyframes bcRule{to{transform:scaleX(1)}}",
    "@keyframes bcFade{to{opacity:1}}"
  ].join("");
  (document.head || root).appendChild(style);

  var splash = null;
  var gone = false;

  function finish() {
    if (gone) return;
    gone = true;
    if (!splash) { cleanup(); return; }
    splash.classList.add("is-out");
    window.setTimeout(cleanup, 640);
  }
  function cleanup() {
    root.classList.remove("bc-intro");
    if (splash && splash.parentNode) splash.parentNode.removeChild(splash);
    if (style.parentNode) style.parentNode.removeChild(style);
  }

  function build() {
    splash = document.createElement("div");
    splash.className = "bc-splash";
    splash.setAttribute("aria-hidden", "true");

    var wall = document.createElement("div");
    wall.className = "bc-wall";
    PHOTOS.forEach(function (src, i) {
      var fig = document.createElement("figure");
      if (TALL.indexOf(src) !== -1) fig.className = "is-tall";
      fig.style.animationDelay = (i * 55) + "ms";
      var img = new Image();
      img.alt = "";
      img.decoding = "async";
      // the photos may live at the root or in images/site, depending on the upload
      // small splash-only copies first; fall back to the full photo, then give up quietly
      var tries = ["intro-" + src, src, "images/site/" + src];
      var at = 0;
      img.onerror = function () {
        at += 1;
        if (at < tries.length) img.src = tries[at];
        else { fig.style.background = "#1d2126"; img.remove(); }
      };
      img.src = tries[0];
      fig.appendChild(img);
      wall.appendChild(fig);
    });

    var shade = document.createElement("div");
    shade.className = "bc-shade";

    var mark = document.createElement("div");
    mark.className = "bc-mark";
    mark.innerHTML = '<img class="bc-logo" src="logo-light.svg" alt="">'
      + '<div class="bc-rule"></div>'
      + '<div class="bc-sub">Downpatrick &middot; County Down</div>';

    splash.appendChild(wall);
    splash.appendChild(shade);
    splash.appendChild(mark);
    document.body.appendChild(splash);
    // the splash now covers everything, so the instant cover can go
    root.classList.add("bc-intro-built");
    style.textContent = style.textContent.replace(
      "html.bc-intro::after{content:'';", "html.bc-intro:not(.bc-intro-built)::after{content:'';");

    // a tap skips it
    splash.addEventListener("click", finish);
    // hold just long enough to read, then lift away
    window.setTimeout(finish, 1650);
  }

  if (document.body) build();
  else document.addEventListener("DOMContentLoaded", build);

  // whatever happens, the page must never be stuck behind the splash
  window.setTimeout(function () { finish(); window.setTimeout(cleanup, 700); }, 3200);
})();
