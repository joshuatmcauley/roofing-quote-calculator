# Euro Subframes — website

Static, mobile-first site for eurosubframes.com. Dark graphite palette with signal red,
built around an **engineering-drawing** visual language: hairline rules, corner
registration marks, chamfered panels, monospaced data and no decorative rounding.

Deploy: push to GitHub → Settings → Pages → main branch / root.

## Files

| Path | What it is |
|---|---|
| `index.html` | Home — hero, reg search, makes ticker, categories, part finder, best sellers, reviews |
| `shop.html` | Full catalogue: category filter, live search, sort |
| `products/*.html` | One page per product (133), generated from the live Shopify catalogue |
| `about.html`, `contact.html` | About and contact |
| `css/style.css` | Whole design system. Tokens live in `:root` at the top |
| `js/main.js` | Loader, nav, scroll reveals, shop filtering, gallery, reg lookup |
| `images/logo.svg` | Logo, traced to vector, red (white text for dark backgrounds) |
| `images/logo-on-white.svg` | Same logo with black text, for light backgrounds |

## Design tokens

Everything keys off custom properties in `css/style.css`:

```css
--red: #e30613;        /* signal red, from RH Auto Services */
--black / --graphite   /* surfaces */
--display: Michroma    /* headings */
--body: Barlow         /* copy */
--mono: JetBrains Mono /* all data: prices, counts, part numbers, specs */
```

The rule of thumb: **anything that is a measurement, a count or a code is set in mono.**
That is what gives the site its technical character — keep it if you extend the design.

## Loading screen

Home page only. An SVG subframe schematic draws itself (stroke-dashoffset), bushings pop
in, a scan line sweeps, then the panel wipes upward. Roughly 2.4s, then it removes itself
from the DOM. It is skipped on repeat visits in the same tab (`sessionStorage`) and for
anyone with "reduce motion" on. A hard timeout guarantees it never traps a visitor.

## Shopify

The site is a storefront; **Shopify still handles cart, checkout, payment and stock.**

- **Buy Now** → `/cart/{variantId}:{qty}` (straight to checkout)
- **Add to Cart** → `/cart/add?id={variantId}&quantity={qty}`
- Cart and policy links point at the live store.

⚠️ This assumes the Shopify store keeps the `eurosubframes.com` domain. If this site takes
that domain over, those links break — put this on `www` or move the shop to
`shop.eurosubframes.com`.

## Catalogue data

Product pages are a **snapshot** of the Shopify catalogue. They do not update themselves.
When products or prices change, the pages need regenerating.

Generated fields, derived from the Shopify titles and descriptions:

- **Year range** — parsed from the title (`2006-2016`, `05-11`, `05-2010`), shown as a chip
- **Part numbers** — parsed from the description, shown in the spec table
- **Display name** — the listing title with the year range, trailing part numbers and the
  `NEW ` prefix stripped, and SHOUTY CAPS normalised, so the grid stays scannable. The full
  original title is kept in `<title>`, the meta description, `alt` text and the search index.

## Known data issues (worth fixing in Shopify)

- Five listings look like accidental duplicates — handles ending `-1` / `-copy` or
  starting `copy-of-`: the Mazda MX5 brace bar pair, a Dodge Caliber rear subframe, a
  Mazda MX5 rear subframe, a Freelander 2 rear subframe and a Hyundai Tucson rear subframe.
- One title reads "FIOR TOYOTA RAV4" (should be "FOR"). The site corrects it on display,
  but the Shopify listing still has the typo.
- 36 of 133 products are marked sold out. Their pages swap the buy buttons for a
  "call to check availability" prompt.

## Registration search

The number-plate box on the home page is **UI only**. `js/main.js` → "Registration lookup"
has the hook marked with a `TODO`. It needs a small server-side proxy (API keys cannot live
in client-side JS). See the DVSA MOT History API route discussed separately.

## Images

Product and category photos are hot-linked:

- **Products** → the existing Shopify CDN (`cdn.shopify.com`)
- **Categories / hero / about** → Unsplash

To self-host, download them into `images/` and update the `src` paths.

## Contact form

Opens the visitor's mail app (`mailto:`). Swap for Formspree or Netlify Forms to receive
submissions directly. The form pre-fills the vehicle field from `?reg=` so the reg search
can hand off to it.
