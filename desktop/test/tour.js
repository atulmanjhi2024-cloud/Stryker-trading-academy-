// 15 s tour video of Desktop 2.0 beta 2 (sample data, stub sign-in, no network writes, no orders):
//   xvfb-run -a -s '-screen 0 1600x1000x24' node test/tour.js <out.mp4>      needs ffmpeg
// Shows: sign-in, Home with the one top bar, the profile-picture menu, screens, the chart filling the window with its
// tabs in the same bar, the "..." menu, light theme, the command palette.
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');
const { _electron: electron } = require(process.env.PW_CORE || '/root/projects/stryker-trading-academy/node_modules/playwright-core');

const OUT = process.argv[2] || path.join(__dirname, '..', 'dist', 'tour.mp4');
const FR = fs.mkdtempSync(path.join(os.tmpdir(), 'tz-tour-'));
(async () => {
  const app = await electron.launch({
    executablePath: require(path.join(__dirname, '..', 'node_modules', 'electron')),
    args: [...((process.getuid && process.getuid() === 0) || process.env.CI ? ['--no-sandbox'] : []), path.join(__dirname, '..'), '--user-data-dir=' + fs.mkdtempSync(path.join(os.tmpdir(), 'tz-d2-'))],
    env: Object.assign({}, process.env, { TZ_DESKTOP_STUB: '1' }), timeout: 60000
  });
  const win = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 900));
  await win.setViewportSize({ width: 1440, height: 900 }).catch(() => {});
  await win.waitForSelector('[data-screen="signin"]');
  let n = 0;
  const shotChart = () => app.evaluate(async () => (await global.__tzTest.chart().capturePage()).toPNG().toString('base64'));
  // each frame = 0.1 s; the chart is its own view over the window, so on Charts the frame is the chart's capture
  const grab = async (count, chart) => {
    for (let i = 0; i < count; i++) {
      const f = path.join(FR, String(n++).padStart(4, '0') + '.png');
      if (chart) fs.writeFileSync(f, Buffer.from(await shotChart(), 'base64')); else await win.screenshot({ path: f });
    }
  };
  const theme = (t) => win.evaluate((t) => { localStorage.setItem('tz_desktop_theme', t); document.documentElement.setAttribute('data-theme', t === 'day' ? 'light' : 'night'); window.tzApp.theme(t); }, t);
  await grab(8);                                                     // 0.8 s sign-in
  await win.evaluate(() => window.TZData.Auth.stubSignIn());
  await win.waitForSelector('[data-screen="home"] .qc');
  await win.waitForTimeout(300);
  await grab(12);                                                    // 1.2 s Home
  await win.click('#tb-end >> #av'); await win.waitForTimeout(250);
  await grab(15);                                                    // 1.5 s profile menu
  await win.keyboard.press('Escape');
  for (const s of ['watchlist', 'alerts', 'gex', 'stats', 'journal', 'learn']) {
    await win.evaluate((x) => window.__tzUi.go(x), s);
    await win.waitForTimeout(300);
    await grab(8);                                                   // 4.8 s screens
  }
  await win.evaluate(() => window.__tzUi.go('charts'));
  await win.waitForSelector('.chart-load', { state: 'detached', timeout: 45000 }).catch(() => {});
  await win.waitForTimeout(6000);
  await grab(15, true);                                              // 1.5 s chart, one bar
  await app.evaluate(() => global.__tzTest.chart().executeJavaScript('document.getElementById("tzd-end").shadowRoot.getElementById("more").click()'));
  await win.waitForTimeout(300);
  await grab(12, true);                                              // 1.2 s "..." menu
  await app.evaluate(() => global.__tzTest.chart().executeJavaScript('document.getElementById("tzd-end").shadowRoot.getElementById("more").click()'));
  await theme('day'); await win.waitForTimeout(1200);
  await grab(15, true);                                              // 1.5 s chart, light
  await win.evaluate(() => window.__tzUi.go('home')); await win.waitForTimeout(400);
  await grab(10);                                                    // 1.0 s Home, light
  await win.keyboard.press('Control+K');
  await win.waitForSelector('#pal-q');
  await win.type('#pal-q', 'nq', { delay: 60 });
  await grab(15);                                                    // 1.5 s palette
  await theme('night');
  await app.evaluate(({ app: a }) => a.exit(0)).catch(() => {});
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '10', '-i', path.join(FR, '%04d.png'), '-vf', 'scale=1440:900,format=yuv420p', '-c:v', 'libx264', '-r', '30', OUT]);
  fs.rmSync(FR, { recursive: true, force: true });
  console.log('tour', OUT, n, 'frames =', n / 10, 's');
})().catch((e) => { console.error(e); process.exit(1); });
