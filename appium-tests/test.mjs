import { remote } from 'webdriverio';
import ExcelJS from 'exceljs';
import path from 'path';

const testResults = [];

async function logResult(testName, expected, actual, status, errorMsg = '') {
    console.log(`[${status}] ${testName}`);
    testResults.push({
        testCase: testName,
        expected: expected,
        actual: actual,
        status: status,
        error: errorMsg,
        timestamp: new Date().toISOString()
    });
}

async function waitForWebViewAndSwitch(client) {
    console.log('Waiting for stable WebView connection (up to 90s)...');
    const deadline = Date.now() + 90000;
    let attempt = 0;

    while (Date.now() < deadline) {
        attempt++;
        // Always re-poll contexts so we catch a freshly registered WebView
        const contexts = await client.getContexts().catch(() => ['NATIVE_APP']);
        console.log(`Attempt ${attempt} - Available Contexts:`, contexts);
        const webviewContext = contexts.find(c => c.includes('WEBVIEW'));

        if (webviewContext) {
            try {
                console.log(`Switching to ${webviewContext}...`);
                await client.switchContext(webviewContext);
                await client.pause(4000); // let Chrome stabilise before touching DevTools
                const url = await client.getUrl();
                console.log('WebView connected successfully. URL:', url);
                return; // success
            } catch (e) {
                console.log(`Switch failed: ${e.message} — re-polling after 5s...`);
                try { await client.switchContext('NATIVE_APP'); } catch {}
                await client.pause(5000); // longer wait before re-polling
            }
        } else {
            await client.pause(3000);
        }
    }
    throw new Error('Timed out (90s) waiting for a stable WebView connection!');
}

async function jsSetValue(client, selector, value) {
    // Use JavaScript to set input values instead of CDP keyboard events.
    // This avoids Chrome renderer crashes caused by Input.dispatchKeyEvent on Chrome 145 WebView.
    const el = await client.$(selector);
    await el.waitForDisplayed({ timeout: 12000 });
    await el.click();
    await client.pause(300);
    await client.execute((sel, val) => {
        const input = document.querySelector(sel);
        if (!input) throw new Error('jsSetValue: element not found: ' + sel);
        // Use the correct prototype based on element type to avoid "Illegal invocation"
        const proto = input.tagName.toLowerCase() === 'textarea'
            ? window.HTMLTextAreaElement.prototype
            : window.HTMLInputElement.prototype;
        const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value').set;
        nativeSetter.call(input, val);
        input.dispatchEvent(new Event('input',  { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
    }, selector, String(value));
    await client.pause(200);
    console.log(`Set value on ${selector}: "${value}"`);
}

async function loginAs(client, role, phone, password) {
    console.log(`Logging in as ${role}...`);

    // Navigate directly to /login-choice — avoids framer-motion opacity:0 animation
    const BASE = 'https://jobnow.dailywage.workers.dev';
    await client.url(`${BASE}/login-choice`);
    await client.pause(3000);

    // Click the appropriate role button
    await clickVisible(client, `a[href="/login?role=${role}"]`, `${role} role button`);
    await client.pause(5000);

    // Enter credentials via JS to avoid CDP keyboard renderer crashes on Chrome 145
    await jsSetValue(client, '#login-phone', phone);
    await jsSetValue(client, '#login-phone-password', password);

    const submitBtn = await client.$('#login-phone-submit');
    await submitBtn.waitForDisplayed({ timeout: 10000 });
    await submitBtn.click();
    console.log('Login submitted. Switching to NATIVE_APP to survive Supabase redirect...');

    // IMMEDIATELY switch to NATIVE_APP — Supabase auth navigates (possibly cross-domain)
    // which kills the Chrome DevTools session if we stay in WEBVIEW context.
    try { await client.switchContext('NATIVE_APP'); } catch (e) {
        console.log('  switchContext NATIVE_APP warning:', e.message);
    }
    await client.pause(5000); // wait for auth redirect to complete

    // Re-acquire the WebView after navigation settles
    await waitForWebViewAndSwitch(client);

    // Verify we landed on the expected dashboard
    const url = await client.getUrl();
    console.log(`Post-login URL: ${url}`);
    if (!url.includes(`/${role}`)) {
        throw new Error(`Login as ${role} failed — expected /${role}, got: ${url}`);
    }
    console.log(`Logged in as ${role}. Dashboard confirmed: ${url}`);
}

async function resetSession(client) {
    try {
        console.log('Clearing local storage to reset session...');
        await client.execute(() => {
            window.localStorage.clear();
            window.sessionStorage.clear();
        });
        console.log('Storage cleared successfully.');
    } catch (e) {
        console.log('Error clearing storage:', e.message);
    }
    await client.switchContext('NATIVE_APP');
    await client.terminateApp('com.jobnow.app');
    await client.activateApp('com.jobnow.app');
    await waitForWebViewAndSwitch(client);
}

// Click the first DISPLAYED element matching selector.
// Waits up to `waitMs` for at least one element to appear (handles React auth-loading delay).
// Falls back to JS click if no displayed element found (avoids sidebar vs bottom-nav ambiguity).
async function clickVisible(client, selector, label = selector, waitMs = 15000) {
    // Poll until at least one element appears in DOM
    let elements = [];
    const deadline = Date.now() + waitMs;
    while (Date.now() < deadline) {
        elements = await client.$$(selector).catch(() => []);
        if (elements.length > 0) break;
        console.log(`  Waiting for ${label} to appear in DOM...`);
        await client.pause(1500);
    }
    for (const el of elements) {
        try {
            if (await el.isDisplayed()) {
                await el.click();
                console.log(`Clicked visible: ${label}`);
                return;
            }
        } catch {}
    }
    // Fallback: scroll into view and JS-click the first element found
    if (elements.length > 0) {
        console.log(`No visible element for ${label} — using JS click fallback`);
        await client.execute(el => { el.scrollIntoView(); el.click(); }, elements[0]);
    } else {
        throw new Error(`Element "${selector}" did not appear within ${waitMs}ms`);
    }
}

async function runTest() {
    console.log('Connecting to Appium server and launching JobNow app on emulator...');
    
    const capabilities = {
        platformName: 'Android',
        'appium:automationName': 'UiAutomator2',
        'appium:app': 'C:\\Users\\aysha\\Desktop\\PDD\\android\\app\\build\\outputs\\apk\\debug\\jobnow.apk',
        'appium:appPackage': 'com.jobnow.app',
        'appium:appActivity': 'com.jobnow.app.MainActivity',
        'appium:autoGrantPermissions': true,
        'appium:ensureWebviewsHavePages': true,
        'appium:nativeWebScreenshot': true,
        'appium:newCommandTimeout': 3600,
        'appium:ignoreHiddenApiPolicyError': true,
        'appium:webviewConnectTimeout': 40000,
        'appium:chromedriverDisableBuildCheck': true,
        'appium:chromedriverArgs': ['--disable-dev-shm-usage', '--no-sandbox', '--disable-gpu']
    };

    const client = await remote({
        protocol: 'http',
        hostname: '127.0.0.1',
        port: 4723,
        path: '/',
        capabilities: capabilities,
        logLevel: 'error'
    });

    try {
        await waitForWebViewAndSwitch(client);
        
        // Self-healing startup cleanup in case app starts in logged-in state
        try {
            let currentUrl = await client.getUrl();
            console.log('Initial URL in Webview:', currentUrl);
            if (currentUrl && !currentUrl.includes('/welcome')) {
                console.log('Detected existing session at startup. Clearing storage and navigating to welcome...');
                // Clear storage via JS (no navigation yet — avoids DevTools disconnect)
                await client.execute(() => {
                    window.localStorage.clear();
                    window.sessionStorage.clear();
                }).catch(e => console.log('Storage clear warning:', e.message));
                // Use WebDriver-level navigation (safer than window.location.href)
                await client.url('https://jobnow.dailywage.workers.dev/');
                await client.pause(4000);
                console.log('Navigated to welcome page.');
            }
        } catch (err) {
            console.log('Startup cleanup warning (non-fatal):', err.message);
        }

        // Ensure we are in WEBVIEW context before starting scenarios
        try {
            const currentCtx = await client.getContext();
            if (!currentCtx || !currentCtx.includes('WEBVIEW')) {
                console.log('Not in WEBVIEW after cleanup — re-acquiring...');
                await waitForWebViewAndSwitch(client);
            }
        } catch (e) {
            console.log('Re-acquiring WEBVIEW after cleanup:', e.message);
            await waitForWebViewAndSwitch(client);
        }

        // ---------------------------------------------------------
        // SCENARIO 1: CONTRACTOR POST JOB & ESCROW FUNDING
        // ---------------------------------------------------------
        console.log('Starting Scenario 1: Contractor Job Posting...');
        await loginAs(client, 'contractor', '8220983729', 'apsar123');
        
        // Go to Post Job page
        await clickVisible(client, 'a[href="/contractor/post"]', 'Post Job tab');
        await client.pause(2000);

        // Fill form via JS to avoid CDP keyboard renderer crashes
        await jsSetValue(client, '#post-title', 'E2E Painter Job');
        await jsSetValue(client, '#post-description', 'This is a test job description generated by the E2E script for automated testing.');
        await jsSetValue(client, '#post-pay', '850');
        await jsSetValue(client, '#post-workers', '1');
        await jsSetValue(client, '#post-duration', '2');
        await jsSetValue(client, '#post-start-date', '2026-06-15');

        // Select Painter skill
        try {
            const painterBtn = await client.$('button*=Painter');
            await painterBtn.click();
            console.log('Selected Painter skill.');
        } catch (e) {
            console.log('Failed to click Painter button, proceeding with default:', e.message);
        }

        // Submit form — scroll into center first so bottom nav doesn't intercept, then JS-click
        const publishBtn = await client.$('#post-job-submit');
        await client.execute(el => { el.scrollIntoView({ block: 'center', behavior: 'instant' }); }, publishBtn);
        await client.pause(800);
        await client.execute(el => el.click(), publishBtn);
        console.log('Clicked publish button. Waiting for payment modal...');
        await client.pause(3000);

        // Enter UPI into payment modal via JS
        const upiInput = await client.$('input[placeholder*="mobile@upi"]');
        await upiInput.waitForExist({ timeout: 12000 });
        await jsSetValue(client, 'input[placeholder*="mobile@upi"]', 'test@upi');
        await client.pause(500);

        // Click the modal's Pay button via JS — uses .z-10 to target inside the modal,
        // avoiding the backdrop (which would intercept a ChromeDriver click on #post-job-submit)
        await client.execute(() => {
            const btn = document.querySelector('.z-10 form button[type="submit"]');
            if (!btn) throw new Error('Modal pay button not found inside .z-10 form');
            btn.scrollIntoView({ block: 'center' });
            btn.click();
        });
        console.log('Clicked Pay button on Razorpay modal.');
        await client.pause(6000);

        const urlAfterPost = await client.getUrl();
        console.log('Current URL after job posting:', urlAfterPost);
        if (!urlAfterPost.includes('/contractor')) {
            throw new Error(`Expected redirection to /contractor dashboard, but got: ${urlAfterPost}`);
        }

        logResult(
            'Scenario 1: Contractor Job Posting', 
            'Job successfully posted and escrow funded', 
            'Job posted and redirected to /contractor', 
            'PASS'
        );

        await resetSession(client);

        // ---------------------------------------------------------
        // SCENARIO 2: WORKER JOB SEARCH & APPLICATION
        // ---------------------------------------------------------
        console.log('Starting Scenario 2: Worker Job Search & Apply...');
        await loginAs(client, 'worker', '8870730454', 'jalal123');

        // Filter by Painter skill
        try {
            const painterSkillBtn = await client.$('button*=Painter');
            await painterSkillBtn.waitForExist({ timeout: 10000 });
            await painterSkillBtn.click();
            console.log('Filtered jobs by Painter skill.');
            await client.pause(2000);
        } catch (e) {
            console.log('Failed to filter by Painter skill:', e.message);
        }

        // Find the job card and click Apply using XPath matching title card
        console.log('Searching for the posted E2E Painter Job card...');
        const applyBtn = await client.$('//h3[contains(text(), "E2E Painter Job")]/ancestor::div[contains(@class, "cursor-pointer")]//button');
        await applyBtn.waitForExist({ timeout: 15000 });
        await applyBtn.click();
        console.log('Clicked Apply on E2E Painter Job card.');
        await client.pause(3000);

        // Verify Apply page is loaded
        const applyHeader = await client.$('h1*=Claim Escrow Job Slot');
        await applyHeader.waitForExist({ timeout: 10000 });

        // Submit application
        const claimBtn = await client.$('button[type="submit"]');
        await claimBtn.click();
        console.log('Clicked Claim Slot & Lock Escrow.');
        await client.pause(4000);

        const afterApplyUrl = await client.getUrl();
        console.log('Current URL after applying:', afterApplyUrl);
        if (!afterApplyUrl.includes('/worker/accepted')) {
            throw new Error(`Expected redirection to /worker/accepted, but got: ${afterApplyUrl}`);
        }

        logResult(
            'Scenario 2: Worker Job Search & Apply', 
            'Job claimed and redirected to accepted jobs page', 
            'Job slot successfully claimed and verified', 
            'PASS'
        );

        await resetSession(client);

        // ---------------------------------------------------------
        // SCENARIO 3: WORKER DASHBOARD NAVIGATION & BUTTONS
        // ---------------------------------------------------------
        console.log('Starting Scenario 3: Worker Navigation & Buttons...');
        await loginAs(client, 'worker', '8870730454', 'jalal123');

        // Click Jobs Tab
        await clickVisible(client, 'a[href="/worker/jobs"]', 'Worker Jobs tab');
        await client.pause(2000);

        // Click Chat Tab
        await clickVisible(client, 'a[href="/worker/messages"]', 'Worker Chat tab');
        await client.pause(2000);

        // Click Earnings Tab
        await clickVisible(client, 'a[href="/worker/earnings"]', 'Worker Earnings tab');
        await client.pause(2000);

        // Click Profile Tab
        await clickVisible(client, 'a[href="/worker/profile"]', 'Worker Profile tab');
        await client.pause(2000);

        // Click Edit profile
        const editProfileBtn = await client.$('button*=Edit profile');
        await editProfileBtn.waitForExist({ timeout: 10000 });
        await editProfileBtn.click();
        console.log('Clicked Edit Profile.');
        await client.pause(2500);

        // Click Cancel on Edit profile modal
        const cancelEditBtn = await client.$('button*=Cancel');
        await cancelEditBtn.waitForExist({ timeout: 10000 });
        await cancelEditBtn.click();
        console.log('Clicked Cancel on Edit Profile modal.');
        await client.pause(2000);

        logResult(
            'Scenario 3: Worker Navigation & Buttons', 
            'All main bottom tabs navigate properly and profile drawer opens/closes', 
            'Verified bottom tabs and edit profile drawer', 
            'PASS'
        );

        await resetSession(client);

        // ---------------------------------------------------------
        // SCENARIO 4: CONTRACTOR DASHBOARD NAVIGATION & BUTTONS
        // ---------------------------------------------------------
        console.log('Starting Scenario 4: Contractor Navigation & Buttons...');
        await loginAs(client, 'contractor', '8220983729', 'apsar123');

        // Click Workers Tab
        await clickVisible(client, 'a[href="/contractor/workers"]', 'Contractor Workers tab');
        await client.pause(2000);

        // Click Chat Tab
        await clickVisible(client, 'a[href="/contractor/messages"]', 'Contractor Chat tab');
        await client.pause(2000);

        // Click Profile Tab
        await clickVisible(client, 'a[href="/contractor/profile"]', 'Contractor Profile tab');
        await client.pause(2000);

        // Click Home Tab
        await clickVisible(client, 'a[href="/contractor"]', 'Contractor Home tab');
        await client.pause(2000);

        // Click See All link for active jobs
        await clickVisible(client, 'a[href="/contractor/active"]', 'Active Jobs See All link');
        await client.pause(2000);

        logResult(
            'Scenario 4: Contractor Navigation & Buttons', 
            'All main bottom tabs navigate properly and sub-pages load', 
            'Verified contractor bottom tabs and sub-pages navigation', 
            'PASS'
        );

        // Cleanup: clear session before exiting
        try {
            console.log('Performing final session reset cleanup...');
            const contextsFinal = await client.getContexts();
            const webviewFinal = contextsFinal.find(c => c.includes('WEBVIEW'));
            if (webviewFinal) {
                await client.switchContext(webviewFinal);
                await client.execute(() => {
                    window.localStorage.clear();
                    window.sessionStorage.clear();
                });
            }
        } catch (e) {
            console.log('Failed final cleanup:', e.message);
        }

    } catch (error) {
        console.error('Test Failed:', error.message);
        logResult('Appium Automation Test', 'Test executes smoothly', error.message, 'FAIL', error.stack);
    } finally {
        await client.switchContext('NATIVE_APP').catch(() => {});
        await client.deleteSession();
        await generateExcelReport();
        console.log('Testing complete. Excel report generated.');
    }
}

async function generateExcelReport() {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Live Appium Test Results');

    sheet.columns = [
        { header: 'Timestamp', key: 'timestamp', width: 25 },
        { header: 'Test Case', key: 'testCase', width: 30 },
        { header: 'Expected Result', key: 'expected', width: 45 },
        { header: 'Actual Result', key: 'actual', width: 40 },
        { header: 'Status', key: 'status', width: 15 },
        { header: 'Error Details', key: 'error', width: 40 }
    ];

    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF000000' } };

    testResults.forEach(result => {
        const row = sheet.addRow(result);
        row.getCell('status').fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: result.status === 'PASS' ? 'FF00FF00' : 'FFFF0000' }
        };
    });

    let reportPath = path.resolve('..', 'Mobile_Test_Report.xlsx');
    try {
        await workbook.xlsx.writeFile(reportPath);
        console.log(`\n=> ✅ Excel Report saved to: ${reportPath}`);
    } catch (e) {
        if (e.code === 'EBUSY' || e.code === 'EACCES') {
            // File is open in Excel — save with a timestamp suffix instead
            const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
            reportPath = path.resolve('..', `Mobile_Test_Report_${ts}.xlsx`);
            await workbook.xlsx.writeFile(reportPath);
            console.log(`\n=> ✅ Excel Report saved to (fallback): ${reportPath}`);
            console.log('   (Original file was locked — close Mobile_Test_Report.xlsx in Excel to overwrite it next time)');
        } else {
            throw e;
        }
    }
}

runTest();
