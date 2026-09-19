import { expect, test } from '@playwright/test'

for (const width of [390, 1440]) {
  test(`first welcome greeting visibly animates on the actual home at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.addInitScript(() => {
      localStorage.setItem('animation-preference', 'standard')
      const samples: number[] = []
      Object.assign(window, { welcomeSamples: samples })
      let frame = 0
      const tick = () => {
        const heading = document.querySelector('.widget-grid-item h2')
        if (heading) samples.push(Number(getComputedStyle(heading.parentElement!).opacity))
        if (++frame < 900) requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })
    await page.route('**/api/**', route => {
      const path = new URL(route.request().url()).pathname
      let data: unknown = { success: true, data: [], items: [], sources: [], installations: [] }
      if (path === '/api/setup/status') data = { is_setup_required: false }
      if (path === '/api/auth/me') data = { authenticated: false }
      if (path === '/api/config/ui') data = { dashboard_title: 'Welcome motion audit', dashboard_layout_mode: 'standard' }
      return route.fulfill({ json: data })
    })
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto('/')
    await expect(page.locator('.widget-grid-item h2').first()).toBeVisible({ timeout: 20000 })
    await expect.poll(() => page.evaluate(() => (window as any).welcomeSamples.some((value: number) => value > 0 && value < 0.99))).toBe(true)
    await expect(page.locator('.widget-grid-item h2').first().locator('..')).toHaveCSS('opacity', '1')
    expect(errors).toEqual([])
    console.log(JSON.stringify({ width, samples: await page.evaluate(() => (window as any).welcomeSamples.slice(0, 55)) }))
  })
}

for (const authenticated of [false, true]) {
 test(`user modal commits its entry on actual home (auth=${authenticated})`, async ({page}) => {
  await page.addInitScript(auth => {localStorage.setItem('animation-preference','standard'); if(auth) localStorage.setItem('myriad_session_hint','true')}, authenticated)
  const held = Promise.withResolvers<void>()
  let loginLoads=0
  if (!authenticated) await page.route('**/assets/LoginForm-*.js', async route => {loginLoads++; await held.promise; await route.continue()})
  await page.route('**/api/**', route => {
   const path = new URL(route.request().url()).pathname
   let data: unknown = {success:true,data:[],items:[],sources:[],installations:[],notifications:[],unread_count:0,total:0}
   if(path==='/api/setup/status') data={is_setup_required:false}
   if(path==='/api/auth/me') data=authenticated ? {authenticated:true,id:1,username:'fixture',is_admin:true,is_owner:true} : {authenticated:false}
   if(path==='/api/config/ui') data={dashboard_layout_mode:'standard'}
   return route.fulfill({json:data})
  })
  const errors:string[]=[]
  page.on('pageerror',error=>errors.push(error.message))
  await page.goto('/')
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('open-control-panel', {detail:{tab:'control'}})))
  await expect(page.locator('.user-info-button')).toBeAttached({timeout:20000})
  if(authenticated) await expect(page.locator('.user-info-button')).toContainText('fixture')
  await page.evaluate(()=>window.dispatchEvent(new Event('open-user-modal')))
  if (!authenticated) {
    await expect.poll(()=>loginLoads).toBe(1)
    await page.waitForTimeout(100)
    await expect(page.locator('.user-modal-login-only')).toHaveCount(0)
    held.resolve()
  }
  const modal=page.locator(authenticated?'.user-modal':'.user-modal-login-only')
  await expect(modal).toHaveClass(/animate-in/)
  await expect(modal).toBeVisible()
  await modal.locator('.user-modal-close-float').click()
  await expect(modal).toHaveCount(0)
  expect(errors).toEqual([])
 })
}

test('home layout import loads its editing code on demand and saves the selected layout', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('myriad_session_hint', 'true'))
  const saves: any[] = []
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('dialog', dialog => dialog.accept())
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname
    let data: unknown = { success: true, data: [], items: [], sources: [], installations: [], notifications: [], total: 0 }
    if (path === '/api/setup/status') data = { is_setup_required: false }
    if (path === '/api/auth/me') data = { authenticated: true, id: 1, username: 'fixture', is_admin: true, is_owner: true }
    if (path === '/api/csrf-token') data = { csrf_token: `v1.${'a'.repeat(16)}.${'b'.repeat(43)}`, expires_in: 3600 }
    if (path === '/api/config/ui') data = { dashboard_layout_mode: 'standard' }
    if (path === '/api/config/dashboard' && route.request().method() === 'POST') saves.push(route.request().postDataJSON())
    return route.fulfill({ json: data })
  })
  await page.goto('/')
  const edit = page.locator('[data-tour="home-edit"]').first()
  await expect(edit).toBeVisible({ timeout: 20000 })
  await edit.click()
  const chooserPending = page.waitForEvent('filechooser')
  await page.getByRole('button', {name: 'Import', exact: true}).click()
  const input = await chooserPending
  const welcome = { id: 'imported-welcome', type: 'welcome', size: '4x2', position: { x: 0, y: 0 } }
  await input.setFiles({ name: 'layout.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ kind: 'myriad.home-layout', v: 2, mode: 'standard', layouts: { standard: [welcome], free: [] }, assets: {} })) })
  await expect.poll(() => saves.some(save => typeof save.layout === 'string' && save.layout.includes('imported-welcome'))).toBe(true)
  expect(errors).toEqual([])
})

test('notification action loads on click and dispatches the room acceptance', async ({ page }) => {
  const { DEFAULT_NOTIFICATION_PREFERENCES, DEFAULT_NOTIFICATION_CATALOG } = await import('../../src/services/notificationPreferencesApi')
  await page.addInitScript(() => localStorage.setItem('myriad_session_hint', 'true'))
  const writes: string[] = []
  let actionLoads = 0
  page.on('request', request => { if (/notificationActions-.*\.js/.test(request.url())) actionLoads++ })
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname
    let data: unknown = { success: true, data: [], items: [], sources: [], installations: [], notifications: [], total: 0 }
    if (path === '/api/setup/status') data = { is_setup_required: false }
    if (path === '/api/auth/me') data = { authenticated: true, id: 1, username: 'fixture', is_admin: true, is_owner: true }
    if (path === '/api/csrf-token') data = { csrf_token: `v1.${'a'.repeat(16)}.${'b'.repeat(43)}`, expires_in: 3600 }
    if (path === '/api/config/ui') data = { dashboard_layout_mode: 'standard' }
    if (path === '/api/agent/notifications/preferences') data = { success: true, preferences: DEFAULT_NOTIFICATION_PREFERENCES, catalog: DEFAULT_NOTIFICATION_CATALOG }
    if (path === '/api/agent/notifications') data = { notifications: [{ id: 'invite', notification_type: 'federation_invite', priority: 'normal', title: 'Fixture invite', body: 'Invitation', user_id: 1, created_at: new Date().toISOString(), read: false, metadata: { kind: 'room_invite', room_id: 'fixture-room', actions: [{ id: 'accept' }] } }], unread_count: 1, total: 1 }
    if (route.request().method() === 'POST') writes.push(path)
    return route.fulfill({ json: data })
  })
  await page.goto('/')
  await expect(page.locator('.user-info-button')).toBeAttached({ timeout: 20000 })
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('open-control-panel', { detail: { tab: 'notifications' } })))
  const action = page.locator('.notif-overlay button').filter({ hasText: /^Confirm$|^Accept$/ })
  await expect(action).toBeVisible()
  expect(actionLoads).toBe(0)
  await action.click()
  await expect.poll(() => writes).toContain('/api/federation/rooms/fixture-room/accept')
  expect(actionLoads).toBe(1)
})
