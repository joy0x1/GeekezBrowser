// fingerprint.js - 专业版重构

// 真实的 Chrome 版本号段 (主版本.0.次版本.小版本)
const CHROME_VERSIONS = [
    '128.0.6613.120', '128.0.6613.119', '127.0.6533.120', 
    '127.0.6533.99', '126.0.6478.127', '126.0.6478.182',
    '129.0.6668.58', '129.0.6668.42'
];

// 操作系统数据库 (关联 UA 平台字符 + 兼容的 GPU 列表)
const OS_DB = [
    {
        name: 'Windows',
        uaPlatform: 'Windows NT 10.0; Win64; x64', // Win10/11 通用
        navigatorPlatform: 'Win32',
        gpus: [
            { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4090 Direct3D11 vs_5_0 ps_5_0, D3D11)' },
            { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Ti Direct3D11 vs_5_0 ps_5_0, D3D11)' },
            { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 SUPER Direct3D11 vs_5_0 ps_5_0, D3D11)' },
            { vendor: 'Google Inc. (AMD)', renderer: 'ANGLE (AMD, AMD Radeon RX 6700 XT Direct3D11 vs_5_0 ps_5_0, D3D11)' },
            { vendor: 'Google Inc. (Intel)', renderer: 'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)' }
        ]
    },
    {
        name: 'Mac',
        uaPlatform: 'Macintosh; Intel Mac OS X 10_15_7',
        navigatorPlatform: 'MacIntel',
        gpus: [
            { vendor: 'Apple', renderer: 'Apple M1' },
            { vendor: 'Apple', renderer: 'Apple M2 Pro' },
            { vendor: 'Apple', renderer: 'Apple M3 Max' },
            { vendor: 'Intel Inc.', renderer: 'Intel(R) Iris(TM) Plus Graphics 640' } // 旧款 Mac
        ]
    }
    // Linux 对于电商环境极少使用，建议为了风控安全，少用 Linux 指纹，除非你就在 Linux 机器上跑
];

// 常见分辨率
const RESOLUTIONS = [
    { w: 1920, h: 1080 }, { w: 2560, h: 1440 }, { w: 1366, h: 768 },
    { w: 1536, h: 864 }, { w: 1440, h: 900 }, { w: 1280, h: 720 },
    { w: 3840, h: 2160 }, { w: 1680, h: 1050 }
];

// 硬件并发数 (CPU 核心)
const CORES = [4, 6, 8, 12, 16, 24];

// 设备内存 (GB)
const MEMORY = [4, 8, 16, 32];

function getRandom(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

function generateFingerprint() {
    // 1. 随机选择操作系统
    const osProfile = getRandom(OS_DB);
    
    // 2. 根据操作系统选择显卡 (一致性关键)
    const gpu = getRandom(osProfile.gpus);
    
    // 3. 随机选择 Chrome 版本
    const version = getRandom(CHROME_VERSIONS);
    
    // 4. 随机分辨率
    const res = getRandom(RESOLUTIONS);
    
    // 5. 硬件参数
    const concurrency = getRandom(CORES);
    const memory = getRandom(MEMORY);

    // 6. 生成噪音种子 (Canvas/Audio/WebGL)
    // 极微小的浮点数扰动
    const canvasNoise = {
        r: Math.floor(Math.random() * 10) - 5,
        g: Math.floor(Math.random() * 10) - 5,
        b: Math.floor(Math.random() * 10) - 5,
        a: Math.floor(Math.random() * 10) - 5
    };

    return {
        // 基础信息
        userAgent: `Mozilla/5.0 (${osProfile.uaPlatform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version} Safari/537.36`,
        platform: osProfile.navigatorPlatform, // Win32 or MacIntel
        
        // 屏幕
        screen: { width: res.w, height: res.h },
        window: { width: res.w, height: res.h },
        
        // 硬件指纹
        webgl: gpu,
        hardwareConcurrency: concurrency,
        deviceMemory: memory,
        
        // 噪音参数
        canvasNoise: canvasNoise,
        audioNoise: Math.random() * 0.0001,
        webglNoise: Math.random() * 0.0001, // 用于微调 WebGL 绘图
        
        noiseSeed: Math.floor(Math.random() * 9999999)
    };
}

module.exports = { generateFingerprint };