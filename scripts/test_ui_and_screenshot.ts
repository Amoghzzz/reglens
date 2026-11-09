import puppeteer from 'puppeteer-core';
import path from 'path';
import fs from 'fs';

const ARTIFACT_DIR = 'C:\\Users\\amogh\\.gemini\\antigravity\\brain\\aedf9999-bc78-4095-9213-51a0accbe176';
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

async function main() {
  const browserPath = fs.existsSync(CHROME_PATH) ? CHROME_PATH : EDGE_PATH;
  console.log(`Using browser at: ${browserPath}`);

  if (!fs.existsSync(ARTIFACT_DIR)) {
    fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  }

  const browser = await puppeteer.launch({
    executablePath: browserPath,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1400,900']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900, deviceScaleFactor: 2 });

  console.log('Navigating to http://localhost:3000...');
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle2', timeout: 30000 });

  // 1. Capture Main Screen
  const mainScreenPath = path.join(ARTIFACT_DIR, 'main_screen.png');
  await page.screenshot({ path: mainScreenPath, fullPage: false });
  console.log(`✓ Saved main screen screenshot to: ${mainScreenPath}`);

  // 2. Click the first example question
  console.log('Clicking the first example question chip...');
  const clicked = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const btn = buttons.find(b => b.textContent && b.textContent.includes('What is the maximum exposure'));
    if (btn) {
      btn.click();
      return true;
    }
    return false;
  });

  if (!clicked) {
    console.log('Typing into textarea fallback...');
    await page.type('textarea', 'What is the maximum exposure an NBFC can have to a single party?');
    const sendBtn = await page.$('button[title="Send question"]');
    if (sendBtn) await sendBtn.click();
  }

  console.log('Waiting for answer generation to complete...');
  // Wait until "Verified Source Provisions" or citation buttons appear
  await page.waitForSelector('button[title*="View source chunk"]', { timeout: 60000 });
  console.log('✓ Answer generated and verified citations rendered!');

  // Settle time for layout
  await new Promise(r => setTimeout(r, 2000));

  const answerScreenPath = path.join(ARTIFACT_DIR, 'answer_screen.png');
  await page.screenshot({ path: answerScreenPath, fullPage: false });
  console.log(`✓ Saved answer screen screenshot to: ${answerScreenPath}`);

  // 3. Click the first citation chip to open the source panel
  console.log('Clicking first citation chip to open Source Panel...');
  const citationButtons = await page.$$('button[title*="View source chunk"]');
  if (citationButtons.length > 0) {
    await citationButtons[0].click();
    console.log('Waiting for Source Drawer to slide in...');
    await new Promise(r => setTimeout(r, 1500));

    const sourcePanelPath = path.join(ARTIFACT_DIR, 'source_panel_open.png');
    await page.screenshot({ path: sourcePanelPath, fullPage: false });
    console.log(`✓ Saved source panel screenshot to: ${sourcePanelPath}`);
  } else {
    console.error('No citation button found!');
  }

  await browser.close();
  console.log('Puppeteer test run completed successfully!');
}

main().catch(err => {
  console.error('Puppeteer script failed:', err);
  process.exit(1);
});
