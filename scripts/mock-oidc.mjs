// Minimal OpenID Connect provider for the e2e tests and local development:
// discovery, authorization code flow with PKCE (S256 required), token and
// userinfo endpoints. No dependencies. Never use it for a real install.
//
// /authorize shows a form where you (or the test) type the claims to return:
// sub, email, email_verified, name; "Cancel" returns error=access_denied.
// The sub "token-error" makes the token endpoint fail (provider error test).
//
//   node scripts/mock-oidc.mjs [port]          default 9099
//   MOCK_OIDC_HOST=0.0.0.0                     listen address (default 127.0.0.1)
//   MOCK_OIDC_ISSUER=http://host:9099          issuer + endpoint base URL
//   MOCK_OIDC_CLIENT_ID / MOCK_OIDC_CLIENT_SECRET   default shopapp / shopapp-secret
import http from 'node:http';
import crypto from 'node:crypto';

const host = process.env.MOCK_OIDC_HOST ?? '127.0.0.1';
const port = Number(process.argv[2] ?? process.env.MOCK_OIDC_PORT ?? 9099);
const issuer = process.env.MOCK_OIDC_ISSUER ?? `http://127.0.0.1:${port}`;
const CLIENT_ID = process.env.MOCK_OIDC_CLIENT_ID ?? 'shopapp';
const CLIENT_SECRET = process.env.MOCK_OIDC_CLIENT_SECRET ?? 'shopapp-secret';

const codes = new Map(); // code -> { claims, challenge, redirect_uri }
const tokens = new Map(); // access token -> claims
const b64url = (buf) => buf.toString('base64url');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function body(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => resolve(new URLSearchParams(data)));
  });
}
function json(res, status, obj) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(obj));
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, issuer);
    if (url.pathname === '/.well-known/openid-configuration') {
      return json(res, 200, {
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        userinfo_endpoint: `${issuer}/userinfo`,
        jwks_uri: `${issuer}/jwks`,
        response_types_supported: ['code'],
        code_challenge_methods_supported: ['S256'],
        scopes_supported: ['openid', 'email', 'profile']
      });
    }
    if (url.pathname === '/authorize' && req.method === 'GET') {
      const q = url.searchParams;
      if (q.get('client_id') !== CLIENT_ID) return json(res, 400, { error: 'unauthorized_client' });
      if (q.get('code_challenge_method') !== 'S256' || !q.get('code_challenge'))
        return json(res, 400, { error: 'invalid_request', error_description: 'PKCE S256 required' });
      const hidden = ['redirect_uri', 'state', 'code_challenge']
        .map((k) => `<input type="hidden" name="${k}" value="${esc(q.get(k) ?? '')}">`)
        .join('');
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end(`<!doctype html><title>Mock OIDC</title><form method="post" action="/authorize">${hidden}
<label>sub <input name="sub" value="user-1"></label>
<label>email <input name="email" value=""></label>
<label>name <input name="name" value=""></label>
<label><input type="checkbox" name="email_verified" value="true" checked> email_verified</label>
<button name="action" value="login">Sign in</button>
<button name="action" value="cancel">Cancel</button></form>`);
    }
    if (url.pathname === '/authorize' && req.method === 'POST') {
      const f = await body(req);
      const back = new URL(f.get('redirect_uri'));
      back.searchParams.set('state', f.get('state'));
      if (f.get('action') === 'cancel') {
        back.searchParams.set('error', 'access_denied');
      } else {
        const code = b64url(crypto.randomBytes(16));
        const claims = { sub: f.get('sub'), name: f.get('name') || undefined };
        if (f.get('email')) {
          claims.email = f.get('email');
          claims.email_verified = f.get('email_verified') === 'true';
        }
        codes.set(code, { claims, challenge: f.get('code_challenge'), redirect_uri: f.get('redirect_uri') });
        back.searchParams.set('code', code);
      }
      res.writeHead(302, { location: back.toString() });
      return res.end();
    }
    if (url.pathname === '/token' && req.method === 'POST') {
      const f = await body(req);
      let id = f.get('client_id');
      let secret = f.get('client_secret');
      const basic = req.headers.authorization?.match(/^Basic (.+)$/);
      if (basic) [id, secret] = Buffer.from(basic[1], 'base64').toString().split(':').map(decodeURIComponent);
      if (id !== CLIENT_ID || secret !== CLIENT_SECRET) return json(res, 401, { error: 'invalid_client' });
      const entry = codes.get(f.get('code'));
      codes.delete(f.get('code'));
      if (!entry) return json(res, 400, { error: 'invalid_grant' });
      if (entry.claims.sub === 'token-error') return json(res, 500, { error: 'server_error' });
      const verifier = f.get('code_verifier') ?? '';
      if (b64url(crypto.createHash('sha256').update(verifier).digest()) !== entry.challenge)
        return json(res, 400, { error: 'invalid_grant', error_description: 'PKCE verification failed' });
      if (f.get('redirect_uri') !== entry.redirect_uri) return json(res, 400, { error: 'invalid_grant' });
      const token = b64url(crypto.randomBytes(24));
      tokens.set(token, entry.claims);
      return json(res, 200, { access_token: token, token_type: 'Bearer', expires_in: 300 });
    }
    if (url.pathname === '/userinfo') {
      const claims = tokens.get(req.headers.authorization?.replace(/^Bearer /, ''));
      return claims ? json(res, 200, claims) : json(res, 401, { error: 'invalid_token' });
    }
    json(res, 404, { error: 'not_found' });
  })
  .listen(port, host, () => console.log(`mock OIDC provider on ${host}:${port}, issuer ${issuer}`));
