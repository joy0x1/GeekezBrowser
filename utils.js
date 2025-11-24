// utils.js
const { Base64 } = require('js-base64');
const { URL } = require('url');

/**
 * 从代理链接中提取备注
 * 优先级：VMess 的 ps 字段 > URL 的 hash (#) > 空字符串
 */
function getProxyRemark(link) {
    if (!link) return '';
    link = link.trim();
    try {
        if (link.startsWith('vmess://')) {
            const base64Str = link.replace('vmess://', '');
            try {
                const configStr = Base64.decode(base64Str);
                const vmess = JSON.parse(configStr);
                return vmess.ps || '';
            } catch (e) { return ''; }
        } else {
            // 处理 ss://, vless://, trojan://, socks5:// 等
            try {
                // 有些链接可能不完整，尝试用 URL 解析
                if (link.includes('#')) {
                    const hashPart = link.split('#')[1];
                    return decodeURIComponent(hashPart).trim();
                }
            } catch (e) { return ''; }
        }
    } catch (e) { return ''; }
    return '';
}

/**
 * 解析各种协议链接为 Xray Outbound 对象
 */
function parseProxyLink(link, tag) {
    let outbound = { tag: tag };
    link = link.trim();

    try {
        if (link.startsWith('vmess://')) {
            const base64Str = link.replace('vmess://', '');
            const configStr = Base64.decode(base64Str);
            const vmess = JSON.parse(configStr);

            outbound.protocol = "vmess";
            outbound.settings = {
                vnext: [{
                    address: vmess.add,
                    port: parseInt(vmess.port),
                    users: [{
                        id: vmess.id,
                        alterId: parseInt(vmess.aid || 0),
                        security: vmess.scy || "auto"
                    }]
                }]
            };
            outbound.streamSettings = {
                network: vmess.net || "tcp",
                security: vmess.tls || "none",
                wsSettings: vmess.net === "ws" ? { path: vmess.path, headers: { Host: vmess.host } } : undefined,
                tlsSettings: vmess.tls === 'tls' ? { serverName: vmess.sni || vmess.host, allowInsecure: true } : undefined,
                grpcSettings: vmess.net === 'grpc' ? { serviceName: vmess.path } : undefined // 兼容部分 grpc 写在 path 里的情况
            };
        } 
        else if (link.startsWith('vless://')) {
            const urlObj = new URL(link);
            const params = urlObj.searchParams;
            outbound.protocol = "vless";
            outbound.settings = {
                vnext: [{
                    address: urlObj.hostname,
                    port: parseInt(urlObj.port),
                    users: [{
                        id: urlObj.username,
                        encryption: params.get("encryption") || "none"
                    }]
                }]
            };
            outbound.streamSettings = {
                network: params.get("type") || "tcp",
                security: params.get("security") || "none",
                tlsSettings: params.get("security") === 'tls' ? { serverName: params.get("sni") || urlObj.hostname, allowInsecure: true } : undefined,
                wsSettings: params.get("type") === 'ws' ? { path: params.get("path") } : undefined,
                grpcSettings: params.get("type") === 'grpc' ? { serviceName: params.get("serviceName") } : undefined
            };
        }
        else if (link.startsWith('trojan://')) {
            const urlObj = new URL(link);
            const params = urlObj.searchParams;
            outbound.protocol = "trojan";
            outbound.settings = {
                servers: [{
                    address: urlObj.hostname,
                    port: parseInt(urlObj.port),
                    password: urlObj.username
                }]
            };
            outbound.streamSettings = {
                network: params.get("type") || "tcp",
                security: "tls",
                tlsSettings: { serverName: params.get("sni") || urlObj.hostname, allowInsecure: true },
                wsSettings: params.get("type") === 'ws' ? { path: params.get("path") } : undefined,
                grpcSettings: params.get("type") === 'grpc' ? { serviceName: params.get("serviceName") } : undefined
            };
        }
        else if (link.startsWith('ss://')) {
            let raw = link.replace('ss://', '');
            if (raw.includes('#')) raw = raw.split('#')[0]; 

            let method, password, host, port;
            if (raw.includes('@')) {
                const parts = raw.split('@');
                const userPart = parts[0];
                const hostPart = parts[1];
                if (!userPart.includes(':')) {
                    const decoded = Base64.decode(userPart);
                    [method, password] = decoded.split(':');
                } else {
                    [method, password] = userPart.split(':');
                }
                [host, port] = hostPart.split(':');
            } else {
                const decoded = Base64.decode(raw);
                const match = decoded.match(/^(.*?):(.*?)@(.*?):(\d+)$/);
                if(match) {
                     [, method, password, host, port] = match;
                } else {
                    // 尝试处理旧格式或其他变种，如果不匹配则抛错
                     const parts = decoded.split(':');
                     if(parts.length >= 3) { // 极简容错
                         method = parts[0]; password = parts[1]; host = parts[2]; port = parts[3];
                     }
                }
            }
            outbound.protocol = "shadowsocks";
            outbound.settings = {
                servers: [{ address: host, port: parseInt(port), method, password }]
            };
        } else if (link.startsWith('socks5://') || link.startsWith('socks://')) {
            const urlObj = new URL(link.replace('socks5://', 'http://').replace('socks://', 'http://'));
            outbound.protocol = "socks";
            outbound.settings = {
                servers: [{
                    address: urlObj.hostname,
                    port: parseInt(urlObj.port),
                    users: urlObj.username ? [{ user: urlObj.username, pass: urlObj.password }] : []
                }]
            };
        } else if (link.startsWith('http://') || link.startsWith('https://')) {
            const urlObj = new URL(link);
            outbound.protocol = "http";
            outbound.settings = {
                servers: [{
                    address: urlObj.hostname,
                    port: parseInt(urlObj.port),
                    users: urlObj.username ? [{ user: urlObj.username, pass: urlObj.password }] : []
                }]
            };
        } else {
            throw new Error("不支持的协议格式");
        }
    } catch (e) {
        console.error("解析节点失败:", link, e);
        throw e;
    }

    return outbound;
}

function generateXrayConfig(mainProxyStr, localPort, preProxyConfig = null) {
    const outbounds = [];

    // 1. 解析主节点
    let mainOutbound;
    try {
        mainOutbound = parseProxyLink(mainProxyStr, "proxy_main");
    } catch (e) {
        mainOutbound = { protocol: "freedom", tag: "proxy_main" }; 
    }

    // 2. 处理前置代理
    if (preProxyConfig && preProxyConfig.preProxies && preProxyConfig.preProxies.length > 0) {
        try {
            const target = preProxyConfig.preProxies[0];
            const preOutbound = parseProxyLink(target.url, "proxy_pre");
            outbounds.push(preOutbound);
            
            // Xray 核心链式代理设置
            mainOutbound.proxySettings = {
                tag: "proxy_pre" 
            };
            
            // 针对嵌套代理的优化：清理可能导致冲突的高级流设置
            // 如果前置已经处理了复杂的传输层，后置最好是纯粹的 TCP
            // 但如果后置必须有 TLS (虽然我们建议不要)，Xray 也能尝试处理
            
        } catch (e) {
            console.error("前置代理解析失败:", e);
        }
    }

    outbounds.push(mainOutbound);
    outbounds.push({ protocol: "freedom", tag: "direct" });

    return {
        log: { loglevel: "error" },
        inbounds: [{
            port: localPort,
            listen: "127.0.0.1",
            protocol: "socks",
            settings: { udp: true }
        }],
        outbounds: outbounds,
        routing: {
            rules: [
                { type: "field", outboundTag: "proxy_main", port: "0-65535" }
            ]
        }
    };
}

module.exports = { generateXrayConfig, parseProxyLink, getProxyRemark };