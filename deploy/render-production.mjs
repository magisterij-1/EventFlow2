import { createHash, randomBytes } from 'node:crypto';
import { appendFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is missing from the production configuration`);
  return value;
}

const apiKey = required('RENDER_API_KEY');
const ownerId = required('RENDER_OWNER_ID');
const registryCredentialId = required('RENDER_REGISTRY_CREDENTIAL_ID');
const databaseUrl = required('DATABASE_URL');
const clientSecret = required('KEYCLOAK_BACKEND_CLIENT_SECRET');
const keycloakUrl = required('PRODUCTION_KEYCLOAK_URL').replace(/\/+$/, '');
const keycloakIssuer = `${keycloakUrl}/realms/EventFlow`;
const name = process.env.RENDER_SERVICE_NAME || 'eventflow-production';

async function verifyKeycloak() {
  const url = new URL(keycloakUrl);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('PRODUCTION_KEYCLOAK_URL must be a public HTTPS base URL');
  }

  const discovery = await fetch(`${keycloakIssuer}/.well-known/openid-configuration`, {
    signal: AbortSignal.timeout(30000)
  });
  if (!discovery.ok || (await discovery.json()).issuer !== keycloakIssuer) {
    throw new Error('The production Keycloak realm does not advertise the expected issuer');
  }

  const token = await fetch(`${keycloakIssuer}/protocol/openid-connect/token`, {
    method: 'POST',
    redirect: 'error',
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: 'eventflow-backend',
      client_secret: clientSecret
    }),
    signal: AbortSignal.timeout(30000)
  });
  if (!token.ok) throw new Error('Keycloak rejected the production backend client credentials');
  await token.body?.cancel();
}

async function render(path, method = 'GET', body) {
  const response = await fetch(`https://api.render.com/v1${path}`, {
    method,
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30000)
  });
  if (!response.ok) throw new Error(`Render API ${method} ${path} returned HTTP ${response.status}`);
  return response.json();
}

async function startDeploy(imagePath) {
  const query = new URLSearchParams({ ownerId, name });
  const services = await render(`/services?${query}`);
  const existing = services.find(({ service }) => service.name === name)?.service;

  if (existing) {
    const repository = (image) => image?.replace(/@[^/]+$|:[^/]+$/, '');
    if (existing.type !== 'web_service' || repository(existing.imagePath) !== repository(imagePath)) {
      throw new Error('The Render service name already belongs to a different deployment source');
    }
    const deploy = await render(`/services/${existing.id}/deploys`, 'POST', { imageUrl: imagePath });
    return { service: existing, deployId: deploy.id };
  }

  return render('/services', 'POST', {
    type: 'web_service', name, ownerId, autoDeploy: 'no',
    image: { ownerId, imagePath, registryCredentialId },
    serviceDetails: {
      runtime: 'image',
      plan: process.env.RENDER_PLAN || 'free',
      region: process.env.RENDER_REGION || 'frankfurt',
      healthCheckPath: '/api/db-test'
    },
    envVars: Object.entries({
      DATABASE_URL: databaseUrl,
      KEYCLOAK_URL: keycloakUrl,
      KEYCLOAK_ISSUER: keycloakIssuer,
      KEYCLOAK_REALM: 'EventFlow',
      KEYCLOAK_BACKEND_CLIENT_ID: 'eventflow-backend',
      KEYCLOAK_BACKEND_CLIENT_SECRET: clientSecret
    }).map(([key, value]) => ({ key, value }))
  });
}

async function waitForDeploy(service, deployId) {
  if (!service?.id || !deployId) throw new Error('Render did not return a deploy ID');
  const pending = new Set(['created', 'queued', 'build_in_progress', 'pre_deploy_in_progress', 'update_in_progress']);
  const deadline = Date.now() + 10 * 60 * 1000;

  while (Date.now() < deadline) {
    const { status } = await render(`/services/${service.id}/deploys/${deployId}`);
    if (status === 'live') return;
    if (!pending.has(status)) throw new Error(`Render deploy ${deployId} ended with status ${status}`);
    await delay(10000);
  }

  throw new Error(`Timed out waiting for Render deploy ${deployId}`);
}

async function verifyBrowserLogin(url) {
  const redirect = new URL('/', url);
  const login = new URL(`${keycloakIssuer}/protocol/openid-connect/auth`);
  login.search = new URLSearchParams({
    client_id: 'eventflow-frontend',
    redirect_uri: redirect.href,
    response_type: 'code',
    scope: 'openid',
    prompt: 'none',
    code_challenge_method: 'S256',
    code_challenge: createHash('sha256').update(randomBytes(32).toString('base64url')).digest('base64url')
  });
  const response = await fetch(login, { redirect: 'manual', signal: AbortSignal.timeout(30000) });
  const location = response.headers.get('location');
  const callback = location ? new URL(location, login) : null;
  if (response.status < 300 || response.status >= 400 || callback?.origin !== redirect.origin ||
      callback.pathname !== redirect.pathname || callback.searchParams.get('error') !== 'login_required') {
    throw new Error(`Keycloak rejected the frontend callback. Check eventflow-frontend redirect URIs for ${redirect.origin}`);
  }
}

if (process.argv.includes('--check-config')) {
  await verifyKeycloak();
} else {
  const { service, deployId } = await startDeploy(required('RENDER_IMAGE'));
  await waitForDeploy(service, deployId);
  const { serviceDetails: { url } } = await render(`/services/${service.id}`);
  const [page, events] = await Promise.all([
    fetch(url, { signal: AbortSignal.timeout(30000) }),
    fetch(new URL('/api/events', url), { signal: AbortSignal.timeout(30000) })
  ]);
  if (!page.ok || !(await page.text()).includes('id="root"')) throw new Error('The public frontend is unavailable');
  if (!events.ok || !Array.isArray((await events.json()).events)) throw new Error('The public events API is unavailable');
  await verifyBrowserLogin(url);
  await appendFile(required('GITHUB_OUTPUT'), `url=${url}\n`);
  console.log(`EventFlow is live at ${url}`);
}
