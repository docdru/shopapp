/// <reference path="../pb_data/types.d.ts" />

// Sign-in configuration (spec "Sign-in"): single sign-on through an OIDC
// provider and/or email + password for the users collection, set by
// environment variables and applied at every start of `pocketbase serve`.
// The logic lives in lib/auth-config.js (handlers can't share top-level code).
// Superusers are not touched.

onBootstrap((e) => {
  e.next();
  if (!$os.args.includes("serve")) return; // CLI commands (superuser upsert, migrate …) leave it alone

  // `serve` applies pending migrations only after bootstrap, and pb_hooks
  // can't hook in later. Run them now (it's a no-op when there are none), so
  // the settings land on the migrated users collection, also on a fresh install.
  e.app.runAllMigrations();

  require(`${__hooks}/lib/auth-config.js`).apply(e.app);
});

// The first single sign-on links the provider account to the existing user
// with the same (provider-verified) email. PocketBase resets the password of
// an *unverified* user when it links one (protection against accounts
// pre-created by an attacker with someone else's email). That can't happen
// here: there is no sign-up, the admin creates every account. So mark the
// account verified first, and its password keeps working while the family
// moves over. No matching account = no record (users.createRule is null).
onRecordAuthWithOAuth2Request((e) => {
  if (e.record && !e.isNewRecord && !e.record.verified()) {
    e.record.setVerified(true);
    e.app.save(e.record);
  }
  e.next();
}, "users");
