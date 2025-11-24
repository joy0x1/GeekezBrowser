const { app, BrowserWindow, ipcMain, dialog, screen, shell } = require('electron');
const path = require('path');
const fs = require('fs-extra');
const { spawn } = require('child_process');
const treeKill = require('tree-kill');
const getPort = require('get-port');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { v4: uuidv4 } = require('uuid');
const yaml = require('js-yaml');
const { executablePath } = require('puppeteer');
const { SocksProxyAgent } = require('socks-proxy-agent');
const http = require('http');

app.disableHardwareAcceleration();

const { generateXrayConfig } = require('./utils');
const { generateFingerprint } = require('./fingerprint');

puppeteer.use(StealthPlugin());

const isDev = !app.isPackaged;
const BIN_PATH = isDev 
    ? path.join(__dirname, 'resources', 'bin', process.platform === 'win32' ? 'xray.exe' : 'xray')
    : path.join(process.resourcesPath, 'bin', process.platform === 'win32' ? 'xray.exe' : 'xray');

const DATA_PATH = path.join(app.getPath('userData'), 'BrowserProfiles');
const TRASH_PATH = path.join(app.getPath('userData'), '_Trash_Bin');
const PROFILES_FILE = path.join(DATA_PATH, 'profiles.json');
const SETTINGS_FILE = path.join(DATA_PATH, 'settings.json');

fs.ensureDirSync(DATA_PATH);
fs.ensureDirSync(TRASH_PATH);

let activeProcesses = {}; 

function createWindow() {
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width: screenW, height: screenH } = primaryDisplay.workAreaSize;
    const winW = Math.round(screenW * 0.5); 
    const winH = Math.round(screenH * 0.601); 

    const win = new BrowserWindow({
        width: winW, height: winH, minWidth: 800, minHeight: 600,
        title: "GeekEZ Browser", backgroundColor: '#1e1e2d',
		icon: path.join(__dirname, 'resources/icon.ico'),
        webPreferences: { 
            preload: path.join(__dirname, 'preload.js'), 
            contextIsolation: true, 
            nodeIntegration: false,
            spellcheck: false 
        }
    });
    win.setMenuBarVisibility(false);
    win.loadFile('index.html');
}

app.whenReady().then(() => {
    createWindow();
    setTimeout(() => { fs.emptyDir(TRASH_PATH).catch(() => {}); }, 10000); 
});

// --- 注入脚本 ---
// main.js 中的 createInjectionScript 函数

const createInjectionScript = (fp, profileName) => {
    if (!fp) return "";
    const fpJson = JSON.stringify(fp);
    const nameJson = JSON.stringify(profileName);

    return `
    (() => {
        try {
            const fp = ${fpJson};
            const profileName = ${nameJson};

            // --- 0. Native Code 伪装工具 (Anti-detection) ---
            const nativeToString = Function.prototype.toString;
            function proxyToString(fn, nativeStr) {
                const toStringProxy = new Proxy(nativeToString, {
                    apply(target, thisArg, args) {
                        if (thisArg === fn) return nativeStr;
                        return target.apply(thisArg, args);
                    }
                });
                Object.defineProperty(fn, 'toString', { value: toStringProxy });
            }

            // --- 1. Navigator Spoofing (UA, Platform, Hardware) ---
            // 使用 Object.defineProperty 覆盖只读属性
            Object.defineProperty(navigator, 'userAgent', { get: () => fp.userAgent });
            Object.defineProperty(navigator, 'platform', { get: () => fp.platform }); // 关键：Win32 / MacIntel
            Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => fp.hardwareConcurrency });
            Object.defineProperty(navigator, 'deviceMemory', { get: () => fp.deviceMemory });
            
            // 语言伪装 (根据 Platform 简单推断，生产环境可做的更细)
            const lang = fp.platform.includes('Mac') ? ['en-US', 'en'] : ['en-US', 'en']; 
            Object.defineProperty(navigator, 'languages', { get: () => lang });
            Object.defineProperty(navigator, 'language', { get: () => lang[0] });

            // --- 2. Screen Spoofing ---
            const screenProps = {
                width: fp.screen.width, height: fp.screen.height,
                availWidth: fp.screen.width, availHeight: fp.screen.height, // 简化处理，通常要减去任务栏
                colorDepth: 24, pixelDepth: 24
            };
            for (const prop in screenProps) {
                Object.defineProperty(screen.prototype, prop, { get: () => screenProps[prop] });
            }

            // --- 3. WebGL Parameter Spoofing ---
            const getParameter = WebGLRenderingContext.prototype.getParameter;
            WebGLRenderingContext.prototype.getParameter = function(parameter) {
                // UNMASKED_VENDOR_WEBGL
                if (parameter === 37445) return fp.webgl.vendor;
                // UNMASKED_RENDERER_WEBGL
                if (parameter === 37446) return fp.webgl.renderer;
                return getParameter.apply(this, arguments);
            };
            proxyToString(WebGLRenderingContext.prototype.getParameter, "function getParameter() { [native code] }");

            // --- 4. Canvas Fingerprint Noise ---
            const getImageData = CanvasRenderingContext2D.prototype.getImageData;
            CanvasRenderingContext2D.prototype.getImageData = function(x, y, w, h) {
                const imageData = getImageData.apply(this, arguments);
                // 使用 noiseSeed 确定性地添加微小噪音
                if (fp.noiseSeed) {
                    for (let i = 0; i < imageData.data.length; i += 4) {
                        // 仅修改 Alpha 通道或 Blue 通道，且间隔修改，降低性能损耗
                        if ((i + fp.noiseSeed) % 53 === 0) {
                            // 加上 fp.canvasNoise 的随机扰动
                            const noise = fp.canvasNoise ? (fp.canvasNoise.b || 0) : 0;
                            imageData.data[i+2] = Math.min(255, Math.max(0, imageData.data[i+2] + noise));
                        }
                    }
                }
                return imageData;
            };
            proxyToString(CanvasRenderingContext2D.prototype.getImageData, "function getImageData() { [native code] }");

            const toDataURL = HTMLCanvasElement.prototype.toDataURL;
            HTMLCanvasElement.prototype.toDataURL = function(type) {
                // 由于 getImageData 已经被 Hook，toDataURL 依赖底层数据，通常也会带上噪音。
                // 这里的 Hook 主要是为了防检测 toString
                return toDataURL.apply(this, arguments);
            };
            proxyToString(HTMLCanvasElement.prototype.toDataURL, "function toDataURL() { [native code] }");

            // --- 5. AudioContext Noise ---
            const originalGetChannelData = AudioBuffer.prototype.getChannelData;
            AudioBuffer.prototype.getChannelData = function(channel) {
                const results = originalGetChannelData.apply(this, arguments);
                const noise = fp.audioNoise || 0.00001;
                // 遍历音频数据添加微小噪音
                for (let i = 0; i < results.length; i += 100) {
                    results[i] = results[i] + noise;
                }
                return results;
            };
            proxyToString(AudioBuffer.prototype.getChannelData, "function getChannelData() { [native code] }");

            // --- 6. UI Indicator (标题与水印) ---
            const updateTitle = () => {
                if(!document.title.startsWith("[" + profileName + "]")) {
                    document.title = "[" + profileName + "] " + document.title;
                }
            };
            setInterval(updateTitle, 1000);
            
            const badge = document.createElement('div');
            badge.innerText = profileName;
            badge.style.cssText = "position:fixed; bottom:5px; right:5px; opacity:0.6; background:#000; color:#0f0; padding:3px 6px; font-size:11px; z-index:2147483647; pointer-events:none; border-radius:3px; font-family:sans-serif; font-weight:bold;";
            if(document.body) document.body.appendChild(badge);

        } catch(e) { console.error("Fingerprint Injection Error:", e); }
    })();
    `;
};

// --- IPC ---
ipcMain.handle('fetch-url', async (e, url) => {
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.text();
    } catch (error) { throw error.message; }
});

ipcMain.handle('test-proxy-latency', async (e, proxyStr) => {
    const tempPort = await getPort();
    const tempConfigPath = path.join(app.getPath('userData'), `test_config_${tempPort}.json`);
    try {
        let outbound;
        try {
            const { parseProxyLink } = require('./utils');
            outbound = parseProxyLink(proxyStr, "proxy_test");
        } catch (err) { return { success: false, msg: "Format Err" }; }
        const config = {
            log: { loglevel: "none" },
            inbounds: [{ port: tempPort, listen: "127.0.0.1", protocol: "socks", settings: { udp: true } }],
            outbounds: [outbound, { protocol: "freedom", tag: "direct" }],
            routing: { rules: [{ type: "field", outboundTag: "proxy_test", port: "0-65535" }] }
        };
        await fs.writeJson(tempConfigPath, config);
        const xrayProcess = spawn(BIN_PATH, ['-c', tempConfigPath], { cwd: path.dirname(BIN_PATH), stdio: 'ignore' });
        await new Promise(r => setTimeout(r, 800));
        const start = Date.now();
        const agent = new SocksProxyAgent(`socks5://127.0.0.1:${tempPort}`);
        const result = await new Promise((resolve) => {
            const req = http.get('http://cp.cloudflare.com/generate_204', { agent, timeout: 5000 }, (res) => {
                const latency = Date.now() - start;
                if (res.statusCode === 204) resolve({ success: true, latency });
                else resolve({ success: false, msg: `HTTP ${res.statusCode}` });
            });
            req.on('error', () => resolve({ success: false, msg: "Err" }));
            req.on('timeout', () => { req.destroy(); resolve({ success: false, msg: "Timeout" }); });
        });
        treeKill(xrayProcess.pid);
        try { fs.unlinkSync(tempConfigPath); } catch(e){}
        return result;
    } catch (err) { return { success: false, msg: err.message }; }
});

ipcMain.handle('get-running-ids', () => Object.keys(activeProcesses));
ipcMain.handle('get-profiles', async () => { if (!fs.existsSync(PROFILES_FILE)) return []; return fs.readJson(PROFILES_FILE); });
ipcMain.handle('update-profile', async (event, updatedProfile) => {
    let profiles = await fs.readJson(PROFILES_FILE);
    const index = profiles.findIndex(p => p.id === updatedProfile.id);
    if (index > -1) { profiles[index] = updatedProfile; await fs.writeJson(PROFILES_FILE, profiles); return true; }
    return false;
});
ipcMain.handle('save-profile', async (event, data) => {
    const profiles = fs.existsSync(PROFILES_FILE) ? await fs.readJson(PROFILES_FILE) : [];
    const fingerprint = data.fingerprint || generateFingerprint();
    const newProfile = { id: uuidv4(), name: data.name, proxyStr: data.proxyStr, fingerprint: fingerprint, preProxyOverride: 'default', isSetup: false, createdAt: Date.now() };
    profiles.push(newProfile);
    await fs.writeJson(PROFILES_FILE, profiles);
    return newProfile;
});
ipcMain.handle('delete-profile', async (event, id) => {
    let profiles = await fs.readJson(PROFILES_FILE);
    profiles = profiles.filter(p => p.id !== id);
    await fs.writeJson(PROFILES_FILE, profiles);
    const profileDir = path.join(DATA_PATH, id);
    const trashDest = path.join(TRASH_PATH, `${id}_${Date.now()}`);
    try { if (fs.existsSync(profileDir)) fs.renameSync(profileDir, trashDest); } 
    catch (err) { fs.move(profileDir, trashDest).catch(() => {}); }
    return true;
});
ipcMain.handle('get-settings', async () => { if (fs.existsSync(SETTINGS_FILE)) return fs.readJson(SETTINGS_FILE); return { preProxies: [], mode: 'single', enablePreProxy: false }; });
ipcMain.handle('save-settings', async (e, settings) => { await fs.writeJson(SETTINGS_FILE, settings); return true; });
ipcMain.handle('open-url', async (e, url) => { await shell.openExternal(url); });
ipcMain.handle('export-profile', async (e, profileId) => {
    const profiles = await fs.readJson(PROFILES_FILE);
    const profile = profiles.find(p => p.id === profileId);
    if(!profile) return false;
    const { filePath } = await dialog.showSaveDialog({ title: 'Export Profile', defaultPath: `${profile.name}.yml`, filters: [{ name: 'YAML', extensions: ['yml', 'yaml'] }] });
    if (filePath) { const exportData = { ...profile }; delete exportData.id; await fs.writeFile(filePath, yaml.dump(exportData)); return true; }
    return false;
});
ipcMain.handle('import-profile', async () => {
    const { filePaths } = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'YAML', extensions: ['yml', 'yaml'] }] });
    if (filePaths && filePaths.length > 0) {
        try {
            const content = await fs.readFile(filePaths[0], 'utf8');
            const data = yaml.load(content);
            if(data.name && data.proxyStr && data.fingerprint) {
                const profiles = fs.existsSync(PROFILES_FILE) ? await fs.readJson(PROFILES_FILE) : [];
                const newProfile = { ...data, id: uuidv4(), isSetup: false, createdAt: Date.now() };
                profiles.push(newProfile);
                await fs.writeJson(PROFILES_FILE, profiles);
                return true;
            }
        } catch (e) { console.error(e); }
    }
    return false;
});

ipcMain.handle('launch-profile', async (event, profileId) => {
    const sender = event.sender;
    if (activeProcesses[profileId]) {
        const proc = activeProcesses[profileId];
        if (proc.browser && proc.browser.isConnected()) {
            try {
                const pages = await proc.browser.pages();
                if (pages.length > 0) await pages[0].bringToFront();
                return "环境运行中，已唤醒窗口";
            } catch (e) { delete activeProcesses[profileId]; }
        } else { delete activeProcesses[profileId]; }
    }

    const profiles = await fs.readJson(PROFILES_FILE);
    const profile = profiles.find(p => p.id === profileId);
    if (!profile) throw new Error('Profile not found');
    
    let settings = { preProxies: [], mode: 'single', enablePreProxy: false };
    if (fs.existsSync(SETTINGS_FILE)) try { settings = await fs.readJson(SETTINGS_FILE); } catch(e){}
    const override = profile.preProxyOverride || 'default';
    const shouldUsePreProxy = override === 'on' || (override === 'default' && settings.enablePreProxy);
    let finalPreProxyConfig = null;
    let switchMsg = null;
    
    if (shouldUsePreProxy && settings.preProxies && settings.preProxies.length > 0) {
        const active = settings.preProxies.filter(p => p.enable !== false);
        if (active.length > 0) {
            if (settings.mode === 'single') {
                const target = active.find(p => p.id === settings.selectedId) || active[0];
                finalPreProxyConfig = { preProxies: [target] };
            } else if (settings.mode === 'balance') {
                const target = active[Math.floor(Math.random() * active.length)];
                finalPreProxyConfig = { preProxies: [target] };
                if(settings.notify) switchMsg = `Balance: [${target.remark}]`;
            } else if (settings.mode === 'failover') {
                const target = active[0];
                finalPreProxyConfig = { preProxies: [target] };
                if(settings.notify) switchMsg = `Failover: [${target.remark}]`;
            }
        }
    }

    try {
        const localPort = await getPort();
        const profileDir = path.join(DATA_PATH, profileId);
        const userDataDir = path.join(profileDir, 'browser_data');
        const xrayConfigPath = path.join(profileDir, 'config.json');
        fs.ensureDirSync(userDataDir);
        try {
            const defaultProfileDir = path.join(userDataDir, 'Default');
            fs.ensureDirSync(defaultProfileDir);
            const preferencesPath = path.join(defaultProfileDir, 'Preferences');
            let preferences = {};
            if (fs.existsSync(preferencesPath)) preferences = await fs.readJson(preferencesPath);
            if (!preferences.bookmark_bar) preferences.bookmark_bar = {};
            preferences.bookmark_bar.show_on_all_tabs = true;
            if(preferences.protection) delete preferences.protection;
            await fs.writeJson(preferencesPath, preferences);
        } catch (e) {}

        const config = generateXrayConfig(profile.proxyStr, localPort, finalPreProxyConfig);
        fs.writeJsonSync(xrayConfigPath, config);
        const xrayProcess = spawn(BIN_PATH, ['-c', xrayConfigPath], { cwd: path.dirname(BIN_PATH), stdio: 'ignore' });
        
        const launchArgs = [
            `--proxy-server=socks5://127.0.0.1:${localPort}`,
            `--user-data-dir=${userDataDir}`,
            `--window-size=${profile.fingerprint?.window?.width || 1280},${profile.fingerprint?.window?.height || 800}`,
            '--no-first-run', '--restore-last-session',
            '--disable-blink-features=AutomationControlled', 
            '--disable-infobars', '--disable-features=IsolateOrigins,site-per-process'
        ];
        const browser = await puppeteer.launch({
            headless: false, executablePath: executablePath(), userDataDir: userDataDir,
            args: launchArgs, defaultViewport: null, ignoreDefaultArgs: ['--enable-automation'],
            pipe: false, dumpio: false 
        });

        if (!profile.isSetup) {
            try {
                const setupPage = await browser.newPage();
                await setupPage.goto('chrome://settings/manageProfile');
                await new Promise(r => setTimeout(r, 500));
                await setupPage.evaluate((newName) => {
                    function findDeep(root, selector) {
                        if (!root) return null;
                        if (root.matches && root.matches(selector)) return root;
                        if (root.shadowRoot) { const found = findDeep(root.shadowRoot, selector); if (found) return found; }
                        if (root.children) { for (let i = 0; i < root.children.length; i++) { const found = findDeep(root.children[i], selector); if (found) return found; } }
                        return null;
                    }
                    const input = findDeep(document.body, '#nameInput');
                    if (input) {
                        input.value = newName;
                        input.dispatchEvent(new Event('input', { bubbles: true }));
                        input.dispatchEvent(new Event('change', { bubbles: true }));
                        input.blur();
                    }
                }, profile.name);
                await new Promise(r => setTimeout(r, 800));
                await setupPage.close();
                const allProfiles = await fs.readJson(PROFILES_FILE);
                const idx = allProfiles.findIndex(p => p.id === profileId);
                if (idx > -1) { allProfiles[idx].isSetup = true; await fs.writeJson(PROFILES_FILE, allProfiles); }
            } catch (e) {}
        }

        const injectJs = createInjectionScript(profile.fingerprint, profile.name);
        const pages = await browser.pages();
        if(pages[0]) { await pages[0].evaluateOnNewDocument(injectJs); await pages[0].reload(); }
        browser.on('targetcreated', async (t) => { const p = await t.page(); if(p) await p.evaluateOnNewDocument(injectJs); });

        activeProcesses[profileId] = { xrayPid: xrayProcess.pid, browser };
        sender.send('profile-status', { id: profileId, status: 'running' });

        browser.on('disconnected', () => {
            if (activeProcesses[profileId]) {
                treeKill(activeProcesses[profileId].xrayPid);
                delete activeProcesses[profileId];
                if (!sender.isDestroyed()) sender.send('profile-status', { id: profileId, status: 'stopped' });
            }
        });
        return switchMsg; 
    } catch (err) { console.error(err); throw err; }
});
// --- Export Logic ---
ipcMain.handle('export-data', async (e, type) => {
    const profiles = fs.existsSync(PROFILES_FILE) ? await fs.readJson(PROFILES_FILE) : [];
    const settings = fs.existsSync(SETTINGS_FILE) ? await fs.readJson(SETTINGS_FILE) : { preProxies: [], subscriptions: [] };
    
    let exportObj = {};
    
    if (type === 'all' || type === 'profiles') {
        // 导出 Profile 时，移除 id 以便导入时重新生成（避免冲突），或者保留 id 用于迁移？
        // 通常为了迁移，保留 id，但在本机导入时如果有同 id 应覆盖或跳过。
        // 这里简单起见，原样导出。
        exportObj.profiles = profiles;
    }
    
    if (type === 'all' || type === 'proxies') {
        exportObj.preProxies = settings.preProxies || [];
        exportObj.subscriptions = settings.subscriptions || [];
    }

    // 只有当有数据时才保存
    if (Object.keys(exportObj).length === 0) return false;

    const { filePath } = await dialog.showSaveDialog({
        title: 'Export Data',
        defaultPath: `GeekEZ_Backup_${type}_${Date.now()}.yaml`,
        filters: [{ name: 'YAML', extensions: ['yml', 'yaml'] }]
    });

    if (filePath) {
        await fs.writeFile(filePath, yaml.dump(exportObj));
        return true;
    }
    return false;
});

// --- Import Logic (Unified) ---
ipcMain.handle('import-data', async () => {
    const { filePaths } = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [{ name: 'YAML', extensions: ['yml', 'yaml'] }]
    });

    if (filePaths && filePaths.length > 0) {
        try {
            const content = await fs.readFile(filePaths[0], 'utf8');
            const data = yaml.load(content);
            
            let updated = false;

            // 1. 检测是否是组合包 (包含 profiles 或 preProxies 字段)
            if (data.profiles || data.preProxies || data.subscriptions) {
                // 导入 Profiles
                if (Array.isArray(data.profiles)) {
                    const currentProfiles = fs.existsSync(PROFILES_FILE) ? await fs.readJson(PROFILES_FILE) : [];
                    data.profiles.forEach(p => {
                        // 简单的去重逻辑：如果 ID 存在则覆盖，否则添加
                        // 为了安全，重新生成 ID 更好，防止冲突？
                        // 策略：保留导入的配置，但赋予新 ID (如果是克隆)，
                        // 或者假设用户是做数据迁移，保留 ID。这里选择保留 ID 但检查存在。
                        const idx = currentProfiles.findIndex(cp => cp.id === p.id);
                        if (idx > -1) {
                            currentProfiles[idx] = p; // 覆盖
                        } else {
                            // 如果是单个 Profile 格式导入进来的，可能没有 isSetup 等字段，补全它
                            if(!p.id) p.id = uuidv4();
                            currentProfiles.push(p);
                        }
                    });
                    await fs.writeJson(PROFILES_FILE, currentProfiles);
                    updated = true;
                }

                // 导入 Settings (Proxies)
                if (Array.isArray(data.preProxies) || Array.isArray(data.subscriptions)) {
                    const currentSettings = fs.existsSync(SETTINGS_FILE) ? await fs.readJson(SETTINGS_FILE) : { preProxies: [], subscriptions: [] };
                    
                    if(data.preProxies) {
                        if(!currentSettings.preProxies) currentSettings.preProxies = [];
                        // 合并节点，避免 ID 冲突
                        data.preProxies.forEach(p => {
                            if(!currentSettings.preProxies.find(cp => cp.id === p.id)) {
                                currentSettings.preProxies.push(p);
                            }
                        });
                    }
                    
                    if(data.subscriptions) {
                        if(!currentSettings.subscriptions) currentSettings.subscriptions = [];
                        data.subscriptions.forEach(s => {
                            if(!currentSettings.subscriptions.find(cs => cs.id === s.id)) {
                                currentSettings.subscriptions.push(s);
                            }
                        });
                    }
                    await fs.writeJson(SETTINGS_FILE, currentSettings);
                    updated = true;
                }

            } 
            // 2. 兼容旧版：单个 Profile 导入 (没有根键，直接就是对象)
            else if (data.name && data.proxyStr && data.fingerprint) {
                const profiles = fs.existsSync(PROFILES_FILE) ? await fs.readJson(PROFILES_FILE) : [];
                // 总是作为新环境导入
                const newProfile = { ...data, id: uuidv4(), isSetup: false, createdAt: Date.now() };
                profiles.push(newProfile);
                await fs.writeJson(PROFILES_FILE, profiles);
                updated = true;
            }

            return updated;
        } catch (e) {
            console.error(e);
            throw e;
        }
    }
    return false;
});

app.on('window-all-closed', () => {
    Object.values(activeProcesses).forEach(p => treeKill(p.xrayPid));
    if (process.platform !== 'darwin') app.quit();
});