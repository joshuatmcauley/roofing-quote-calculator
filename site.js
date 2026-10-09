/* B&C McKeown — shared site behaviour.
   Header and footer are injected so every page stays in step, and the product
   listings are built from range.js, the same data the calculator prices from. */

const SITE = {
  name: "B&C McKeown",
  legal: "B&C McKeown Ltd",
  tel: "02844 615148",
  telHref: "tel:+442844615148",
  town: "Downpatrick, County Down",
  shop: "https://bcmckeown.net",
};

/* The four pillars the range sorts into. Each maps to categories in range.js. */
const PILLARS = [
  {
    id: "roofing",
    title: "Roofing Sheets",
    blurb: "Metal box profile, tile effect, insulated panels, clear polycarbonate and purlins.",
    cats: ["Metal roofing", "Clear roofing and flat sheets", "Purlins"],
    icon: "roof",
    photo: "cat-roofing",
  },
  {
    id: "decking",
    title: "Decking & Cladding",
    blurb: "Composite decking boards, wall cladding and the trims that finish them properly.",
    cats: ["Composite decking", "Composite wall cladding", "Stone wall cladding"],
    icon: "deck",
    photo: "cat-decking",
  },
  {
    id: "fencing",
    title: "Fencing & Gates",
    blurb: "Composite fence panels, V mesh systems, gates and posts for any boundary.",
    cats: ["Composite fencing", "V mesh fencing", "Gates"],
    icon: "fence",
    photo: "cat-fencing",
  },
  {
    id: "landscaping",
    title: "Granite & Landscaping",
    blurb: "Porcelain paving, granite kerbs, steps and garden rooms built to last.",
    cats: ["Porcelain paving", "Granite and landscaping", "Granite kerbs", "Granite steps",
           "Composite sheds and garden rooms"],
    icon: "stone",
    photo: "cat-landscaping",
  },
];

const ICONS = {
  roof: '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linejoin="round"><path d="M4 26 24 9l20 17"/><path d="M8 24v15h32V24"/><path d="M16 39V28h7v11"/></svg>',
  deck: '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linejoin="round"><path d="M5 14h38v26H5z"/><path d="M14 14v26M24 14v26M34 14v26"/><path d="M5 14 12 7h24l7 7"/></svg>',
  fence: '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linejoin="round"><path d="M10 42V14l5-6 5 6v28M28 42V14l5-6 5 6v28"/><path d="M4 20h40M4 30h40"/></svg>',
  stone: '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linejoin="round"><path d="M5 17h17v14H5zM26 17h17v14H26z"/><path d="M5 35h17v8H5zM26 35h17v8H26z"/><path d="M14 6h20v7H14z"/></svg>',
};

const ARROW = '<svg width="14" height="10" viewBox="0 0 14 10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M1 5h11M8.5 1.5 12 5l-3.5 3.5"/></svg>';

function esc(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, (ch) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]
  ));
}

function money(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "";
  return "£" + v.toLocaleString("en-GB", { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 });
}

/* ---------- header and footer ---------- */
const NAV = [
  ["index.html", "Home"],
  ["products.html", "Products"],
  ["calculator.html", "Quote Calculator"],
  ["about.html", "About"],
  ["contact.html", "Contact"],
];

function renderChrome() {
  const here = (location.pathname.split("/").pop() || "index.html").toLowerCase();
  const head = document.querySelector("[data-site-head]");
  if (head) {
    head.innerHTML = `<div class="shell head-row">
      <a class="brand" href="index.html">B&amp;C McKeown <span>Downpatrick</span></a>
      <nav class="nav" data-nav>
        ${NAV.map(([href, label]) => `<a href="${href}"${href.toLowerCase() === here ? ' aria-current="page"' : ""}>${esc(label)}</a>`).join("")}
        <a class="nav-tel" href="${SITE.telHref}">${esc(SITE.tel)}</a>
      </nav>
      <button class="burger" type="button" data-burger aria-label="Menu" aria-expanded="false"><i></i><i></i><i></i></button>
    </div>`;
    const burger = head.querySelector("[data-burger]");
    const nav = head.querySelector("[data-nav]");
    burger.addEventListener("click", () => {
      const open = nav.classList.toggle("open");
      burger.setAttribute("aria-expanded", open ? "true" : "false");
    });
  }

  const foot = document.querySelector("[data-site-foot]");
  if (foot) {
    foot.innerHTML = `<div class="shell">
      <div class="foot-grid">
        <div>
          <div class="foot-brand">B&amp;C McKeown</div>
          <p class="foot-note">Composite building products, roofing sheets and landscaping
            supplies, stocked and cut to size in ${esc(SITE.town)}.</p>
        </div>
        <div>
          <h4>Products</h4>
          <ul class="foot-links">
            ${PILLARS.map((p) => `<li><a href="products.html#${esc(p.id)}">${esc(p.title)}</a></li>`).join("")}
          </ul>
        </div>
        <div>
          <h4>Tools</h4>
          <ul class="foot-links">
            <li><a href="calculator.html">Roofing quote calculator</a></li>
            <li><a href="other.html">Other product calculators</a></li>
            <li><a href="products.html">Full product range</a></li>
          </ul>
        </div>
        <div>
          <h4>Get in touch</h4>
          <ul class="foot-links">
            <li><a href="${SITE.telHref}">${esc(SITE.tel)}</a></li>
            <li><a href="contact.html">Contact page</a></li>
            <li><a href="${SITE.shop}" rel="noopener">Online shop</a></li>
          </ul>
        </div>
      </div>
      <div class="foot-base">
        <span>&copy; ${new Date().getFullYear()} ${esc(SITE.legal)}. All rights reserved.</span>
        <span>Prices include VAT. Delivery charged separately.</span>
      </div>
    </div>`;
  }
}

/* ---------- product data ---------- */
function allProducts() {
  return typeof RANGE_EXTRAS === "undefined" ? [] : RANGE_EXTRAS;
}

function fromPrice(product) {
  const prices = (product.variants || [])
    .map((v) => Number(v.price))
    .filter((n) => Number.isFinite(n) && n > 0);
  return prices.length ? Math.min(...prices) : null;
}

function inStock(product) {
  return (product.variants || []).some((v) => Number(v.stock) > 0);
}

function pillarFor(category) {
  return PILLARS.find((p) => p.cats.includes(category)) || null;
}

function productCard(product) {
  const price = fromPrice(product);
  const stocked = inStock(product);
  const img = product.image
    ? `<img src="${esc(product.image)}" alt="${esc(product.name)}" loading="lazy" decoding="async">`
    : "";
  return `<article class="prod">
    <div class="prod-img">${img}</div>
    <div class="prod-body">
      <div class="prod-cat">${esc(product.category || "")}</div>
      <h4>${esc(product.name)}</h4>
      <div class="prod-foot">
        <span class="price">${price != null ? money(price) : "POA"}${price != null ? " <small>from</small>" : ""}</span>
        <span class="stock${stocked ? "" : " out"}">${stocked ? "In stock" : "Ask us"}</span>
      </div>
    </div>
  </article>`;
}

/* ---------- product listing page ---------- */
function renderProducts() {
  const mount = document.querySelector("[data-products]");
  if (!mount) return;
  const filterBar = document.querySelector("[data-filters]");
  const products = allProducts();

  const groups = PILLARS.map((p) => ({
    ...p,
    items: products.filter((item) => p.cats.includes(item.category)),
  })).filter((g) => g.items.length);

  if (filterBar) {
    filterBar.innerHTML = `<button class="chip on" data-filter="all" type="button">Everything (${products.length})</button>`
      + groups.map((g) => `<button class="chip" data-filter="${esc(g.id)}" type="button">${esc(g.title)} (${g.items.length})</button>`).join("");
  }

  function paint(filter) {
    const shown = filter === "all" ? groups : groups.filter((g) => g.id === filter);
    mount.innerHTML = shown.map((g) => `<section class="band" id="${esc(g.id)}" style="padding-top:0">
      <div class="band-head">
        <p class="eyebrow">${esc(g.items.length)} product${g.items.length === 1 ? "" : "s"}</p>
        <h2>${esc(g.title)}</h2>
        <p class="lede">${esc(g.blurb)}</p>
      </div>
      <div class="prod-grid">${g.items.map(productCard).join("")}</div>
    </section>`).join("")
      || `<p class="empty">Nothing in this section yet. Give us a ring on ${esc(SITE.tel)}.</p>`;
    revealAll();
  }

  paint("all");

  if (filterBar) {
    filterBar.addEventListener("click", (event) => {
      const btn = event.target.closest("[data-filter]");
      if (!btn) return;
      filterBar.querySelectorAll(".chip").forEach((c) => c.classList.toggle("on", c === btn));
      paint(btn.dataset.filter);
      if (btn.dataset.filter !== "all") history.replaceState(null, "", "#" + btn.dataset.filter);
    });
  }

  // land on the right section when arriving from a footer or card link
  const hash = location.hash.replace("#", "");
  if (hash) {
    const btn = filterBar && filterBar.querySelector(`[data-filter="${CSS.escape(hash)}"]`);
    if (btn) btn.click();
  }
}

/* ---------- homepage category grid ---------- */
function renderPillars() {
  const products = allProducts();
  const count = (p) => products.filter((item) => p.cats.includes(item.category)).length;

  // photo tiles
  const photoMount = document.querySelector("[data-pillars-photo]");
  if (photoMount) {
    photoMount.innerHTML = PILLARS.map((p) => `<a class="cat-photo" href="products.html#${esc(p.id)}">
      <picture>
        <source srcset="images/site/${esc(p.photo)}.webp" type="image/webp">
        <img src="images/site/${esc(p.photo)}.jpg" alt="${esc(p.title)}" loading="lazy" decoding="async" width="900" height="700">
      </picture>
      <span class="count">${count(p)}</span>
      <span class="cat-body">
        <h3>${esc(p.title)}</h3>
        <p>${esc(p.blurb)}</p>
        <span class="more">View range ${ARROW}</span>
      </span>
    </a>`).join("");
  }

  // plain icon tiles, used on inner pages
  const mount = document.querySelector("[data-pillars]");
  if (!mount) return;
  mount.innerHTML = PILLARS.map((p) => `<a class="cat" href="products.html#${esc(p.id)}">
      <span class="cat-ico">${ICONS[p.icon] || ""}</span>
      <h3>${esc(p.title)}</h3>
      <p>${esc(p.blurb)}</p>
      <span class="more">${count(p)} product${count(p) === 1 ? "" : "s"} ${ARROW}</span>
    </a>`).join("");
}

/* ---------- a short featured strip on the homepage ---------- */
function renderFeatured() {
  const mount = document.querySelector("[data-featured]");
  if (!mount) return;
  const picks = ["Metal roofing", "Composite decking", "Porcelain paving", "Composite fencing"];
  const chosen = [];
  picks.forEach((cat) => {
    const found = allProducts().filter((p) => p.category === cat && p.image);
    if (found.length) chosen.push(found[0]);
  });
  mount.innerHTML = chosen.map(productCard).join("");
}

/* ---------- scroll reveal ---------- */
let revealObserver = null;
function revealAll() {
  if (!("IntersectionObserver" in window)) {
    document.querySelectorAll(".rv").forEach((el) => el.classList.add("in"));
    return;
  }
  if (!revealObserver) {
    revealObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("in");
          revealObserver.unobserve(entry.target);
        }
      });
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
  }
  document.querySelectorAll(".rv:not(.in)").forEach((el) => revealObserver.observe(el));
}

/* ---------- contact form ---------- */
function wireContact() {
  const form = document.querySelector("[data-enquiry]");
  if (!form) return;
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const lines = [
      `Name: ${data.get("name") || ""}`,
      `Phone: ${data.get("phone") || ""}`,
      `Email: ${data.get("email") || ""}`,
      `Interested in: ${data.get("topic") || ""}`,
      "",
      String(data.get("message") || ""),
    ];
    // No server behind this page yet, so hand the enquiry to the mail client.
    const subject = encodeURIComponent(`Website enquiry — ${data.get("topic") || "General"}`);
    const body = encodeURIComponent(lines.join("\n"));
    window.location.href = `mailto:sales@bcmckeown.net?subject=${subject}&body=${body}`;
    const note = form.querySelector("[data-sent]");
    if (note) note.hidden = false;
  });
}

document.addEventListener("DOMContentLoaded", () => {
  renderChrome();
  renderPillars();
  renderFeatured();
  renderProducts();
  wireContact();
  revealAll();
});
