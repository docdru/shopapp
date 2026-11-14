/// <reference path="../pb_data/types.d.ts" />

// Passwords: at least 10 characters, checked by the server.
// The account sheet already asked for 10, but only in the browser; the API
// still accepted PocketBase's default of 8. Superusers get 12 (the admin
// password comes from a password manager anyway).
// Only new or changed passwords are checked: existing shorter ones keep
// working until they are changed.

const setMin = (app, collection, min) => {
  const c = app.findCollectionByNameOrId(collection);
  c.fields.getByName("password").min = min;
  app.save(c);
};

migrate((app) => {
  setMin(app, "users", 10);
  setMin(app, "_superusers", 12);
}, (app) => {
  // back to PocketBase's default
  setMin(app, "users", 8);
  setMin(app, "_superusers", 8);
});
