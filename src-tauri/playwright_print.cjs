const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// Set to true to see Chrome performing all actions; set to false in production to run headless
const SHOW_BROWSER = true;

async function run() {
  // Parse command line arguments
  const argsList = process.argv.slice(2);
  const params = {};
  for (let i = 0; i < argsList.length; i++) {
    if (argsList[i].startsWith('--')) {
      const parts = argsList[i].split('=');
      const key = parts[0].substring(2);
      const val = parts.slice(1).join('=');
      params[key] = val;
    }
  }

  const filePath = params.filePath;
  const printerName = params.printer;
  const copies = parseInt(params.copies || '1', 10);
  const isColor = params.isColor === 'true';
  const isDuplex = params.isDuplex === 'true';
  const pageSize = params.pageSize || 'A4';
  const orientation = params.orientation || 'Portrait';
  const pagesRange = params.pages || '';
  const jobToken = params.jobToken || 'PF-UNKNOWN';
  const profileDir = params.profileDir || path.join(__dirname, '.chrome_profile');

  if (!filePath) {
    console.error('Error: --filePath is required');
    process.exit(1);
  }

  const filename = path.basename(filePath);

  console.log(`Print Automation Config:`);
  console.log(`- File Path: ${filePath}`);
  console.log(`- Printer: ${printerName}`);
  console.log(`- Copies: ${copies}`);
  console.log(`- Color: ${isColor}`);
  console.log(`- Duplex: ${isDuplex}`);
  console.log(`- Page Size: ${pageSize}`);
  console.log(`- Orientation: ${orientation}`);
  console.log(`- Page Range: ${pagesRange}`);
  console.log(`- Job Token: ${jobToken}`);
  console.log(`- Profile Dir: ${profileDir}`);

  // 1. Map media size for Chrome print preview sticky settings
  const pageSizesMap = {
    'A4': {
      "height_microns": 297000,
      "width_microns": 210000,
      "name": "ISO_A4",
      "custom_display_name": "A4"
    },
    'Letter': {
      "height_microns": 279400,
      "width_microns": 215900,
      "name": "NA_LETTER",
      "custom_display_name": "Letter"
    },
    'Legal': {
      "height_microns": 355600,
      "width_microns": 215900,
      "name": "NA_LEGAL",
      "custom_display_name": "Legal"
    }
  };

  const mediaSizeObj = pageSizesMap[pageSize] || pageSizesMap['A4'];
  const isLandscape = orientation.toLowerCase() === 'landscape';

  // 2. Prepare Chrome preferences directories & files
  const defaultPrefsDir = path.join(profileDir, 'Default');
  if (!fs.existsSync(defaultPrefsDir)) {
    fs.mkdirSync(defaultPrefsDir, { recursive: true });
  }

  const prefsPath = path.join(defaultPrefsDir, 'Preferences');
  let existingPrefs = {};
  if (fs.existsSync(prefsPath)) {
    try {
      existingPrefs = JSON.parse(fs.readFileSync(prefsPath, 'utf8'));
    } catch (e) {
      console.warn('Failed to parse existing Chrome Preferences, overwriting:', e);
    }
  }

  // Inject or update printing settings
  if (!existingPrefs.printing) existingPrefs.printing = {};
  if (!existingPrefs.printing.print_preview_sticky_settings) {
    existingPrefs.printing.print_preview_sticky_settings = {};
  }

  const appState = {
    recentDestinations: [
      {
        id: printerName,
        origin: "local",
        account: "",
        displayName: printerName
      }
    ],
    selectedDestinationId: printerName,
    version: 2,
    isColorEnabled: isColor,
    isDuplexEnabled: isDuplex,
    copies: copies,
    isLandscapeEnabled: isLandscape,
    pagesToPrint: pagesRange,
    mediaSize: mediaSizeObj
  };

  existingPrefs.printing.print_preview_sticky_settings.appState = JSON.stringify(appState);

  // Write updated preferences
  fs.writeFileSync(prefsPath, JSON.stringify(existingPrefs, null, 2), 'utf8');
  console.log('Successfully wrote print settings to Chrome Preferences file.');

  // Create local HTML print harness page
  const harnessPath = path.join(profileDir, 'print_harness.html');
  const fileUrl = `file:///${path.resolve(filePath).replace(/\\/g, '/')}`;
  
  const harnessHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>PrintFlow Harness - ${jobToken}</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
      background-color: #0b0f19;
      color: #f3f4f6;
      display: flex;
      height: 100vh;
      overflow: hidden;
    }
    .sidebar {
      width: 340px;
      background-color: #111827;
      border-right: 1px solid #1f2937;
      display: flex;
      flex-direction: column;
      padding: 24px;
      box-sizing: border-box;
      flex-shrink: 0;
    }
    .title {
      font-size: 18px;
      font-weight: 700;
      color: #818cf8;
      margin-bottom: 24px;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .job-card {
      background-color: #1f2937;
      border: 1px solid #374151;
      border-radius: 12px;
      padding: 16px;
      margin-bottom: 20px;
    }
    .job-title {
      font-size: 11px;
      color: #9ca3af;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 4px;
    }
    .job-value {
      font-size: 14px;
      font-weight: 600;
      color: #ffffff;
      word-break: break-all;
    }
    .setting-item {
      display: flex;
      justify-content: space-between;
      margin-bottom: 8px;
      font-size: 13px;
    }
    .setting-label {
      color: #9ca3af;
    }
    .setting-value {
      font-weight: 600;
      color: #f3f4f6;
    }
    .progress-section {
      flex-grow: 1;
      background-color: #0b0f19;
      border: 1px solid #1f2937;
      border-radius: 12px;
      padding: 16px;
      margin-bottom: 20px;
      font-family: monospace;
      font-size: 12px;
      overflow-y: auto;
    }
    .log-entry {
      margin-bottom: 8px;
      color: #10b981;
    }
    .log-entry.pending {
      color: #4b5563;
    }
    .log-entry.active {
      color: #3b82f6;
      animation: pulse 1.5s infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }
    .btn-print {
      background: linear-gradient(135deg, #4f46e5 0%, #3730a3 100%);
      color: white;
      border: none;
      padding: 14px;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 700;
      cursor: pointer;
      transition: all 0.2s;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
      text-align: center;
    }
    .btn-print:hover {
      transform: translateY(-1px);
      box-shadow: 0 10px 15px -3px rgba(79, 70, 229, 0.3);
    }
    .btn-print:active {
      transform: translateY(0);
    }
    .viewer-container {
      flex-grow: 1;
      background-color: #0b0f19;
      display: flex;
      flex-direction: column;
      height: 100%;
    }
    .viewer {
      width: 100%;
      height: 100%;
      border: none;
    }
    @media print {
      body {
        background: white;
        color: black;
      }
      .sidebar {
        display: none !important;
      }
      .viewer-container {
        width: 100% !important;
        height: 100% !important;
      }
    }
  </style>
</head>
<body>
  <div class="sidebar">
    <div class="title">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path><path d="M6 9V3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v6"></path><rect x="6" y="14" width="12" height="8" rx="1"></rect></svg>
      PrintFlow Automation
    </div>
    
    <div class="job-card">
      <div class="job-title">Job Token</div>
      <div class="job-value">${jobToken}</div>
      <div class="job-title" style="margin-top: 12px;">Document</div>
      <div class="job-value" style="font-size: 12px; font-weight: normal; max-height: 40px; overflow: hidden; text-overflow: ellipsis;">${filename}</div>
    </div>
    
    <div class="job-card" style="margin-top: 0;">
      <div class="setting-item">
        <span class="setting-label">Printer:</span>
        <span class="setting-value">${printerName}</span>
      </div>
      <div class="setting-item">
        <span class="setting-label">Copies:</span>
        <span class="setting-value">${copies}</span>
      </div>
      <div class="setting-item">
        <span class="setting-label">Color Mode:</span>
        <span class="setting-value">${isColor ? 'Color' : 'B&W'}</span>
      </div>
      <div class="setting-item">
        <span class="setting-label">Paper Size:</span>
        <span class="setting-value">${pageSize}</span>
      </div>
      <div class="setting-item">
        <span class="setting-label">Orientation:</span>
        <span class="setting-value">${orientation}</span>
      </div>
      <div class="setting-item" style="margin-bottom: 0;">
        <span class="setting-label">Duplex:</span>
        <span class="setting-value">${isDuplex ? 'Two-Sided' : 'One-Sided'}</span>
      </div>
    </div>
    
    <div class="progress-section" id="logs-container">
      <div class="log-entry" id="log-init">&gt; Initializing print harness... OK</div>
      <div class="log-entry pending" id="log-settings">&gt; Configured sticky preferences</div>
      <div class="log-entry pending" id="log-trigger">&gt; Awaiting operator print action...</div>
    </div>
    
    <button class="btn-print" id="print-btn" onclick="triggerNativePrint()">Print Document</button>
  </div>
  
  <div class="viewer-container">
    <embed class="viewer" id="pdf-viewer" src="${fileUrl}#toolbar=0&navpanes=0" type="application/pdf" />
  </div>

  <script>
    function log(elementId, text, status = 'ok') {
      const el = document.getElementById(elementId);
      if (el) {
        el.innerText = "> " + text;
        el.className = "log-entry " + status;
      }
    }
    
    function triggerNativePrint() {
      log('log-trigger', 'Executing window.print()...', 'active');
      setTimeout(() => {
        window.print();
        log('log-trigger', 'Print job sent successfully.', 'ok');
      }, 500);
    }
  </script>
</body>
</html>`;

  fs.writeFileSync(harnessPath, harnessHtml, 'utf8');

  // 3. Launch Chrome with Playwright
  console.log(`Launching Google Chrome (visible: ${SHOW_BROWSER})...`);
  
  const chromeArgs = [
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-features=Translate',
    '--window-size=1100,800'
  ];

  // If running headlessly (production), bypass native preview and print instantly
  if (!SHOW_BROWSER) {
    chromeArgs.push('--kiosk-printing');
  }

  const context = await chromium.launchPersistentContext(profileDir, {
    headless: !SHOW_BROWSER,
    channel: 'chrome',
    args: chromeArgs
  });

  try {
    const page = context.pages()[0] || await context.newPage();

    // Load custom print harness URL
    const harnessUrl = `file:///${path.resolve(harnessPath).replace(/\\/g, '/')}`;
    console.log(`Navigating to print harness page...`);
    await page.goto(harnessUrl);

    // Wait for the document to be fully loaded
    await page.waitForLoadState('load');
    await page.waitForTimeout(2000); 

    // Update harness logger to show options configured
    await page.evaluate(() => {
      const logSettings = document.getElementById('log-settings');
      if (logSettings) {
        logSettings.innerText = "> Configured sticky preferences... OK";
        logSettings.className = "log-entry";
      }
    });

    await page.waitForTimeout(1000);

    // Hover and Click on the custom Print Button on the page
    console.log('Moving cursor to Print button...');
    await page.hover('#print-btn');
    await page.waitForTimeout(800);
    console.log('Clicking HTML Print button...');
    await page.click('#print-btn');

    if (SHOW_BROWSER) {
      // Wait for print preview modal to draw
      console.log('Waiting for Chrome print preview to appear...');
      await page.waitForTimeout(3000);

      // Send Enter to trigger printing from preview window
      console.log('Sending Enter key press to confirm print preview...');
      await page.keyboard.press('Enter');
      await page.waitForTimeout(4000);
    } else {
      // Silent spooling wait
      console.log('Spooling silent kiosk print...');
      await page.waitForTimeout(6000);
    }

    console.log('Print flow completed successfully.');
  } catch (error) {
    console.error('Error during print automation:', error);
    process.exit(2);
  } finally {
    console.log('Closing browser context.');
    await context.close();
    
    // Clean up temporary print harness file
    try {
      if (fs.existsSync(harnessPath)) {
        fs.unlinkSync(harnessPath);
      }
    } catch (e) {
      console.warn('Could not delete temporary harness file:', e.message);
    }
  }
}

run().catch((err) => {
  console.error('Fatal execution error:', err);
  process.exit(3);
});
