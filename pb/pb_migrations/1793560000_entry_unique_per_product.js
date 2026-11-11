/// <reference path="../pb_data/types.d.ts" />

// A list entry can name a specific product. The same item may then be on the
// list twice: once generic ("any coffee beans") and once as a specific
// product. One open entry per (item, product) instead of per item.

const OLD = "CREATE UNIQUE INDEX idx_list_entries_item ON list_entries (item) WHERE item != '' AND in_cart = FALSE";
const NEW = "CREATE UNIQUE INDEX idx_list_entries_item ON list_entries (item, product) WHERE item != '' AND in_cart = FALSE";

migrate((app) => {
  const c = app.findCollectionByNameOrId("list_entries");
  c.indexes = c.indexes.filter((i) => !i.includes("idx_list_entries_item")).concat([NEW]);
  app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("list_entries");
  c.indexes = c.indexes.filter((i) => !i.includes("idx_list_entries_item")).concat([OLD]);
  app.save(c);
});
