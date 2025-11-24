// setup.js
const fs = require('fs');
const path = require('path');
const https = require('https');
const os = require('os');
const { exec } = require('child_process');

// 配置
const BIN_DIR = path.join(__dirname, 'resources', 'bin');
const XRAY_VERSION = 'v1.8.4'; // 指定 Xray 版本
const GH_PROXY = 'https://gh-proxy.com/'; // Github 加速前缀

// 检测系统架构
function getPlatformInfo() {
    const platform = os.platform();
    const arch = os.arch();
    
    let xrayAsset = '';
    let exeName = 'xray';

    if (platform === 'win32') {
        xrayAsset = `Xray-windows-${arch === 'x64' ? '64' : '32'}.zip`;
        exeName = 'xray.exe';
    } else if (platform === 'darwin') {
        // Mac Universal or specific
        xrayAsset = `Xray-macos-${arch === 'arm64' ? 'arm64-v8a' : '64'}.zip`;
    } else if (platform === 'linux') {
        xrayAsset = `Xray-linux-${arch === 'x64' ? '64' : '32'}.zip`;
    } else {
        console.error('❌ Unsupported Platform:', platform);
        process.exit(1);
    }

    return { xrayAsset, exeName };
}

// 简单的网络检测 (检测是否能直连 Github)
function checkNetwork() {
    return new Promise((resolve) => {
        console.log('🌐 Checking network connectivity...');
        const req = https.get('https://github.com', { timeout: 5000 }, (res) => {
            if (res.statusCode === 200 || res.statusCode === 301 || res.statusCode === 302) {
                resolve(true); // Global
            } else {
                resolve(false); // Likely CN
            }
        });
        req.on('error', () => resolve(false));
        req.on('timeout', () => { req.destroy(); resolve(false); });
    });
}

// 下载文件
function downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest);
        https.get(url, (response) => {
            if (response.statusCode === 302 || response.statusCode === 301) {
                downloadFile(response.headers.location, dest).then(resolve).catch(reject);
                return;
            }
            response.pipe(file);
            file.on('finish', () => {
                file.close(resolve);
            });
        }).on('error', (err) => {
            fs.unlink(dest, () => {});
            reject(err);
        });
    });
}

// 解压 (使用系统 tar/powershell，避免依赖第三方库)
function extractZip(zipPath, destDir) {
    return new Promise((resolve, reject) => {
        console.log('📦 Extracting...');
        if (os.platform() === 'win32') {
            // Windows 使用 PowerShell 解压
            exec(`powershell -command "Expand-Archive -Path '${zipPath}' -DestinationPath '${destDir}' -Force"`, (err) => {
                if (err) reject(err); else resolve();
            });
        } else {
            // Mac/Linux 使用 unzip
            exec(`unzip -o "${zipPath}" -d "${destDir}"`, (err) => {
                if (err) reject(err); else resolve();
            });
        }
    });
}

async function main() {
    // 1. 创建目录
    if (!fs.existsSync(BIN_DIR)) {
        fs.mkdirSync(BIN_DIR, { recursive: true });
    }

    const { xrayAsset, exeName } = getPlatformInfo();
    const finalExePath = path.join(BIN_DIR, exeName);

    if (fs.existsSync(finalExePath)) {
        console.log('✅ Xray core already exists. Skipping download.');
        return;
    }

    // 2. 检测网络
    const isGlobal = await checkNetwork();
    console.log(`🌍 Network Environment: ${isGlobal ? 'Global' : 'Mainland China (Using Mirror)'}`);

    // 3. 构建下载链接
    const baseUrl = `https://github.com/XTLS/Xray-core/releases/download/${XRAY_VERSION}/${xrayAsset}`;
    const downloadUrl = isGlobal ? baseUrl : (GH_PROXY + baseUrl);

    console.log(`⬇️ Downloading Xray core from: ${downloadUrl}`);
    
    const zipPath = path.join(BIN_DIR, 'xray.zip');
    
    try {
        await downloadFile(downloadUrl, zipPath);
        console.log('✅ Download complete.');
        
        await extractZip(zipPath, BIN_DIR);
        console.log('✅ Extraction complete.');
        
        // 清理 zip
        fs.unlinkSync(zipPath);
        
        // Mac/Linux 赋予执行权限
        if (os.platform() !== 'win32') {
            fs.chmodSync(finalExePath, '755');
        }

        console.log('🎉 Setup finished! You can now run "npm start".');

    } catch (error) {
        console.error('❌ Error during setup:', error.message);
        console.error('Try downloading manually and placing it in resources/bin/');
    }
}

main();