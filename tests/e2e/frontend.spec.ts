import { expect, test } from '@playwright/test'

test('Session 恢复、知识库页面、Markdown 导入和 Token 管理', async ({ page }) => {
  let tokens: Array<{ id: string; name: string; scopes: string[]; created_at: number; revoked_at: null }> = []
  await page.route('**/app-api/v1/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname.replace('/app-api/v1', '')
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
    if (path === '/auth/me') return json({ user: { id: 'user-e2e', email: 'e2e@example.com', name: 'E2E 用户' } })
    if (path === '/kb' && request.method() === 'GET') return json([{ id: 1, name: '测试知识库' }])
    if (path === '/kb/1/folders') return json([])
    if (path === '/kb/1/docs') return json([{ id: 'doc_test', title: '测试文档', kb_id: 1 }])
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

  const fileInput = page.locator('input[type="file"][accept*=".md"]')
  await fileInput.setInputFiles({ name: 'import.md', mimeType: 'text/markdown', buffer: Buffer.from('# API v1\n\n导入内容') })
  await expect(page.locator('.ProseMirror')).toContainText('导入内容')

  await page.getByRole('button', { name: /API Token/ }).click()
  await expect(page.getByRole('dialog', { name: '开放 API Token' })).toBeVisible()
  await page.getByPlaceholder('例如：本地 Agent').fill('E2E Agent')
  await page.getByRole('button', { name: '创建 Token' }).click()
  await expect(page.getByText('请立即复制，关闭后无法再次查看')).toBeVisible()
  await expect(page.getByText(/doco_tok_01ARZ3NDEKTSV4RRFFQ69G5FAV/)).toBeVisible()
  await expect(page.getByText('E2E Agent')).toBeVisible()
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByTitle('撤销').click()
  await expect(page.getByText('尚未创建 Token')).toBeVisible()
  await page.getByRole('button', { name: '关闭' }).click()
  await expect(page.getByRole('dialog', { name: '开放 API Token' })).toBeHidden()

  await page.reload()
  await expect(page.getByText('E2E 用户')).toBeVisible()
  await expect(page.locator('.ProseMirror')).toContainText('导入内容')
})
