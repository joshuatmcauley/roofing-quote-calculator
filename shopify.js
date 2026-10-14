/* B&C McKeown <-> Shopify (Storefront API)

   Live prices and stock on product pages, a basket, and Shopify's own checkout.
   Shopify still does payments, receipts, stock and orders; this site only reads
   products and builds a cart.

   The token below is the PUBLIC Storefront API token. It is meant to be visible
   in website code. Never put the private token in this file.

   Delete this file and the site goes back to static prices and "Buy online".
   Add ?shopdebug to any page address to see what the connection is doing. */
(function () {
  "use strict";

  var SHOP = {
    domain: "a8f386-ad.myshopify.com",
    token: "789089ca76cb1e0faab9c2937dfecfb0",
    version: "2026-10",
    country: "GB"            // prices in GBP; the shop also sells in EUR to Ireland
  };
  var CART_KEY = "bcCartId";
  var DEBUG = /[?&]shopdebug\b/.test(location.search);

  /* ---------- small helpers ---------- */
  function log(msg, bad) {
    if (window.console) console[bad ? "warn" : "log"]("[shop] " + msg);
    if (!DEBUG) return;
    var box = document.getElementById("shop-debug");
    if (!box) {
      box = document.createElement("div");
      box.id = "shop-debug";
      box.style.cssText = "position:fixed;left:8px;right:8px;bottom:8px;z-index:2000;max-height:40vh;overflow:auto;" +
        "background:#111;color:#e6e6e6;font:12px/1.45 ui-monospace,Menlo,monospace;padding:10px 12px;border-radius:8px;opacity:.95";
      document.body.appendChild(box);
    }
    var line = document.createElement("div");
    line.style.color = bad ? "#ff9b9b" : "#9bffb4";
    line.textContent = msg;
    box.appendChild(line);
  }
  function fmt(amount) {
    var n = Number(amount);
    if (typeof window.money === "function") return window.money(n);
    return "£" + n.toFixed(2);
  }
  function e(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function store(key, val) {
    try {
      if (val === undefined) return window.localStorage.getItem(key);
      if (val === null) window.localStorage.removeItem(key); else window.localStorage.setItem(key, val);
    } catch (err) { return null; }
    return null;
  }

  /* ---------- the API ---------- */
  function gql(query, variables) {
    var ctrl = typeof AbortController === "function" ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 9000) : null;
    return fetch("https://" + SHOP.domain + "/api/" + SHOP.version + "/graphql.json", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Storefront-Access-Token": SHOP.token },
      body: JSON.stringify({ query: query, variables: variables || {} }),
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (res) {
      if (timer) clearTimeout(timer);
      if (!res.ok) throw new Error("Shopify answered " + res.status + (res.status === 401 || res.status === 403 ? " (token or permissions)" : ""));
      return res.json();
    }).then(function (json) {
      if (json.errors && json.errors.length) {
        var err = new Error(json.errors.map(function (x) { return x.message; }).join("; "));
        err.partial = json.data;
        throw err;
      }
      return json.data;
    });
  }

  var VARIANT_FIELDS = "id title availableForSale price { amount currencyCode }";
  function productQuery(withQty) {
    return "query P($h: String!) @inContext(country: " + SHOP.country + ") { product(handle: $h) { id title " +
      "variants(first: 100) { nodes { " + VARIANT_FIELDS + (withQty ? " quantityAvailable" : "") + " } } } }";
  }
  // Exact stock counts need the inventory permission; if it is missing, carry on without them.
  function fetchProduct(handle) {
    return gql(productQuery(true), { h: handle }).catch(function (err) {
      if (/quantityAvailable|inventory/i.test(err.message)) {
        log("No permission for exact stock counts, showing in stock / out of stock instead", true);
        return gql(productQuery(false), { h: handle });
      }
      throw err;
    }).then(function (data) { return data && data.product; });
  }

  var CART_FIELDS = "id checkoutUrl totalQuantity cost { subtotalAmount { amount currencyCode } } " +
    "lines(first: 100) { nodes { id quantity cost { totalAmount { amount } } merchandise { ... on ProductVariant { " +
    "id title price { amount } product { title handle featuredImage { url } } } } } }";
  var IN_GB = "@inContext(country: " + SHOP.country + ")";

  function cartId() { return store(CART_KEY); }
  function getCart() {
    var id = cartId();
    if (!id) return Promise.resolve(null);
    return gql("query C($id: ID!) " + IN_GB + " { cart(id: $id) { " + CART_FIELDS + " } }", { id: id })
      .then(function (d) {
        if (!d.cart) { store(CART_KEY, null); return null; }   // finished or expired cart
        return d.cart;
      });
  }
  function userErrors(payload) {
    if (payload && payload.userErrors && payload.userErrors.length) throw new Error(payload.userErrors.map(function (u) { return u.message; }).join("; "));
    return payload.cart;
  }
  function addLines(lines) {
    return getCart().then(function (cart) {
      if (!cart) {
        return gql("mutation A($lines: [CartLineInput!]!) " + IN_GB + " { cartCreate(input: { lines: $lines }) { cart { " +
          CART_FIELDS + " } userErrors { message } } }", { lines: lines }).then(function (d) {
          var c = userErrors(d.cartCreate);
          store(CART_KEY, c.id);
          return c;
        });
      }
      return gql("mutation A($id: ID!, $lines: [CartLineInput!]!) " + IN_GB + " { cartLinesAdd(cartId: $id, lines: $lines) { cart { " +
        CART_FIELDS + " } userErrors { message } } }", { id: cart.id, lines: lines }).then(function (d) { return userErrors(d.cartLinesAdd); });
    });
  }
  function updateLine(lineId, qty) {
    var id = cartId();
    if (qty <= 0) {
      return gql("mutation R($id: ID!, $l: [ID!]!) " + IN_GB + " { cartLinesRemove(cartId: $id, lineIds: $l) { cart { " +
        CART_FIELDS + " } userErrors { message } } }", { id: id, l: [lineId] }).then(function (d) { return userErrors(d.cartLinesRemove); });
    }
    return gql("mutation U($id: ID!, $lines: [CartLineUpdateInput!]!) " + IN_GB + " { cartLinesUpdate(cartId: $id, lines: $lines) { cart { " +
      CART_FIELDS + " } userErrors { message } } }", { id: id, lines: [{ id: lineId, quantity: qty }] }).then(function (d) { return userErrors(d.cartLinesUpdate); });
  }

  /* ---------- basket button + drawer ---------- */
  var drawer = null, countEl = null, lastCart = null;
  function mountBasket() {
    var row = document.querySelector(".site-head .head-row");
    if (!row || row.querySelector(".cart-btn")) return;
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "cart-btn";
    btn.setAttribute("aria-label", "Basket");
    btn.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 4h2l2.4 11.2a1 1 0 0 0 1 .8h9.2a1 1 0 0 0 1-.8L20.5 8H6.2"/>' +
      '<circle cx="9.5" cy="20" r="1.3"/><circle cx="17" cy="20" r="1.3"/></svg><span class="cart-count" hidden>0</span>';
    var burger = row.querySelector(".burger");
    row.insertBefore(btn, burger || null);
    countEl = btn.querySelector(".cart-count");
    btn.addEventListener("click", function () { openDrawer(); });

    drawer = document.createElement("aside");
    drawer.className = "cart-drawer";
    drawer.setAttribute("aria-label", "Basket");
    drawer.innerHTML = '<div class="cart-panel" role="dialog" aria-modal="true" aria-labelledby="cart-title">' +
      '<div class="cart-head"><h2 id="cart-title">Basket</h2><button type="button" class="cart-close" aria-label="Close basket">×</button></div>' +
      '<div class="cart-body"></div></div>';
    document.body.appendChild(drawer);
    drawer.addEventListener("click", function (ev) {
      if (ev.target === drawer || ev.target.closest(".cart-close")) closeDrawer();
      var step = ev.target.closest("[data-line-step]");
      if (step) {
        var line = (lastCart && lastCart.lines.nodes || []).filter(function (l) { return l.id === step.dataset.line; })[0];
        if (!line) return;
        setBusy(true);
        updateLine(line.id, line.quantity + Number(step.dataset.lineStep)).then(render).catch(fail);
      }
    });
    document.addEventListener("keydown", function (ev) { if (ev.key === "Escape" && drawer.classList.contains("is-open")) closeDrawer(); });
  }
  function setBusy(on) { if (drawer) drawer.classList.toggle("is-busy", on); }
  function fail(err) {
    setBusy(false);
    log(err.message, true);
    var body = drawer && drawer.querySelector(".cart-body");
    if (body) body.insertAdjacentHTML("afterbegin", '<p class="cart-error">Something went wrong updating the basket. Please try again, or ring 02844 615148.</p>');
  }
  function render(cart) {
    setBusy(false);
    lastCart = cart;
    var n = cart ? cart.totalQuantity : 0;
    if (countEl) { countEl.textContent = n; countEl.hidden = !n; }
    if (!drawer) return;
    var body = drawer.querySelector(".cart-body");
    var lines = cart ? cart.lines.nodes : [];
    if (!lines.length) {
      body.innerHTML = '<p class="cart-empty">Your basket is empty.</p><a class="btn ghost" href="products.html">Browse products</a>';
      return;
    }
    body.innerHTML = '<ul class="cart-lines">' + lines.map(function (l) {
      var v = l.merchandise, p = v.product || {};
      var img = p.featuredImage ? '<img src="' + e(p.featuredImage.url + (p.featuredImage.url.indexOf("?") > -1 ? "&" : "?") + "width=160") + '" alt="">' : "";
      var opt = v.title && v.title !== "Default Title" ? '<span class="cart-opt">' + e(v.title) + "</span>" : "";
      return '<li class="cart-line"><a class="cart-img" href="product/' + e(p.handle) + '.html">' + img + '</a>' +
        '<div class="cart-info"><a href="product/' + e(p.handle) + '.html">' + e(p.title) + "</a>" + opt +
        '<div class="cart-qty"><button type="button" data-line="' + e(l.id) + '" data-line-step="-1" aria-label="One fewer">−</button>' +
        "<span>" + l.quantity + "</span>" +
        '<button type="button" data-line="' + e(l.id) + '" data-line-step="1" aria-label="One more">+</button></div></div>' +
        '<strong class="cart-price">' + fmt(l.cost.totalAmount.amount) + "</strong></li>";
    }).join("") + "</ul>" +
      '<div class="cart-foot"><div class="cart-sub"><span>Subtotal</span><strong>' + fmt(cart.cost.subtotalAmount.amount) + "</strong></div>" +
      '<p class="cart-note">Prices include VAT. Delivery is worked out at checkout.</p>' +
      '<a class="btn cart-checkout" href="' + e(cart.checkoutUrl) + '">Go to checkout</a></div>';
  }
  function openDrawer() {
    if (!drawer) return;
    drawer.classList.add("is-open");
    document.body.style.overflow = "hidden";
    var c = drawer.querySelector(".cart-close"); if (c) c.focus();
  }
  function closeDrawer() {
    if (!drawer) return;
    drawer.classList.remove("is-open");
    document.body.style.overflow = "";
  }

  /* ---------- product pages ---------- */
  function norm(s) {
    s = String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
    return s === "default title" ? "" : s;
  }
  function setupProduct() {
    var root = document.querySelector("[data-product]");
    var dataEl = document.getElementById("product-data");
    if (!root || !dataEl) return;
    var handle = root.getAttribute("data-product");
    var local;
    try { local = JSON.parse(dataEl.textContent); } catch (err) { return; }

    fetchProduct(handle).then(function (product) {
      if (!product) {
        log("Product '" + handle + "' not found. Is it published to the Headless channel?", true);
        return;
      }
      // match each variant on this page to Shopify's by its option names
      var live = local.variants.map(function (v) {
        var want = norm(v.label);
        return product.variants.nodes.filter(function (n) { return norm(n.title) === want; })[0] || null;
      });
      if (local.variants.length === 1 && !live[0] && product.variants.nodes.length === 1) live[0] = product.variants.nodes[0];
      var matched = live.filter(Boolean).length;
      log("Connected: " + product.title + ", " + matched + " of " + local.variants.length + " options matched");
      if (!matched) { log("No options matched, keeping the static page", true); return; }

      var priceEl = root.querySelector("[data-price]");
      var stockEl = root.querySelector("[data-stock]");
      var buttons = Array.prototype.slice.call(root.querySelectorAll("[data-variant]"));
      function selected() {
        var on = root.querySelector("[data-variant].is-on");
        return on ? Number(on.getAttribute("data-variant")) : 0;
      }
      function showStock(v) {
        if (!stockEl) return;
        var q = v.quantityAvailable;
        var cls, txt;
        if (!v.availableForSale) { cls = "out"; txt = "Out of stock online, call us for availability"; }
        else if (typeof q === "number" && q > 0 && q <= 5) { cls = "low"; txt = "Only " + q + " left"; }
        else { cls = "in"; txt = "In stock"; }
        stockEl.className = "pdp-stock is-" + cls;
        stockEl.textContent = txt;
      }
      function refresh() {
        var v = live[selected()];
        if (!v) return;
        if (priceEl) priceEl.textContent = fmt(v.price.amount);
        showStock(v);
        if (addBtn) {
          addBtn.disabled = !v.availableForSale;
          addBtn.textContent = v.availableForSale ? "Add to basket" : "Out of stock";
        }
      }
      // mark sold-out options without hiding them
      buttons.forEach(function (b) {
        var v = live[Number(b.getAttribute("data-variant"))];
        if (v && !v.availableForSale) b.classList.add("is-soldout");
        b.addEventListener("click", function () { setTimeout(refresh, 0); });
      });

      // swap the placeholder buttons for a real basket
      var actions = root.querySelector(".pdp-actions");
      var addBtn = null;
      if (actions) {
        var wrap = document.createElement("div");
        wrap.className = "pdp-add";
        wrap.innerHTML = '<label class="pdp-qty"><span>Qty</span><input type="number" min="1" max="999" value="1" inputmode="numeric"></label>' +
          '<button type="button" class="btn pdp-add-btn">Add to basket</button>';
        actions.insertBefore(wrap, actions.firstChild);
        addBtn = wrap.querySelector(".pdp-add-btn");
        var qtyIn = wrap.querySelector("input");
        ["pdp-buy", "paypal-btn", "paypal-note"].forEach(function (c) {
          var el = actions.querySelector("." + c); if (el) el.hidden = true;
        });
        addBtn.addEventListener("click", function () {
          var v = live[selected()];
          if (!v || !v.availableForSale) return;
          var qty = Math.max(1, Math.min(999, parseInt(qtyIn.value, 10) || 1));
          addBtn.disabled = true;
          addBtn.textContent = "Adding…";
          addLines([{ merchandiseId: v.id, quantity: qty }]).then(function (cart) {
            render(cart);
            addBtn.textContent = "Added";
            setTimeout(refresh, 1200);
            openDrawer();
          }).catch(function (err) {
            log("Add to basket failed: " + err.message, true);
            addBtn.textContent = "Couldn't add, try again";
            setTimeout(refresh, 2500);
          }).then(function () { addBtn.disabled = false; });
        });
      }
      refresh();
    }).catch(function (err) {
      log("Could not reach Shopify: " + err.message + ". Showing saved prices instead.", true);
    });
  }

  function start() {
    mountBasket();
    getCart().then(render).catch(function (err) { log("Basket: " + err.message, true); render(null); });
    setupProduct();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
