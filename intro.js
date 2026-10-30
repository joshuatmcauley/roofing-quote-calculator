/* B&C McKeown — intro splash.
   A box profile sheet with light running across it, the wordmark on top, and
   the gold rule under it filling as the page loads. When the page is ready the
   sheet lifts away to show the site. Shown once per visit.
   Entirely self-contained: delete this file and the site behaves exactly as
   before (the <script> tag pointing at it simply finds nothing). */
(function () {
  "use strict";

  var KEY = "bcIntroSeen";
  var MIN_MS = 950;   // long enough to read the name
  var MAX_MS = 2600;  // never hold anyone longer than this, however slow the page

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
  var started = Date.now();
  root.classList.add("bc-intro");

  var ease = "cubic-bezier(.16,.84,.28,1)";
  var style = document.createElement("style");
  style.textContent = [
    "html.bc-intro,html.bc-intro body{overflow:hidden}",

    ".bc-splash{position:fixed;inset:0;z-index:2147483647;background:#0e1013;overflow:hidden;",
    "display:grid;place-items:center;cursor:pointer;-webkit-tap-highlight-color:transparent;",
    "box-shadow:0 40px 80px rgba(0,0,0,.45);",
    "transition:transform 720ms cubic-bezier(.76,0,.22,1)}",
    /* the sheet lifts straight up off the page */
    ".bc-splash.is-out{transform:translateY(-104%)}",

    /* box profile sheet: wide flat pans, a narrow raised rib every 1/5 of a metre,
       laid back in perspective and rolled out from the top */
    ".bc-sheet{position:absolute;left:-30%;right:-30%;top:-10%;bottom:-40%;",
    "transform-origin:50% 0;transform:perspective(900px) rotateX(38deg);",
    "background:repeating-linear-gradient(90deg,",
    "#14171b 0,#14171b 70px,#0b0d10 70px,#0b0d10 74px,",
    "#1f242a 74px,#262c33 82px,#1c2025 90px,#2a3038 90px,#2a3038 92px,",
    "#14171b 92px,#14171b 110px);",
    "clip-path:inset(0 0 100% 0);animation:bcRoll 900ms " + ease + " forwards}",
    /* light catching the ribs as it runs across */
    ".bc-sheet::after{content:'';position:absolute;inset:0;",
    "background:linear-gradient(100deg,transparent 30%,rgba(255,255,255,.11) 46%,",
    "rgba(255,255,255,.18) 50%,rgba(255,255,255,.11) 54%,transparent 70%);",
    "transform:translateX(-70%);animation:bcSweep 1800ms cubic-bezier(.45,.05,.35,1) 250ms forwards}",

    /* keep the middle dark so the wordmark always reads */
    ".bc-shade{position:absolute;inset:0;pointer-events:none;",
    "background:radial-gradient(ellipse 58% 46% at 50% 50%,rgba(14,16,19,.92) 0%,",
    "rgba(14,16,19,.7) 48%,rgba(14,16,19,.2) 82%,rgba(14,16,19,.55) 100%),",
    "linear-gradient(to bottom,rgba(14,16,19,.85) 0%,rgba(14,16,19,0) 30%)}",

    ".bc-mark{position:relative;text-align:center;color:#fff;padding:0 24px;width:100%}",
    ".bc-logo{display:block;width:min(560px,80vw);height:auto;margin:0 auto;opacity:0;",
    "transform:translateY(10px);animation:bcUp 700ms " + ease + " 120ms forwards}",
    /* the gold rule is the loading bar: it runs most of the way on its own and
       finishes when the page is actually ready */
    ".bc-rule{height:2px;width:min(240px,50vw);margin:20px auto 16px;background:rgba(230,182,92,.18);",
    "position:relative;overflow:hidden}",
    ".bc-rule i{position:absolute;inset:0;background:#e6b65c;transform-origin:0 50%;",
    "transform:scaleX(0);transition:transform 900ms " + ease + "}",
    ".bc-sub{font-family:Outfit,'Segoe UI',sans-serif;font-size:11.5px;font-weight:600;",
    "letter-spacing:.34em;margin-right:-.34em;text-transform:uppercase;color:#b9bdc1;",
    "opacity:0;animation:bcFade 700ms ease 420ms forwards}",

    "@keyframes bcRoll{to{clip-path:inset(0 0 0 0)}}",
    "@keyframes bcSweep{to{transform:translateX(70%)}}",
    "@keyframes bcUp{to{opacity:1;transform:none}}",
    "@keyframes bcFade{to{opacity:1}}"
  ].join("");
  (document.head || root).appendChild(style);

  var splash = document.createElement("div");
  splash.className = "bc-splash";
  splash.setAttribute("aria-hidden", "true");
  splash.innerHTML = '<div class="bc-sheet"></div><div class="bc-shade"></div>'
    + '<div class="bc-mark"><img class="bc-logo" src="logo-light.svg" alt="">'
    + '<div class="bc-rule"><i></i></div>'
    + '<div class="bc-sub">Downpatrick &middot; County Down</div></div>';
  var bar = splash.querySelector(".bc-rule i");

  // Straight onto the page before the body exists, so the very first frame is
  // the brand rather than a blank screen.
  root.appendChild(splash);
  window.requestAnimationFrame(function () {
    window.requestAnimationFrame(function () { bar.style.transform = "scaleX(.72)"; });
  });

  var gone = false;
  function leave() {
    if (gone) return;
    gone = true;
    bar.style.transitionDuration = "260ms";
    bar.style.transform = "scaleX(1)";
    window.setTimeout(function () {
      splash.classList.add("is-out");
      root.classList.remove("bc-intro");
      window.setTimeout(cleanup, 760);
    }, 280);
  }
  function cleanup() {
    root.classList.remove("bc-intro");
    if (splash.parentNode) splash.parentNode.removeChild(splash);
    if (style.parentNode) style.parentNode.removeChild(style);
  }

  // Leave as soon as the page (hero video included) is ready, but not before
  // the name has had a moment on screen.
  function ready() {
    window.setTimeout(leave, Math.max(0, MIN_MS - (Date.now() - started)));
  }
  if (document.readyState === "complete") ready();
  else window.addEventListener("load", ready);

  // a tap or a key skips it
  splash.addEventListener("click", leave);
  window.addEventListener("keydown", leave, { once: true });

  // whatever happens, the page must never be stuck behind the splash
  window.setTimeout(leave, MAX_MS);
  window.setTimeout(cleanup, MAX_MS + 1400);
})();
