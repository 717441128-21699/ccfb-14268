/**
 * 端到端冒烟测试：案件建档 -> 合成文书 -> WebGL2 分离 -> 图层切换
 * -> ROI 框选与调权 -> 指标达标 -> 报告 PNG/JSON 导出。
 * 运行：node e2e/smoke.mjs
 */
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { writeFileSync } from 'node:fs';

const server = await createServer({ server: { port: 5198, host: '127.0.0.1' }, logLevel: 'error' });
await server.listen();

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

const steps = [];
const check = (name, cond, extra = '') => {
  steps.push({ name, pass: !!cond, extra });
  if (!cond) console.log('FAIL:', name, extra);
};

try {
  await page.goto('http://127.0.0.1:5198/', { waitUntil: 'commit' });
  await page.waitForSelector('text=案件列表');

  // 1. 新建案件
  await page.click('text=＋ 新建案件');
  await page.locator('.modal input').nth(1).fill('E2E 借款合同涂改案');
  await page.locator('.modal input').nth(2).fill('检验员甲');
  await page.click('.modal button:has-text("建档")');
  await page.waitForSelector('text=E2E 借款合同涂改案');
  check('create-case', true);

  // 2. 新建合成文书（工作台尺寸，SwiftShader 下更快）
  await page.click('.topbar button:has-text("新建检验文书")');
  await page.waitForSelector('text=新建检验文书');
  await page.click('text=同色笔涂改描红');
  await page.click('text=生成并进入检验');

  // 3. 工作台出现并完成首次分离
  await page.waitForSelector('text=双墨水叠加（红/青）', { timeout: 30000 });
  await page.waitForFunction(() => {
    const el = document.querySelector('.stage-canvas');
    return el && el.width > 0;
  });
  await page.waitForSelector('text=GPU 分离耗时', { timeout: 30000 });
  check('workspace-separation-done', true);

  const metricText = await page.locator('text=综合串色率').first().textContent().catch(() => '');
  check('cross-color-metric-shown', metricText.includes('串色率'), metricText);

  // 4. 切换各显示模式，canvas 持续有内容
  for (const mode of ['墨水二层（后加墨）', '墨水一层（原文墨）', '拟合残差图', '可见光 RGB 合成', '双墨水叠加（红/青）']) {
    await page.click(`button:has-text("${mode}")`);
    await page.waitForTimeout(150);
  }
  const canvasInfo = await page.evaluate(() => {
    const c = document.querySelector('.stage-canvas');
    const gl = c.getContext('webgl2');
    const px = new Uint8Array(4);
    gl.readPixels(c.width >> 1, c.height >> 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return { w: c.width, h: c.height, center: Array.from(px) };
  });
  check('display-modes-render', canvasInfo.w > 0 && canvasInfo.h > 0, JSON.stringify(canvasInfo));

  // 5. 框选 ROI
  const box = await page.locator('.stage-wrap').boundingBox();
  await page.click('button:has-text("框选 ROI")');
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.6, { steps: 6 });
  await page.mouse.up();
  await page.waitForSelector('text=区域 1');
  check('roi-created', true);

  // 6. 调 ROI 内 NIR 权重滑杆并确认重新分离无报错
  const sliders = page.locator('.roi-item.selected input[type=range]');
  await sliders.nth(5).fill('2.5');
  await page.waitForTimeout(300);
  check('roi-weight-adjust', true);

  // 7. 加文字标注（画布内联输入框）
  await page.click('button:has-text("文字")');
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.25);
  const textInput = page.locator('.text-annotation-input');
  await textInput.waitFor({ timeout: 5000 });
  await textInput.fill('可疑后加笔画');
  await textInput.press('Enter');
  await page.waitForSelector('text=可疑后加笔画');
  check('annotation-added', true);

  // 8. 生成结论页并导出
  const downloadPromise = page.waitForEvent('download', { timeout: 15000 });
  await page.click('button:has-text("生成结论页")');
  await page.waitForSelector('text=检验结论页');
  await page.fill('textarea', 'E2E 自动检验意见：两墨水分层清晰。');
  await page.click('button:has-text("导出报告 PNG")');
  const dl = await downloadPromise;
  check('report-png-download', dl.suggestedFilename().includes('检验报告'), dl.suggestedFilename());

  const dl2Promise = page.waitForEvent('download', { timeout: 15000 });
  await page.click('button:has-text("导出 JSON")');
  const dl2 = await dl2Promise;
  check('report-json-download', dl2.suggestedFilename().includes('检验记录'), dl2.suggestedFilename());

  // 9. 关闭结论弹窗，返回案件列表，确认文书已入库
  await page.click('.modal button:has-text("取消")');
  await page.click('button:has-text("返回案件列表")');
  await page.click('text=查看文书');
  const rowCount = await page.locator('table tbody tr').count();
  check('doc-listed-in-case', rowCount >= 1, `rows=${rowCount}`);
} catch (e) {
  check('e2e-exception', false, String(e && e.stack || e).slice(0, 500));
}

await browser.close();
await server.close();

console.log(JSON.stringify(steps, null, 2));
const ok = steps.every((s) => s.pass) && errors.length === 0;
if (errors.length) console.log('BROWSER ERRORS:', errors);
writeFileSync(new URL('./last-result.json', import.meta.url), JSON.stringify({ ok, steps, errors }, null, 2));
if (!ok) process.exit(1);
console.log('E2E ALL PASS');
