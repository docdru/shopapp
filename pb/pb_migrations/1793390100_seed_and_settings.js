/// <reference path="../pb_data/types.d.ts" />

// App settings for running behind nginx, plus seed data: units, one household
// with the stores and categories from the spec. Family member accounts are
// created by the admin in the PocketBase dashboard (see README).

migrate((app) => {
  // --- settings -----------------------------------------------------------
  const settings = app.settings();
  settings.meta.appName = "Family Shopping";
  // nginx sets X-Real-IP; needed for correct rate limiting and logs.
  settings.trustedProxy.headers = ["X-Real-IP"];
  settings.trustedProxy.useLeftmostIP = false;
  settings.rateLimits.enabled = true;
  app.save(settings);

  const insert = (collection, data) => {
    const r = new Record(app.findCollectionByNameOrId(collection));
    for (const [k, v] of Object.entries(data)) r.set(k, v);
    app.save(r);
    return r;
  };

  // --- units ---------------------------------------------------------------
  [
    ["piece", "×"], ["pack", "pk"], ["bottle", "btl"], ["can", "can"], ["jar", "jar"],
    ["g", "g"], ["kg", "kg"], ["ml", "ml"], ["l", "l"],
  ].forEach(([name, short], i) => insert("units", { name, short, sort: i }));

  // --- default household ---------------------------------------------------
  const household = insert("households", { name: "Family" });

  [["dm", "drugstore"], ["Edeka", "supermarket"], ["Aldi", "supermarket"], ["Weekly market", "market"]]
    .forEach(([name, type], i) => insert("stores", { household: household.id, name, type, sort: i }));

  ["Produce", "Bakery", "Dairy", "Pantry", "Drugstore", "Cleaning", "Other"].forEach((name, i) =>
    insert("categories", { household: household.id, name, sort: i }));
}, (app) => {
  for (const n of ["categories", "stores", "units", "households"]) {
    app.db().newQuery(`DELETE FROM ${n}`).execute();
  }
});
