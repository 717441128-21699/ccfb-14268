/**
 * 无头浏览器 GPU 校验：启动 Vite + Chromium（SwiftShader WebGL2），
 * 验证 GLSL 分离结果与 CPU 参考实现一致、ROI 权重生效、A4@200DPI 耗时 <3s。
 * 运行：node gpu-check/run.mjs
 */
import { chromium } from 'playwright';
import { createServer } from 'vite';

const server = await createServer({ server: { port: 5199, host: '127.0.0.1' }, logLevel: 'error' });
await server.listen();
const url = 'http://127.0.0.1:5199/gpu-check/';

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl2-compute-context'],
});
const page = await browser.newPage({ viewport: { width: 1024, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(url, { waitUntil: 'commit' });
await page.waitForFunction('window.__GPU_CHECK_DONE__ === true', { timeout: 120000 });
const json = await page.locator('#result').textContent();
await browser.close();
await server.close();

const report = JSON.parse(json);
console.log(JSON.stringify(report, null, 2));
if (errors.length) console.log('BROWSER ERRORS:', errors);
if (!report.ok || errors.length) process.exit(1);
