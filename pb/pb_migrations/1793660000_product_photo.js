/// <reference path="../pb_data/types.d.ts" />

// A photo per product, so whoever is shopping can see which pack to grab.
// The app shrinks photos to 1024 px before upload; the size limit is a
// safety net. Protected: the files are only served with a short-lived file
// token of a signed-in user (the collection's view rule still applies), so a
// leaked URL doesn't show the household's photos. SVG is not allowed (it can
// carry scripts).

migrate((app) => {
  const c = app.findCollectionByNameOrId("products");
  c.fields.add(new FileField({
    name: "photo",
    maxSelect: 1,
    maxSize: 3 * 1024 * 1024,
    mimeTypes: ["image/jpeg", "image/png", "image/webp"],
    thumbs: ["96x96", "480x0"],
    protected: true,
  }));
  app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("products");
  c.fields.removeByName("photo");
  app.save(c);
});
