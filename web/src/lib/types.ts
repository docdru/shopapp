import type PocketBase from 'pocketbase';
import type { RecordModel, RecordService } from 'pocketbase';

// Record types mirroring pb/pb_migrations. Keep in sync with the schema.

export interface User extends RecordModel {
  email: string;
  name: string;
  color: string;
  household: string;
}

export interface Unit extends RecordModel {
  name: string;
  short: string;
  sort: number;
}

export interface Category extends RecordModel {
  household: string;
  name: string;
  sort: number;
}

export interface Store extends RecordModel {
  household: string;
  name: string;
  type: string;
  sort: number;
}

export type StockState = 'ok' | 'low' | 'out';

export interface ItemType extends RecordModel {
  household: string;
  name: string;
  aliases: string; // comma-separated
  category: string;
  default_qty: number;
  default_unit: string;
  track_stock: boolean;
  stock_state: '' | StockState;
  restock_at: '' | 'out' | 'low';
  notes: string;
}

export interface ItemStore extends RecordModel {
  household: string;
  item: string;
  store: string;
  verdict: 'preferred' | 'avoid';
  reason: string;
}

export type ProductVerdict = '' | 'preferred' | 'ok' | 'dont_buy';

/** A specific product (brand, variant, pack size) that counts as an item. */
export interface Product extends RecordModel {
  household: string;
  item: string;
  name: string;
  brand: string;
  pack_qty: number;
  pack_unit: string;
  verdict: ProductVerdict;
  reason: string;
  barcode: string;
  /** File name of the product photo ('' = none); protected, needs a file token. */
  photo: string;
}

/** A product at a store: sold there (with optional price) or "not here". */
export interface ProductStore extends RecordModel {
  household: string;
  product: string;
  store: string;
  price: number; // 0 = unknown
  price_seen_at: string;
  dont_buy_here: boolean;
  reason: string;
}

export interface ListEntry extends RecordModel {
  household: string;
  item: string; // empty for one-off entries
  label: string; // name of a one-off entry
  qty: number;
  unit: string;
  note: string;
  store: string;
  product: string;
  added_by: string;
  in_cart: boolean;
  from_stock: boolean;
}

export type EventType =
  | 'added'
  | 'bought'
  | 'not_needed'
  | 'used_up'
  | 'stock_changed'
  | 'created'
  | 'edited';

export interface AppEvent extends RecordModel {
  household: string;
  type: EventType;
  item: string;
  label: string; // item name at the time (kept when the item is deleted)
  qty: number;
  unit: string;
  store: string;
  product: string;
  price: number;
  detail: string;
  user: string;
  expand?: { user?: User };
}

export interface TypedPocketBase extends PocketBase {
  collection(idOrName: 'users'): RecordService<User>;
  collection(idOrName: 'units'): RecordService<Unit>;
  collection(idOrName: 'categories'): RecordService<Category>;
  collection(idOrName: 'stores'): RecordService<Store>;
  collection(idOrName: 'item_types'): RecordService<ItemType>;
  collection(idOrName: 'item_stores'): RecordService<ItemStore>;
  collection(idOrName: 'products'): RecordService<Product>;
  collection(idOrName: 'product_stores'): RecordService<ProductStore>;
  collection(idOrName: 'list_entries'): RecordService<ListEntry>;
  collection(idOrName: 'events'): RecordService<AppEvent>;
  collection(idOrName: string): RecordService;
}
