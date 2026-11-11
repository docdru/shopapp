/// <reference path="../pb_data/types.d.ts" />

// events.detail: short extra info, e.g. the new stock state ("low") or
//   "from stock" for entries the stock screen added.
// list_entries.from_stock: entry was added automatically because the item
//   ran out (shown as a "from stock" badge on the list).

migrate((app) => {
  const events = app.findCollectionByNameOrId("events");
  events.fields.add(new TextField({ name: "detail", max: 100 }));
  app.save(events);

  const entries = app.findCollectionByNameOrId("list_entries");
  entries.fields.add(new BoolField({ name: "from_stock" }));
  app.save(entries);
}, (app) => {
  const events = app.findCollectionByNameOrId("events");
  events.fields.removeByName("detail");
  app.save(events);

  const entries = app.findCollectionByNameOrId("list_entries");
  entries.fields.removeByName("from_stock");
  app.save(entries);
});
