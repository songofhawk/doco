import { expect, test } from '@playwright/test'

test('Session 恢复、知识库页面、Markdown 导入和 Token 管理', async ({ page }) => {
  let createdSpreadsheet = false
  let tokens: Array<{ id: string; name: string; scopes: string[]; created_at: number; revoked_at: null }> = []
  await page.route('**/app-api/v1/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname.replace('/app-api/v1', '')
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
    if (path === '/auth/me') return json({ user: { id: 'user-e2e', email: 'e2e@example.com', name: 'E2E 用户' } })
    if (path === '/kb' && request.method() === 'GET') return json([{ id: 1, name: '测试知识库' }])
    if (path === '/kb/1/folders') return json([])
    if (path === '/kb/1/docs') return json([
      { id: 'doc_test', title: '测试文档', kb_id: 1, document_type: 'document' },
      ...(createdSpreadsheet ? [{ id: 'doc_sheet', title: '测试电子表格', kb_id: 1, document_type: 'spreadsheet' }] : []),
    ])
    if (path === '/docs' && request.method() === 'POST') {
      const body = request.postDataJSON()
      expect(body.document_type).toBe('spreadsheet')
      createdSpreadsheet = true
      return json({ id: body.id, title: body.title, kb_id: 1, document_type: 'spreadsheet' })
    }
    if (path === '/docs/doc_test/path') return json({ doc_id: 'doc_test', folder_id: null, kb_id: 1 })
    if (path === '/docs/doc_test' && request.method() === 'GET') return json({ id: 'doc_test', title: '测试文档', heading_numbered: 0, bg_color: '#ffffff', collapsed_blocks: '' })
    if (path === '/docs/doc_test' && request.method() === 'PATCH') return json({ status: 'ok' })
    if (path === '/api-tokens' && request.method() === 'GET') return json({ tokens })
    if (path === '/api-tokens' && request.method() === 'POST') {
      const row = { id: 'tok_01ARZ3NDEKTSV4RRFFQ69G5FAV', name: 'E2E Agent', scopes: ['documents:read', 'documents:write'], created_at: Date.now(), revoked_at: null }
      tokens = [row]
      return json({ ...row, token: 'doco_tok_01ARZ3NDEKTSV4RRFFQ69G5FAV_e2e-secret-value' }, 201)
    }
    if (path.startsWith('/api-tokens/') && request.method() === 'DELETE') { tokens = []; return route.fulfill({ status: 204 }) }
    return json({ error: `未模拟 ${request.method()} ${path}` }, 404)
  })

  await page.goto('/doc/doc_test')
  await expect(page.getByText('E2E 用户')).toBeVisible()
  await expect(page.getByText('测试知识库')).toBeVisible()
  await expect(page.getByPlaceholder('无标题')).toHaveValue('测试文档')
  const documentCanvas = page.locator('.doco-document-canvas')
  await expect(documentCanvas.getByRole('button', { name: '导入文档' })).toBeVisible()
  await expect(documentCanvas.getByRole('button', { name: '导出文档' })).toBeVisible()
  await expect(page.locator('header').getByRole('button', { name: '导入文档' })).toHaveCount(0)

  await page.getByRole('button', { name: '收起侧边栏' }).click()
  await expect(page.locator('#doco-sidebar')).toBeHidden()
  await page.reload()
  await expect(page.getByRole('button', { name: '展开侧边栏' })).toBeVisible()
  await expect(page.locator('#doco-sidebar')).toBeHidden()
  await page.getByRole('button', { name: '展开侧边栏' }).click()
  await expect(page.locator('#doco-sidebar')).toBeVisible()
  await expect(page.getByText('测试知识库')).toBeVisible()

  const sidebar = page.locator('#doco-sidebar')
  const sidebarResizer = page.getByRole('separator', { name: '调整侧边栏宽度' })
  const [sidebarBoxBeforeResize, resizerBox] = await Promise.all([
    sidebar.boundingBox(),
    sidebarResizer.boundingBox(),
  ])
  if (!sidebarBoxBeforeResize || !resizerBox) throw new Error('侧边栏分隔线不可用')
  await page.mouse.move(resizerBox.x + resizerBox.width / 2, resizerBox.y + 120)
  await page.mouse.down()
  await page.mouse.move(resizerBox.x + resizerBox.width / 2 + 48, resizerBox.y + 120)
  await page.mouse.up()
  await expect.poll(async () => (await sidebar.boundingBox())?.width || 0).toBeGreaterThan(sidebarBoxBeforeResize.width + 40)
  await page.reload()
  await expect(sidebar).toBeVisible()
  await expect.poll(async () => (await sidebar.boundingBox())?.width || 0).toBeGreaterThan(sidebarBoxBeforeResize.width + 40)
  await page.screenshot({ path: '/tmp/doco-sidebar-resizer.png' })

  const kbRow = page.getByText('测试知识库').locator('..')
  await kbRow.getByRole('button').first().click()
  const newSpreadsheetEntry = page.getByRole('button', { name: '新建电子表格' })
  await expect(newSpreadsheetEntry).toBeVisible()
  await page.screenshot({ path: '/tmp/doco-new-spreadsheet-entry.png' })
  await newSpreadsheetEntry.click()
  await page.getByPlaceholder('请输入电子表格标题').fill('测试电子表格')
  await page.getByRole('button', { name: '确定' }).click()
  await expect(page.getByText('测试电子表格')).toBeVisible()
  await expect(page.getByLabel('电子表格')).toBeVisible()
  await page.goto('/doc/doc_test')

  const fileInput = page.locator('input[type="file"][accept*=".md"]')
  await fileInput.setInputFiles({ name: 'import.md', mimeType: 'text/markdown', buffer: Buffer.from('# API v1\n\n导入内容') })
  await expect(page.locator('.ProseMirror')).toContainText('导入内容')

  const tocTrigger = page.locator('.toc-trigger')
  await expect(tocTrigger).toBeVisible()
  await page.getByRole('button', { name: '收起侧边栏' }).click()
  await expect(page.locator('#doco-sidebar')).toBeHidden()
  await expect.poll(async () => {
    const [tocBox, canvasBox] = await Promise.all([
      tocTrigger.boundingBox(),
      documentCanvas.boundingBox(),
    ])
    return Boolean(tocBox && canvasBox && tocBox.x + tocBox.width <= canvasBox.x)
  }).toBe(true)
  await page.getByRole('button', { name: '展开侧边栏' }).click()
  await expect(page.locator('#doco-sidebar')).toBeVisible()

  await page.locator('.ProseMirror').click()
  await page.keyboard.press('Control+End')
  await page.keyboard.press('Enter')
  await page.keyboard.type('/dzbg')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('grid', { name: '电子表格' })).toBeVisible()

  const cells = page.getByRole('gridcell')
  const formula = page.getByRole('textbox', { name: '公式栏' })
  await cells.nth(0).click()
  await formula.fill('10')
  await cells.nth(1).click()
  await formula.fill('20')
  await cells.nth(2).click()
  await formula.fill('=SUM(A1:B1)')
  await expect(cells.nth(2)).toHaveText('30')

  await page.getByRole('button', { name: '账户菜单' }).click()
  await page.getByRole('menuitem', { name: 'API Token' }).click()
  await expect(page.getByRole('dialog', { name: '开放 API Token' })).toBeVisible()
  await page.getByPlaceholder('例如：本地 Agent').fill('E2E Agent')
  await page.getByRole('button', { name: '创建 Token' }).click()
  await expect(page.getByText('请立即复制，关闭后无法再次查看')).toBeVisible()
  await expect(page.getByText(/doco_tok_01ARZ3NDEKTSV4RRFFQ69G5FAV/)).toBeVisible()
  await expect(page.getByText('E2E Agent')).toBeVisible()
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('dialog', { name: '开放 API Token' }).getByTitle('撤销').click()
  await expect(page.getByText('尚未创建 Token')).toBeVisible()
  await page.getByRole('button', { name: '关闭' }).click()
  await expect(page.getByRole('dialog', { name: '开放 API Token' })).toBeHidden()

  await page.reload()
  await expect(page.getByText('E2E 用户')).toBeVisible()
  await expect(page.locator('.ProseMirror')).toContainText('导入内容')
})

test('登录页只提供邮箱验证码和 Google 登录', async ({ page }) => {
  let signedIn = false
  await page.route('**/app-api/v1/**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname.replace('/app-api/v1', '')
    const json = (body: unknown, status = 200) => route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(body),
    })
    if (path === '/auth/me') {
      return signedIn
        ? json({ user: { id: 'google-user', email: 'google.user@example.com', name: 'Google 用户' } })
        : json({ error: 'Unauthorized' }, 401)
    }
    if (path === '/auth/email/code' && request.method() === 'POST') {
      expect(request.postDataJSON()).toEqual({ email: 'google.user@example.com' })
      return json({ status: 'ok', expiresInSeconds: 600, retryAfterSeconds: 60 })
    }
    if (path === '/auth/email/verify' && request.method() === 'POST') {
      expect(request.postDataJSON()).toEqual({ email: 'google.user@example.com', code: '123456' })
      signedIn = true
      return json({ user: { id: 'google-user', email: 'google.user@example.com', name: 'Google 用户' } })
    }
    if (path === '/kb') return json([])
    return json({ error: `未模拟 ${request.method()} ${path}` }, 404)
  })

  await page.goto('/')
  await expect(page.getByText('使用邮箱或 Google 账号登录')).toBeVisible()
  await expect(page.getByText('密码登录')).toHaveCount(0)
  await page.getByLabel('邮箱地址').fill('google.user@example.com')
  await page.getByRole('button', { name: '发送验证码' }).click()
  await page.getByLabel('输入 6 位验证码').fill('123456')
  await page.getByRole('button', { name: '登录' }).click()
  await expect(page.getByText('Google 用户')).toBeVisible()
})

test('冷感与纸感外观会统一应用到应用和电子表格并持久化', async ({ page }) => {
  let appearanceTheme: 'simple' | 'paper' = 'simple'
  await page.route('**/app-api/v1/**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname.replace('/app-api/v1', '')
    const json = (body: unknown, status = 200) => route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(body),
    })

    if (path === '/auth/me') {
      return json({ user: { id: 'theme-e2e', email: 'theme@example.com', name: '主题测试', appearanceTheme } })
    }
    if (path === '/auth/preferences' && request.method() === 'PATCH') {
      appearanceTheme = request.postDataJSON().appearanceTheme
      return json({ user: { id: 'theme-e2e', email: 'theme@example.com', name: '主题测试', appearanceTheme } })
    }
    if (path === '/kb') return json([{ id: 1, name: '主题知识库' }])
    if (path === '/kb/1/folders') return json([])
    if (path === '/kb/1/docs') return json([
      { id: 'doc_theme', title: '主题文档', kb_id: 1, document_type: 'document' },
      { id: 'doc_theme_sheet', title: '主题电子表格', kb_id: 1, document_type: 'spreadsheet' },
    ])
    if (path === '/docs/doc_theme/path') return json({ doc_id: 'doc_theme', folder_id: null, kb_id: 1 })
    if (path === '/docs/doc_theme' && request.method() === 'GET') {
      return json({ id: 'doc_theme', title: '主题文档', document_type: 'document', heading_numbered: 0, bg_color: '#ffffff', collapsed_blocks: '' })
    }
    if (path === '/docs/doc_theme' && request.method() === 'PATCH') return json({ status: 'ok' })
    if (path === '/docs/doc_theme_sheet/path') return json({ doc_id: 'doc_theme_sheet', folder_id: null, kb_id: 1 })
    if (path === '/docs/doc_theme_sheet' && request.method() === 'GET') {
      return json({ id: 'doc_theme_sheet', title: '主题电子表格', document_type: 'spreadsheet' })
    }
    if (path === '/docs/doc_theme_sheet' && request.method() === 'PATCH') return json({ status: 'ok' })
    return json({ error: `未模拟 ${request.method()} ${path}` }, 404)
  })

  await page.goto('/doc/doc_theme_sheet')
  const app = page.locator('.doco-app')
  const firstCell = page.getByRole('gridcell').nth(1)
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'simple')
  await expect(app).toHaveCSS('background-color', 'rgb(249, 250, 251)')
  await expect(firstCell).toHaveCSS('background-color', 'rgb(255, 255, 255)')

  await page.getByRole('button', { name: '账户菜单' }).click()
  await page.getByRole('menuitemradio', { name: /纸感/ }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'paper')
  await expect(app).toHaveCSS('background-color', 'rgb(245, 244, 237)')
  await expect(page.locator('.doco-sidebar')).toHaveCSS('background-color', 'rgb(247, 246, 241)')
  await expect(firstCell).toHaveCSS('background-color', 'rgb(250, 249, 245)')
  await page.screenshot({ path: '/tmp/doco-paper-theme.png', fullPage: true })

  await page.goto('/doc/doc_theme')
  const documentCanvas = page.locator('.doco-document-canvas')
  await expect(documentCanvas).toHaveCSS('background-color', 'rgb(250, 249, 245)')
  await expect(page.getByPlaceholder('无标题')).toHaveCSS('font-family', /Georgia/)

  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'paper')
  await expect(documentCanvas).toHaveCSS('background-color', 'rgb(250, 249, 245)')

  await page.getByRole('button', { name: '账户菜单' }).click()
  await page.getByRole('menuitemradio', { name: /冷感/ }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'simple')
  await expect(documentCanvas).toHaveCSS('background-color', 'rgb(255, 255, 255)')
  await page.goto('/doc/doc_theme_sheet')
  await expect(firstCell).toHaveCSS('background-color', 'rgb(255, 255, 255)')
  await page.screenshot({ path: '/tmp/doco-simple-theme.png', fullPage: true })
})

test('反复重新挂载协同编辑器不会累积空段落', async ({ page }) => {
  const docId = `doc_mount_${Date.now()}`
  await page.route('**/app-api/v1/**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname.replace('/app-api/v1', '')
    const json = (body: unknown, status = 200) => route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(body),
    })

    if (path === '/auth/me') return json({ user: { id: 'mount-e2e', email: 'mount@example.com', name: '挂载测试' } })
    if (path === '/kb') return json([{ id: 1, name: '挂载测试库' }])
    if (path === '/kb/1/folders') return json([])
    if (path === '/kb/1/docs') return json([{ id: docId, title: '挂载回归', kb_id: 1, document_type: 'document' }])
    if (path === `/docs/${docId}/path`) return json({ doc_id: docId, folder_id: null, kb_id: 1 })
    if (path === `/docs/${docId}` && request.method() === 'GET') {
      return json({
        id: docId,
        title: '挂载回归',
        document_type: 'document',
        heading_numbered: 0,
        bg_color: '#ffffff',
        collapsed_blocks: '',
      })
    }
    if (path === `/docs/${docId}` && request.method() === 'PATCH') return json({ status: 'ok' })
    return json({ error: `未模拟 ${request.method()} ${path}` }, 404)
  })

  const emptyTopLevelParagraphs = () => page.locator('.ProseMirror > p').evaluateAll(
    paragraphs => paragraphs.filter(paragraph => !(paragraph.textContent || '').trim()).length,
  )

  await page.goto(`/doc/${docId}`)
  await expect(page.getByPlaceholder('无标题')).toHaveValue('挂载回归')
  await expect(page.getByLabel('正在恢复本地文档')).toBeHidden()
  await expect(page.locator('.ProseMirror')).toBeVisible()
  const initialEmptyParagraphs = await emptyTopLevelParagraphs()

  for (let index = 0; index < 3; index += 1) {
    await page.reload()
    await expect(page.getByPlaceholder('无标题')).toHaveValue('挂载回归')
    await expect(page.getByLabel('正在恢复本地文档')).toBeHidden()
    await expect(page.locator('.ProseMirror')).toBeVisible()
  }

  expect(await emptyTopLevelParagraphs()).toBe(initialEmptyParagraphs)
})
