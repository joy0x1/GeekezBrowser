# GeekEZ Browser

**GeekEZ Browser** is a stealthy, anti-detect browser designed for e-commerce operations and multi-account management. Built with Electron and Puppeteer, integrated with Xray-core for powerful proxy tunneling.

**GeekEZ Browser** 是一款专为电商运营和多账号管理设计的指纹隐匿浏览器。基于 Electron 和 Puppeteer 构建，底层集成 Xray-core 实现强大的代理链路管理。

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)

## ✨ Features (核心特性)

*   **Fingerprint Isolation (指纹隔离)**:
    *   **Native Code Spoofing**: Proxies `toString()` methods to bypass integrity checks.
    *   **Media Noise Injection**: Adds invisible noise to Canvas and AudioContext to generate unique fingerprints.
    *   **Hardware Consistency**: UserAgent matches platform and WebGL parameters strictly.
*   **Proxy Chain (链路代理)**:
    *   Supports `VMess`, `VLESS`, `Trojan`, `Shadowsocks`, `Socks5`, `HTTP`.
    *   **Pre-Proxy**: Tunnel traffic through a pre-proxy (e.g., local VPN) before hitting the target proxy to hide your real IP.
    *   **Group & Subscribe**: Manage nodes via subscription URLs with auto-update support.
*   **E-Commerce Ready (电商适用)**:
    *   Optimized for **TikTok**, **Facebook**, **Amazon**, **Shopee**, etc.
    *   Removes automation flags (`navigator.webdriver`, CDP traces).

## 🚀 Quick Start (快速开始)

### Option 1: Download Release (下载安装包)
Go to the [Releases](https://github.com/EchoHS/GeekezBrowser/releases) page and download the installer for your system.
前往 Releases 页面下载适配您系统的安装包直接运行。

### Option 2: Run from Source (源码运行)

**Prerequisites (前置要求)**:
*   [Node.js](https://nodejs.org/) (Version 16+)
*   [Git](https://git-scm.com/)

**Installation Steps (安装步骤)**:

1.  **Clone the repository**
    ```bash
    git clone https://github.com/EchoHS/GeekezBrowser.git
    cd GeekezBrowser
    ```

2.  **Install Dependencies (安装依赖)**
    *   *Global Users*: `npm install`
    *   *China Users (中国用户推荐)*:
        ```bash
        npm config set registry https://registry.npmmirror.com
        # Configure Puppeteer to use China mirror
        SET PUPPETEER_DOWNLOAD_HOST=https://npmmirror.com/mirrors
        npm install
        ```

3.  **Run Setup Script (运行初始化脚本)**
    This script will automatically detect your network environment (CN/Global) and download the correct Xray-core binary.
    此脚本会自动检测您的网络环境（中国/海外），并下载适配系统的 Xray 内核（中国地区自动使用加速镜像）。
    ```bash
    node setup.js
    ```

4.  **Start the App (启动应用)**
    ```bash
    npm start
    ```

## 🛠 Compatibility (适用性说明)

| Platform | Rating | Note |
| :--- | :--- | :--- |
| **TikTok** | ✅ Safe | Canvas noise effectively prevents device association. Requires high-quality IP. |
| **Facebook** | ✅ Safe | Automation flags stripped. Suitable for ad account management. |
| **Amazon (Buyer)** | ✅ Safe | Sufficient isolation for buyer/reviewer accounts. |
| **Amazon (Seller)** | ⚠️ Caution | Main accounts with high assets should consider VPS due to TLS fingerprinting risks. |
| **Shopee/Lazada** | ✅ Safe | Stable fingerprint for seller centers. |

## 📦 Build (打包发布)

To create an executable for your platform:

```bash
# For Windows
npm run build:win

# For macOS
npm run build:mac

# For Linux
npm run build:linux

⚠️ Disclaimer
This tool is provided for educational and research purposes only. The developers are not responsible for any account bans or legal issues resulting from the use of this software.
本软件仅供技术研究与教育使用。请遵守各平台的使用规则，开发者不对因使用本软件导致的账号封禁或法律风险承担责任。

