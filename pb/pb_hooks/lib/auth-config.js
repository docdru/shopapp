/// <reference path="../../pb_data/types.d.ts" />

// Applies the sign-in settings from the environment to the users collection.
// Called from auth.pb.js at every start of `pocketbase serve`.
//
//   OIDC_ISSUER          issuer URL; endpoints are read from its discovery document
//   OIDC_AUTH_URL        optional: explicit endpoints, instead of (or overriding) discovery
//   OIDC_TOKEN_URL
//   OIDC_USERINFO_URL
//   OIDC_CLIENT_ID       client registered at the provider
//   OIDC_CLIENT_SECRET
//   OIDC_NAME            button label ("Sign in with <name>"), default "SSO"
//   PASSWORD_LOGIN       on (default) | off
//
// Nothing set = password only. PASSWORD_LOGIN=off is ignored (with a
// warning) unless the provider is fully configured, so a typo can't lock
// everybody out.

const PROVIDER = "oidc";
const TAG = "[sign-in]";

function env(name) {
  return String($os.getenv(name) || "").trim();
}

function warn(app, msg) {
  console.log(`${TAG} WARNING: ${msg}`);
  app.logger().warn(`${TAG} ${msg}`);
}

function discover(issuer) {
  const res = $http.send({
    url: issuer.replace(/\/+$/, "") + "/.well-known/openid-configuration",
    method: "GET",
    timeout: 10,
  });
  if (res.statusCode !== 200) throw new Error(`discovery answered HTTP ${res.statusCode}`);
  const doc = res.json || {};
  return {
    issuer: doc.issuer,
    authURL: doc.authorization_endpoint,
    tokenURL: doc.token_endpoint,
    userInfoURL: doc.userinfo_endpoint,
  };
}

/** The provider config to apply, or null (with the reason logged). */
function providerFromEnv(app, stored) {
  const issuer = env("OIDC_ISSUER");
  const clientId = env("OIDC_CLIENT_ID");
  const clientSecret = env("OIDC_CLIENT_SECRET");
  const explicit = {
    authURL: env("OIDC_AUTH_URL"),
    tokenURL: env("OIDC_TOKEN_URL"),
    userInfoURL: env("OIDC_USERINFO_URL"),
  };
  const anySet = issuer || clientId || clientSecret || explicit.authURL || explicit.tokenURL || explicit.userInfoURL;
  if (!anySet) return null;

  let urls = { authURL: "", tokenURL: "", userInfoURL: "" };
  if (issuer && !(explicit.authURL && explicit.tokenURL && explicit.userInfoURL)) {
    try {
      const found = discover(issuer);
      if (found.issuer && found.issuer.replace(/\/+$/, "") !== issuer.replace(/\/+$/, "")) {
        warn(app, `OIDC_ISSUER is ${issuer} but the provider calls itself ${found.issuer}`);
      }
      urls = found;
    } catch (err) {
      // The provider may just be down while this host boots. Keep the
      // endpoints of the last successful start for the same client.
      if (stored && stored.issuer === issuer && stored.clientId === clientId && stored.authURL && stored.tokenURL && stored.userInfoURL) {
        warn(app, `could not read ${issuer}/.well-known/openid-configuration (${err}); using the endpoints from the last start`);
        urls = { authURL: stored.authURL, tokenURL: stored.tokenURL, userInfoURL: stored.userInfoURL };
      } else {
        warn(app, `could not read ${issuer}/.well-known/openid-configuration (${err}); single sign-on is off`);
      }
    }
  }
  for (const k of Object.keys(explicit)) if (explicit[k]) urls[k] = explicit[k];

  const missing = [];
  if (!clientId) missing.push("OIDC_CLIENT_ID");
  if (!clientSecret) missing.push("OIDC_CLIENT_SECRET");
  if (!urls.authURL) missing.push("auth URL (OIDC_ISSUER or OIDC_AUTH_URL)");
  if (!urls.tokenURL) missing.push("token URL (OIDC_ISSUER or OIDC_TOKEN_URL)");
  if (!urls.userInfoURL) missing.push("userinfo URL (OIDC_ISSUER or OIDC_USERINFO_URL)");
  if (missing.length) {
    warn(app, `single sign-on is not fully configured, missing ${missing.join(", ")}; it stays off`);
    return null;
  }

  return {
    name: PROVIDER,
    displayName: env("OIDC_NAME") || "SSO",
    clientId,
    clientSecret,
    authURL: urls.authURL,
    tokenURL: urls.tokenURL,
    userInfoURL: urls.userInfoURL,
    pkce: true,
    // remembered for the fallback above (not used by PocketBase)
    extra: { shopappIssuer: issuer },
  };
}

function apply(app) {
  const users = app.findCollectionByNameOrId("users");

  let stored = null;
  for (const p of users.oauth2.providers || []) {
    if (p.name === PROVIDER) stored = { issuer: (p.extra || {}).shopappIssuer || "", clientId: p.clientId, authURL: p.authURL, tokenURL: p.tokenURL, userInfoURL: p.userInfoURL };
  }

  const provider = providerFromEnv(app, stored);

  const pwSetting = env("PASSWORD_LOGIN").toLowerCase() || "on";
  let password = true;
  if (pwSetting === "off") {
    if (provider) password = false;
    else warn(app, "PASSWORD_LOGIN=off is ignored: no single sign-on provider is fully configured, so password sign-in stays on");
  } else if (pwSetting !== "on") {
    warn(app, `PASSWORD_LOGIN=${pwSetting} is not on or off; password sign-in stays on`);
  }

  unmarshal(
    {
      oauth2: { enabled: !!provider, providers: provider ? [provider] : [] },
      passwordAuth: { enabled: password },
    },
    users,
  );
  app.save(users);

  const sso = provider ? `single sign-on "${provider.displayName}" (${provider.authURL})` : "no single sign-on";
  console.log(`${TAG} password sign-in ${password ? "on" : "off"}, ${sso}`);
}

module.exports = { apply };
