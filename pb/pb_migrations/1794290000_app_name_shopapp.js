/// <reference path="../pb_data/types.d.ts" />

// The app is now called ShopApp. The name appears in PocketBase's dashboard
// and in the emails it sends (password reset, MFA codes).

migrate((app) => {
  const settings = app.settings();
  settings.meta.appName = "ShopApp";
  app.save(settings);
}, (app) => {
  const settings = app.settings();
  settings.meta.appName = "Family Shopping";
  app.save(settings);
});
