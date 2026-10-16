import puppeteer from 'puppeteer-core';

async function run() {
  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  // 1. Tablet landscape view test
  const tabletPage = await browser.newPage();
  await tabletPage.setViewport({ width: 1280, height: 800 });

  console.log('Opening tablet app...');
  await tabletPage.goto('https://studycalm-five.vercel.app/', { waitUntil: 'networkidle2' });

  // Click [📱 원격 리모컨] button
  await tabletPage.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const btn = buttons.find((b) => b.textContent && b.textContent.includes('원격'));
    if (btn) btn.click();
  });

  await new Promise((r) => setTimeout(r, 800));
  await tabletPage.screenshot({
    path: '/Users/chaney/.gemini/antigravity/brain/b09346c1-e7d0-49a8-9893-80667162929f/modal_remote_qr.png',
  });
  console.log('Saved modal_remote_qr.png');

  // 2. Mobile smartphone remote view test
  const mobilePage = await browser.newPage();
  await mobilePage.setViewport({ width: 390, height: 844, isMobile: true });

  console.log('Opening smartphone remote app...');
  await mobilePage.goto('https://studycalm-five.vercel.app/remote?room=sc-demo99', {
    waitUntil: 'networkidle2',
  });

  await new Promise((r) => setTimeout(r, 1200));
  await mobilePage.screenshot({
    path: '/Users/chaney/.gemini/antigravity/brain/b09346c1-e7d0-49a8-9893-80667162929f/mobile_remote_view.png',
  });
  console.log('Saved mobile_remote_view.png');

  await browser.close();
  console.log('All done.');
}

run().catch(console.error);
