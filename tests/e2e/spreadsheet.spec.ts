import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'

async function mockDocoApi(page: Page) {
  await page.route('**/app-api/v1/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname.replace('/app-api/v1', '')
    const json = (body: unknown, status = 200) => route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(body),
    })

    if (path === '/auth/me') return json({ user: { id: 'spreadsheet-e2e', email: 'sheet@example.com', name: '表格测试用户' } })
    if (path === '/kb' && request.method() === 'GET') return json([{ id: 1, name: '电子表格测试库' }])
    if (path === '/kb/1/folders') return json([])
    if (path === '/kb/1/docs') return json([{ id: 'doc_spreadsheet', title: '电子表格完整测试', kb_id: 1, document_type: 'spreadsheet' }])
    if (path === '/docs/doc_spreadsheet/path') return json({ doc_id: 'doc_spreadsheet', folder_id: null, kb_id: 1 })
    if (path === '/docs/doc_spreadsheet' && request.method() === 'GET') {
      return json({ id: 'doc_spreadsheet', title: '电子表格完整测试', document_type: 'spreadsheet' })
    }
    if (path === '/docs/doc_spreadsheet' && request.method() === 'PATCH') return json({ status: 'ok' })
    return json({ error: `未模拟 ${request.method()} ${path}` }, 404)
  })
}

async function setCell(page: Page, index: number, value: string) {
  const cells = page.getByRole('gridcell')
  await cells.nth(index).click()
  await page.getByRole('textbox', { name: '公式栏' }).fill(value)
}

test('独立电子表格文件的完整浏览器交互与本地持久化', async ({ page }) => {
  test.setTimeout(90_000)
  const pageErrors: string[] = []
  page.on('pageerror', error => pageErrors.push(error.message))
  await mockDocoApi(page)
  await page.goto('/doc/doc_spreadsheet')
  const title = page.getByRole('textbox', { name: '电子表格标题' })
  await expect(title).toHaveValue('电子表格完整测试')
  await expect(title.locator('xpath=ancestor::*[contains(@class,"spreadsheet-titlebar")]')).toHaveCount(1)
  await expect(page.locator('.standalone-spreadsheet-heading')).toHaveCount(0)
  await expect(page.locator('.spreadsheet-block-standalone .spreadsheet-shell')).toHaveCSS('border-top-width', '0px')
  await expect(page.locator('.ProseMirror')).toHaveCount(0)
  await expect(page.getByText(/\d+ 字/)).toHaveCount(0)
  const grid = page.getByRole('grid', { name: '电子表格' })
  const cells = page.getByRole('gridcell')

  // 基础输入与公式。
  await setCell(page, 0, '项目')
  await setCell(page, 1, '数量')
  await setCell(page, 2, '单价')
  await setCell(page, 3, '小计')
  await setCell(page, 12, '设计')
  await setCell(page, 13, '2')
  await setCell(page, 14, '1200')
  await setCell(page, 15, '=B2*C2')
  await expect(cells.nth(15)).toHaveText('2400')

  await setCell(page, 24, '开发')
  await setCell(page, 25, '3')
  await setCell(page, 26, '800')
  await setCell(page, 27, '=B3*C3')
  await expect(cells.nth(27)).toHaveText('2400')

  await setCell(page, 36, '合计')
  await setCell(page, 39, '=SUM(D2:D3)')
  await expect(cells.nth(39)).toHaveText('4800')
  await setCell(page, 40, '=IF(D4>=4000,"通过","未通过")')
  await expect(cells.nth(40)).toHaveText('通过')

  // 快捷键与按钮使用同一套跨平台定义。
  await cells.nth(0).click()
  await expect(page.getByTitle(/粗体 \(.+B\)/)).toBeVisible()
  await page.keyboard.press('Control+b')
  await expect(cells.nth(0)).toHaveCSS('font-weight', '700')
  await page.keyboard.press('Control+i')
  await expect(cells.nth(0)).toHaveCSS('font-style', 'italic')
  await page.keyboard.press('Control+u')
  await expect(cells.nth(0)).toHaveCSS('text-decoration-line', 'underline')
  await page.getByTitle(/左对齐/).click()
  await expect(page.getByTitle(/居中 \(.+M\)/)).toBeVisible()
  await page.keyboard.press('Control+Shift+m')
  await expect(cells.nth(0)).toHaveCSS('text-align', 'center')
  await page.waitForTimeout(600)
  await page.keyboard.press('Control+z')
  await expect(cells.nth(0)).not.toHaveCSS('text-align', 'center')
  await page.keyboard.press('Control+Shift+z')
  await expect(cells.nth(0)).toHaveCSS('text-align', 'center')

  // 格式与选区。
  await cells.nth(15).click()
  await page.getByLabel('单元格类型').selectOption('currency')
  await expect(cells.nth(15)).toContainText('¥')
  await expect(cells.nth(15)).toHaveCSS('text-align', 'right')
  const decreaseDecimal = page.getByRole('button', { name: '减少小数位数' })
  const increaseDecimal = page.getByRole('button', { name: '增加小数位数' })
  await expect(decreaseDecimal).toBeVisible()
  await expect(increaseDecimal).toBeVisible()
  await decreaseDecimal.click()
  await expect(cells.nth(15)).toHaveText(/¥2,400\.0$/)
  await decreaseDecimal.click()
  await expect(cells.nth(15)).toHaveText(/¥2,400$/)
  await expect(decreaseDecimal).toBeDisabled()
  await increaseDecimal.click()
  await expect(cells.nth(15)).toHaveText(/¥2,400\.0$/)

  // 自动识别的数值也属于数字单元格，并从当前显示精度开始增减。
  await cells.nth(13).click()
  await expect(decreaseDecimal).toBeVisible()
  await expect(increaseDecimal).toBeVisible()
  await expect(decreaseDecimal).toBeDisabled()
  await increaseDecimal.click()
  await expect(cells.nth(13)).toHaveText('2.0')
  await cells.nth(14).click()
  await expect(decreaseDecimal).toBeDisabled()
  await setCell(page, 41, '855.54')
  await expect(decreaseDecimal).toBeEnabled()
  await decreaseDecimal.click()
  await expect(cells.nth(41)).toHaveText('855.5')
  await increaseDecimal.click()
  await expect(cells.nth(41)).toHaveText('855.54')
  await cells.nth(15).click()
  await page.getByLabel('单元格类型').selectOption('number')
  await expect(decreaseDecimal).toBeVisible()

  // 单元格类型按大类组织，并提供对应的缺省对齐。
  const cellType = page.getByLabel('单元格类型')
  await expect(cellType.locator('optgroup[label="通用"]')).toHaveCount(1)
  await expect(cellType.locator('optgroup[label="数字"]')).toHaveCount(1)
  await expect(cellType.locator('optgroup[label="日期与逻辑"]')).toHaveCount(1)
  await cells.nth(12).click()
  await cellType.selectOption('text')
  await expect(cells.nth(12)).toHaveCSS('text-align', 'left')
  await expect(page.getByRole('button', { name: '减少小数位数' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '增加小数位数' })).toHaveCount(0)
  await cells.nth(40).click()
  await cellType.selectOption('boolean')
  await expect(cells.nth(40)).toHaveCSS('text-align', 'center')

  // 单元格、行头、列头均有各自的右键菜单。
  await cells.nth(12).click({ button: 'right' })
  const cellMenu = page.getByRole('menu', { name: '单元格操作' })
  await expect(cellMenu).toBeVisible()
  await expect(cellMenu.getByRole('menuitem', { name: /粘贴/ })).toBeVisible()
  await expect(cellMenu.getByRole('menuitem', { name: '在下方插入行' })).toBeVisible()
  await page.keyboard.press('Escape')

  await grid.locator('tbody tr').nth(1).locator('th').click({ button: 'right' })
  const rowMenu = page.getByRole('menu', { name: '行操作' })
  await expect(rowMenu).toBeVisible()
  await expect(rowMenu.getByRole('menuitem', { name: '删除第 2 行' })).toBeVisible()
  await page.keyboard.press('Escape')

  await grid.locator('thead tr').first().locator('th').nth(2).click({ button: 'right' })
  const colMenu = page.getByRole('menu', { name: '列操作' })
  await expect(colMenu).toBeVisible()
  await expect(colMenu.getByRole('menuitem', { name: '删除 B 列' })).toBeVisible()
  await expect(colMenu.getByRole('menuitem', { name: '升序排列' })).toBeVisible()
  await page.keyboard.press('Escape')

  await cells.nth(13).click()
  await cells.nth(27).click({ modifiers: ['Shift'] })
  await expect(page.getByText(/已选择 \d+ 个单元格/)).toBeVisible()

  // 图标按钮有明确名称和 tooltip；单选时合并不可用。
  const mergeButton = page.getByRole('button', { name: '合并或取消合并单元格' })
  await cells.nth(0).click()
  await expect(mergeButton).toBeDisabled()
  await expect(mergeButton).toHaveAttribute('data-tooltip', '请先拖选多个单元格')
  const sortAscendingButton = page.getByRole('button', { name: '按 A 列升序排序' })
  await expect(sortAscendingButton).toHaveAttribute('data-tooltip', '按 A 列升序排序')
  await expect(page.getByRole('button', { name: '按 A 列降序排序' })).toHaveAttribute('data-tooltip', '按 A 列降序排序')
  await sortAscendingButton.hover()
  await expect.poll(() => sortAscendingButton.evaluate(element => getComputedStyle(element, '::after').opacity)).toBe('1')

  // 排序：选择 A 列后降序，开发应移动到首个数据行。
  await grid.locator('thead tr').first().locator('th').nth(1).click()
  await page.getByRole('button', { name: '按 A 列降序排序' }).click()
  await expect(cells.nth(0)).toHaveText('项目')
  await expect(cells.nth(12)).toHaveText('设计')
  await expect(cells.nth(24)).toHaveText('开发')
  await expect(page.locator('.spreadsheet-action-status')).toContainText('已按 A 列降序排列')

  // 筛选：只保留“开发”。
  await page.getByTitle('筛选').click()
  await page.getByRole('textbox', { name: '筛选 A 列' }).fill('开发')
  await expect(grid).toContainText('开发')
  await expect(grid).not.toContainText('设计')
  await page.getByTitle('筛选').click()
  await expect(grid).toContainText('设计')

  // 合并与取消合并。
  await cells.nth(48).click()
  await cells.nth(49).click({ modifiers: ['Shift'] })
  await expect(mergeButton).toBeEnabled()
  await mergeButton.click()
  await expect(grid.locator('td[colspan="2"]')).toHaveCount(1)
  await mergeButton.click()
  await expect(grid.locator('td[colspan="2"]')).toHaveCount(0)

  // 行列、冻结。
  await page.getByRole('button', { name: /行列/ }).click()
  await page.getByRole('button', { name: '在上方插入行' }).click()
  await expect(page.getByText('31 行 × 12 列')).toBeVisible()
  await expect(page.locator('.spreadsheet-action-status')).toContainText('已插入第')
  await page.getByRole('button', { name: /行列/ }).click()
  await page.getByRole('button', { name: '在左侧插入列' }).click()
  await expect(page.getByText('31 行 × 13 列')).toBeVisible()
  await page.getByRole('button', { name: /行列/ }).click()
  await page.getByRole('button', { name: '删除当前行' }).click()
  await expect(page.getByText('30 行 × 13 列')).toBeVisible()
  await page.getByRole('button', { name: /行列/ }).click()
  await page.getByRole('button', { name: '删除当前列' }).click()
  await expect(page.getByText('30 行 × 12 列')).toBeVisible()
  await page.getByRole('button', { name: /行列/ }).click()
  await page.getByRole('button', { name: '追加 10 行' }).click()
  await expect(page.getByText('40 行 × 12 列')).toBeVisible()
  await page.getByRole('button', { name: /行列/ }).click()
  await page.getByRole('button', { name: /冻结到第 \d+ 行/ }).click()
  await expect(page.locator('.spreadsheet-action-status')).toContainText('已冻结前')
  await expect(cells.first()).toHaveCSS('position', 'sticky')
  await page.getByRole('button', { name: /行列/ }).click()
  await page.getByRole('button', { name: /冻结到第 \d+ 列/ }).click()
  await expect(page.locator('.spreadsheet-action-status')).toContainText('已冻结前')
  await expect(cells.first()).toHaveCSS('position', 'sticky')

  // 粘贴矩阵。
  await cells.nth(0).click()
  await grid.evaluate((element) => {
    const clipboardData = new DataTransfer()
    clipboardData.setData('text/plain', '甲\t10\n乙\t20')
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }))
  })
  await expect(grid).toContainText('甲')
  await expect(grid).toContainText('乙')

  // CSV 导入。
  const csvInput = page.locator('input[type="file"][accept*=".csv"]')
  await csvInput.setInputFiles({
    name: 'sheet.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('名称,金额\n订阅,99\n服务,199'),
  })
  await expect(grid).toContainText('订阅')
  await expect(grid).toContainText('199')

  // CSV 导出。
  const downloadPromise = page.waitForEvent('download')
  await page.getByTitle('导出 CSV').click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('电子表格.csv')
  const downloadPath = await download.path()
  expect(downloadPath).toBeTruthy()
  expect(await readFile(downloadPath!, 'utf8')).toContain('订阅,99')

  // IndexedDB/Yjs 本地持久化：刷新后仍恢复电子表格数据。
  await page.screenshot({ path: '/tmp/doco-spreadsheet-browser.png', fullPage: true })
  await page.reload()
  await expect(page.getByRole('grid', { name: '电子表格' })).toBeVisible()
  await expect(page.getByRole('grid', { name: '电子表格' })).toContainText('订阅')
  await expect(page.getByRole('grid', { name: '电子表格' })).toContainText('199')
  expect(pageErrors).toEqual([])
})
