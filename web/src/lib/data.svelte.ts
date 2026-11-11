import { pb } from './pb';
import { auth } from './auth.svelte';
import { isDue, purchasesByItem, rhythm, type Purchase, type Rhythm } from './rhythm';
import type {
  Category,
  EventType,
  ItemStore,
  ItemType,
  ListEntry,
  Product,
  ProductStore,
  ProductVerdict,
  StockState,
  Store,
  Unit,
  User
} from './types';

type Rec = { id: string };

/** Apply a realtime event (or our own write) to a local array. */
function apply<T extends Rec>(list: T[], action: string, record: T): T[] {
  const rest = list.filter((x) => x.id !== record.id);
  return action === 'delete' ? rest : [...rest, record];
}

function byId<T extends Rec>(list: T[]): Map<string, T> {
  return new Map(list.map((x) => [x.id, x]));
}

const norm = (s: string) => s.trim().toLocaleLowerCase();

export type RuleDraft = { verdict: '' | 'preferred' | 'avoid'; reason: string };

export type OfferDraft = { state: '' | 'here' | 'not'; price: string; reason: string };

export interface ProductDraft {
  name: string;
  pack_qty: number | null;
  pack_unit: string;
  verdict: Exclude<ProductVerdict, ''>;
  reason: string;
  /** store id → offer */
  offers: Record<string, OfferDraft>;
  /** New photo to upload, null = remove it, undefined = leave as it is. */
  photo?: File | null;
}

/** What to buy: a product, and where (with price) if known. */
export interface Recommendation {
  product: Product;
  offer?: ProductStore;
  store?: Store;
}

/** A purchase-relevant event: a bought, or an "undo bought". */
type PurchaseEvent = Purchase & { id: string };

/** How far back purchases are loaded for the usual rhythm. */
const RHYTHM_DAYS = 400;

/** An events record as loaded (only some fields) or pushed by realtime. */
type EventLike = { id: string; [field: string]: any };

const parseTime = (s: string) => Date.parse(s.replace(' ', 'T'));

function toPurchase(e: EventLike): PurchaseEvent | null {
  if (!e.item) return null;
  if (e.type === 'bought') return { id: e.id, item: e.item, at: parseTime(e.created) };
  if (e.type === 'edited' && e.detail === 'undo bought') return { id: e.id, item: e.item, at: parseTime(e.created), undo: true };
  return null;
}

/** Suggestions for the strip above the list (spec: Recommendations). */
export interface Suggestions {
  /** Usually bought by now (rhythm from the log), most overdue first. */
  usual: { item: ItemType; rhythm: Rhythm }[];
  /** Tracked items that are low or out at home and not on the list. */
  low: ItemType[];
}

const euro = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
export const formatPrice = (n: number) => euro.format(n);

/** "1,29" or "1.29" → 1.29; empty or invalid → 0 (unknown). */
export function parsePrice(text: string): number {
  const n = parseFloat(text.trim().replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0;
}

export interface ItemDraft {
  name: string;
  aliases: string;
  category: string;
  default_qty: number;
  default_unit: string;
  track_stock: boolean;
  restock_at: 'out' | 'low';
  /** store id → rule */
  rules: Record<string, RuleDraft>;
}

/**
 * Everything the household's screens show, loaded once after login and kept
 * live with PocketBase realtime subscriptions. Pages read from here and call
 * its methods; each method writes to PocketBase, applies the result locally
 * at once, and records an event in the log.
 */
class Household {
  entries = $state<ListEntry[]>([]);
  items = $state<ItemType[]>([]);
  itemStores = $state<ItemStore[]>([]);
  products = $state<Product[]>([]);
  productStores = $state<ProductStore[]>([]);
  categories = $state<Category[]>([]);
  stores = $state<Store[]>([]);
  units = $state<Unit[]>([]);
  users = $state<User[]>([]);
  /** Bought and undo-bought events of the last RHYTHM_DAYS days, for the usual rhythm. */
  purchases = $state<PurchaseEvent[]>([]);
  /** Short-lived token for protected files (product photos). */
  fileToken = $state('');
  #fileTokenAt = 0;
  ready = $state(false);
  error = $state('');

  itemById = $derived(byId(this.items));
  productById = $derived(byId(this.products));
  categoryById = $derived(byId(this.categories));
  unitById = $derived(byId(this.units));
  storeById = $derived(byId(this.stores));
  userById = $derived(byId(this.users));

  sortedCategories = $derived([...this.categories].sort((a, b) => a.sort - b.sort));
  sortedStores = $derived([...this.stores].sort((a, b) => a.sort - b.sort));
  /**
   * Stores by use: how many items are bought there (Buy here, or a product
   * sold there), most first; ties keep the store order. Store pickers show
   * the top five (`topStores`).
   */
  storesByUse = $derived.by(() => {
    const items = new Map<string, Set<string>>();
    const add = (store: string, item: string) => {
      let set = items.get(store);
      if (!set) items.set(store, (set = new Set()));
      set.add(item);
    };
    for (const r of this.itemStores) if (r.verdict === 'preferred') add(r.store, r.item);
    for (const o of this.productStores) {
      const p = this.productById.get(o.product);
      if (p && !o.dont_buy_here) add(o.store, p.item);
    }
    const n = (s: Store) => items.get(s.id)?.size ?? 0;
    return this.sortedStores.map((s, i) => ({ s, i })).sort((a, b) => n(b.s) - n(a.s) || a.i - b.i).map((x) => x.s);
  });
  sortedUnits = $derived([...this.units].sort((a, b) => a.sort - b.sort));

  open = $derived(this.entries.filter((e) => !e.in_cart));
  cart = $derived(this.entries.filter((e) => e.in_cart));

  #unsubscribers: Array<() => Promise<void>> = [];
  #started = false;

  async start() {
    if (this.#started) return;
    this.#started = true;
    this.error = '';
    try {
      const since = new Date(Date.now() - RHYTHM_DAYS * 86_400_000);
      const [entries, items, itemStores, products, productStores, categories, stores, units, users, events] = await Promise.all([
        pb.collection('list_entries').getFullList(),
        pb.collection('item_types').getFullList(),
        pb.collection('item_stores').getFullList(),
        pb.collection('products').getFullList(),
        pb.collection('product_stores').getFullList(),
        pb.collection('categories').getFullList(),
        pb.collection('stores').getFullList(),
        pb.collection('units').getFullList(),
        pb.collection('users').getFullList(),
        pb.collection('events').getFullList({
          filter: pb.filter(
            'created >= {:since} && item != "" && (type = "bought" || (type = "edited" && detail = "undo bought"))',
            { since }
          ),
          fields: 'id,type,item,detail,created',
          sort: 'created'
        })
      ]);
      const purchases = events.map(toPurchase).filter((p) => p !== null);
      Object.assign(this, { entries, items, itemStores, products, productStores, categories, stores, units, users, purchases });
      await this.refreshFileToken(true);
      this.ready = true;

      this.#unsubscribers = await Promise.all([
        pb.collection('list_entries').subscribe('*', (e) => {
          this.entries = apply(this.entries, e.action, e.record);
        }),
        pb.collection('item_types').subscribe('*', (e) => {
          this.items = apply(this.items, e.action, e.record);
        }),
        pb.collection('item_stores').subscribe('*', (e) => {
          this.itemStores = apply(this.itemStores, e.action, e.record);
        }),
        pb.collection('products').subscribe('*', (e) => {
          this.products = apply(this.products, e.action, e.record);
        }),
        pb.collection('product_stores').subscribe('*', (e) => {
          this.productStores = apply(this.productStores, e.action, e.record);
        }),
        pb.collection('categories').subscribe('*', (e) => {
          this.categories = apply(this.categories, e.action, e.record);
        }),
        pb.collection('stores').subscribe('*', (e) => {
          this.stores = apply(this.stores, e.action, e.record);
        }),
        // Purchases by anyone in the household feed "usually bought now".
        pb.collection('events').subscribe('*', (e) => {
          if (e.action === 'create') this.#addPurchase(e.record);
        })
      ]);
    } catch (err) {
      this.error = (err as Error).message;
      this.#started = false;
    }
  }

  async stop() {
    await Promise.all(this.#unsubscribers.map((u) => u().catch(() => {})));
    this.#unsubscribers = [];
    this.#started = false;
    this.ready = false;
    Object.assign(this, {
      entries: [],
      items: [],
      itemStores: [],
      products: [],
      productStores: [],
      categories: [],
      stores: [],
      units: [],
      users: [],
      purchases: [],
      fileToken: ''
    });
  }

  /**
   * Reload and resubscribe, e.g. after a password change: PocketBase then
   * drops the realtime connection's old authorization.
   */
  async restart() {
    await this.stop();
    await this.start();
  }

  // ---- lookups -------------------------------------------------------------

  /** Specific product name, else item name, else the one-off label. */
  entryName(e: ListEntry): string {
    return this.entryProduct(e)?.name || (e.item && this.itemById.get(e.item)?.name) || e.label;
  }

  /** The specific product an entry asks for, if any (and if it still exists). */
  entryProduct(e: ListEntry): Product | undefined {
    return e.product ? this.productById.get(e.product) : undefined;
  }

  quantity(e: { qty: number; unit: string }): string {
    const unit = this.unitById.get(e.unit);
    if (!unit || unit.name === 'piece') return `${e.qty}×`;
    return `${e.qty} ${unit.short || unit.name}`;
  }

  rulesFor(itemId: string): ItemStore[] {
    return this.itemStores.filter((r) => r.item === itemId);
  }

  preferredStores(itemId: string): string[] {
    return this.rulesFor(itemId)
      .filter((r) => r.verdict === 'preferred')
      .map((r) => this.storeById.get(r.store)?.name ?? '')
      .filter(Boolean);
  }

  avoidedStores(itemId: string): { store: string; reason: string }[] {
    return this.rulesFor(itemId)
      .filter((r) => r.verdict === 'avoid')
      .map((r) => ({ store: this.storeById.get(r.store)?.name ?? '', reason: r.reason }))
      .filter((r) => r.store);
  }

  /**
   * Group items by category in category order. Items without a (still
   * existing) category come last under "Other".
   */
  groupByCategory<T extends ItemType>(items: T[]): { id: string; name: string; items: T[] }[] {
    const groups = this.sortedCategories.map((c) => ({ id: c.id, name: c.name, items: [] as T[] }));
    const other = { id: '_other', name: 'Other', items: [] as T[] };
    for (const item of items) {
      (groups.find((g) => g.id === item.category) ?? other).items.push(item);
    }
    return [...groups, other]
      .map((g) => ({ ...g, items: g.items.sort((a, b) => a.name.localeCompare(b.name)) }))
      .filter((g) => g.items.length);
  }

  // ---- products ----------------------------------------------------------------

  productsFor(itemId: string): Product[] {
    const order = { preferred: 0, ok: 1, '': 1, dont_buy: 2 } as const;
    return this.products
      .filter((p) => p.item === itemId)
      .sort((a, b) => order[a.verdict] - order[b.verdict] || a.name.localeCompare(b.name));
  }

  /**
   * URL of a product's photo ('' if none): a 96 px square thumbnail, the
   * 480 px wide version, or the original. Photos are protected files: the
   * URL carries a file token, which expires after a few minutes.
   */
  photoUrl(p: Product | undefined, size: 'thumb' | 'large' | 'full' = 'thumb'): string {
    if (!p?.photo || !this.fileToken) return '';
    const thumb = size === 'thumb' ? '96x96' : size === 'large' ? '480x0' : '';
    return pb.files.getURL(p, p.photo, { token: this.fileToken, ...(thumb ? { thumb } : {}) });
  }

  /**
   * Get a new file token. Called at start and when a photo fails to load
   * (token expired); at most every 10 s, so a missing file can't loop.
   */
  async refreshFileToken(force = false) {
    if (!force && Date.now() - this.#fileTokenAt < 10_000) return;
    this.#fileTokenAt = Date.now();
    try {
      this.fileToken = await pb.files.getToken();
    } catch {
      /* offline or signed out: photos just don't show */
    }
  }

  offersFor(productId: string): ProductStore[] {
    return this.productStores.filter((o) => o.product === productId && this.storeById.has(o.store));
  }

  /** "1 kg", "6×", "500 ml" — empty when no pack size is known. */
  packSize(p: Product): string {
    if (!p.pack_qty) return '';
    return this.quantity({ qty: p.pack_qty, unit: p.pack_unit });
  }

  /**
   * Price per kg / l for weight and volume packs, else per pack; for comparing
   * products. Infinity when the price is unknown.
   */
  unitPrice(p: Product, price: number): number {
    if (!price) return Infinity;
    const unit = this.unitById.get(p.pack_unit)?.name ?? '';
    const qty = p.pack_qty || 1;
    if (unit === 'g' || unit === 'ml') return price / (qty / 1000);
    if (unit === 'kg' || unit === 'l') return price / qty;
    return price;
  }

  /** "13,95 €/kg" for weight/volume packs, else ''. */
  unitPriceLabel(p: Product, price: number): string {
    const unit = this.unitById.get(p.pack_unit)?.name ?? '';
    if (!price || !['g', 'kg', 'ml', 'l'].includes(unit)) return '';
    const per = unit === 'g' || unit === 'kg' ? 'kg' : 'l';
    return `${formatPrice(this.unitPrice(p, price))}/${per}`;
  }

  #buyable(p: Product, o: ProductStore): boolean {
    return p.verdict !== 'dont_buy' && !o.dont_buy_here;
  }

  /**
   * What to buy for an item: preferred products first, then the lowest price
   * per kg / l / pack. At a store: only products sold there and not marked
   * "don't buy". Anywhere: across all stores; falls back to a preferred
   * product without known stores.
   */
  recommend(itemId: string, storeId = ''): Recommendation | undefined {
    const rank = (p: Product, o?: ProductStore) => [
      p.verdict === 'preferred' ? 0 : 1,
      o ? this.unitPrice(p, o.price) : Infinity
    ];
    const better = (a: number[], b: number[]) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
    let best: { r: Recommendation; k: number[] } | undefined;
    for (const product of this.productsFor(itemId)) {
      for (const offer of this.offersFor(product.id)) {
        if (storeId && offer.store !== storeId) continue;
        if (!this.#buyable(product, offer)) continue;
        const k = rank(product, offer);
        if (!best || better(k, best.k)) best = { r: { product, offer, store: this.storeById.get(offer.store) }, k };
      }
    }
    if (best || storeId) return best?.r;
    const preferred = this.productsFor(itemId).find((p) => p.verdict === 'preferred');
    return preferred ? { product: preferred } : undefined;
  }

  /** One-line hint for the list: what to get, and where / for how much. */
  hint(itemId: string, storeId = ''): string {
    const r = this.recommend(itemId, storeId);
    if (!r) return '';
    const name = [r.product.name, this.packSize(r.product)].filter(Boolean).join(' ');
    const price = r.offer?.price ? formatPrice(r.offer.price) : '';
    if (storeId) return `Get ${name}${price ? ` · ${price}` : ''}`;
    if (r.store) return `${name}${price ? ` · ${price}` : ''} at ${r.store.name}`;
    return `Preferred: ${name}`;
  }

  /**
   * Store filter (spec: "Store filter rules"):
   * - "avoid": the item is marked Not here at this store, or every product
   *   sold here is marked don't buy → "Better elsewhere", with the reason
   * - "here": preferred here, a buyable product is sold here, no store
   *   information at all, or a one-off (without a store, or with this one)
   * - "elsewhere": only known at other stores → hidden behind "N more"
   */
  verdictAt(entry: ListEntry, storeId: string): { k: 'here' | 'avoid' | 'elsewhere'; why?: string } {
    if (!entry.item) {
      // A one-off with a Buy at store is only for that store.
      const own = this.entryStore(entry);
      return !own || own === storeId ? { k: 'here' } : { k: 'elsewhere' };
    }

    // A specific product: only where it's sold; "not here" → better elsewhere.
    const pinned = this.entryProduct(entry);
    if (pinned) {
      const o = this.offersFor(pinned.id).find((x) => x.store === storeId);
      if (!o) return { k: 'elsewhere' };
      if (o.dont_buy_here || pinned.verdict === 'dont_buy')
        return { k: 'avoid', why: o.reason || pinned.reason || 'Not at this store' };
      return { k: 'here' };
    }

    const rules = this.rulesFor(entry.item);
    const atStore = rules.find((r) => r.store === storeId);
    if (atStore?.verdict === 'avoid') return { k: 'avoid', why: atStore.reason || 'Not at this store' };

    const products = this.productsFor(entry.item);
    const offersHere = products.flatMap((p) =>
      this.offersFor(p.id)
        .filter((o) => o.store === storeId)
        .map((o) => ({ p, o }))
    );
    const buyableHere = offersHere.filter(({ p, o }) => this.#buyable(p, o));
    if (offersHere.length && !buyableHere.length) {
      const why = offersHere.length === 1 && offersHere[0].o.reason ? offersHere[0].o.reason : '';
      return { k: 'avoid', why: why || "Only don't-buy products here" };
    }
    if (atStore?.verdict === 'preferred' || buyableHere.length) return { k: 'here' };

    const preferredElsewhere = rules.some((r) => r.verdict === 'preferred' && this.storeById.has(r.store));
    const offeredElsewhere = products.some((p) => this.offersFor(p.id).length > 0);
    return preferredElsewhere || offeredElsewhere ? { k: 'elsewhere' } : { k: 'here' };
  }

  /** Create or update a product of an item, with its store offers. */
  async saveProduct(itemId: string, draft: ProductDraft, existing?: Product): Promise<Product> {
    const fields = {
      name: draft.name.trim(),
      pack_qty: draft.pack_qty || 0,
      pack_unit: draft.pack_unit,
      verdict: draft.verdict,
      reason: draft.verdict === 'dont_buy' ? draft.reason.trim() : '',
      // a File is sent as multipart; null removes the photo
      ...(draft.photo !== undefined ? { photo: draft.photo } : {})
    };
    const saved = existing
      ? await pb.collection('products').update(existing.id, fields)
      : await pb.collection('products').create({ household: this.#household, item: itemId, ...fields });
    this.products = apply(this.products, existing ? 'update' : 'create', saved);

    const now = new Date().toISOString().replace('T', ' ');
    for (const store of this.stores) {
      const want = draft.offers[store.id];
      const have = this.productStores.find((o) => o.product === saved.id && o.store === store.id);
      if (!want?.state) {
        if (have) {
          await pb.collection('product_stores').delete(have.id);
          this.productStores = apply(this.productStores, 'delete', have);
        }
        continue;
      }
      const price = want.state === 'here' ? parsePrice(want.price) : have?.price ?? 0;
      const body = {
        price,
        dont_buy_here: want.state === 'not',
        reason: want.state === 'not' ? want.reason.trim() : '',
        price_seen_at: price && price !== have?.price ? now : (have?.price_seen_at ?? '')
      };
      if (have && have.price === body.price && have.dont_buy_here === body.dont_buy_here && have.reason === body.reason)
        continue;
      const rec = have
        ? await pb.collection('product_stores').update(have.id, body)
        : await pb.collection('product_stores').create({
            household: this.#household,
            product: saved.id,
            store: store.id,
            ...body
          });
      this.productStores = apply(this.productStores, have ? 'update' : 'create', rec);
    }

    await this.#log(existing ? 'edited' : 'created', {
      item: this.itemById.get(itemId),
      detail: `product: ${saved.name}`
    });
    return saved;
  }

  async deleteProduct(product: Product) {
    await pb.collection('products').delete(product.id);
    this.products = apply(this.products, 'delete', product);
    this.productStores = this.productStores.filter((o) => o.product !== product.id);
    await this.#log('edited', { item: this.itemById.get(product.item), detail: `product deleted: ${product.name}` });
  }

  productDraft(product?: Product, storeId = ''): ProductDraft {
    const offers: Record<string, OfferDraft> = {};
    if (product) {
      for (const o of this.offersFor(product.id)) {
        offers[o.store] = {
          state: o.dont_buy_here ? 'not' : 'here',
          price: o.price ? o.price.toFixed(2).replace('.', ',') : '',
          reason: o.reason
        };
      }
    } else if (storeId) {
      offers[storeId] = { state: 'here', price: '', reason: '' };
    }
    return {
      name: product?.name ?? '',
      pack_qty: product?.pack_qty || null,
      pack_unit: product?.pack_unit ?? '',
      verdict: product?.verdict || 'ok',
      reason: product?.reason ?? '',
      offers
    };
  }

  /** The open entry for an item (generic) or for one of its products. */
  openEntryFor(itemId: string, productId = ''): ListEntry | undefined {
    return this.open.find((e) => e.item === itemId && (e.product || '') === productId);
  }

  /** Buyable products whose name contains the text, or whose item is in `items`. */
  searchProducts(text: string, items: ItemType[], limit = 4): Product[] {
    const n = norm(text);
    if (!n) return [];
    const itemIds = new Set(items.map((i) => i.id));
    const score = (p: Product) => {
      const name = norm(p.name);
      if (name.startsWith(n) || name.split(' ').some((w) => w.startsWith(n))) return 0;
      if (name.includes(n)) return 1;
      if (itemIds.has(p.item)) return 2;
      return 3;
    };
    return this.products
      .filter((p) => this.itemById.has(p.item) && p.verdict !== 'dont_buy')
      .map((p) => ({ p, s: score(p) }))
      .filter((x) => x.s < 3)
      .sort((a, b) => a.s - b.s || a.p.name.localeCompare(b.p.name))
      .slice(0, limit)
      .map((x) => x.p);
  }

  /**
   * Stores to show for an entry with "All" selected. Generic: stores the item
   * is preferred at plus stores selling a buyable product; `preferred` = a
   * preferred product is sold there. Specific product: where it's sold;
   * `preferred` = the cheapest of those (when prices are known).
   */
  storesFor(e: ListEntry): { name: string; preferred: boolean }[] {
    const out = new Map<string, boolean>();
    const product = this.entryProduct(e);
    const own = this.entryStore(e);
    if (own) out.set(own, true);
    else if (product) {
      const offers = this.offersFor(product.id).filter((o) => !o.dont_buy_here);
      const priced = offers.filter((o) => o.price);
      const min = Math.min(...priced.map((o) => this.unitPrice(product, o.price)));
      for (const o of offers) out.set(o.store, !!o.price && this.unitPrice(product, o.price) === min && priced.length > 1);
    } else if (e.item) {
      for (const r of this.rulesFor(e.item)) if (r.verdict === 'preferred') out.set(r.store, out.get(r.store) ?? false);
      for (const p of this.productsFor(e.item)) {
        if (p.verdict === 'dont_buy') continue;
        for (const o of this.offersFor(p.id)) {
          if (o.dont_buy_here) continue;
          out.set(o.store, out.get(o.store) || p.verdict === 'preferred');
        }
      }
    }
    return this.sortedStores
      .filter((s) => out.has(s.id))
      .map((s) => ({ name: s.name, preferred: out.get(s.id) ?? false }));
  }

  /** A one-off's Buy at store ('' = none, or the store was deleted). */
  entryStore(e: ListEntry): string {
    return !e.item && e.store && this.storeById.has(e.store) ? e.store : '';
  }

  /**
   * Stores an entry clearly belongs to (spec: store filter). One-off: its Buy
   * at store. Specific product: where it's sold. Generic: the item's Buy at
   * stores and stores selling a preferred product, minus its Not here stores.
   * Empty = the entry is under "Other".
   */
  clearStores(e: ListEntry): Set<string> {
    const out = new Set<string>();
    if (!e.item) {
      const own = this.entryStore(e);
      if (own) out.add(own);
      return out;
    }
    const product = this.entryProduct(e);
    if (product) {
      if (product.verdict !== 'dont_buy')
        for (const o of this.offersFor(product.id)) if (!o.dont_buy_here) out.add(o.store);
      return out;
    }
    const rules = this.rulesFor(e.item);
    for (const r of rules) if (r.verdict === 'preferred' && this.storeById.has(r.store)) out.add(r.store);
    for (const p of this.productsFor(e.item)) {
      if (p.verdict !== 'preferred') continue;
      for (const o of this.offersFor(p.id)) if (!o.dont_buy_here) out.add(o.store);
    }
    for (const r of rules) if (r.verdict === 'avoid') out.delete(r.store);
    return out;
  }

  /**
   * A store picker's stores: the five most used plus `keep` (stores already
   * set in that sheet), in order of use; `first` goes on top. `more` = how
   * many stay hidden until the picker is expanded.
   */
  topStores(keep: Iterable<string>, expanded: boolean, first = ''): { stores: Store[]; more: number } {
    const k = new Set(keep);
    const ordered = first
      ? [...this.storesByUse.filter((s) => s.id === first), ...this.storesByUse.filter((s) => s.id !== first)]
      : this.storesByUse;
    const top = ordered.filter((s, i) => i < 5 || k.has(s.id) || s.id === first);
    return { stores: expanded ? ordered : top, more: ordered.length - top.length };
  }

  /** Stores with something on the list to buy there (store chips). */
  storesWithEntries(): Set<string> {
    const out = new Set<string>();
    for (const e of this.open)
      for (const s of this.clearStores(e)) if (!out.has(s) && this.verdictAt(e, s).k === 'here') out.add(s);
    return out;
  }

  /**
   * With a store selected: what to get there. Generic entry: every preferred
   * product sold there, with price. Specific product: its price there.
   */
  linesAt(e: ListEntry, storeId: string): string[] {
    const line = (p: Product, price: number) =>
      [[p.name, this.packSize(p)].filter(Boolean).join(' '), price ? formatPrice(price) : '']
        .filter(Boolean)
        .join(' · ');
    const product = this.entryProduct(e);
    if (product) {
      const o = this.offersFor(product.id).find((x) => x.store === storeId && !x.dont_buy_here);
      return o?.price ? [formatPrice(o.price)] : [];
    }
    if (!e.item) return [];
    const lines: { text: string; k: number }[] = [];
    for (const p of this.productsFor(e.item)) {
      if (p.verdict !== 'preferred') continue;
      const o = this.offersFor(p.id).find((x) => x.store === storeId && !x.dont_buy_here);
      if (o) lines.push({ text: line(p, o.price), k: this.unitPrice(p, o.price) });
    }
    return lines.sort((a, b) => a.k - b.k).map((l) => l.text);
  }

  /** Exact match on name or one of the aliases. */
  itemByName(name: string): ItemType | undefined {
    const n = norm(name);
    if (!n) return undefined;
    return this.items.find(
      (i) => norm(i.name) === n || i.aliases.split(',').some((a) => norm(a) === n)
    );
  }

  /** Items whose name or aliases contain the text; prefix matches first. */
  search(text: string, limit = 6): ItemType[] {
    const n = norm(text);
    if (!n) return [];
    const score = (i: ItemType) => {
      const names = [i.name, ...i.aliases.split(',')].map(norm).filter(Boolean);
      if (names.some((s) => s.startsWith(n))) return 0;
      if (names.some((s) => s.includes(n))) return 1;
      return 2;
    };
    return this.items
      .map((i) => ({ i, s: score(i) }))
      .filter((x) => x.s < 2)
      .sort((a, b) => a.s - b.s || a.i.name.localeCompare(b.i.name))
      .slice(0, limit)
      .map((x) => x.i);
  }

  // ---- suggestions -----------------------------------------------------------

  /**
   * Is this store a place to buy the item? It is marked Buy here, or a
   * product of it you'd buy is sold here, and it isn't marked Not here.
   */
  fitsStore(itemId: string, storeId: string): boolean {
    const rule = this.rulesFor(itemId).find((r) => r.store === storeId);
    if (rule?.verdict === 'avoid') return false;
    return rule?.verdict === 'preferred' || !!this.recommend(itemId, storeId);
  }

  /**
   * The suggestion strip (spec: Recommendations): items usually bought by now
   * and tracked items low or out at home, none of them already on the list.
   * With a store selected, only items to buy at that store. Never added on
   * their own: one tap adds.
   */
  suggestions(storeId = '', now = Date.now()): Suggestions {
    const onList = new Set(this.open.map((e) => e.item).filter(Boolean));
    const fits = (id: string) => !storeId || this.fitsStore(id, storeId);
    const low = this.items
      .filter((i) => i.track_stock && (i.stock_state === 'low' || i.stock_state === 'out'))
      .filter((i) => !onList.has(i.id) && fits(i.id))
      .sort((a, b) => (a.stock_state === 'out' ? 0 : 1) - (b.stock_state === 'out' ? 0 : 1) || a.name.localeCompare(b.name));
    const lowIds = new Set(low.map((i) => i.id));
    const usual: Suggestions['usual'] = [];
    for (const [itemId, times] of purchasesByItem(this.purchases)) {
      const item = this.itemById.get(itemId);
      if (!item || onList.has(itemId) || lowIds.has(itemId) || !fits(itemId)) continue;
      const r = rhythm(times, now);
      if (isDue(r)) usual.push({ item, rhythm: r });
    }
    usual.sort((a, b) => b.rhythm.due - a.rhythm.due || a.item.name.localeCompare(b.item.name));
    return { usual, low };
  }

  #addPurchase(e: EventLike) {
    const p = toPurchase(e);
    if (p && !this.purchases.some((x) => x.id === p.id)) this.purchases = [...this.purchases, p];
  }

  // ---- the list ------------------------------------------------------------

  /** Enter in the add field: a known item, else a one-off entry. */
  async add(text: string) {
    const item = this.itemByName(text);
    if (item) return this.addItem(item);
    return this.addOnce(text);
  }

  /**
   * Add an item type (or one specific product of it); if that is already on
   * the list, bump its quantity. Generic and specific entries of the same
   * item are separate entries.
   */
  async addItem(item: ItemType, opts: { fromStock?: boolean; product?: Product } = {}): Promise<ListEntry> {
    const product = opts.product;
    // A specific product counts in packs; a generic item in its usual amount.
    const step = product ? 1 : item.default_qty || 1;
    const unit = product ? '' : item.default_unit;
    const existing = this.openEntryFor(item.id, product?.id ?? '');
    if (existing) {
      const updated = await pb.collection('list_entries').update(existing.id, { 'qty+': step });
      this.entries = apply(this.entries, 'update', updated);
      await this.#log('added', { item, product, qty: step, unit: existing.unit });
      return updated;
    }
    const created = await pb.collection('list_entries').create({
      household: this.#household,
      item: item.id,
      product: product?.id ?? '',
      qty: step,
      unit,
      from_stock: !!opts.fromStock,
      added_by: this.#user
    });
    this.entries = apply(this.entries, 'create', created);
    await this.#log('added', {
      item,
      product,
      qty: step,
      unit,
      detail: opts.fromStock ? 'from stock' : ''
    });
    return created;
  }

  /** Put exactly this product on the list. */
  async addProduct(product: Product): Promise<ListEntry | undefined> {
    const item = this.itemById.get(product.item);
    if (!item) return undefined;
    return this.addItem(item, { product });
  }

  /**
   * Switch an entry between generic ('' = any) and a specific product. If an
   * open entry for the target already exists, the two are merged.
   */
  async setEntryProduct(entry: ListEntry, productId: string) {
    if ((entry.product || '') === productId) return;
    const item = this.itemById.get(entry.item);
    const target = this.openEntryFor(entry.item, productId);
    if (target && target.id !== entry.id) {
      const merged = await pb.collection('list_entries').update(target.id, { 'qty+': entry.qty });
      this.entries = apply(this.entries, 'update', merged);
      await pb.collection('list_entries').delete(entry.id);
      this.entries = apply(this.entries, 'delete', entry);
    } else {
      const updated = await pb.collection('list_entries').update(entry.id, { product: productId });
      this.entries = apply(this.entries, 'update', updated);
    }
    const product = productId ? this.productById.get(productId) : undefined;
    await this.#log('edited', { item, product, detail: product ? 'specific product' : 'any product' });
  }

  /** A one-off entry: nothing is saved as an item type. */
  async addOnce(label: string) {
    const text = label.trim();
    if (!text) return;
    const created = await pb.collection('list_entries').create({
      household: this.#household,
      label: text,
      qty: 1,
      added_by: this.#user
    });
    this.entries = apply(this.entries, 'create', created);
    await this.#log('added', { label: text, qty: 1 });
  }

  /** Buy at store of a one-off entry ('' = any store). */
  async setEntryStore(entry: ListEntry, storeId: string) {
    if (entry.item || (entry.store || '') === storeId) return;
    const updated = await pb.collection('list_entries').update(entry.id, { store: storeId });
    this.entries = apply(this.entries, 'update', updated);
    await this.#log('edited', {
      label: entry.label,
      detail: storeId ? `buy at ${this.storeById.get(storeId)?.name ?? ''}` : 'any store'
    });
  }

  async updateEntry(entry: ListEntry, changes: { qty: number; unit: string; note: string }) {
    const updated = await pb.collection('list_entries').update(entry.id, changes);
    this.entries = apply(this.entries, 'update', updated);
    await this.#log('edited', {
      item: this.itemById.get(entry.item),
      label: entry.label,
      qty: changes.qty,
      unit: changes.unit
    });
  }

  /**
   * Bought: into the cart, logged as a purchase (with the store, when the
   * list is filtered to one); tracked stock is back to OK.
   */
  async bought(entry: ListEntry, storeId = '') {
    const updated = await pb.collection('list_entries').update(entry.id, { in_cart: true });
    this.entries = apply(this.entries, 'update', updated);
    const item = this.itemById.get(entry.item);
    if (item?.track_stock && item.stock_state !== 'ok') {
      const i = await pb.collection('item_types').update(item.id, { stock_state: 'ok' });
      this.items = apply(this.items, 'update', i);
    }
    await this.#log('bought', {
      item,
      product: this.entryProduct(entry),
      label: entry.label,
      qty: entry.qty,
      unit: entry.unit,
      store: storeId
    });
  }

  async undoBought(entry: ListEntry) {
    const updated = await pb.collection('list_entries').update(entry.id, { in_cart: false });
    this.entries = apply(this.entries, 'update', updated);
    await this.#log('edited', {
      item: this.itemById.get(entry.item),
      label: entry.label,
      detail: 'undo bought'
    });
  }

  /** Not needed after all: removed, not counted as a purchase. */
  async notNeeded(entry: ListEntry) {
    await pb.collection('list_entries').delete(entry.id);
    this.entries = apply(this.entries, 'delete', entry);
    await this.#log('not_needed', {
      item: this.itemById.get(entry.item),
      product: this.entryProduct(entry),
      label: entry.label,
      qty: entry.qty,
      unit: entry.unit
    });
  }

  async clearCart() {
    const done = [...this.cart];
    await Promise.all(done.map((e) => pb.collection('list_entries').delete(e.id)));
    for (const e of done) this.entries = apply(this.entries, 'delete', e);
  }

  // ---- stock ---------------------------------------------------------------

  /**
   * Set the stock state. Out (or low, if the item asks for it) puts the item
   * on the list unless it's already there. Returns true if it was added.
   */
  async setStock(item: ItemType, state: StockState): Promise<boolean> {
    if (item.stock_state === state) return false;
    const updated = await pb.collection('item_types').update(item.id, { stock_state: state });
    this.items = apply(this.items, 'update', updated);
    await this.#log(state === 'out' ? 'used_up' : 'stock_changed', { item: updated, detail: state });

    const restock = state === 'out' || (state === 'low' && item.restock_at === 'low');
    if (restock && !this.open.some((e) => e.item === item.id)) {
      await this.addItem(updated, { fromStock: true });
      return true;
    }
    return false;
  }

  // ---- item types ----------------------------------------------------------

  newDraft(name = ''): ItemDraft {
    return {
      name,
      aliases: '',
      category: this.sortedCategories[0]?.id ?? '',
      default_qty: 1,
      default_unit: '',
      track_stock: false,
      restock_at: 'out',
      rules: {}
    };
  }

  draftFor(item: ItemType): ItemDraft {
    const rules: Record<string, RuleDraft> = {};
    for (const r of this.rulesFor(item.id)) rules[r.store] = { verdict: r.verdict, reason: r.reason };
    return {
      name: item.name,
      aliases: item.aliases,
      category: item.category,
      default_qty: item.default_qty || 1,
      default_unit: item.default_unit,
      track_stock: item.track_stock,
      restock_at: item.restock_at || 'out',
      rules
    };
  }

  /** Create or update an item type and its store rules. */
  async saveItem(draft: ItemDraft, existing?: ItemType): Promise<ItemType> {
    const fields = {
      name: draft.name.trim(),
      aliases: draft.aliases
        .split(',')
        .map((a) => a.trim())
        .filter(Boolean)
        .join(', '),
      category: draft.category,
      default_qty: draft.default_qty || 1,
      default_unit: draft.default_unit,
      track_stock: draft.track_stock,
      restock_at: draft.restock_at,
      stock_state: draft.track_stock ? existing?.stock_state || 'ok' : ''
    };
    const saved = existing
      ? await pb.collection('item_types').update(existing.id, fields)
      : await pb.collection('item_types').create({ household: this.#household, ...fields });
    this.items = apply(this.items, existing ? 'update' : 'create', saved);

    // Store rules: create, change or remove one record per store.
    for (const store of this.stores) {
      const want = draft.rules[store.id];
      const have = this.itemStores.find((r) => r.item === saved.id && r.store === store.id);
      if (!want?.verdict) {
        if (have) {
          await pb.collection('item_stores').delete(have.id);
          this.itemStores = apply(this.itemStores, 'delete', have);
        }
        continue;
      }
      const reason = want.verdict === 'avoid' ? want.reason.trim() : '';
      if (have && have.verdict === want.verdict && have.reason === reason) continue;
      const rec = have
        ? await pb.collection('item_stores').update(have.id, { verdict: want.verdict, reason })
        : await pb.collection('item_stores').create({
            household: this.#household,
            item: saved.id,
            store: store.id,
            verdict: want.verdict,
            reason
          });
      this.itemStores = apply(this.itemStores, have ? 'update' : 'create', rec);
    }

    await this.#log(existing ? 'edited' : 'created', { item: saved });
    return saved;
  }

  /** Turn a one-off entry into a saved item type. */
  async convertEntry(entry: ListEntry, item: ItemType) {
    const updated = await pb.collection('list_entries').update(entry.id, { item: item.id, label: '', store: '' });
    this.entries = apply(this.entries, 'update', updated);
  }

  async deleteItem(item: ItemType) {
    await pb.collection('item_types').delete(item.id);
    this.items = apply(this.items, 'delete', item);
    // The server removes its list entries and store rules (cascade).
    this.entries = this.entries.filter((e) => e.item !== item.id);
    this.itemStores = this.itemStores.filter((r) => r.item !== item.id);
    const gone = new Set(this.products.filter((p) => p.item === item.id).map((p) => p.id));
    this.products = this.products.filter((p) => !gone.has(p.id));
    this.productStores = this.productStores.filter((o) => !gone.has(o.product));
    await this.#log('edited', { label: item.name, detail: 'deleted' });
  }

  // ---- stores and categories -------------------------------------------------

  storeByName(name: string): Store | undefined {
    const n = norm(name);
    return this.stores.find((s) => norm(s.name) === n);
  }

  categoryByName(name: string): Category | undefined {
    const n = norm(name);
    return this.categories.find((c) => norm(c.name) === n);
  }

  /** How many item rules ("Buy here / Not here") a store deletion removes. */
  rulesAtStore(storeId: string): number {
    return this.itemStores.filter((r) => r.store === storeId).length;
  }

  /** How many product prices / "not here" marks a store deletion removes. */
  offersAtStore(storeId: string): number {
    return this.productStores.filter((o) => o.store === storeId).length;
  }

  /** How many items a category deletion moves to "Other". */
  itemsInCategory(categoryId: string): number {
    return this.items.filter((i) => i.category === categoryId).length;
  }

  async addStore(name: string, type: string): Promise<Store> {
    const sort = Math.max(-1, ...this.stores.map((s) => s.sort)) + 1;
    const rec = await pb.collection('stores').create({
      household: this.#household,
      name: name.trim(),
      type: type.trim(),
      sort
    });
    this.stores = apply(this.stores, 'create', rec);
    await this.#log('created', { label: rec.name, detail: 'store' });
    return rec;
  }

  async updateStore(store: Store, changes: { name: string; type: string }) {
    const rec = await pb.collection('stores').update(store.id, {
      name: changes.name.trim(),
      type: changes.type.trim()
    });
    this.stores = apply(this.stores, 'update', rec);
    await this.#log('edited', { label: rec.name, detail: 'store' });
  }

  /** Deletes the store; the server removes its item rules and prices too. */
  async deleteStore(store: Store) {
    await pb.collection('stores').delete(store.id);
    this.stores = apply(this.stores, 'delete', store);
    this.itemStores = this.itemStores.filter((r) => r.store !== store.id);
    this.productStores = this.productStores.filter((o) => o.store !== store.id);
    await this.#log('edited', { label: store.name, detail: 'store deleted' });
  }

  async addCategory(name: string): Promise<Category> {
    const sort = Math.max(-1, ...this.categories.map((c) => c.sort)) + 1;
    const rec = await pb.collection('categories').create({
      household: this.#household,
      name: name.trim(),
      sort
    });
    this.categories = apply(this.categories, 'create', rec);
    await this.#log('created', { label: rec.name, detail: 'category' });
    return rec;
  }

  async renameCategory(category: Category, name: string) {
    const rec = await pb.collection('categories').update(category.id, { name: name.trim() });
    this.categories = apply(this.categories, 'update', rec);
    await this.#log('edited', { label: rec.name, detail: 'category' });
  }

  /** Deletes the category; its items stay and show under "Other". */
  async deleteCategory(category: Category) {
    await pb.collection('categories').delete(category.id);
    this.categories = apply(this.categories, 'delete', category);
    // The server clears the items' category reference; mirror it locally.
    this.items = this.items.map((i) => (i.category === category.id ? { ...i, category: '' } : i));
    await this.#log('edited', { label: category.name, detail: 'category deleted' });
  }

  /** Move a store one place up (-1) or down (+1). */
  async moveStore(store: Store, delta: -1 | 1) {
    const order = await this.#reorder('stores', this.sortedStores, store.id, delta);
    if (order) this.stores = order;
  }

  /** Move a category one place up (-1) or down (+1): the list's group order. */
  async moveCategory(category: Category, delta: -1 | 1) {
    const order = await this.#reorder('categories', this.sortedCategories, category.id, delta);
    if (order) this.categories = order;
  }

  /**
   * Swap a record with its neighbour and renumber `sort` 0..n-1, writing only
   * the records whose number changed. Returns the new local list.
   */
  async #reorder<T extends Store | Category>(
    collection: 'stores' | 'categories',
    sorted: T[],
    id: string,
    delta: -1 | 1
  ): Promise<T[] | null> {
    const from = sorted.findIndex((x) => x.id === id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= sorted.length) return null;
    const next = [...sorted];
    [next[from], next[to]] = [next[to], next[from]];
    const result: T[] = [];
    for (const [i, rec] of next.entries()) {
      if (rec.sort === i) {
        result.push(rec);
        continue;
      }
      result.push((await pb.collection(collection).update(rec.id, { sort: i })) as T);
    }
    return result;
  }

  // ---- internals -----------------------------------------------------------

  get #household(): string {
    return auth.user?.household ?? '';
  }

  get #user(): string {
    return auth.user?.id ?? '';
  }

  async #log(
    type: EventType,
    e: {
      item?: ItemType;
      product?: Product;
      label?: string;
      qty?: number;
      unit?: string;
      detail?: string;
      store?: string;
    }
  ) {
    const rec = await pb.collection('events').create({
      household: this.#household,
      type,
      item: e.item?.id ?? '',
      product: e.product?.id ?? '',
      // the name at the time, so the log still reads well if the item goes
      label: e.item?.name ?? e.label ?? '',
      qty: e.qty ?? 0,
      unit: e.unit ?? '',
      store: e.store ?? '',
      detail: e.detail ?? '',
      user: this.#user
    });
    this.#addPurchase(rec);
  }
}

export const data = new Household();
