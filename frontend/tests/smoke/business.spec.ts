/**
 * Real backend + disposable Postgres. Billing / third-party providers stay
 * unused. Each chain is written so omitting the write, relaxing the private
 * gate, or skipping logout invalidation fails the assertion.
 */
import { expect, test, type APIRequestContext } from '@playwright/test'

const USER = 'smokeadmin'
const PASS = 'SmokePass1'
const SETUP_SECRET = process.env.MYRIAD_SETUP_SECRET || 'smoke-setup-secret'
const TAPP_ID = 'com.myriad.smoke-hello'

const MINIMAL_CORE = 'exports.onReady = function () {}'

function coreManifest(permissions: string[]) {
  return {
    id: TAPP_ID,
    name: 'Smoke Hello',
    version: '1.0.0',
    minSystemVersion: '0.4.0',
    category: 'utility',
    core: { entry: 'core.js' },
    permissions,
  }
}

function installBody(permissions: string[]) {
  return {
    source: 'direct',
    manifest: coreManifest(permissions),
    modules: { 'core.js': MINIMAL_CORE },
    permissions,
  }
}

async function csrf(request: APIRequestContext): Promise<string> {
  const response = await request.get('/api/csrf-token')
  expect(response.ok(), await response.text()).toBeTruthy()
  const body = (await response.json()) as { csrf_token?: string | null }
  expect(body.csrf_token, 'logged-in session must receive a CSRF token').toBeTruthy()
  return body.csrf_token as string
}

test.describe.serial('business smoke', () => {
  test('init, login, save settings, refresh reads them back', async ({ request }) => {
    const setup = await request.post('/api/setup/create-admin', {
      data: {
        username: USER,
        password: PASS,
        setup_secret: SETUP_SECRET,
      },
    })
    const setupStatus = setup.status()
    expect(
      setupStatus === 200 || setupStatus === 409,
      `create-admin ${setupStatus} ${await setup.text()}`,
    ).toBeTruthy()

    const login = await request.post('/api/auth/login', {
      data: { username: USER, password: PASS },
    })
    expect(login.ok(), await login.text()).toBeTruthy()

    const token = await csrf(request)
    const saved = await request.put('/api/config/module-visibility', {
      headers: { 'X-CSRF-Token': token },
      data: {
        modules: {
          library: 'all',
          brew: 'authenticated',
          reports: 'all',
          tapp: 'all',
          agent: 'all',
        },
        agentUsage: { guest: 'none', user: 'standard' },
      },
    })
    expect(saved.ok(), await saved.text()).toBeTruthy()

    const fresh = await request.newContext({
      extraHTTPHeaders: { Origin: 'http://localhost:1102' },
    })
    const loginAgain = await fresh.post('/api/auth/login', {
      data: { username: USER, password: PASS },
    })
    expect(loginAgain.ok(), await loginAgain.text()).toBeTruthy()
    const read = await fresh.get('/api/config/module-visibility')
    expect(read.ok(), await read.text()).toBeTruthy()
    const body = (await read.json()) as {
      preferences?: { modules?: { brew?: string } }
    }
    expect(
      body.preferences?.modules?.brew,
      'skipping the PUT would leave brew at the default "all"',
    ).toBe('authenticated')
    await fresh.dispose()
  })

  test('public guest can read public config; private tapp is hidden', async ({
    request,
  }) => {
    const login = await request.post('/api/auth/login', {
      data: { username: USER, password: PASS },
    })
    expect(login.ok(), await login.text()).toBeTruthy()
    const token = await csrf(request)

    const installed = await request.post('/api/tapps/install', {
      headers: { 'X-CSRF-Token': token },
      data: installBody(['storage:read', 'ui:theme']),
    })
    const installedStatus = installed.status()
    expect(
      installedStatus === 200 || installedStatus === 409,
      await installed.text(),
    ).toBeTruthy()

    const guest = await request.newContext({
      extraHTTPHeaders: { Origin: 'http://localhost:1102' },
    })
    const pub = await guest.get('/api/config/public')
    expect(pub.status(), 'public config must stay guest-readable').toBe(200)

    const adminConfig = await guest.get('/api/config')
    expect(
      adminConfig.status(),
      'relaxing this to 200 would expose admin config',
    ).toBe(401)

    const visible = await guest.get(`/api/tapps/${TAPP_ID}`)
    expect(visible.ok(), await visible.text()).toBeTruthy()

    const hide = await request.post(`/api/tapps/${TAPP_ID}/visibility`, {
      headers: { 'X-CSRF-Token': token },
      data: { visibility: 'admin' },
    })
    expect(hide.ok(), await hide.text()).toBeTruthy()

    const hidden = await guest.get(`/api/tapps/${TAPP_ID}`)
    expect(
      hidden.status(),
      'skipping visibility=admin would keep this 200 for guests',
    ).toBe(404)
    await guest.dispose()
  })

  test('tapp grant change and logout kill the previous runtime', async ({
    request,
  }) => {
    const login = await request.post('/api/auth/login', {
      data: { username: USER, password: PASS },
    })
    expect(login.ok(), await login.text()).toBeTruthy()
    const token = await csrf(request)

    const reveal = await request.post(`/api/tapps/${TAPP_ID}/visibility`, {
      headers: { 'X-CSRF-Token': token },
      data: { visibility: 'all' },
    })
    expect(reveal.ok(), await reveal.text()).toBeTruthy()

    const updated = await request.post(`/api/tapps/${TAPP_ID}/update`, {
      headers: { 'X-CSRF-Token': token },
      data: installBody(['ui:theme']),
    })
    expect(updated.ok(), await updated.text()).toBeTruthy()

    const grant = await request.post(`/api/tapps/${TAPP_ID}/runtime-grants`, {
      headers: { 'X-CSRF-Token': token },
      data: { instanceId: 'smoke-page-1', kind: 'page' },
    })
    expect(grant.ok(), await grant.text()).toBeTruthy()
    const issued = (await grant.json()) as { token?: string; permissions?: string[] }
    expect(issued.token).toBeTruthy()
    expect(
      issued.permissions ?? [],
      'approved-permission shrink must drop storage:read from the new grant',
    ).not.toContain('storage:read')
    expect(issued.permissions ?? []).toContain('ui:theme')

    const beforeLogout = await request.get('/api/auth/me')
    expect(beforeLogout.ok()).toBeTruthy()
    const me = (await beforeLogout.json()) as { authenticated?: boolean }
    expect(me.authenticated).toBe(true)

    const logout = await request.post('/api/auth/logout')
    expect(logout.ok(), await logout.text()).toBeTruthy()

    const after = await request.get('/api/auth/me')
    expect(after.ok()).toBeTruthy()
    const guestMe = (await after.json()) as { authenticated?: boolean }
    expect(
      guestMe.authenticated,
      'skipping token_version bump would leave this session authenticated',
    ).toBe(false)

    const staleGrant = await request.post(`/api/tapps/${TAPP_ID}/runtime-grants`, {
      headers: {
        'X-CSRF-Token': token,
        'X-Tapp-Runtime-Grant': issued.token ?? '',
      },
      data: { instanceId: 'smoke-page-2', kind: 'page' },
    })
    expect(
      staleGrant.status(),
      'an old cookie+grant must not mint a new runtime after logout',
    ).toBe(401)
  })
})
