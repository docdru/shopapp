/// <reference path="../pb_data/types.d.ts" />

// Initial schema for the family shopping app.
// See docs/spec.md → "Data model". Every household-owned collection carries a
// `household` relation and is only visible to users of that household.

migrate((app) => {
  // --- shared API rules --------------------------------------------------
  const sameHousehold = "household = @request.auth.household";
  const createInHousehold =
    '@request.auth.id != "" && @request.body.household = @request.auth.household';
  const householdRules = {
    listRule: sameHousehold,
    viewRule: sameHousehold,
    createRule: createInHousehold,
    updateRule: sameHousehold + " && (@request.body.household:isset = false || @request.body.household = @request.auth.household)",
    deleteRule: sameHousehold,
  };

  const created = () => ({ name: "created", type: "autodate", onCreate: true, onUpdate: false });
  const updated = () => ({ name: "updated", type: "autodate", onCreate: true, onUpdate: true });

  const save = (def) => {
    const c = new Collection(def);
    app.save(c);
    return c;
  };

  // --- households ----------------------------------------------------------
  const households = save({
    type: "base",
    name: "households",
    listRule: "id = @request.auth.household",
    viewRule: "id = @request.auth.household",
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      { name: "name", type: "text", required: true, max: 100 },
      created(),
      updated(),
    ],
  });

  const householdField = () => ({
    name: "household",
    type: "relation",
    required: true,
    collectionId: households.id,
    maxSelect: 1,
    cascadeDelete: true,
  });

  // --- users: one login per family member ---------------------------------
  const users = app.findCollectionByNameOrId("users");
  users.fields.add(new RelationField({
    name: "household",
    required: true,
    collectionId: households.id,
    maxSelect: 1,
    cascadeDelete: false,
  }));
  users.fields.add(new TextField({ name: "color", max: 20 })); // chip colour in the log
  // Accounts are created by the admin only; no public sign-up.
  users.listRule = "household = @request.auth.household";
  users.viewRule = "household = @request.auth.household";
  users.createRule = null;
  users.updateRule = "id = @request.auth.id && @request.body.household:isset = false";
  users.deleteRule = null;
  app.save(users);

  // --- units (global, shared by all households) ---------------------------
  const units = save({
    type: "base",
    name: "units",
    listRule: '@request.auth.id != ""',
    viewRule: '@request.auth.id != ""',
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      { name: "name", type: "text", required: true, max: 30 },  // "pack"
      { name: "short", type: "text", max: 10 },                 // "pk"
      { name: "sort", type: "number", onlyInt: true },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_units_name ON units (name)"],
  });

  // --- categories & stores --------------------------------------------------
  const categories = save({
    type: "base",
    name: "categories",
    ...householdRules,
    fields: [
      householdField(),
      { name: "name", type: "text", required: true, max: 60 },
      { name: "sort", type: "number", onlyInt: true },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_categories_name ON categories (household, name COLLATE NOCASE)"],
  });

  const stores = save({
    type: "base",
    name: "stores",
    ...householdRules,
    fields: [
      householdField(),
      { name: "name", type: "text", required: true, max: 60 },
      { name: "type", type: "text", max: 30 }, // "drugstore", "supermarket", "market", "online"
      { name: "sort", type: "number", onlyInt: true },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_stores_name ON stores (household, name COLLATE NOCASE)"],
  });

  // --- item types: the shopping-list vocabulary ("Milk", "Detergent") ------
  const items = save({
    type: "base",
    name: "item_types",
    ...householdRules,
    fields: [
      householdField(),
      { name: "name", type: "text", required: true, max: 100 },
      { name: "aliases", type: "text", max: 300 }, // comma-separated search terms ("Waschmittel")
      { name: "category", type: "relation", collectionId: categories.id, maxSelect: 1 },
      { name: "default_qty", type: "number", min: 0 },
      { name: "default_unit", type: "relation", collectionId: units.id, maxSelect: 1 },
      { name: "track_stock", type: "bool" },
      { name: "stock_state", type: "select", values: ["ok", "low", "out"], maxSelect: 1 },
      { name: "restock_at", type: "select", values: ["out", "low"], maxSelect: 1 },
      { name: "notes", type: "text", max: 500 },
      created(),
      updated(),
    ],
    indexes: ["CREATE UNIQUE INDEX idx_item_types_name ON item_types (household, name COLLATE NOCASE)"],
  });

  // Preferred / avoid store per item, with a reason.
  save({
    type: "base",
    name: "item_stores",
    ...householdRules,
    fields: [
      householdField(),
      { name: "item", type: "relation", required: true, collectionId: items.id, maxSelect: 1, cascadeDelete: true },
      { name: "store", type: "relation", required: true, collectionId: stores.id, maxSelect: 1, cascadeDelete: true },
      { name: "verdict", type: "select", required: true, values: ["preferred", "avoid"], maxSelect: 1 },
      { name: "reason", type: "text", max: 200 },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_item_stores ON item_stores (item, store)"],
  });

  // --- products (specific brand / package of an item type) ---------------
  const products = save({
    type: "base",
    name: "products",
    ...householdRules,
    fields: [
      householdField(),
      { name: "item", type: "relation", required: true, collectionId: items.id, maxSelect: 1, cascadeDelete: true },
      { name: "name", type: "text", required: true, max: 120 },
      { name: "brand", type: "text", max: 60 },
      { name: "pack_qty", type: "number", min: 0 },
      { name: "pack_unit", type: "relation", collectionId: units.id, maxSelect: 1 },
      { name: "verdict", type: "select", values: ["preferred", "ok", "dont_buy"], maxSelect: 1 },
      { name: "reason", type: "text", max: 200 },
      { name: "barcode", type: "text", max: 32 },
      created(),
      updated(),
    ],
  });

  // Latest price per store, plus a store-specific "don't buy here".
  save({
    type: "base",
    name: "product_stores",
    ...householdRules,
    fields: [
      householdField(),
      { name: "product", type: "relation", required: true, collectionId: products.id, maxSelect: 1, cascadeDelete: true },
      { name: "store", type: "relation", required: true, collectionId: stores.id, maxSelect: 1, cascadeDelete: true },
      { name: "price", type: "number", min: 0 },
      { name: "price_seen_at", type: "date" },
      { name: "dont_buy_here", type: "bool" },
      { name: "reason", type: "text", max: 200 },
      updated(),
    ],
    indexes: ["CREATE UNIQUE INDEX idx_product_stores ON product_stores (product, store)"],
  });

  // --- the shopping list ----------------------------------------------------
  // An entry points at an item type, or is a one-off with only a `label`.
  // One open entry per item type: adding it again bumps the quantity.
  // Bought entries stay (in_cart) until the cart is cleared; the log keeps history.
  save({
    type: "base",
    name: "list_entries",
    ...householdRules,
    fields: [
      householdField(),
      { name: "item", type: "relation", collectionId: items.id, maxSelect: 1, cascadeDelete: true },
      { name: "label", type: "text", max: 100 },
      { name: "qty", type: "number", min: 0 },
      { name: "unit", type: "relation", collectionId: units.id, maxSelect: 1 },
      { name: "note", type: "text", max: 200 },
      { name: "store", type: "relation", collectionId: stores.id, maxSelect: 1 },
      { name: "product", type: "relation", collectionId: products.id, maxSelect: 1 },
      { name: "added_by", type: "relation", collectionId: users.id, maxSelect: 1 },
      // "in_cart" = bought, shown with Undo until the cart is cleared
      { name: "in_cart", type: "bool" },
      created(),
      updated(),
    ],
    indexes: ["CREATE UNIQUE INDEX idx_list_entries_item ON list_entries (item) WHERE item != '' AND in_cart = FALSE"],
  });

  // --- event log: append-only history, source for suggestions later ------
  save({
    type: "base",
    name: "events",
    listRule: sameHousehold,
    viewRule: sameHousehold,
    createRule: createInHousehold + " && @request.body.user = @request.auth.id",
    updateRule: null,
    deleteRule: null,
    fields: [
      householdField(),
      { name: "type", type: "select", required: true, maxSelect: 1,
        values: ["added", "bought", "not_needed", "used_up", "stock_changed", "created", "edited"] },
      { name: "item", type: "relation", collectionId: items.id, maxSelect: 1 },
      { name: "label", type: "text", max: 100 },
      { name: "qty", type: "number", min: 0 },
      { name: "unit", type: "relation", collectionId: units.id, maxSelect: 1 },
      { name: "store", type: "relation", collectionId: stores.id, maxSelect: 1 },
      { name: "product", type: "relation", collectionId: products.id, maxSelect: 1 },
      { name: "price", type: "number", min: 0 },
      { name: "user", type: "relation", required: true, collectionId: users.id, maxSelect: 1 },
      created(),
    ],
    indexes: ["CREATE INDEX idx_events_created ON events (household, created)"],
  });
}, (app) => {
  const names = ["events", "list_entries", "product_stores", "products",
    "item_stores", "item_types", "stores", "categories", "units"];
  for (const n of names) {
    app.delete(app.findCollectionByNameOrId(n));
  }
  const users = app.findCollectionByNameOrId("users");
  // back to PocketBase's default rules for "users"
  users.listRule = "id = @request.auth.id";
  users.viewRule = "id = @request.auth.id";
  users.createRule = "";
  users.updateRule = "id = @request.auth.id";
  users.deleteRule = "id = @request.auth.id";
  users.fields.removeByName("household");
  users.fields.removeByName("color");
  app.save(users);
  app.delete(app.findCollectionByNameOrId("households"));
});
