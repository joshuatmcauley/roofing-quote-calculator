#!/usr/bin/env python3
"""Sync the site with the live Shopify catalogue.

What it does
  * range.js          one entry per product: name, photos, category, option names,
                      prices (EX VAT, like every other price in the repo) and stock.
  * product/*.html    one page per product, built from the same data.
  * config.js         the calculator's screw and cap prices (extras with a shopHandle).

Rules that keep it safe
  * A product that is already on the site keeps its category. Categories were chosen
    by hand and cannot be derived from Shopify collections, so only a NEW product is
    classified (collections first, then its title).
  * Hand-added "From our yard" galleries on product pages are kept.
  * Nothing is deleted unless Shopify answered with a plausible catalogue. A failed or
    partial answer stops the run with an error and changes nothing.

Run it from anywhere:   python3 tools/sync_shopify.py          (writes files)
                        python3 tools/sync_shopify.py --dry    (report only)
Python 3.8+, standard library only, so it runs on a plain GitHub runner.

The token is Shopify's PUBLIC Storefront token, the same one shopify.js ships to every
visitor. It can only read published products. It is not a secret.
"""
import argparse
import html
import json
import os
import re
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SHOP_DOMAIN = "a8f386-ad.myshopify.com"
SHOP_TOKEN = "789089ca76cb1e0faab9c2937dfecfb0"
API_VERSION = "2026-10"
SHOP_URL = "https://shop.bcmckeown.net"
VAT = 1.2                      # keep in step with company.vatPercent in config.js
MIN_KEEP = 0.8                 # refuse to run if Shopify returns fewer than 80% of what we have

QUERY = """query($after:String){ products(first:100, after:$after){
  pageInfo{hasNextPage endCursor}
  nodes{ id handle title descriptionHtml availableForSale
    options{name}
    collections(first:10){nodes{handle}}
    images(first:30){nodes{url width height}}
    variants(first:100){nodes{ id title availableForSale quantityAvailable price{amount} image{url} }} } } }"""

# collection handle -> site category, most specific first. Used for NEW products only.
COLLECTION_RULES = [
    ("composite-sheds-and-garden-rooms", "Composite sheds and garden rooms"),
    ("stone-wall-cladding", "Stone wall cladding"),
    ("composite-wall-cladding", "Composite wall cladding"),
    ("composite-decking", "Composite decking"),
    ("composite-fencing", "Composite fencing"),
    ("security-fencing-v-mesh-kits", "V mesh fencing"),
    ("security-fencing", "V mesh fencing"),
    ("mesh-gates", "Gates"),
    ("aluminium-gate-frames", "Gates"),
    ("granite-gate-post", "Gates"),
    ("granite-kerbs", "Granite kerbs"),
    ("granite-steps", "Granite steps"),
    ("c-purlin-cut-to-size", "Purlins"),
    ("metal-roof-cladding-collection", "Metal roofing"),
    ("roof-cladding", "Metal roofing"),
    ("box-profile-corrugated-cut-to-size", "Metal roofing"),
    ("sandwich-panel-roofing", "Metal roofing"),
    ("clear-roofing-sheets", "Clear roofing and flat sheets"),
    ("clear-roofing-collection", "Clear roofing and flat sheets"),
    ("polycarbonate-frp", "Clear roofing and flat sheets"),
    ("granite-paving", "Granite and landscaping"),
    ("granite", "Granite and landscaping"),
    ("paving", "Granite and landscaping"),
]
# a title wins over collections for these (screws and caps are in no collection)
TITLE_RULES = [
    (re.compile(r"\b(screws?|tek|fixings?|washers?|sealant|stitchers?|caps?)\b", re.I), "Accessories"),
]
# category -> (pillar id on products.html, pillar title). Mirrors PILLARS in site.js.
PILLARS = {
    "Metal roofing": ("roofing", "Roofing Sheets"),
    "Clear roofing and flat sheets": ("roofing", "Roofing Sheets"),
    "Purlins": ("roofing", "Roofing Sheets"),
    "Composite decking": ("decking", "Decking &amp; Cladding"),
    "Composite wall cladding": ("decking", "Decking &amp; Cladding"),
    "Stone wall cladding": ("decking", "Decking &amp; Cladding"),
    "Composite fencing": ("composite-fencing", "Composite Fencing"),
    "V mesh fencing": ("v-mesh-fencing-gates", "V Mesh Fencing &amp; Gates"),
    "Gates": ("v-mesh-fencing-gates", "V Mesh Fencing &amp; Gates"),
    "Porcelain paving": ("landscaping", "Granite &amp; Landscaping"),
    "Granite and landscaping": ("landscaping", "Granite &amp; Landscaping"),
    "Granite kerbs": ("landscaping", "Granite &amp; Landscaping"),
    "Granite steps": ("landscaping", "Granite &amp; Landscaping"),
    "Composite sheds and garden rooms": ("landscaping", "Granite &amp; Landscaping"),
    "Accessories": ("accessories", "Accessories"),
}
FALLBACK_CATEGORY = "Other"


# ---------------------------------------------------------------- Shopify
def fetch_catalogue():
    out, after = [], None
    while True:
        body = json.dumps({"query": QUERY, "variables": {"after": after}}).encode()
        req = urllib.request.Request(
            f"https://{SHOP_DOMAIN}/api/{API_VERSION}/graphql.json", body,
            {"Content-Type": "application/json", "X-Shopify-Storefront-Access-Token": SHOP_TOKEN,
             "User-Agent": "bcmckeown-site-sync"})
        data = json.load(urllib.request.urlopen(req, timeout=60))
        if data.get("errors"):
            raise SystemExit("Shopify returned errors: " + json.dumps(data["errors"])[:400])
        page = data["data"]["products"]
        out += page["nodes"]
        if not page["pageInfo"]["hasNextPage"]:
            return out
        after = page["pageInfo"]["endCursor"]


# ---------------------------------------------------------------- helpers
def money(n):
    return "£%d" % n if float(n) == int(float(n)) else "£%.2f" % float(n)


def ex_vat(inc):
    return round(float(inc) / VAT + 1e-9, 2)


def num(v):
    s = ("%.6f" % float(v)).rstrip("0").rstrip(".")
    return s if s else "0"


def esc(s):
    return html.escape(str(s), quote=True)


STOCK_CAP = 10   # the site shows "Only n left" up to 5 and "In stock" above, so a bigger number
                 # would only make every sale rewrite a page and a line of range.js


def stock_of(v):
    q = v.get("quantityAvailable")
    if isinstance(q, int):
        return min(max(q, 0), STOCK_CAP)
    return STOCK_CAP if v.get("availableForSale") else 0


def sized(url, w):
    return esc(url + ("&" if "?" in url else "?") + f"width={w}")


def nice_title(t):
    return re.sub(r"(?<=\d)MM\b", "mm", t)       # Shopify mixes 0.5MM and 0.6mm


def plain(html_text):
    html_text = re.sub(r"(?is)<(script|style)[^>]*>.*?</\1>", "", html_text or "")   # drop their contents too
    t = re.sub(r"<(br|/p|/h\d|/li)[^>]*>", " ", html_text, flags=re.I)
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", "", t))).strip()


# ---- description HTML: allow-list, so nothing from Shopify can inject script or styling
ALLOWED = {"p", "h3", "h4", "ul", "ol", "li", "strong", "b", "em", "i", "br", "a"}


def clean_html(raw):
    raw = raw or ""
    raw = re.sub(r"(?is)<(script|style)[^>]*>.*?</\1>", "", raw)
    raw = re.sub(r"(?i)<br\s*/?>\s*<br\s*/?>", "</p><p>", raw)            # blank line = new paragraph
    if not re.search(r"(?i)<(p|h\d|ul|ol)\b", raw):                         # plain text with <br>s
        raw = "<p>" + raw + "</p>"

    def fix(m):
        closing, tag, attrs = m.group(1), m.group(2).lower(), m.group(3)
        if tag == "h1" or tag == "h2":
            tag = "h3"
        if tag not in ALLOWED:
            return ""
        if closing:
            return f"</{tag}>"
        if tag == "a":
            h = re.search(r'href\s*=\s*"([^"]*)"', attrs, re.I)
            href = h.group(1) if h else ""
            if re.match(r"(?i)^(https?:|tel:|mailto:|/)", href):
                return f'<a href="{esc(href)}" rel="noopener">'
            return ""
        return f"<{tag}>"

    out = re.sub(r"<(/?)([a-zA-Z0-9]+)([^>]*)>", fix, raw)
    out = re.sub(r"<p>\s*(&nbsp;|\s)*</p>", "", out)
    return out.strip()


def category_for_new(product):
    for rx, cat in TITLE_RULES:
        if rx.search(product["title"]):
            return cat
    handles = [c["handle"] for c in product["collections"]["nodes"]]
    for h, cat in COLLECTION_RULES:
        if h in handles:
            return cat
    return FALLBACK_CATEGORY


# ---------------------------------------------------------------- range.js
RANGE_HEAD = "const RANGE_EXTRAS = "


def read_range():
    src = (ROOT / "range.js").read_text(encoding="utf-8").strip()
    assert src.startswith(RANGE_HEAD) and src.endswith(";"), "range.js is not in the expected shape"
    return json.loads(src[len(RANGE_HEAD):-1])


def write_range(entries):
    body = json.dumps(entries, separators=(",", ":"), ensure_ascii=False)
    (ROOT / "range.js").write_text(RANGE_HEAD + body + ";\n", encoding="utf-8")


def build_variants(existing, product):
    """Update prices and stock in place when the option set is unchanged (keeps the
    variant ids and names the calculator may rely on); rebuild if options changed."""
    sv = product["variants"]["nodes"]
    single = len(sv) == 1 and sv[0]["title"] == "Default Title"
    if existing:
        old = existing["variants"]
        if single and len(old) == 1:
            return [{**old[0], "price": ex_vat(sv[0]["price"]["amount"]), "stock": stock_of(sv[0])}]
        by_name = {v["name"].strip().lower(): v for v in old}
        if len(old) == len(sv) and all(v["title"].strip().lower() in by_name for v in sv):
            return [{**by_name[v["title"].strip().lower()], "price": ex_vat(v["price"]["amount"]),
                     "stock": stock_of(v)} for v in sv]
    h = product["handle"]
    return [{"id": f"{h}-{i}", "name": "Each" if single else v["title"],
             "price": ex_vat(v["price"]["amount"]), "packSize": 1, "stock": stock_of(v)}
            for i, v in enumerate(sv, 1)]


def merge_entries(current, catalogue):
    by_handle = {e["id"]: e for e in current}
    live = {p["handle"] for p in catalogue}
    result, added, updated, unclassified = [], [], [], []
    for p in catalogue:
        old = by_handle.get(p["handle"])
        imgs = [i["url"] for i in p["images"]["nodes"]]
        entry = {
            "id": p["handle"],
            "name": p["title"],
            "image": imgs[0] if imgs else "",
            "category": old["category"] if old else category_for_new(p),
            "profileIds": old.get("profileIds", []) if old else [],
            "variants": build_variants(old, p),
        }
        if len(imgs) > 1:
            entry["image2"] = imgs[1]
        if old is None:
            added.append(entry)
            if entry["category"] == FALLBACK_CATEGORY:
                unclassified.append(entry["name"])
        elif json.dumps(old, sort_keys=True) != json.dumps(entry, sort_keys=True):
            updated.append(entry)
        result.append(entry)
    removed = [e for e in current if e["id"] not in live]
    return result, added, updated, removed, unclassified


# ---------------------------------------------------------------- product pages
def related_cards(entry, entries):
    others = [e for e in entries if e["category"] == entry["category"] and e["id"] != entry["id"]][:3]
    cards = []
    for e in others:
        prices = [v["price"] for v in e["variants"] if v["price"] > 0]
        price = money(round(min(prices) * VAT + 1e-9, 2)) if prices else "POA"
        img = f'<img src="{sized(e["image"], 600)}" alt="{esc(e["name"])}" loading="lazy" decoding="async">' if e["image"] else ""
        cards.append(
            f'<article class="prod"><a class="prod-link" href="product/{esc(e["id"])}.html"><div class="prod-img">{img}</div>'
            f'<div class="prod-body"><div class="prod-cat">{esc(e["category"])}</div><h4>{esc(e["name"])}</h4>'
            f'<div class="prod-foot"><span class="price">{price}</span><span class="more-link">View →</span></div></div></a></article>')
    return "".join(cards)


def render_page(p, entry, entries, yard_html):
    h, title = p["handle"], p["title"]
    t = esc(title)
    images = [i["url"] for i in p["images"]["nodes"]]
    img_ids = {}
    sv = p["variants"]["nodes"]
    multi = not (len(sv) == 1 and sv[0]["title"] == "Default Title")
    prices = [float(v["price"]["amount"]) for v in sv]
    lo, hi = min(prices), max(prices)
    copy = clean_html(p["descriptionHtml"]) or "<p>Ask us for details on 02844 615148.</p>"
    blurb = plain(p["descriptionHtml"])[:220] or title
    category = entry["category"]
    pill_id, pill_title = PILLARS.get(category, ("other", "More products"))
    any_stock = any(stock_of(v) > 0 for v in sv)
    variants = []
    for v in sv:
        variants.append({"label": v["title"] if multi else "", "text": nice_title(v["title"]),
                         "price": float(v["price"]["amount"]), "stock": stock_of(v),
                         "image": (v.get("image") or {}).get("url", "")})
    first = variants[0]
    ld = {"@context": "https://schema.org", "@type": "Product", "name": title, "description": blurb,
          "image": images, "brand": {"@type": "Brand", "name": "B&C McKeown"}, "category": category,
          "offers": {"@type": "AggregateOffer", "priceCurrency": "GBP", "lowPrice": "%.2f" % lo,
                     "highPrice": "%.2f" % hi, "offerCount": len(variants),
                     "availability": "https://schema.org/" + ("InStock" if any_stock else "OutOfStock")}}
    thumbs = ""
    if len(images) > 1:
        thumbs = '<div class="pdp-thumbs">' + "".join(
            f'<button type="button" class="pdp-thumb{" is-on" if n == 0 else ""}" data-thumb="{n}" '
            f'aria-label="Show photo {n+1} of {len(images)}"><img src="{sized(u,160)}" alt="" loading="lazy"></button>'
            for n, u in enumerate(images)) + "</div>"
    lightbox = "".join(f'<a href="{sized(u,1600)}" data-lightbox="gallery" data-caption="{t}" hidden></a>' for u in images)
    if images:
        main = (f'<button type="button" class="pdp-main" data-open-gallery aria-label="Enlarge photo">'
                f'<img src="{sized(images[0],1000)}" alt="{t}" width="1000" height="1000" fetchpriority="high"></button>')
    else:
        main = '<div class="pdp-main"><div class="pdp-noimg">Photo coming soon</div></div>'
    legend = " / ".join(o["name"] for o in p.get("options", [])) or "Options"
    vfield = ""
    if multi:
        vfield = (f'<fieldset class="pdp-variants"><legend>{esc(legend)}</legend>' + "".join(
            f'<button type="button" class="pdp-variant{" is-on" if n == 0 else ""}" data-variant="{n}" '
            f'aria-pressed="{"true" if n == 0 else "false"}">{esc(v["text"])}</button>'
            for n, v in enumerate(variants)) + "</fieldset>")
    pdata = {"variants": [{"label": v["label"], "price": int(v["price"]) if v["price"] == int(v["price"]) else v["price"],
                           "stock": v["stock"], "image": v["image"]}
                          for v in variants], "images": images}
    tip = ('\n          <li>Not sure how many? The <a href="calculator.html">roofing calculator</a> '
           'suggests the screws and caps for your roof</li>') if category == "Accessories" else ""
    stock_cls, stock_txt = ("is-in", "In stock") if any_stock else ("is-out", "Out of stock online, call us for availability")
    og_img = f'\n  <meta property="og:image" content="{sized(images[0],1200)}">' if images else ""
    return f'''<!DOCTYPE html>
<html lang="en-GB">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <base href="../">
  <title>{t} | B&amp;C McKeown, Downpatrick</title>
  <meta name="description" content="{esc(blurb)}">
  <meta property="og:type" content="product">
  <meta property="og:title" content="{t}">
  <meta property="og:description" content="{esc(blurb)}">{og_img}
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600&family=Teko:wght@500;600&display=swap">
  <link rel="stylesheet" href="site.css">
  <script type="application/ld+json">{json.dumps(ld, ensure_ascii=False).replace("</", "<\\/")}</script>
  <script src="intro.js"></script>
</head>
<body data-page="product">
<header class="site-head" data-site-head></header>
<main class="pdp" data-product="{esc(h)}">
  <div class="shell">
    <p class="crumb pdp-crumb"><a href="index.html">Home</a> › <a href="products.html">Products</a> › <a href="products.html#{pill_id}">{pill_title}</a> › <span>{t}</span></p>
    <section class="pdp-top">
      <div class="pdp-gallery">
        {main}
        {thumbs}
        {lightbox}
      </div>
      <div class="pdp-info">
        <p class="eyebrow">{esc(category)}</p>
        <h1 class="pdp-title">{t}</h1>
        <div class="pdp-price"><strong data-price>{money(first["price"])}</strong><span class="pdp-vat">inc VAT</span></div>
        {vfield}
        <p class="pdp-stock {stock_cls}" data-stock>{stock_txt}</p>
        <div class="pdp-actions">
          <a class="btn pdp-buy" href="{SHOP_URL}/products/{esc(h)}" rel="noopener">Buy online</a>
          <button type="button" class="paypal-btn" data-action="paypal-placeholder" data-id="{esc(h)}">
            <span class="paypal-label">Buy with <b>Pay</b><b class="pp-pal">Pal</b></span>
            <span class="paypal-soon">Coming soon</span>
          </button>
          <p class="paypal-note" data-note hidden>Online payment here isn’t switched on yet. Use Buy online, or ring <a href="tel:+442844615148">02844 615148</a>.</p>
          <a class="btn ghost" href="tel:+442844615148">Call 02844 615148</a>

        </div>
        <ul class="pdp-points">
          <li>Collect from the yard in Downpatrick, or ask about delivery</li>
          <li>Advice from people who stock it and fit it</li>{tip}
        </ul>
      </div>
    </section>
    <section class="pdp-desc"><h2>About this product</h2><div class="pdp-copy">{copy}</div></section>
  </div>
  {yard_html}<section class="band"><div class="shell"><div class="band-head"><p class="eyebrow">You might also need</p><h2>Related products</h2></div><div class="prod-grid">{related_cards(entry, entries)}</div></div></section>
</main>
<footer class="site-foot" data-site-foot></footer>
<script type="application/json" id="product-data">{json.dumps(pdata, ensure_ascii=False).replace("</", "<\\/")}</script>
<script src="range.js"></script>
<script src="site.js"></script>
</body>
</html>
'''


def visible_state_of_page(text):
    """What a visitor can see on an existing page, read back from the page itself."""
    try:
        data = json.loads(re.search(r'id="product-data">(.*?)</script>', text, re.S).group(1))
        title = html.unescape(re.search(r'<h1 class="pdp-title">(.*?)</h1>', text, re.S).group(1))
        cat = html.unescape(re.search(r'<p class="eyebrow">([^<]*)</p>', text).group(1))
        copy = re.search(r'<div class="pdp-copy">(.*?)</div></section>', text, re.S).group(1)
    except (AttributeError, ValueError):
        return None
    return {"title": title, "category": cat, "copy": plain(copy), "images": data["images"],
            "variants": [(v["label"], round(float(v["price"]), 2), min(int(v["stock"]), 1) if int(v["stock"]) > 5 else int(v["stock"]),
                          v["image"]) for v in data["variants"]]}


def visible_state_of_product(p, entry):
    sv = p["variants"]["nodes"]
    multi = not (len(sv) == 1 and sv[0]["title"] == "Default Title")
    return {"title": p["title"], "category": entry["category"], "copy": plain(clean_html(p["descriptionHtml"])),
            "images": [i["url"] for i in p["images"]["nodes"]],
            # must match what render_page() writes into the page, or a page would look
            # changed on every run
            "variants": [(v["title"] if multi else "", round(float(v["price"]["amount"]), 2),
                          min(stock_of(v), 1) if stock_of(v) > 5 else stock_of(v),
                          (v.get("image") or {}).get("url", ""))
                         for v in sv]}


YARD_RX = re.compile(r'<section class="band wash pdp-yard">.*?</section>\s*', re.S)


def write_pages(catalogue, entries, dry):
    by_entry = {e["id"]: e for e in entries}
    changed, created = [], []
    for p in catalogue:
        path = ROOT / "product" / f"{p['handle']}.html"
        yard = ""
        if path.exists():
            m = YARD_RX.search(path.read_text(encoding="utf-8"))
            yard = (m.group(0).rstrip() + "\n  ") if m else ""
        old = path.read_text(encoding="utf-8") if path.exists() else None
        if old is not None and visible_state_of_page(old) == visible_state_of_product(p, by_entry[p["handle"]]):
            continue                      # nothing a visitor can see has changed: leave the page alone
        new = render_page(p, by_entry[p["handle"]], entries, yard)
        if old == new:
            continue
        (created if old is None else changed).append(p["handle"])
        if not dry:
            path.write_text(new, encoding="utf-8")
    return created, changed


# ---------------------------------------------------------------- calculator extras
def sync_extras(catalogue, dry):
    """Screws and caps in config.js carry a shopHandle; keep their prices in step."""
    path = ROOT / "config.js"
    src = path.read_text(encoding="utf-8")
    by = {p["handle"]: p for p in catalogue}
    notes = []

    def fix(m):
        handle = m.group(1)
        p = by.get(handle)
        if not p:
            notes.append(f"{handle}: no longer on Shopify (left as is)")
            return m.group(0)
        # the calculator keeps 6 decimals so a 7.00 cap pack stays exactly 7.00 inc VAT
        want = num(round(float(p["variants"]["nodes"][0]["price"]["amount"]) / VAT, 6))
        block = m.group(0)
        pm = re.search(r"price:\s*([0-9.]+)", block)
        if pm and abs(float(pm.group(1)) - float(want)) > 0.000002:
            notes.append(f"{handle}: calculator price {pm.group(1)} -> {want} (ex VAT)")
            block = block[:pm.start(1)] + want + block[pm.end(1):]
        return block

    new = re.sub(r'shopHandle:\s*"([^"]+)"[\s\S]*?price:\s*[0-9.]+', fix, src)
    if new != src and not dry:
        path.write_text(new, encoding="utf-8")
    return notes


# ---------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry", action="store_true", help="report what would change, write nothing")
    ap.add_argument("--from-json", help="use a saved catalogue instead of calling Shopify (for tests)")
    args = ap.parse_args()

    catalogue = json.load(open(args.from_json)) if args.from_json else fetch_catalogue()
    current = read_range()
    if not catalogue:
        raise SystemExit("Shopify returned no products. Changing nothing.")
    if len(catalogue) < MIN_KEEP * len(current):
        raise SystemExit(f"Shopify returned {len(catalogue)} products but the site has {len(current)}. "
                         "That looks like a failed or partial answer, so nothing was changed.")

    entries, added, updated, removed, unclassified = merge_entries(current, catalogue)
    created, changed = write_pages(catalogue, entries, args.dry)
    extras = sync_extras(catalogue, args.dry)
    if not args.dry:
        write_range(entries)
        live = {p["handle"] for p in catalogue}
        for e in removed:
            f = ROOT / "product" / f"{e['id']}.html"
            if f.exists():
                f.unlink()

    lines = [f"Shopify catalogue: {len(catalogue)} products (site had {len(current)})."]
    if added:
        lines.append("Added: " + "; ".join(f"{e['name']} [{e['category']}]" for e in added))
    if removed:
        lines.append("Removed: " + "; ".join(e["name"] for e in removed))
    if updated:
        lines.append(f"Updated {len(updated)} listing(s): " + "; ".join(e["name"][:40] for e in updated[:12])
                     + (" ..." if len(updated) > 12 else ""))
    if created or changed:
        lines.append(f"Product pages: {len(created)} new, {len(changed)} rewritten.")
    lines += ["Calculator: " + n for n in extras]
    if unclassified:
        lines.append("NEEDS A CATEGORY (shown under 'More products'): " + "; ".join(unclassified))
    if len(lines) == 1:
        lines.append("Nothing to change.")
    print("\n".join(lines))
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as f:
            f.write("### Shopify sync\n\n" + "\n\n".join(lines) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
