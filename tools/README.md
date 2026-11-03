# Shopify sync

`sync_shopify.py` keeps the site in step with the Shopify store, so adding or editing a
product in Shopify is enough: nobody needs to touch the website files.

## What it keeps up to date

| File | What changes |
|---|---|
| `range.js` | One entry per product: name, photos, category, option names, prices (**ex VAT**, like every other price here) and stock. Drives the Products page, the home page counts and the Products menu. |
| `product/*.html` | One page per product: photos, description, options, price. Rewritten only when something a visitor can see has changed. |
| `config.js` | The calculator's screw and cap prices (the extras that carry a `shopHandle`). |

## What it does on its own

* A **new product** gets a listing and a page. Its category is worked out from its Shopify
  collections, then its title. If nothing matches, it appears under **More products** on
  the Products page, and the run summary says `NEEDS A CATEGORY`.
* A product that is **already on the site keeps its category**. Categories were chosen by
  hand and cannot be derived from collections.
* A product **removed or unpublished** in Shopify loses its listing and page.
* **Hand-added "From our yard" galleries** on product pages are kept.
* Stock is stored **capped at 10**: the site only says "Only n left" up to 5, and a larger
  number would make every sale rewrite a page.

## What it does NOT do

* **Calculator sheet prices.** Prices for the sheets themselves (box profile per metre, tile
  effect, polycarbonate and so on) live in `config.js` and `jobs.js` and are maintained by
  hand. Only the screw and cap extras follow Shopify. If a sheet price changes in Shopify,
  the calculator's quote will not follow it until those files are edited.
* **Home page cards and tile photos.** Those are chosen pictures in `home-cards/` and
  `tile-*`. A new Shopify photo does not replace them.
* **The Products-page groups.** A brand-new kind of product shows under *More products*
  until it is added to `PILLARS` in `site.js` (and to `PILLARS` in `sync_shopify.py`).

## Safety

It stops and changes nothing if Shopify returns no products, or fewer than 80% of the
number the site already has, so a failed or partial answer cannot wipe the site.

## Running it

    python3 tools/sync_shopify.py --dry    # show what would change, write nothing
    python3 tools/sync_shopify.py          # update the files

Python 3.8+, standard library only. It uses Shopify's public Storefront token, the same one
`shopify.js` already ships to every visitor, so there is no secret to store.

## The schedule

`.github/workflows/sync-shopify.yml` runs it at 11 and 41 minutes past every hour, and on
demand from the **Actions** tab (*Sync from Shopify* → *Run workflow*). It commits to `main`
only when something changed. If a run fails, GitHub emails the repository owner.

GitHub switches scheduled workflows off after 60 days with no repository activity. Edits in
Shopify keep it alive; if it ever stops, re-enable it on the Actions tab.
