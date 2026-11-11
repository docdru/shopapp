<!--
Snapshot of the living spec. Source of truth: https://claude.ai/artifact/DPjmRyRE4V32geGviEx4hQ
Exported 2026-11-10 (spec rev 55, plus the rename in v0.12.2; the author mention is left out). Refresh this file whenever the spec changes; see docs/README.md.
-->

# ShopApp – Spec

Oct 23, 2026

## Purpose & principles

A self-hosted family app that makes the shopping list effortless and keeps household basics (detergent, shampoo, milk) from running out. Recipes stay in Paprika 3 for now; a meal planner may follow later.

- **One input field** – type to find a known item. Unknown text is added **just this once** by default, or saved as a new item type.
- **Stock as state, not counts** – each tracked item is *ok*, *low* or *out*. "Used the last one" puts it on the list automatically.
- **Store-aware** – items know where to buy them and where *not* to buy them, and why.
- **Products under each item** – specific products (brand + pack size) can be marked *preferred*, *OK* or *don't buy*, overall or per store, with a price per store. All optional, but visible while shopping.
- **Bought is not the same as not needed** – separate actions; only *bought* counts as a purchase.
- **Log everything quietly** – every add, purchase, removal and use-up is recorded to drive later suggestions.
- **Types first, products behind them** – the list shows "Shampoo"; products (and later barcodes) map onto that one type.
- **Family-sized** – a few users, one household, no admin overhead.

## Scope by phase

Phase 1 is the whole MVP; everything after it waits until the list and inventory feel right in daily use.

| Phase | Contents | Status |
| --- | --- | --- |
| 1 – MVP | Shopping list, item types, categories, stores (preferred / avoid + reason), simple stock (ok/low/out), **products per item with verdicts and per-store prices, price check while shopping**, **one-off entries**, **separate Bought / Not needed**, event log, multi-user sync, installable PWA | Live in the app (v0.12), prototype v0.12. Not in the app yet: the products & prices table and "when you buy" price in the entry sheet |
| 2 – Suggestions | "Usually buy" suggestions from the log (e.g. milk every few days), "low items at this store" | Live in the app (v0.10) |
| 3 – Barcode | Scan to add to list or mark used / bought; barcode → product (products already exist from phase 1); lookup via Open Food Facts / Open Beauty Facts | Planned |
| 4 – Photo | Recognise a product from a photo and map it to a product or type (products already have photos since v0.11) | Idea |
| 5 – Recipes & meals | Meal planner; recipe ingredients to list; link or import from Paprika | Idea |
| 6 – Automatic prices | Online price sources, receipt scanning, price alerts – UX still open | Idea |

## Data model

The **ItemType** is the centre: list entries, stock, store rules and (later) barcodes all point at it. Products are part of the MVP; barcodes attach to products in phase 3.

| Entity | Key fields | Notes |
| --- | --- | --- |
| ItemType | name, category, default unit, trackStock (bool), stockState (ok / low / out), aliases | "Milk", "Detergent". Aliases help search ("Waschmittel" → Detergent). |
| Category | name, sort order | Groups the list in aisle order (Dairy, Drugstore, Cleaning…). |
| Store | name, type, sort order | "dm", "Edeka", "Weekly market", "Online". |
| ItemStore | itemType, store, rule (preferred / avoid), reason | e.g. Bread – avoid at Aldi – "kids don't like it". |
| Product | itemType, name (brand + variant), packSize, verdict (preferred / ok / don't buy), reason, photo (optional), barcode (phase 3) | Many products → one item type. Pack size ("1 kg", "60 tabs", "20 loads") gives a price per unit. The photo shows which pack to grab. |
| ProductStore | product, store, lastPrice, priceSeenAt, dontBuyHere, reason | Price per store plus a store-specific verdict ("too pricey here"). Updated when someone records a price at purchase. |
| ListEntry | itemType **or** free text (one-off), optional specific product, optional store (one-offs only: “Buy at”), quantity + unit, note, addedBy, addedAt, state (open / bought), fromStock | One open entry per item type and product (generic and specific entries of the same item can coexist); adding again bumps quantity. One-off entries have no item type and disappear when cleared or removed. |
| Event | type (added / bought / not needed / used up / stock changed / created / edited), itemType + its name at the time (or one-off text), product?, store?, price?, quantity, detail (e.g. new stock state), user, timestamp | Append-only. Purchases with a price update ProductStore. One-offs never feed suggestions. |
| User | name, colour | Family members, one login each. Every record belongs to a household. |

Stock rules: marking an item *out* (or *low*, if the item opts in) adds it to the list. *Bought* sets stock back to *ok* and logs a purchase. *Not needed* removes the entry and logs that, without touching stock or purchase history.

Store filter rules: an entry shows under a store if the item prefers that store or has a product sold there that isn't marked *don't buy*. It moves to "Better elsewhere" if the item, or every product available there, is marked *don't buy* at that store. A one-off with a “Buy at” store shows only there; one-offs without a store show under every store. An item known only at other stores (by its rules or its products) is hidden behind “N more items for other stores”. The selected store is remembered per device, and Bought records it in the log.

Clear store: an entry has a clear store where the item is marked *Buy here*, where a *preferred* product is sold (not “not here”), where its specific product is sold, or, for a one-off, its “Buy at” store. A store marked *Not here* never counts. A store that only sells an *OK* product doesn't count. Entries without any clear store are “Other”: they have their own **Other** chip, and at a store they're listed below that store's entries under “Other · no clear store”. A store gets a chip only if something on the list has it as a clear store and can be bought there (the selected store keeps its chip, so it doesn't vanish while you shop). Other has a chip only while such entries exist.

## Screens & flows

Four tabs on a phone-first layout: **List**, **Stock**, **Items**, **Log**. The prototype implements all four with sample data.

**List**

- Search-or-add field at the top. Matches show as you type. Unknown text: Enter or "Add just this once" adds a one-off entry; "Save as an item…" opens the quick sheet.
- Store chips (All · dm · Edeka · … · Other) filter the list to what to buy here. Only stores with something on the list get a chip, and Other shows entries without a clear store (see the store filter rules). At a store, entries without a clear store follow in a muted “Other · no clear store” group; entries ruled out there go to a **Better elsewhere** group with the reason; items meant for other stores hide behind "N more items for other stores".
- Each row shows quantity, note and badges, not who added it (the Log has that). A product photo shows as a small thumbnail: always for a specific product, and with a store selected for the product to get there. The entry sheet shows it larger. With All selected: the stores the item is known at, those selling a preferred product in green and bold. With a store selected: every preferred product sold there, with its price there.
- Specific products: a product can go on the list itself. Typing its name in the add field offers it, or in an entry's sheet “Which one?” switches between Any and a product (merging with an existing entry for it). Its row is inverted: product name as title, the item as a small tag, a green bar on the left. It can sit next to the generic item. With a store selected it only shows where it's sold (“not here” → Better elsewhere), with its price; with All, the cheapest of its stores is green and bold.
- Each row has a **Bought** button. Bought entries move to "In the cart" with Undo until "Clear cart".
- Tapping a row opens its detail sheet: quantity, note, a **products & prices** table (all stores, price per unit, date seen, don't-buy struck through, cheapest highlighted), optional "when you buy" store / product / price, and the actions **Not needed** and **Bought**. Quantity stops at 1; removing is always "Not needed".
- One-off entries carry a "one-off" badge; their sheet has Buy at chips (Any · each store · + New store; Any is the default) and offers "Save as an item for the future" (which drops the Buy at store, since the item's rules apply then). With All, a one-off's store shows in green and bold on its row. Adding a one-off while a store is selected doesn't assign that store.
- Suggestion strip: "Usually bought now" items with their usual interval ("usually every 4 days") and "Low at home" items, none of them already on the list; with a store selected, only items bought there. One tap adds; × hides one on this device until tomorrow.

**Stock**

- Tracked items only, grouped by category, each with an ok / low / out toggle.
- "Used last one" = set to *out* → item appears on the list automatically (with a badge "from stock").

**Items**

- All saved item types (one-offs never appear); tap to edit name, category, stock tracking and store rules (preferred / avoid + reason). “+ New store” under the rules adds a store without leaving the item; it starts as Buy here. Store pickers (an item's Where to buy, a product's stores, a one-off's Buy at chips) list stores by use: how many items are bought there (Buy here, or a product sold there), most first, ties in store order. The five most used show, plus any store already set or touched in that sheet (and, in the product sheet, the store you're at, on top); the rest are behind “Show N more stores” (chips: “More…”). No counts are shown.
- **Products and prices** per item, in the item sheet and in a list entry's sheet: brand and name, pack size (number + unit), a photo (optional: taken or picked on the phone, shrunk before upload; change or remove it any time), verdict (preferred / OK / don't buy + reason), and per store “sold here” (price optional) or “not here” + reason. Added from a list entry while a store is selected, that store is pre-set to “sold here”.

**Product recommendation** (shown as early as possible)

- Rule: never a don't-buy product or a product marked “not here” at that store; preferred products first, then the lowest price per kg / l (or per pack). Unknown prices rank last.
- Where it shows: on the list with a store selected (the preferred products and their prices, see List), as product suggestions in the add field, and at the top of a generic entry's sheet. With All selected the list only highlights stores, to stay calm.
- In the entry sheet with All selected: the best product and where it's cheapest (“Lavazza 1 kg · 12,99 € at Aldi”), or “Preferred: …” when no store is known. With a store selected: what to get there and its price there (“Get Lavazza 1 kg · 13,95 €”).

**Log**

- Newest-first list of events: who, what, where, when.

**Account**

- Tapping your name at the top opens the account sheet: change your password (current password, new one twice, at least 10 characters), open Stores & categories, and log out. Changing it signs you out on your other devices; they show the login page the next time they're opened or used.

**Stores & categories** (from the Account sheet)

- Add a store (name, optional type) or a category; rename either. Names are unique per household. A store can also be added from a one-off's Buy at chips or an item's store rules (“+ New store”): the same small form, then back to that sheet with the new store picked.
- Reorder with up/down buttons: store order is used wherever stores are listed; category order is the group order on the list (match it to your route through the shop).
- Delete with a warning of what it affects: a store takes its Buy here / Not here rules (and prices) with it; a category's items move to “Other”.

**Add-item flow**

1. Type a name in the field.
2. Known item → tap it → added (or quantity +1 if already on the list).
3. Unknown, needed once → Enter or "Add just this once" → one-off entry, nothing saved.
4. Unknown, needed again in future → "Save as an item…" → quick sheet → item type created and added to the list.

## Recommendations

Simple rules over the event log are enough at family scale; no machine learning needed.

- **Usual rhythm** – for each item type, the median days between *bought* events. Several purchases on one day count once; an undone Bought doesn't count. Suggest it once that many days have passed since the last purchase (needs ≥ 3 purchase days, from the last 400 days). Stop once it is 3 intervals and at least 30 days overdue: the family has probably stopped buying it.
- **Low at this store** – when a store chip is selected, show items with stock *low* or *out* that are bought there (Buy here, or a product you'd buy is sold there), even if nobody added them yet. With All selected: every tracked item that is low or out and not on the list.
- **Avoid warning** – if a list item is marked *avoid* at the selected store, show the reason inline.
- Suggestions are never added automatically; one tap adds them, × hides one on this device until tomorrow.

## Tech stack & deployment

Decided on 2026-10-30. The code lives in [docdru/shopapp](https://github.com/docdru/shopapp); its CLAUDE.md and README carry the details, and its docs/ folder holds snapshots of this spec and the prototype.

| Layer | Decision | Why |
| --- | --- | --- |
| Backend & DB | PocketBase 0.40 (single binary, SQLite); schema as JS migrations in the repo | Auth, REST API and realtime built in; backup = one folder |
| Frontend | SvelteKit 3 + Svelte 5 + TypeScript, built as a static PWA that PocketBase serves | One process, one port; installs from Chrome on Android |
| Sync | Realtime subscriptions (Server-Sent Events); service worker caches the app shell | Two people shopping see ticks instantly; offline data sync comes later |
| Accounts | One login per family member, grouped into a household; no public sign-up | Log shows who did what; admin creates accounts |
| Hosting | One Docker container on 127.0.0.1:8090 behind the existing nginx (Let's Encrypt, port 443); admin dashboard only via SSH tunnel; non-root container, strict CSP and security headers | Fits the existing public server |
| Releases | GitHub Actions builds amd64/arm64 images to ghcr.io; server runs `docker compose pull && up -d` | Migrations run on start |
| Packaging (optional) | Trusted Web Activity via Bubblewrap | Only if a Play Store / APK install is wanted |
| Barcode (phase 3) | Browser BarcodeDetector API, ZXing fallback | No native app needed |
| Product photos | PocketBase file field on products, protected (served only with a short-lived file token of a household member); the phone shrinks photos to 1024 px JPEG (drops location metadata); thumbnails 96 px and 480 px; JPEG / PNG / WebP only, no SVG | Fast on mobile data; a leaked link shows nothing; backups stay small |

## Open questions

- [ ] One open list per household, or several (e.g. weekly shop vs. drugstore run)?
- [ ] Should *low* also add to the list, or only *out*? (Prototype: only *out*.)
- [x] Login per person or one shared household account? Decided: one login per family member, grouped into a household.
- [x] Quantities: free text ("2 packs") or number + unit? Decided: number + optional unit (piece, pack, bottle, can, jar, g, kg, ml, l), plus an optional note.
- [ ] Which stores and categories to seed?
- [ ] Prices: keep only the latest price per product and store, or a full history? (Prototype: latest price + date; the log keeps every paid price.)
- [ ] Should a one-off added several times be offered as a saved item?
- [ ] Is recording the price at "Bought" enough, or also a quick "note price" while browsing the shelf?
- [ ] Event log retention: the log is a timestamped record of who shopped where and when. Keep it forever, or trim it? (Proposal: keep 24 months, which is enough for suggestions, plus an admin export and wipe. Backups hold old data too.)

## Prototype sync log

Spec and [clickable prototype](https://claude.ai/artifact/9QkWqMkrRvH2H3bqnyfAUK) are kept in sync; every change to one is reflected in the other and logged here.

| Date | Version | Change |
| --- | --- | --- |
| 2026-11-10 | v0.12.2 | Renamed to ShopApp; the code moves to the public repository docdru/shopapp. No behaviour change. Prototype: title only. |
| 2026-11-08 | v0.12.1 | Tech stack: SvelteKit 3 (with Vite 8, TypeScript 6). No behaviour change. Prototype unchanged. |
| 2026-11-07 | v0.12 | App + prototype: one-offs get a “Buy at” store in their sheet (only shown at that store). Store chips only for stores with something on the list (selected one stays); new **Other** chip for entries without a clear store (Buy here, preferred product, specific product or one-off store; OK-only stores don't count); at a store those follow in “Other · no clear store”. Data model: ListEntry store (one-offs). “+ New store” in a one-off's Buy at chips and under an item's store rules (picks the new store; Buy here for items). Store pickers sorted by use, top five plus stores already set, the rest behind “Show N more”. |
| 2026-11-03 | v0.11 | App + prototype: product photos. Add, change or remove in the product sheet (camera or gallery, shrunk on the phone); thumbnail in product lists, on list rows (specific product, or the product to get at the selected store) and larger in the entry sheet. Data model: Product photo. Tech stack: protected files with file token. |
| 2026-11-03 | v0.10 | App + prototype: suggestion strip above the list. “Usually bought now” from the purchase log (median days between purchase days, ≥ 3, undone Bought ignored, dropped when far overdue), “Low at home” for tracked items low or out; with a store selected only items bought there; one tap adds, × hides until tomorrow (per device). Bought in the entry sheet now logs the selected store too. Phase 2 live. |
| 2026-11-03 | v0.9 | Prototype caught up with v0.3–v0.8: account sheet (password, log out), Stores & categories screen, per store Sold here (price optional) / Not here, list rows without “added by” and tab count, stores on rows with All, preferred products with prices at a store, specific products on the list (inverted row, Which one?, product suggestions), item aliases, usual quantity + unit, Low adds to the list if the item opts in, recommendation ranks per kg / l else per pack. Phase table: Phase 1 status. No app change. |
| 2026-11-02 | v0.8 | List: no “added by”, no count on the List tab; All shows stores (preferred-product stores green and bold), a selected store lists preferred products with prices; specific products on the list (inverted row, Which one? in the entry sheet). Data model: one open entry per item and product. Prototype unchanged. |
| 2026-11-02 | v0.7 | App: products per item (verdict, pack size, per store sold here + price / not here), added from the item sheet or while shopping; product recommendation in suggestions, toast, list and entry sheet; store filter uses product rules. Prototype unchanged (it uses price + OK / Not here per store instead of Sold here / Not here). |
| 2026-11-01 | v0.6 | App: “Shopping at” store filter as in the prototype (Better elsewhere with reason, “N more items for other stores”), based on item rules until products exist; choice remembered per device; Bought logs the store. Prototype unchanged. |
| 2026-11-01 | v0.5 | Stores & categories screen: add, rename, reorder, delete (store rules go with a store; a deleted category's items show under Other). Prototype unchanged. |
| 2026-11-01 | v0.4.1 | Account sheet: change your own password (signs out other devices) and log out. Prototype unchanged. |
| 2026-10-31 | v0.4 | App: Stock, Items and Log tabs; add-item flow with suggestions (name and aliases), add once or save as item; entry sheet (quantity + unit, note, one-off → item); Out (or Low, if the item opts in) adds to the list with a from-stock badge; Bought sets stock back to OK. Data model: Event detail and name, ListEntry fromStock. Prototype unchanged. |
| 2026-10-31 | v0.3.1 | Security hardening: admin only via SSH tunnel, CSP and security headers, non-root container, encrypted settings, Dependabot and secret scan. New open question on event log retention. Prototype unchanged. |
| 2026-10-30 | v0.3 | Decided login per member, number + unit quantities, Docker behind nginx; repo scaffold with schema migrations and app shell. Prototype unchanged. |
| 2026-10-25 | v0.2 | Products with verdicts and per-store prices moved into the MVP; price check sheet; store filter uses product verdicts; one-off entries; separate Bought and Not needed actions |
| 2026-10-23 | v0.1 | Initial spec and prototype: List, Stock, Items, Log tabs with sample data |
