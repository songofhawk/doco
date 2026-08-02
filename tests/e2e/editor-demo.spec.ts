import { expect, test } from '@playwright/test'

const slashPersistenceCases = [
  { option: /一级标题/, selector: '.doco-text-editor-content h1' },
  { option: /二级标题/, selector: '.doco-text-editor-content h2' },
  { option: /三级标题/, selector: '.doco-text-editor-content h3' },
  { option: /无序列表/, selector: '.doco-text-editor-content ul:not([data-type="taskList"]) > li' },
  { option: /有序列表/, selector: '.doco-text-editor-content ol > li' },
  { option: /任务列表/, selector: '.doco-text-editor-content ul[data-type="taskList"] > li' },
  { option: /^引用 /, selector: '.doco-text-editor-content blockquote' },
  { option: /代码块/, selector: '.doco-text-editor-content .code-block' },
  { option: /流程图 \(Mermaid\)/, selector: '.doco-text-editor-content .mermaid-block' },
  { option: /UML 图 \(PlantUML\)/, selector: '.doco-text-editor-content .plantuml-block' },
  { option: /^表格 /, selector: '.doco-text-editor-content table' },
  { option: /嵌入式电子表格/, selector: '.doco-text-editor-content .spreadsheet-block' },
  { option: /高亮块/, selector: '.doco-text-editor-content .callout' },
  { option: /分隔线/, selector: '.doco-text-editor-content hr' },
]

async function openSlashMenu(page: import('@playwright/test').Page) {
  const editor = page.locator('.doco-text-editor-content')
  await editor.click()
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await page.keyboard.type('/')
  await expect(page.locator('.doco-command-menu')).toBeVisible()
}

async function waitForBrowserSave(page: import('@playwright/test').Page) {
  const status = page.getByRole('status')
  await expect(status).toContainText('正在保存')
  await expect(status).toContainText('已保存于')
}

async function seedLegacyExample(page: import('@playwright/test').Page) {
  await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('doco-text-editor-demo', 1)
      request.onupgradeneeded = () => request.result.createObjectStore('documents')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })

    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction('documents', 'readwrite')
      transaction.objectStore('documents').put({
        json: {
          type: 'doc',
          content: [
            { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: '一份只属于这个浏览器的文档' }] },
            { type: 'paragraph', content: [{ type: 'text', text: '输入 / 打开命令菜单' }] },
            { type: 'paragraph', content: [{ type: 'text', text: '插入表格、Callout 或 Mermaid 图表' }] },
          ],
        },
        updatedAt: '2026-01-01T00:00:00.000Z',
      }, 'browser-only-document')
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })

    database.close()
  })
}

test('Slash 菜单尚未初始化时也能安全销毁', async ({ page }) => {
  await page.goto('/editor-demo.html')

  const lifecycleError = await page.evaluate(async () => {
    try {
      const { renderItems } = await import('/src/editor/components/suggestions.ts')
      const lifecycle = renderItems()
      lifecycle.onUpdate({ clientRect: null })
      lifecycle.onKeyDown({ event: { key: 'Escape' } })
      lifecycle.onExit()
      return null
    } catch (error) {
      return error instanceof Error ? error.message : String(error)
    }
  })

  expect(lifecycleError).toBeNull()
})

test('默认示例覆盖全部文档样式与自定义节点', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', error => pageErrors.push(error.message))
  await page.route('https://www.plantuml.com/plantuml/svg/**', async (route) => {
    await route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40"><text x="8" y="24">PlantUML</text></svg>',
    })
  })

  await page.goto('/editor-demo.html')
  const editor = page.locator('.doco-text-editor-content')
  await expect(editor.getByRole('heading', { name: 'DocoTextEditor 完整样式示例' })).toBeVisible()

  for (const selector of [
    'h1', 'h2', 'h3', 'strong', 'em', 'u', 's', 'p code', 'mark', 'a[href="https://tiptap.dev"]',
    'blockquote', 'ul:not([data-type="taskList"])', 'ol', 'ul[data-type="taskList"]',
    '.callout', 'table', '.code-block', '.mermaid-block', '.plantuml-block',
    '.image-node-wrapper', '.spreadsheet-block', 'hr',
  ]) {
    await expect(editor.locator(selector), selector).not.toHaveCount(0)
  }

  for (const alignment of ['left', 'center', 'right']) {
    await expect(editor.locator(`p[style*="text-align: ${alignment}"]`)).not.toHaveCount(0)
  }
  await expect(editor.locator('.plantuml-block__diagram svg')).toBeVisible()
  expect(pageErrors).toEqual([])
})

test('旧版内置草稿会自动升级为完整示例', async ({ page }) => {
  await page.goto('/editor-demo.html')
  await seedLegacyExample(page)
  await page.reload()

  const editor = page.locator('.doco-text-editor-content')
  await expect(editor.getByRole('heading', { name: 'DocoTextEditor 完整样式示例' })).toBeVisible()
  await expect(editor.getByText('一份只属于这个浏览器的文档')).toHaveCount(0)
  await expect(editor.locator('ol')).toBeVisible()
  await expect(editor.locator('.spreadsheet-block')).toBeVisible()
})

test('独立编辑器在 IndexedDB 中保存并恢复内容', async ({ page }) => {
  const backendRequests: string[] = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/app-api/') || url.protocol === 'ws:') {
      backendRequests.push(request.url())
    }
  })

  await page.goto('/editor-demo.html')
  await expect(page.getByRole('heading', { name: 'DocoTextEditor，独立运行。' })).toBeVisible()

  const editor = page.locator('.doco-text-editor-content')
  await expect(editor).toBeVisible()
  await editor.click()
  await page.keyboard.press('End')
  await page.keyboard.type(' 浏览器持久化测试')

  await waitForBrowserSave(page)
  await page.reload()

  await expect(editor).toContainText('浏览器持久化测试')
  expect(backendRequests).toEqual([])
})

test('块操作菜单不依赖宿主页面的按钮重置样式', async ({ page }) => {
  await page.goto('/editor-demo.html')

  const firstHeading = page.locator('.doco-text-editor-content h1').first()
  await firstHeading.hover()

  const handle = page.getByRole('button', { name: '打开块操作菜单' })
  await expect(handle).toBeVisible()
  await expect(handle).toHaveCSS('border-top-width', '0px')
  await handle.click()

  const menu = page.locator('.doco-block-menu')
  await expect(menu).toBeVisible()
  await page.getByRole('button', { name: '打开块类型转换菜单' }).hover()
  await expect(page.getByRole('button', { name: /一级标题/ })).toBeVisible()

  const borders = await menu.locator('button').evaluateAll((buttons) => (
    buttons.map((button) => window.getComputedStyle(button).borderTopWidth)
  ))
  expect(new Set(borders)).toEqual(new Set(['0px']))

  const box = await menu.boundingBox()
  expect(box?.width).toBeLessThan(440)
  expect(box?.height).toBeLessThan(520)
})

test('Slash 命令菜单保持紧凑且不显示浏览器默认边框', async ({ page }) => {
  await page.goto('/editor-demo.html')

  const editor = page.locator('.doco-text-editor-content')
  await editor.click()
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await page.keyboard.type('/')

  const menu = page.locator('.doco-command-menu')
  await expect(menu).toBeVisible()

  const firstItem = menu.locator('.doco-command-menu-item').first()
  await expect(firstItem).toHaveCSS('border-top-width', '0px')
  await expect(page.getByRole('option', { name: /有序列表/ })).toBeVisible()

  const box = await menu.boundingBox()
  expect(box?.width).toBeLessThanOrEqual(320)
  expect(box?.height).toBeLessThanOrEqual(420)

  const overflow = await menu.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
  }))
  expect(overflow.scrollHeight).toBeGreaterThan(overflow.clientHeight)
})

test('任务列表保持紧凑对齐', async ({ page }) => {
  await page.goto('/editor-demo.html')

  const editor = page.locator('.doco-text-editor-content')
  await editor.click()
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await page.keyboard.type('/')
  await page.getByRole('option', { name: /任务列表/ }).click()
  await page.keyboard.type('第一项')
  await page.keyboard.press('Enter')
  await page.keyboard.type('第二项')

  const taskList = editor.locator('ul[data-type="taskList"]').last()
  const firstItem = taskList.locator('li').first()
  const checkbox = firstItem.locator('input[type="checkbox"]')
  const paragraph = firstItem.locator('p')

  await expect(paragraph).toHaveCSS('margin-top', '0px')
  await expect(paragraph).toHaveCSS('margin-bottom', '0px')
  await expect(checkbox).toHaveCSS('width', '16px')
  const itemBox = await firstItem.boundingBox()
  expect(itemBox?.height).toBeLessThan(40)
})

test('Demo 已配置 PlantUML 渲染器', async ({ page }) => {
  await page.route('https://www.plantuml.com/plantuml/svg/**', async (route) => {
    await route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40"><text x="8" y="24">PlantUML</text></svg>',
    })
  })
  await page.goto('/editor-demo.html')

  const editor = page.locator('.doco-text-editor-content')
  await editor.click()
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await page.keyboard.type('/')
  await page.getByRole('option', { name: /PlantUML/ }).click()

  const block = editor.locator('.plantuml-block').last()
  await expect(block.locator('.plantuml-block__diagram svg')).toBeVisible()
  await expect(block).not.toContainText('未配置 PlantUML 渲染器')

  await expect(page.getByRole('status')).toContainText('已保存于')
  await page.reload()
  await expect(editor.locator('.plantuml-block').last().locator('.plantuml-block__diagram svg')).toBeVisible()
})

test('所有 Slash 功能插入后都能保存并在刷新后恢复', async ({ browser }) => {
  test.setTimeout(120_000)

  for (const { option, selector } of slashPersistenceCases) {
    const context = await browser.newContext()
    const page = await context.newPage()
    const pageErrors: string[] = []
    page.on('pageerror', error => pageErrors.push(error.message))
    await page.route('https://www.plantuml.com/plantuml/svg/**', async (route) => {
      await route.fulfill({
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40"><text x="8" y="24">PlantUML</text></svg>',
      })
    })

    await page.goto('/editor-demo.html')
    await expect(page.locator('.doco-text-editor-content h1')).toHaveCount(1)
    const nodes = page.locator(selector)
    const countBefore = await nodes.count()
    await openSlashMenu(page)
    await page.getByRole('option', { name: option }).click()
    await expect(nodes).toHaveCount(countBefore + 1)
    await waitForBrowserSave(page)

    await page.reload()
    await expect(page.locator(selector)).toHaveCount(countBefore + 1)
    expect(pageErrors, option.toString()).toEqual([])
    await context.close()
  }

  const imageContext = await browser.newContext()
  const imagePage = await imageContext.newPage()
  const imageErrors: string[] = []
  imagePage.on('pageerror', error => imageErrors.push(error.message))
  await imagePage.goto('/editor-demo.html')
  await expect(imagePage.locator('.doco-text-editor-content h1')).toHaveCount(1)
  const imageNodes = imagePage.locator('.doco-text-editor-content .image-node-wrapper')
  const imageCountBefore = await imageNodes.count()
  await openSlashMenu(imagePage)
  const chooserPromise = imagePage.waitForEvent('filechooser')
  await imagePage.getByRole('option', { name: /图片/ }).click()
  const chooser = await chooserPromise
  await chooser.setFiles({
    name: 'browser-check.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#c96442"/></svg>'),
  })
  await expect(imageNodes).toHaveCount(imageCountBefore + 1)
  await waitForBrowserSave(imagePage)
  await imagePage.reload()
  await expect(imagePage.locator('.doco-text-editor-content .image-node-wrapper')).toHaveCount(imageCountBefore + 1)
  expect(imageErrors).toEqual([])
  await imageContext.close()
})

test('编辑器内控件和浮动工具栏统一清除浏览器粗边框', async ({ page }) => {
  await page.goto('/editor-demo.html')

  const editor = page.locator('.doco-text-editor-content')
  const paragraph = editor.locator('p').first()
  await paragraph.dblclick()

  const floatingToolbar = page.locator('.doco-editor-floating-ui').filter({ visible: true }).first()
  await expect(floatingToolbar).toBeVisible()

  await editor.click()
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await page.keyboard.type('/')
  await page.getByRole('option', { name: /代码块/ }).click()

  const codeBlock = page.locator('.code-block').last()
  await expect(codeBlock).toBeVisible()
  await codeBlock.hover()

  const thickBorders = await page.locator('.doco-editor-root button, .doco-editor-floating-ui button').evaluateAll((controls) => (
    controls
      .filter((control) => (control as HTMLElement).offsetParent !== null)
      .map((control) => {
        const style = window.getComputedStyle(control)
        const widths = [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth]
          .map(value => Number.parseFloat(value) || 0)
        return {
          label: control.getAttribute('aria-label') || control.getAttribute('title') || control.textContent?.trim() || control.tagName,
          width: Math.max(...widths),
        }
      })
      .filter(control => control.width > 1)
  ))

  expect(thickBorders).toEqual([])
  await expect(codeBlock.getByRole('button', { name: /自动换行/ })).toHaveCSS('border-top-width', '0px')
  await expect(codeBlock.getByRole('button', { name: /复制/ })).toHaveCSS('border-top-width', '0px')
})

test('独立组件自带完整主题与基础文档排版', async ({ page }) => {
  await page.goto('/editor-demo.html')

  const root = page.locator('.doco-text-editor')
  const themeTokens = await root.evaluate((element) => {
    const style = window.getComputedStyle(element)
    return [
      '--surface-canvas', '--surface-elevated', '--surface-subtle',
      '--border-subtle', '--border-strong', '--text-primary',
      '--text-secondary', '--text-muted', '--accent', '--font-ui', '--font-heading',
    ].map(token => [token, style.getPropertyValue(token).trim()])
  })
  expect(themeTokens.every(([, value]) => value.length > 0)).toBe(true)

  const editor = page.locator('.doco-text-editor-content')
  const quote = editor.locator('blockquote').first()
  await expect(quote).toHaveCSS('border-left-width', '3px')
  await expect(quote).toHaveCSS('border-left-style', 'solid')
  await expect(quote).toHaveCSS('font-style', 'italic')
  await expect(editor.locator('ul').first()).toHaveCSS('list-style-type', 'disc')
  await expect(editor.locator('h1').first()).toHaveCSS('font-weight', '500')
})
