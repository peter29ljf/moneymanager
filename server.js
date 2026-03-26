const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const https = require('https');
const { spawn } = require('child_process');
const crypto = require('crypto');

const app = express();
const PORT = 3000;
const DATA_FILE = path.join(__dirname, 'assets.json');
const TRADING_LOG_FILE = path.join(__dirname, 'trading_logs.json');
const BITGET_CFG_FILE = path.join(__dirname, 'bitget_config.json');
const EXCHANGE_CFG_FILE = path.join(__dirname, 'exchange_config.json');

const DEFAULT_BITGET_CFG = Object.freeze({
  apiKey: '',
  secretKey: '',
  passphrase: '',
  sandbox: false
});

const DEFAULT_ASTER_CFG = Object.freeze({
  apiKey: '',
  secretKey: '',
  recvWindow: 5000,
  defaultLeverage: 3,
  marginType: 'CROSSED',
  positionMode: 'ONE_WAY'
});

const ASTER_API_BASE = 'https://fapi.asterdex.com';
const ASTER_SYMBOL_CACHE_TTL = 60 * 60 * 1000; // 1 hour
let ASTER_SYMBOL_CACHE = {
  updatedAt: 0,
  symbols: [],
  map: new Map()
};

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function buildDefaultExchangeConfig() {
  return {
    activeExchange: 'sandbox', // preserved for backward compatibility (used as default only)
    bitget: clone(DEFAULT_BITGET_CFG),
    aster: clone(DEFAULT_ASTER_CFG)
  };
}

// 全局错误处理
process.on('uncaughtException', (error) => {
  console.error('未捕获的异常:', error);
  console.error('堆栈跟踪:', error.stack);
  // 不退出进程，而是记录错误并继续运行
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('未处理的Promise拒绝:', reason);
  console.error('Promise:', promise);
  // 不退出进程，而是记录错误并继续运行
});

// 优雅关闭处理
process.on('SIGTERM', () => {
  console.log('收到SIGTERM信号，开始优雅关闭...');
  gracefulShutdown();
});

process.on('SIGINT', () => {
  console.log('收到SIGINT信号，开始优雅关闭...');
  gracefulShutdown();
});

function gracefulShutdown() {
  console.log('清理定时器...');
  // 清理所有策略定时器
  for (const [groupId, timer] of STRATEGY_TIMERS) {
    clearInterval(timer);
    console.log(`已清理组 ${groupId} 的定时器`);
  }
  STRATEGY_TIMERS.clear();
  
  console.log('服务器已优雅关闭');
  process.exit(0);
}

// 内存监控
function startMemoryMonitor() {
  setInterval(() => {
    const memUsage = process.memoryUsage();
    const memMB = Math.round(memUsage.heapUsed / 1024 / 1024);
    const memTotal = Math.round(memUsage.heapTotal / 1024 / 1024);
    
    // 如果内存使用超过500MB，记录警告
    if (memMB > 500) {
      console.warn(`内存使用警告: ${memMB}MB / ${memTotal}MB`);
    }
    
    // 如果内存使用超过800MB，清理定时器并重启策略
    if (memMB > 800) {
      console.warn(`内存使用过高: ${memMB}MB，清理定时器...`);
      for (const [groupId, timer] of STRATEGY_TIMERS) {
        clearInterval(timer);
      }
      STRATEGY_TIMERS.clear();
      
      // 重新启动策略定时器
      setTimeout(() => {
        const data = readAssets();
        for (const g of data.groups || []) {
          const s = ensureGroupStrategy(g);
          if (s.enabled) startStrategyTimer(g.id);
        }
        console.log('策略定时器已重新启动');
      }, 5000);
    }
  }, 60000); // 每分钟检查一次
}

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));

function readAssets() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const data = fs.readFileSync(DATA_FILE, 'utf8');
      const parsed = JSON.parse(data);

      // 兼容旧结构 { crypto: [], stocks: [] } -> 迁移为 { groups: [...] }
      if (parsed && !parsed.groups && (parsed.crypto || parsed.stocks)) {
        const legacyCrypto = Array.isArray(parsed.crypto) ? parsed.crypto : [];
        const legacyStocks = Array.isArray(parsed.stocks) ? parsed.stocks : [];
        const merged = [...legacyCrypto, ...legacyStocks].map(a => {
          const uq = Number(a && a.unrealizedQuantity);
          return {
            id: a.id || Date.now().toString(),
            name: a.name,
            quantity: a.quantity || 0,
            unrealizedQuantity: Number.isFinite(uq) ? uq : 0,
            // 旧资产没有 Bitget 合约符号，保留价格用于初始显示
            price: typeof a.price === 'number' ? a.price : 0,
            symbol: a.symbol || null,
            createdAt: a.createdAt || new Date().toISOString(),
            updatedAt: a.updatedAt || undefined
          };
        });

        return {
          groups: [
            {
              id: 'default-group',
              name: '默认资产组',
              createdAt: new Date().toISOString(),
              assets: merged
            }
          ]
        };
      }

      // 新结构
      if (parsed && Array.isArray(parsed.groups)) {
        for (const group of parsed.groups) {
          if (group && Array.isArray(group.assets)) {
            for (const asset of group.assets) {
              if (asset && typeof asset === 'object') {
                const uq = Number(asset.unrealizedQuantity);
                asset.unrealizedQuantity = Number.isFinite(uq) ? uq : 0;
              }
            }
          }
        }
        return parsed;
      }
    }
  } catch (error) {
    console.error('Error reading assets file:', error);
  }
  return { groups: [] };
}

function writeAssets(data) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
    return true;
  } catch (error) {
    console.error('Error writing assets file:', error);
    return false;
  }
}

function readTradingLogs() {
  try {
    if (fs.existsSync(TRADING_LOG_FILE)) {
      const raw = fs.readFileSync(TRADING_LOG_FILE, 'utf8');
      return JSON.parse(raw || '[]');
    }
  } catch (e) {
    console.error('Error reading logs:', e);
  }
  return [];
}

function appendTradingLog(entry) {
  const logs = readTradingLogs();
  logs.push(entry);
  try {
    fs.writeFileSync(TRADING_LOG_FILE, JSON.stringify(logs, null, 2));
    return true;
  } catch (e) {
    console.error('Error writing logs:', e);
    return false;
  }
}

function parseBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return ['true', '1', 'yes', 'on'].includes(normalized);
  }
  return false;
}

function normalizeBitgetConfig(cfg) {
  const base = clone(DEFAULT_BITGET_CFG);
  if (!cfg || typeof cfg !== 'object') return base;
  if (cfg.apiKey !== undefined) base.apiKey = String(cfg.apiKey || '').trim();
  if (cfg.secretKey !== undefined) base.secretKey = String(cfg.secretKey || '').trim();
  if (cfg.passphrase !== undefined) base.passphrase = String(cfg.passphrase || '').trim();
  if (cfg.sandbox !== undefined) base.sandbox = parseBoolean(cfg.sandbox);
  return base;
}

function normalizeAsterConfig(cfg) {
  const base = clone(DEFAULT_ASTER_CFG);
  if (!cfg || typeof cfg !== 'object') return base;
  if (cfg.apiKey !== undefined) base.apiKey = String(cfg.apiKey || '').trim();
  if (cfg.secretKey !== undefined) base.secretKey = String(cfg.secretKey || '').trim();
  if (cfg.recvWindow !== undefined) {
    const num = Number(cfg.recvWindow);
    if (!Number.isNaN(num) && num > 0) base.recvWindow = Math.floor(num);
  }
  if (cfg.defaultLeverage !== undefined) {
    const lev = Number.parseInt(cfg.defaultLeverage, 10);
    if (!Number.isNaN(lev) && lev >= 1 && lev <= 125) {
      base.defaultLeverage = lev;
    }
  }
  if (cfg.marginType !== undefined) {
    const mt = String(cfg.marginType || '').trim().toUpperCase();
    if (['ISOLATED', 'CROSSED'].includes(mt)) {
      base.marginType = mt;
    }
  }
  if (cfg.positionMode !== undefined) {
    const pm = String(cfg.positionMode || '').trim().toUpperCase();
    if (['ONE_WAY', 'HEDGE'].includes(pm)) {
      base.positionMode = pm;
    }
  }
  return base;
}

function readExchangeConfig() {
  const defaults = buildDefaultExchangeConfig();
  try {
    if (fs.existsSync(EXCHANGE_CFG_FILE)) {
      const raw = fs.readFileSync(EXCHANGE_CFG_FILE, 'utf8');
      if (!raw) return defaults;
      const parsed = JSON.parse(raw);
      const activeCandidate = typeof parsed.activeExchange === 'string'
        ? parsed.activeExchange.toLowerCase()
        : defaults.activeExchange;
      const activeExchange = ['bitget', 'aster', 'sandbox'].includes(activeCandidate)
        ? activeCandidate
        : defaults.activeExchange;
      const bitgetSection = (parsed.bitget && typeof parsed.bitget === 'object')
        ? parsed.bitget
        : {
            apiKey: parsed.apiKey,
            secretKey: parsed.secretKey,
            passphrase: parsed.passphrase,
            sandbox: parsed.sandbox
          };
      const asterSection = (parsed.aster && typeof parsed.aster === 'object') ? parsed.aster : {};
      return {
        activeExchange,
        bitget: normalizeBitgetConfig(bitgetSection),
        aster: normalizeAsterConfig(asterSection)
      };
    }

    if (fs.existsSync(BITGET_CFG_FILE)) {
      const raw = fs.readFileSync(BITGET_CFG_FILE, 'utf8');
      const legacy = raw ? JSON.parse(raw) : {};
      const migrated = {
        activeExchange: 'bitget',
        bitget: normalizeBitgetConfig(legacy),
        aster: clone(DEFAULT_ASTER_CFG)
      };
      writeExchangeConfig(migrated);
      return migrated;
    }
  } catch (error) {
    console.error('读取交易所配置失败:', error);
  }
  return defaults;
}

function writeExchangeConfig(nextCfg) {
  const defaults = buildDefaultExchangeConfig();
  const activeCandidate = typeof nextCfg?.activeExchange === 'string'
    ? nextCfg.activeExchange.toLowerCase()
    : defaults.activeExchange;
  const normalized = {
    activeExchange: ['aster', 'bitget', 'sandbox'].includes(activeCandidate) ? activeCandidate : defaults.activeExchange,
    bitget: normalizeBitgetConfig(nextCfg?.bitget ?? nextCfg?.bitgetCfg),
    aster: normalizeAsterConfig(nextCfg?.aster ?? nextCfg?.asterCfg)
  };
  try {
    fs.writeFileSync(EXCHANGE_CFG_FILE, JSON.stringify(normalized, null, 2));
    return true;
  } catch (error) {
    console.error('写入交易所配置失败:', error);
    return false;
  }
}

function readBitgetCfg() {
  const cfg = readExchangeConfig();
  return normalizeBitgetConfig(cfg.bitget);
}

function writeBitgetCfg(patch) {
  const current = readExchangeConfig();
  const merged = { ...current.bitget, ...(patch || {}) };
  return writeExchangeConfig({ ...current, bitget: normalizeBitgetConfig(merged) });
}

function readAsterCfg() {
  const cfg = readExchangeConfig();
  return normalizeAsterConfig(cfg.aster);
}

function writeAsterCfg(patch) {
  const current = readExchangeConfig();
  const merged = { ...current.aster, ...(patch || {}) };
  return writeExchangeConfig({ ...current, aster: normalizeAsterConfig(merged) });
}

function getExchangeRuntimeConfig() {
  const cfg = readExchangeConfig();
  return {
    activeExchange: cfg.activeExchange || 'sandbox',
    bitget: normalizeBitgetConfig(cfg.bitget),
    aster: normalizeAsterConfig(cfg.aster)
  };
}

function setActiveExchange(exchange) {
  if (typeof exchange !== 'string') return false;
  const normalized = exchange.toLowerCase();
  if (!['bitget', 'aster', 'sandbox'].includes(normalized)) return false;
  const current = readExchangeConfig();
  return writeExchangeConfig({ ...current, activeExchange: normalized });
}

function maskSensitive(value, left = 3, right = 3) {
  if (!value) return '';
  const s = String(value);
  if (s.length <= left + right) {
    return '*'.repeat(Math.max(3, s.length));
  }
  return s.slice(0, left) + '*'.repeat(Math.max(3, s.length - left - right)) + s.slice(-right);
}

function normalizeTradeExchange(value) {
  if (!value) return null;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === 'bitget' || normalized === 'aster') return normalized;
  return null;
}

function hasBitgetCredentials(cfg) {
  return !!(cfg && cfg.apiKey && cfg.secretKey && cfg.passphrase);
}

function hasAsterCredentials(cfg) {
  return !!(cfg && cfg.apiKey && cfg.secretKey);
}

function getAssetTradeExchange(asset, runtimeCfg) {
  if (!asset) return null;
  const bitgetCfg = runtimeCfg.bitget;
  const asterCfg = runtimeCfg.aster;
  const canBitget = hasBitgetCredentials(bitgetCfg);
  const canAster = hasAsterCredentials(asterCfg);

  const preference = normalizeTradeExchange(asset.tradeExchange || asset.exchangePreference || asset.exchange);
  if (preference === 'bitget' && canBitget) return 'bitget';
  if (preference === 'aster' && canAster) return 'aster';

  const symbols = asset.exchangeSymbols || {};
  const hasBitgetSymbol = !!symbols.bitget || (asset.symbol && asset.symbol.endsWith('_UMCBL'));
  const hasAsterSymbol = !!symbols.aster;

  if (!preference) {
    if (hasBitgetSymbol && !hasAsterSymbol && canBitget) return 'bitget';
    if (hasAsterSymbol && !hasBitgetSymbol && canAster) return 'aster';
  }

  if (preference === 'bitget' && !canBitget && canAster && hasAsterSymbol) return 'aster';
  if (preference === 'aster' && !canAster && canBitget && hasBitgetSymbol) return 'bitget';

  if (hasBitgetSymbol && canBitget && !preference) {
    // special handling: if asset symbol ends with _UMCBL but user might want aster (e.g. stored 1:1), prefer aster only if no bitget credentials
    if (!canAster || !hasAsterSymbol) return 'bitget';
  }

  if (hasAsterSymbol && canAster && !preference) return 'aster';
  if (hasBitgetSymbol && canBitget) return 'bitget';
  if (hasAsterSymbol && canAster) return 'aster';
  if (canBitget) return 'bitget';
  if (canAster) return 'aster';
  return null;
}

function deriveBitgetSymbol(symbol) {
  if (!symbol) return null;
  const upper = String(symbol).trim().toUpperCase();
  if (upper.endsWith('_UMCBL') || upper.endsWith('_CMCBL')) return upper;
  if (upper.endsWith('USDT')) return `${upper}_UMCBL`;
  if (upper.includes('_')) return upper;
  return `${upper}USDT_UMCBL`;
}

function deriveAsterSymbol(symbol) {
  if (!symbol) return null;
  const upper = String(symbol).trim().toUpperCase();
  if (upper.endsWith('_UMCBL')) return upper.slice(0, -7);
  if (upper.endsWith('_CMCBL')) return upper.slice(0, -7);
  return upper.replace(/[^A-Z0-9]/g, '');
}

function normalizeExchangeSymbolsPayload(raw, fallbackSymbol) {
  const normalized = { bitget: null, aster: null };
  if (raw && typeof raw === 'object') {
    if (raw.bitget) normalized.bitget = deriveBitgetSymbol(raw.bitget);
    if (raw.aster) normalized.aster = deriveAsterSymbol(raw.aster);
  }
  if (!normalized.bitget && fallbackSymbol) {
    normalized.bitget = deriveBitgetSymbol(fallbackSymbol);
  }
  if (!normalized.aster && normalized.bitget) {
    normalized.aster = deriveAsterSymbol(normalized.bitget);
  }
  return normalized;
}

function getAssetExchangeSymbols(asset) {
  if (!asset || typeof asset !== 'object') return { bitget: null, aster: null };
  const symbols = normalizeExchangeSymbolsPayload(asset.exchangeSymbols, asset.symbol);
  if (!symbols.bitget && asset.symbol) symbols.bitget = deriveBitgetSymbol(asset.symbol);
  if (!symbols.aster && symbols.bitget) symbols.aster = deriveAsterSymbol(symbols.bitget);
  return symbols;
}

function getBitgetSymbolForAsset(asset) {
  return getAssetExchangeSymbols(asset).bitget;
}

function getAsterSymbolForAsset(asset) {
  return getAssetExchangeSymbols(asset).aster;
}

function getDecimalPlaces(stepSize) {
  if (typeof stepSize === 'number') {
    return getDecimalPlaces(stepSize.toString());
  }
  const str = String(stepSize || '');
  const dot = str.indexOf('.');
  if (dot === -1) return 0;
  return str.length - dot - 1;
}

function floorToStep(value, stepSize, precision) {
  const decimalsFromStep = getDecimalPlaces(stepSize);
  const decimals = Math.min(10, Math.max(decimalsFromStep, typeof precision === 'number' ? precision : decimalsFromStep));
  const factor = 10 ** decimals;
  return Math.floor(value * factor) / factor;
}

async function ensureAsterExchangeInfo(force = false) {
  if (!force && ASTER_SYMBOL_CACHE.symbols.length) {
    const age = Date.now() - ASTER_SYMBOL_CACHE.updatedAt;
    if (age < ASTER_SYMBOL_CACHE_TTL) {
      return ASTER_SYMBOL_CACHE.symbols;
    }
  }
  const data = await httpsGetJson(`${ASTER_API_BASE}/fapi/v1/exchangeInfo`, 10000);
  if (!data || !Array.isArray(data.symbols)) {
    throw new Error('获取 Aster 交易对信息失败');
  }
  const map = new Map();
  for (const item of data.symbols) {
    if (item && item.symbol) {
      map.set(String(item.symbol).toUpperCase(), item);
    }
  }
  ASTER_SYMBOL_CACHE = {
    updatedAt: Date.now(),
    symbols: data.symbols,
    map
  };
  return ASTER_SYMBOL_CACHE.symbols;
}

function getAsterSymbolInfo(symbol) {
  if (!symbol) return null;
  const upper = String(symbol).toUpperCase();
  return ASTER_SYMBOL_CACHE.map?.get(upper) || null;
}

function getAsterLotFilter(symbolInfo) {
  if (!symbolInfo || !Array.isArray(symbolInfo.filters)) return null;
  return symbolInfo.filters.find((f) => f && f.filterType === 'LOT_SIZE') || null;
}

function normalizeAsterOrderQuantity(symbol, quantity) {
  const info = getAsterSymbolInfo(symbol);
  if (!info) {
    return {
      qty: Number(quantity),
      minQty: 0,
      stepSize: null,
      precision: 6
    };
  }
  const lotFilter = getAsterLotFilter(info) || {};
  const stepSize = lotFilter.stepSize || `1e-${info.quantityPrecision || 3}`;
  const precision = Math.min(8, Math.max(getDecimalPlaces(stepSize), Number(info.quantityPrecision || 0)));
  const floored = floorToStep(Number(quantity), stepSize, precision);
  const minQty = Number(lotFilter.minQty || 0);
  return {
    qty: Number(floored.toFixed(precision)),
    minQty,
    stepSize,
    precision
  };
}

function isIgnorableAsterError(error, { codes = [], messageIncludes = [] } = {}) {
  if (!error) return false;
  const responseCode = typeof error.code === 'number' ? error.code : (error.response && typeof error.response.code === 'number' ? error.response.code : undefined);
  if (typeof responseCode === 'number' && codes.includes(responseCode)) return true;
  const message = (error.message || error.msg || error.response?.msg || '').toLowerCase();
  if (!message) return false;
  return messageIncludes.some((snippet) => message.includes(String(snippet).toLowerCase()));
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(id);
    return response;
  } catch (error) {
    clearTimeout(id);
    throw error;
  }
}

async function asterSignedRequest(method, pathName, params = {}, cfg, timeoutMs = 10000) {
  const config = cfg ? normalizeAsterConfig(cfg) : readAsterCfg();
  if (!config.apiKey || !config.secretKey) {
    const err = new Error('Aster API 未配置');
    err.code = 'ASTER_CONFIG_MISSING';
    throw err;
  }

  const methodUpper = String(method || 'GET').toUpperCase();
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params || {})) {
    if (value === undefined || value === null || value === '') continue;
    searchParams.append(key, String(value));
  }
  const recvWindow = config.recvWindow && Number.isFinite(config.recvWindow)
    ? Math.max(1, Number(config.recvWindow))
    : DEFAULT_ASTER_CFG.recvWindow;
  searchParams.set('recvWindow', String(Math.floor(recvWindow)));
  searchParams.set('timestamp', Date.now().toString());
  const signature = crypto.createHmac('sha256', config.secretKey).update(searchParams.toString()).digest('hex');
  searchParams.append('signature', signature);

  const queryString = searchParams.toString();
  const url = `${ASTER_API_BASE}${pathName}${['GET', 'DELETE'].includes(methodUpper) ? `?${queryString}` : ''}`;
  const headers = { 'X-MBX-APIKEY': config.apiKey };
  if (!['GET', 'DELETE'].includes(methodUpper)) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
  }

  let response;
  try {
    response = await fetchWithTimeout(url, {
      method: methodUpper,
      headers,
      body: ['GET', 'DELETE'].includes(methodUpper) ? undefined : queryString
    }, timeoutMs);
  } catch (error) {
    if (error.name === 'AbortError') {
      const timeoutError = new Error('Aster 请求超时');
      timeoutError.code = 'ASTER_TIMEOUT';
      throw timeoutError;
    }
    throw error;
  }

  const rawText = await response.text();
  let data = {};
  try {
    data = rawText ? JSON.parse(rawText) : {};
  } catch (error) {
    const parseError = new Error('解析 Aster 响应失败');
    parseError.raw = rawText;
    throw parseError;
  }

  const code = typeof data?.code === 'number' ? data.code : (response.ok ? 0 : response.status);
  if (!response.ok || (code !== 0 && code !== 200)) {
    const err = new Error(data?.msg || `Aster 接口错误 (${response.status})`);
    err.code = code;
    err.status = response.status;
    err.response = data;
    throw err;
  }

  return data;
}

async function ensureAsterAccountSetup(symbol, cfg) {
  const config = cfg ? normalizeAsterConfig(cfg) : readAsterCfg();
  const tasks = [];
  if (config.positionMode === 'ONE_WAY') {
    tasks.push(
      asterSignedRequest('POST', '/fapi/v1/positionSide/dual', { dualSidePosition: 'false' }, config)
        .catch((err) => {
          if (!isIgnorableAsterError(err, { codes: [-4059], messageIncludes: ['no need to change position side'] })) {
            throw err;
          }
        })
    );
  } else if (config.positionMode === 'HEDGE') {
    tasks.push(
      asterSignedRequest('POST', '/fapi/v1/positionSide/dual', { dualSidePosition: 'true' }, config)
        .catch((err) => {
          if (!isIgnorableAsterError(err, { codes: [-4059], messageIncludes: ['no need to change position side'] })) {
            throw err;
          }
        })
    );
  }

  if (config.marginType) {
    tasks.push(
      asterSignedRequest('POST', '/fapi/v1/marginType', { symbol, marginType: config.marginType }, config)
        .catch((err) => {
          const message = String(err?.message || err?.response?.msg || '').toLowerCase();
          const multiAssetsMsg = message.includes('multi-asset') || message.includes('multi asset');
          if (config.marginType === 'ISOLATED' && multiAssetsMsg) {
            console.warn('Aster 返回 Multi-Assets 模式不允许逐仓，自动切换为全仓。');
            writeAsterCfg({ marginType: 'CROSSED' });
            return;
          }
          if (!isIgnorableAsterError(err, { codes: [-4046], messageIncludes: ['no need to change margin type'] })) {
            throw err;
          }
        })
    );
  }

  if (config.defaultLeverage) {
    tasks.push(
      asterSignedRequest('POST', '/fapi/v1/leverage', { symbol, leverage: config.defaultLeverage }, config)
        .catch((err) => {
          if (!isIgnorableAsterError(err, { messageIncludes: ['no need to change leverage', 'same leverage'] })) {
            throw err;
          }
        })
    );
  }

  await Promise.all(tasks);
}

async function placeAsterMarketOrder({ symbol, side, quantity, config }) {
  const normalizedSide = String(side || '').toUpperCase();
  if (!['BUY', 'SELL'].includes(normalizedSide)) {
    throw new Error('下单方向仅支持 BUY 或 SELL');
  }
  await ensureAsterExchangeInfo();
  await ensureAsterAccountSetup(symbol, config);
  const { qty, minQty, precision } = normalizeAsterOrderQuantity(symbol, quantity);
  if (!(qty > 0)) {
    throw new Error('下单数量过小');
  }
  if (minQty && qty < minQty) {
    const err = new Error(`下单数量需不小于最小要求 ${minQty}`);
    err.code = 'ASTER_MIN_QTY';
    throw err;
  }
  const payload = {
    symbol,
    side: normalizedSide,
    type: 'MARKET',
    quantity: qty.toFixed(precision),
    newClientOrderId: `mm_${Date.now()}`
  };
  const result = await asterSignedRequest('POST', '/fapi/v1/order', payload, config);
  return { result, quantity: qty, precision };
}

// 兼容旧接口，返回旧格式（从第一资产组映射）
app.get('/api/assets', (req, res) => {
  const data = readAssets();
  const firstGroup = data.groups[0] || { assets: [] };
  const assetsOld = {
    crypto: [],
    stocks: []
  };
  // 旧前端需要 totals
  const overall = firstGroup.assets.reduce((sum, a) => sum + ((a.price || 0) * (a.quantity || 0)), 0);
  res.json({
    ...assetsOld,
    totals: {
      crypto: 0,
      stocks: 0,
      overall
    }
  });
});

// 新接口：多资产组
app.get('/api/groups', (req, res) => {
  const data = readAssets();
  res.json({ success: true, groups: data.groups });
});

app.post('/api/groups', (req, res) => {
  const { name } = req.body;
  if (!name || typeof name !== 'string') {
    return res.status(400).json({ error: '资产组名称必填' });
  }
  const data = readAssets();
  const newGroup = {
    id: `g_${Date.now()}`,
    name: name.trim(),
    createdAt: new Date().toISOString(),
    assets: []
  };
  data.groups.push(newGroup);
  if (writeAssets(data)) {
    res.status(201).json({ success: true, group: newGroup });
  } else {
    res.status(500).json({ error: '保存资产组失败' });
  }
});

app.delete('/api/groups/:groupId', (req, res) => {
  const { groupId } = req.params;
  const data = readAssets();
  const initialLen = data.groups.length;
  data.groups = data.groups.filter(g => g.id !== groupId);
  if (data.groups.length === initialLen) {
    return res.status(404).json({ error: '资产组不存在' });
  }
  if (writeAssets(data)) {
    res.json({ success: true });
  } else {
    res.status(500).json({ error: '删除失败' });
  }
});

app.post('/api/groups/:groupId/assets', (req, res) => {
  const { groupId } = req.params;
  const { name, symbol, quantity, price, exchangeSymbols, tradeExchange } = req.body || {};
  if (!name || quantity === undefined) {
    return res.status(400).json({ error: '名称、数量必填' });
  }
  const normalizedSymbols = normalizeExchangeSymbolsPayload(exchangeSymbols, symbol);
  if (!normalizedSymbols.bitget) {
    return res.status(400).json({ error: '缺少有效的交易对标识' });
  }
  const bitgetSymbol = normalizedSymbols.bitget;
  let preferredExchange = normalizeTradeExchange(tradeExchange);
  if (!preferredExchange && exchangeSymbols && typeof exchangeSymbols === 'object') {
    preferredExchange = normalizeTradeExchange(exchangeSymbols.tradeExchange || exchangeSymbols.preferred);
  }
  if (!preferredExchange && normalizedSymbols.aster && !normalizedSymbols.bitget) {
    preferredExchange = 'aster';
  }
  if (!preferredExchange) {
    preferredExchange = normalizedSymbols.bitget ? 'bitget' : null;
  }
  const data = readAssets();
  const group = data.groups.find(g => g.id === groupId);
  if (!group) {
    return res.status(404).json({ error: '资产组不存在' });
  }
  const parsedQty = Number(quantity);
  if (!Number.isFinite(parsedQty)) {
    return res.status(400).json({ error: '数量必须为数字' });
  }
  const newAsset = {
    id: `a_${Date.now()}`,
    name: String(name),
    symbol: bitgetSymbol,
    quantity: parsedQty,
    unrealizedQuantity: 0,
    price: price !== undefined ? parseFloat(price) : 0,
    createdAt: new Date().toISOString(),
    exchangeSymbols: normalizedSymbols
  };
  if (preferredExchange) {
    newAsset.tradeExchange = preferredExchange;
  }
  group.assets.push(newAsset);
  if (writeAssets(data)) {
    res.status(201).json({ success: true, asset: newAsset });
  } else {
    res.status(500).json({ error: '保存资产失败' });
  }
});

app.put('/api/groups/:groupId/assets/:assetId', (req, res) => {
  const { groupId, assetId } = req.params;
  const { name, quantity, price, tradeExchange } = req.body;
  const data = readAssets();
  const group = data.groups.find(g => g.id === groupId);
  if (!group) return res.status(404).json({ error: '资产组不存在' });
  const idx = group.assets.findIndex(a => a.id === assetId);
  if (idx === -1) return res.status(404).json({ error: '资产不存在' });
  if (name !== undefined) group.assets[idx].name = String(name);
  if (quantity !== undefined) {
    group.assets[idx].quantity = parseFloat(quantity);
    group.assets[idx].unrealizedQuantity = 0;
  }
  if (price !== undefined) group.assets[idx].price = parseFloat(price);
  if (tradeExchange !== undefined) {
    const normalized = normalizeTradeExchange(tradeExchange);
    if (normalized) {
      group.assets[idx].tradeExchange = normalized;
    }
  }
  group.assets[idx].updatedAt = new Date().toISOString();
  if (writeAssets(data)) {
    res.json({ success: true, asset: group.assets[idx] });
  } else {
    res.status(500).json({ error: '更新资产失败' });
  }
});

app.delete('/api/groups/:groupId/assets/:assetId', (req, res) => {
  const { groupId, assetId } = req.params;
  const data = readAssets();
  const group = data.groups.find(g => g.id === groupId);
  if (!group) return res.status(404).json({ error: '资产组不存在' });
  const initialLen = group.assets.length;
  group.assets = group.assets.filter(a => a.id !== assetId);
  if (group.assets.length === initialLen) return res.status(404).json({ error: '资产不存在' });
  const strategy = ensureGroupStrategy(group);
  rebuildStrategyBaseline(group, strategy);
  if (writeAssets(data)) {
    res.json({ success: true });
  } else {
    res.status(500).json({ error: '删除资产失败' });
  }
});

async function handleContractSearch(req, res, fallbackExchange = 'bitget') {
  const query = (req.query.query || '').toString().trim();
  if (!query) {
    res.status(400).json({ error: 'query 必填' });
    return;
  }

  const runtime = getExchangeRuntimeConfig();
  const defaultExchange = (fallbackExchange || runtime.activeExchange || 'bitget').toLowerCase();
  const exchangeParam = (req.query.exchange || req.query.provider || '').toString().trim().toLowerCase();
  const exchange = exchangeParam || defaultExchange;
  const resolvedExchange = exchange === 'sandbox' ? 'bitget' : exchange;

  try {
    if (resolvedExchange === 'bitget') {
      const url = 'https://api.bitget.com/api/v2/mix/market/contracts?productType=USDT-FUTURES';
      const json = await httpsGetJson(url, 5000);
      if (json.code !== '00000') {
        return res.status(502).json({ error: json.msg || 'Bitget接口错误' });
      }
      const list = Array.isArray(json.data) ? json.data : [];
      const q = query.toUpperCase();
      const filtered = list.filter((it) => {
        const symbol = String(it.symbol || '').toUpperCase();
        const baseCoin = String(it.baseCoin || '').toUpperCase();
        return symbol.includes(q) || baseCoin.includes(q);
      }).slice(0, 20).map((it) => {
        const bitgetSymbol = deriveBitgetSymbol(it.symbol);
        const asterSymbol = deriveAsterSymbol(it.symbol);
        return {
          displayName: `${it.baseCoin}/${it.quoteCoin} 永续 (${it.symbol})`,
          symbol: bitgetSymbol,
          bitgetSymbol,
          asterSymbol,
          baseAsset: it.baseCoin,
          quoteAsset: it.quoteCoin,
          source: 'bitget'
        };
      });
      return res.json({ success: true, results: filtered, exchange: 'bitget' });
    }

    if (resolvedExchange === 'aster') {
      await ensureAsterExchangeInfo();
      const q = query.toUpperCase();
      const matches = (ASTER_SYMBOL_CACHE.symbols || []).filter((info) => {
        const symbol = String(info.symbol || '').toUpperCase();
        const base = String(info.baseAsset || '').toUpperCase();
        const quote = String(info.quoteAsset || '').toUpperCase();
        return symbol.includes(q) || base.includes(q) || quote.includes(q);
      }).slice(0, 20).map((info) => {
        const lot = getAsterLotFilter(info) || {};
        const asterSymbol = String(info.symbol || '').toUpperCase();
        const bitgetSymbol = deriveBitgetSymbol(asterSymbol);
        return {
          displayName: `${info.baseAsset}/${info.quoteAsset} 永续 (${info.symbol})`,
          symbol: bitgetSymbol,
          bitgetSymbol,
          asterSymbol,
          baseAsset: info.baseAsset,
          quoteAsset: info.quoteAsset,
          stepSize: lot.stepSize,
          minQty: lot.minQty,
          pricePrecision: info.pricePrecision,
          quantityPrecision: info.quantityPrecision,
          source: 'aster'
        };
      });
      return res.json({ success: true, results: matches, exchange: 'aster' });
    }

    return res.status(400).json({ error: `不支持的交易所: ${exchange}` });
  } catch (error) {
    console.error('搜索交易对失败:', error.message);
    res.status(500).json({ error: error.message || '搜索失败' });
  }
}

app.get('/api/exchange/search', (req, res) => {
  handleContractSearch(req, res).catch((err) => {
    console.error('搜索接口异常:', err);
    res.status(500).json({ error: err.message || '搜索失败' });
  });
});

app.get('/api/bitget/search', (req, res) => {
  req.query.exchange = 'bitget';
  handleContractSearch(req, res, 'bitget').catch((err) => {
    console.error('Bitget 搜索异常:', err);
    res.status(500).json({ error: err.message || '搜索失败' });
  });
});

// === 策略：数据结构 ===
// 在 group 上挂载 strategy: { enabled:boolean, frequency:{unit:'hour'|'day'|'week', value:1}, minTradeUSDT:number, baselineWeights:{symbol:percent} }

function ensureGroupStrategy(group) {
  if (!group.strategy) {
    group.strategy = {
      enabled: false,
      frequency: { unit: 'hour', value: 1 },
      minTradeUSDT: 100,
      maxTradeUSDT: 1000,
      baselineWeights: {}
    };
  }
  if (group.strategy.maxTradeUSDT === undefined) {
    group.strategy.maxTradeUSDT = 1000;
  }
  return group.strategy;
}

function computeBaselineWeights(group) {
  const total = group.assets.reduce((s, a) => s + (Number(a.price || 0) * Number(a.quantity || 0)), 0) || 0;
  const weights = {};
  if (total <= 0) return weights;
  for (const a of group.assets) {
    const mv = Number(a.price || 0) * Number(a.quantity || 0);
    if (a.symbol) weights[a.symbol] = mv / total;
  }
  return weights;
}

function normalizeBaselineWeights(weights = {}) {
  const entries = Object.entries(weights);
  if (!entries.length) {
    return { changed: false, weights: {} };
  }
  let sum = 0;
  for (const [, value] of entries) {
    const num = Number(value) || 0;
    if (num > 0) sum += num;
  }
  if (sum <= 0) {
    return { changed: true, weights: {} };
  }
  const normalized = {};
  let changed = Math.abs(sum - 1) > 0.0001;
  for (const [symbol, value] of entries) {
    const num = Number(value) || 0;
    if (num <= 0) {
      changed = true;
      continue;
    }
    const normalizedValue = num / sum;
    normalized[symbol] = normalizedValue;
    if (!changed && Math.abs(normalizedValue - num) > 1e-6) {
      changed = true;
    }
  }
  return { changed, weights: normalized };
}

function createBaselineSnapshot(group) {
  const assets = group.assets.map(a => ({
    symbol: a.symbol,
    quantity: Number(a.quantity || 0),
    price: Number(a.price || 0)
  }));
  const totalValue = assets.reduce((sum, asset) => sum + (asset.quantity * asset.price), 0);
  return {
    timestamp: new Date().toISOString(),
    totalValue,
    assets
  };
}

function rebuildStrategyBaseline(group, strategy = null) {
  const s = strategy || ensureGroupStrategy(group);
  s.baselineWeights = computeBaselineWeights(group);
  const { weights, changed } = normalizeBaselineWeights(s.baselineWeights);
  if (changed) {
    s.baselineWeights = weights;
  }
  s.baselineSnapshot = createBaselineSnapshot(group);
  return s;
}

// === 策略：API ===
app.get('/api/groups/:groupId/strategy', (req, res) => {
  const data = readAssets();
  const group = data.groups.find(g => g.id === req.params.groupId);
  if (!group) return res.status(404).json({ error: '资产组不存在' });
  ensureGroupStrategy(group);
  res.json({ success: true, strategy: group.strategy });
});

app.put('/api/groups/:groupId/strategy', (req, res) => {
  const data = readAssets();
  const group = data.groups.find(g => g.id === req.params.groupId);
  if (!group) return res.status(404).json({ error: '资产组不存在' });
  const s = ensureGroupStrategy(group);
  const { unit, value, minTradeUSDT, maxTradeUSDT } = req.body || {};
  if (unit) s.frequency.unit = unit; // 'hour'|'day'|'week'
  if (value !== undefined) s.frequency.value = parseInt(value, 10) || 1;
  if (minTradeUSDT !== undefined) s.minTradeUSDT = Number(minTradeUSDT) || 100;
  if (maxTradeUSDT !== undefined) s.maxTradeUSDT = Number(maxTradeUSDT) || 1000;
  if (!writeAssets(data)) return res.status(500).json({ error: '保存失败' });
  // 若策略开启，更新频率后重启定时器
  if (s.enabled) {
    startStrategyTimer(group.id);
    setTimeout(() => runRebalanceOnce(group.id), 10);
  }
  res.json({ success: true, strategy: s });
});

app.post('/api/groups/:groupId/strategy/enable', (req, res) => {
  const data = readAssets();
  const group = data.groups.find(g => g.id === req.params.groupId);
  if (!group) return res.status(404).json({ error: '资产组不存在' });
  const s = ensureGroupStrategy(group);
  s.enabled = true;
  rebuildStrategyBaseline(group, s);
  if (!writeAssets(data)) return res.status(500).json({ error: '保存失败' });
  // 启动定时器并异步立即执行一次
  startStrategyTimer(group.id);
  setTimeout(() => runRebalanceOnce(group.id), 10);
  res.json({ success: true, strategy: s });
});

app.post('/api/groups/:groupId/strategy/disable', (req, res) => {
  const data = readAssets();
  const group = data.groups.find(g => g.id === req.params.groupId);
  if (!group) return res.status(404).json({ error: '资产组不存在' });
  const s = ensureGroupStrategy(group);
  s.enabled = false;
  if (!writeAssets(data)) return res.status(500).json({ error: '保存失败' });
  stopStrategyTimer(group.id);
  res.json({ success: true, strategy: s });
});

// 交易日志 API
app.get('/api/trading/logs', (req, res) => {
  const logs = readTradingLogs();
  res.json({ success: true, logs });
});

// 保留旧接口占位，防止前端历史代码报错（不再使用）
app.post('/api/assets/crypto', (req, res) => {
  return res.status(410).json({ error: '接口已弃用，请使用 /api/groups' });
});
app.post('/api/assets/stocks', (req, res) => {
  return res.status(410).json({ error: '接口已弃用，请使用 /api/groups' });
});

app.put('/api/assets/crypto/:id', (req, res) => {
  return res.status(410).json({ error: '接口已弃用，请使用 /api/groups' });
});
app.put('/api/assets/stocks/:id', (req, res) => {
  return res.status(410).json({ error: '接口已弃用，请使用 /api/groups' });
});

app.delete('/api/assets/crypto/:id', (req, res) => {
  return res.status(410).json({ error: '接口已弃用，请使用 /api/groups' });
});
app.delete('/api/assets/stocks/:id', (req, res) => {
  return res.status(410).json({ error: '接口已弃用，请使用 /api/groups' });
});

// 工具: 简单的 https GET JSON
function httpsGetJson(url, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, (resp) => {
      let data = '';
      resp.on('data', (chunk) => (data += chunk));
      resp.on('end', () => {
        try {
          resolve(JSON.parse(data || '{}'));
        } catch (e) {
          console.error('解析JSON失败:', e.message, 'URL:', url);
          reject(new Error('解析 JSON 失败'));
        }
      });
    });
    
    // 设置超时
    request.setTimeout(timeout, () => {
      request.destroy();
      console.error('请求超时:', url);
      reject(new Error('请求超时'));
    });
    
    request.on('error', (err) => {
      console.error('网络请求错误:', err.message, 'URL:', url);
      reject(err);
    });
  });
}

// 检查股票市场是否开放（简单实现）
function isStockMarketOpen() {
  const now = new Date();
  const day = now.getDay(); // 0=周日, 1=周一, ..., 6=周六
  const hour = now.getHours();
  const minute = now.getMinutes();
  
  // 周末不开放
  if (day === 0 || day === 6) {
    return false;
  }
  
  // 工作日：9:30-16:00 (美东时间，这里简化处理)
  const currentTime = hour * 60 + minute;
  const marketOpen = 9 * 60 + 30; // 9:30
  const marketClose = 16 * 60; // 16:00
  
  return currentTime >= marketOpen && currentTime < marketClose;
}

// 检查是否为股票交易对
function isStockSymbol(symbol) {
  const stockSymbols = ['TSLAUSDT_UMCBL', 'NVDAUSDT_UMCBL', 'AAPLUSDT_UMCBL', 'GOOGLUSDT_UMCBL', 'MSFTUSDT_UMCBL', 'AMZNUSDT_UMCBL', 'METAUSDT_UMCBL'];
  return stockSymbols.includes(symbol);
}

async function fetchBitgetV1TickerLast(symbol) {
  try {
    const normalizedSymbol = deriveBitgetSymbol(symbol);
    if (!normalizedSymbol) {
      throw new Error('无效的 Bitget 交易对');
    }
    const v2Symbol = normalizedSymbol.replace(/_UMCBL$|_CMCBL$/i, '');
    const url = `https://api.bitget.com/api/v2/mix/market/ticker?symbol=${encodeURIComponent(v2Symbol)}&productType=USDT-FUTURES`;
    const json = await httpsGetJson(url, 5000); // 5秒超时
    const tickerData = Array.isArray(json?.data) ? json.data[0] : json?.data;
    if (json && json.code === '00000' && tickerData && tickerData.lastPr) {
      const price = parseFloat(tickerData.lastPr);
      if (!isNaN(price) && price > 0) return price;
    }
    console.warn(`获取${normalizedSymbol}行情失败:`, json?.msg || '未知错误');
    return null; // 返回null而不是抛出异常
  } catch (error) {
    console.error(`获取${symbol}行情异常:`, error.message);
    return null; // 返回null而不是抛出异常
  }
}

// 刷新指定资产组内所有资产的价格（Bitget v1 ticker）
app.post('/api/groups/:groupId/refresh-prices', async (req, res) => {
  try {
    const { groupId } = req.params;
    const data = readAssets();
    const group = data.groups.find((g) => g.id === groupId);
    if (!group) return res.status(404).json({ error: '资产组不存在' });

    let updatedCount = 0;
    for (const asset of group.assets) {
      const bitgetSymbol = getBitgetSymbolForAsset(asset);
      if (!bitgetSymbol) continue;
      try {
        const last = await fetchBitgetV1TickerLast(bitgetSymbol);
        if (last !== null) {
          asset.price = last;
          asset.symbol = bitgetSymbol;
          asset.exchangeSymbols = normalizeExchangeSymbolsPayload(asset.exchangeSymbols, bitgetSymbol);
          asset.updatedAt = new Date().toISOString();
          updatedCount += 1;
        } else {
          console.warn(`跳过更新${bitgetSymbol}价格（获取失败）`);
        }
      } catch (e) {
        console.error(`更新${bitgetSymbol}价格时发生异常:`, e.message);
        // 忽略单个失败，继续
      }
      // 轻微延迟，降低风控触发
      await new Promise((r) => setTimeout(r, 120));
    }

    if (!writeAssets(data)) {
      return res.status(500).json({ error: '保存刷新结果失败' });
    }

    const totalValue = group.assets.reduce((s, a) => s + (Number(a.price || 0) * Number(a.quantity || 0)), 0);
    res.json({ success: true, updated: updatedCount, totalValue, assets: group.assets });
  } catch (err) {
    res.status(500).json({ error: err.message || '刷新失败' });
  }
});

// === 策略：定时调仓执行器（进程内简易调度）===
const STRATEGY_TIMERS = new Map(); // groupId -> NodeJS.Timer

function msForFrequency(freq) {
  const v = Math.max(1, parseInt(freq.value || 1, 10));
  if (freq.unit === 'minute') return v * 60 * 1000;
  if (freq.unit === 'day') return v * 24 * 60 * 60 * 1000;
  if (freq.unit === 'week') return v * 7 * 24 * 60 * 60 * 1000;
  return v * 60 * 60 * 1000; // hour
}

async function runRebalanceOnce(groupId) {
  const data = readAssets();
  const group = data.groups.find(g => g.id === groupId);
  if (!group) return { skipped: true };
  const s = ensureGroupStrategy(group);
  if (!s.enabled) return { skipped: true };

  const assetSymbols = new Set(group.assets.map(a => a.symbol).filter(Boolean));
  const initialBaseline = s.baselineWeights || {};
  const baselineSymbols = new Set(Object.keys(initialBaseline));
  const weightSum = Object.values(initialBaseline).reduce((sum, val) => {
    const num = Number(val);
    return Number.isFinite(num) ? sum + num : sum;
  }, 0);
  const hasMissingWeights = assetSymbols.size > 0 && [...assetSymbols].some(sym => !baselineSymbols.has(sym));
  const hasObsoleteWeights = baselineSymbols.size > 0 && [...baselineSymbols].some(sym => !assetSymbols.has(sym));
  let needsRebaseline = hasMissingWeights || hasObsoleteWeights || (assetSymbols.size > 0 && weightSum <= 0);
  let stateChanged = false;

  for (const a of group.assets) {
    if (!a.symbol) continue;
    try {
      const price = await fetchBitgetV1TickerLast(a.symbol);
      if (price !== null) {
        if (Number(a.price || 0) !== price) {
          stateChanged = true;
        }
        a.price = price;
      }
    } catch (error) {
      console.error(`刷新${a.symbol}价格失败:`, error.message);
    }
    await new Promise(r => setTimeout(r, 120));
  }

  if (needsRebaseline) {
    rebuildStrategyBaseline(group, s);
    stateChanged = true;
  } else {
    const normalization = normalizeBaselineWeights(s.baselineWeights || {});
    if (normalization.changed) {
      s.baselineWeights = normalization.weights;
      stateChanged = true;
    }
    if (s.baselineSnapshot) {
      const snapshotAssets = Array.isArray(s.baselineSnapshot.assets) ? s.baselineSnapshot.assets : [];
      const filteredAssets = snapshotAssets.filter(asset => !asset.symbol || assetSymbols.has(asset.symbol));
      if (filteredAssets.length !== snapshotAssets.length) {
        s.baselineSnapshot.assets = filteredAssets;
        s.baselineSnapshot.totalValue = filteredAssets.reduce((sum, asset) => sum + (Number(asset.quantity || 0) * Number(asset.price || 0)), 0);
        if (!s.baselineSnapshot.timestamp) {
          s.baselineSnapshot.timestamp = new Date().toISOString();
        }
        stateChanged = true;
      }
    }
  }

  const total = group.assets.reduce((sum, a) => sum + (Number(a.price || 0) * Number(a.quantity || 0)), 0) || 0;
  if (total <= 0) {
    if (stateChanged) writeAssets(data);
    return { skipped: true };
  }

  const baselineWeights = s.baselineWeights || {};
  const activeBaselineSymbols = Object.keys(baselineWeights).filter(symbol => assetSymbols.has(symbol));
  if (!activeBaselineSymbols.length) {
    if (stateChanged) writeAssets(data);
    return { skipped: true };
  }

  const minTrade = Number(s.minTradeUSDT || 100);
  const maxTrade = Number(s.maxTradeUSDT || 1000);

  const deviations = [];
  const deviationMap = new Map();
  for (const a of group.assets) {
    if (!a.symbol) continue;
    const curVal = Number(a.price || 0) * Number(a.quantity || 0);
    const curWeight = total > 0 ? (curVal / total) : 0;
    const targetWeight = baselineWeights[a.symbol] || 0;
    const targetVal = total * targetWeight;
    const diff = targetVal - curVal;
    const devPercent = (curWeight - targetWeight) * 100;
    const entry = {
      symbol: a.symbol,
      currentValue: curVal,
      targetValue: targetVal,
      deviationAmount: diff,
      deviationPercent: devPercent
    };
    deviations.push(entry);
    deviationMap.set(a.symbol, entry);
  }

  const actions = [];
  function roundQtyForSymbol(symbol, qty) {
    const absQty = Math.abs(Number(qty) || 0);
    if (!(absQty > 0)) return 0;
    const upper = String(symbol || '').toUpperCase();
    const decimals = upper.startsWith('BTC') ? 5 : 3;
    const factor = Math.pow(10, decimals);
    return Math.floor(absQty * factor) / factor;
  }

  const nowIso = new Date().toISOString();

  for (const a of group.assets) {
    if (!a.symbol) continue;
    const symbols = getAssetExchangeSymbols(a);
    const d = deviationMap.get(a.symbol);
    if (!d) continue;
    const price = Number(a.price || 0);
    if (!(price > 0)) continue;

    const roundingSymbol = symbols.aster || symbols.bitget || a.symbol;
    const logSymbol = symbols.bitget || a.symbol;
    const prevUnrealized = Number(a.unrealizedQuantity || 0);
    if (d) {
      d.price = price;
      d.previousUnrealizedQuantity = prevUnrealized;
      d.deviationQuantity = 0;
      d.pendingUnrealizedQuantity = prevUnrealized;
      d.pendingTradeValue = prevUnrealized * price;
      d.postTradeUnrealizedQuantity = prevUnrealized;
    }
    let desiredQtyChange = 0;

    const absDeviation = Math.abs(d.deviationAmount);
    if (absDeviation > 0) {
      const cappedValue = Math.min(absDeviation, maxTrade);
      const rawQty = cappedValue / price;
      const roundedQty = roundQtyForSymbol(roundingSymbol, rawQty);
      if (roundedQty > 0) {
        const direction = d.deviationAmount > 0 ? 1 : -1;
        desiredQtyChange = direction * roundedQty;
        a.quantity = Number(a.quantity || 0) + desiredQtyChange;
        a.updatedAt = nowIso;
      }
    }
    if (d) {
      d.deviationQuantity = desiredQtyChange;
    }

    let pendingQty = prevUnrealized + desiredQtyChange;
    const pendingTradeValue = pendingQty * price;
    const pendingValueAbs = Math.abs(pendingTradeValue);
    if (d) {
      d.pendingUnrealizedQuantity = pendingQty;
      d.pendingTradeValue = pendingTradeValue;
    }

    if (pendingValueAbs < minTrade) {
      a.unrealizedQuantity = pendingQty;
      if (d) {
        d.postTradeUnrealizedQuantity = pendingQty;
      }
      continue;
    }

    const tradeDirection = pendingQty >= 0 ? 1 : -1;
    const cappedPendingValue = Math.min(pendingValueAbs, maxTrade);
    const plannedQtyAbs = roundQtyForSymbol(roundingSymbol, cappedPendingValue / price);
    if (!(plannedQtyAbs > 0)) {
      a.unrealizedQuantity = pendingQty;
      if (d) {
        d.postTradeUnrealizedQuantity = pendingQty;
      }
      continue;
    }

    const plannedQty = plannedQtyAbs * tradeDirection;
    const remainingQty = pendingQty - plannedQty;
    a.unrealizedQuantity = remainingQty;
    if (d) {
      d.plannedTradeQuantity = plannedQty;
      d.postTradeUnrealizedQuantity = remainingQty;
      d.executedTradeValue = plannedQtyAbs * price * tradeDirection;
    }

    const plannedValue = plannedQtyAbs * price;
    console.log(`💰 ${logSymbol}: 偏差=${d.deviationAmount.toFixed(2)}, 价格=${price}, 未实现累积数量=${pendingQty.toFixed(6)}, 计划执行数量=${plannedQty.toFixed(6)}`);

    actions.push({
      symbol: logSymbol,
      tradeSymbols: symbols,
      side: tradeDirection > 0 ? 'BUY' : 'SELL',
      valueUSDT: plannedValue,
      quantity: plannedQtyAbs,
      plannedSignedQuantity: plannedQty,
      assetId: a.id
    });
    console.log(`✅ 添加交易操作: ${logSymbol} ${tradeDirection > 0 ? 'BUY' : 'SELL'} ${plannedQtyAbs} (${plannedValue.toFixed(2)} USDT)`);
  }

  const exchangeRuntime = getExchangeRuntimeConfig();
  const bitgetCfg = exchangeRuntime.bitget;
  const asterCfg = exchangeRuntime.aster;
  const canBitget = hasBitgetCredentials(bitgetCfg);
  const canAster = hasAsterCredentials(asterCfg);

  for (const act of actions) {
    const asset = group.assets.find(item => item.id === act.assetId) || group.assets.find(item => item.symbol === act.symbol);
    const targetExchange = getAssetTradeExchange(asset, exchangeRuntime) || 'bitget';
    act.exchange = targetExchange;

    const hasCredentials = targetExchange === 'bitget' ? canBitget : targetExchange === 'aster' ? canAster : false;

    if (!hasCredentials) {
      if (asset) {
        asset.unrealizedQuantity = Number(asset.unrealizedQuantity || 0) + Number(act.plannedSignedQuantity || 0);
        asset.updatedAt = nowIso;
      }
      act.realTradeStatus = 'simulated';
      act.realTradeError = targetExchange === 'bitget' ? 'Bitget 未配置 API' : targetExchange === 'aster' ? 'Aster 未配置 API' : '未配置有效交易所';
      continue;
    }

    try {
      if (targetExchange === 'bitget') {
        const coinParam = (act.tradeSymbols?.bitget || act.symbol).replace('_UMCBL', '');
        const result = await runPythonMarketOrder({
          coin: coinParam,
          side: act.side.toLowerCase(),
          size: act.quantity,
          marginMode: 'isolated',
          cfg: bitgetCfg
        });

        if (result.success) {
          if (asset) {
            const plannedSignedQty = Number(act.plannedSignedQuantity || 0);
            const executedSignedQty = act.side === 'BUY' ? act.quantity : -act.quantity;
            const residual = plannedSignedQty - executedSignedQty;
            asset.unrealizedQuantity = Number(asset.unrealizedQuantity || 0) + residual;
            asset.tradeExchange = 'bitget';
            asset.updatedAt = nowIso;
          }
          act.realTradeStatus = 'success';
          act.realTradeOutput = result.out;
        } else {
          if (asset) {
            asset.unrealizedQuantity = Number(asset.unrealizedQuantity || 0) + Number(act.plannedSignedQuantity || 0);
            asset.updatedAt = nowIso;
          }
          act.realTradeStatus = 'failed';
          act.realTradeError = result.err || result.out;
          console.log(`❌ Bitget 交易失败，跳过持仓更新: ${act.symbol} ${act.side} ${act.quantity}`);
        }
      } else if (targetExchange === 'aster') {
        const tradeSymbol = act.tradeSymbols?.aster || deriveAsterSymbol(act.symbol);
        const execution = await placeAsterMarketOrder({
          symbol: tradeSymbol,
          side: act.side,
          quantity: act.quantity,
          config: asterCfg
        });
        const executedQty = Number(execution.quantity || 0);
        if (asset) {
          const plannedSignedQty = Number(act.plannedSignedQuantity || 0);
          const executedSignedQty = act.side === 'BUY' ? executedQty : -executedQty;
          const residual = plannedSignedQty - executedSignedQty;
          asset.unrealizedQuantity = Number(asset.unrealizedQuantity || 0) + residual;
          asset.tradeExchange = 'aster';
          asset.updatedAt = nowIso;
        }
        act.executedQuantity = executedQty;
        act.realTradeStatus = 'success';
        act.realTradeOutput = execution.result;
      } else {
        if (asset) {
          asset.unrealizedQuantity = Number(asset.unrealizedQuantity || 0) + Number(act.plannedSignedQuantity || 0);
          asset.updatedAt = nowIso;
        }
        act.realTradeStatus = 'error';
        act.realTradeError = `未支持的交易所类型: ${targetExchange}`;
      }
    } catch (error) {
      if (asset) {
        asset.unrealizedQuantity = Number(asset.unrealizedQuantity || 0) + Number(act.plannedSignedQuantity || 0);
        asset.updatedAt = nowIso;
      }
      act.realTradeStatus = 'error';
      act.realTradeError = error.message;
      console.log(`❌ 交易错误，跳过持仓更新: ${act.symbol} ${act.side} ${act.quantity} - ${error.message}`);
    }
  }

  // 保存与记录
  const ts = new Date().toISOString();
  const tradingModes = actions.map(act => act.realTradeStatus === 'simulated' ? 'simulated' : 'real');
  let tradingMode = 'mixed';
  if (tradingModes.every(mode => mode === 'simulated')) {
    tradingMode = 'simulated';
  } else if (tradingModes.every(mode => mode === 'real')) {
    tradingMode = 'real';
  }

  s.lastResult = {
    timestamp: ts,
    totalBefore: total,
    actions,
    deviations,
    tradingMode
  };
  writeAssets(data);
  for (const act of actions) {
    let status;
    let note;
    switch (act.realTradeStatus) {
      case 'success':
        status = 'real';
        note = '策略调仓（真实交易成功）';
        break;
      case 'failed':
        status = 'error';
        note = '策略调仓（真实交易失败）';
        break;
      case 'error':
        status = 'error';
        note = '策略调仓（真实交易错误）';
        break;
      case 'simulated':
      default:
        status = 'simulated';
        note = '策略调仓（模拟）';
        break;
    }
    
    appendTradingLog({ 
      timestamp: ts, 
      groupId, 
      ...act, 
      status, 
      note,
      ...(act.realTradeOutput && { tradeOutput: act.realTradeOutput }),
      ...(act.realTradeError && { tradeError: act.realTradeError })
    });
  }
  return { timestamp: ts, actions, deviations };
}

function startStrategyTimer(groupId) {
  const data = readAssets();
  const group = data.groups.find(g => g.id === groupId);
  if (!group) return;
  const s = ensureGroupStrategy(group);
  if (!s.enabled) return;
  const interval = msForFrequency(s.frequency);
  if (STRATEGY_TIMERS.has(groupId)) clearInterval(STRATEGY_TIMERS.get(groupId));
  const timer = setInterval(() => runRebalanceOnce(groupId), interval);
  STRATEGY_TIMERS.set(groupId, timer);
}

function stopStrategyTimer(groupId) {
  if (STRATEGY_TIMERS.has(groupId)) {
    clearInterval(STRATEGY_TIMERS.get(groupId));
    STRATEGY_TIMERS.delete(groupId);
  }
}

// 开关时同步调度器
app.post('/api/groups/:groupId/strategy/enable', (req, res) => {
  const data = readAssets();
  const group = data.groups.find(g => g.id === req.params.groupId);
  if (!group) return res.status(404).json({ error: '资产组不存在' });
  const s = ensureGroupStrategy(group);
  s.enabled = true;
  rebuildStrategyBaseline(group, s);
  if (!writeAssets(data)) return res.status(500).json({ error: '保存失败' });
  startStrategyTimer(group.id);
  // 立即执行一次（异步，不阻塞响应）
  setTimeout(() => runRebalanceOnce(group.id), 10);
  res.json({ success: true, strategy: s });
});

// 手动触发策略调仓
app.post('/api/groups/:groupId/strategy/rebalance', async (req, res) => {
  try {
    const { groupId } = req.params;
    const result = await runRebalanceOnce(groupId);
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 获取策略最后结果
app.get('/api/groups/:groupId/strategy/result', (req, res) => {
  const data = readAssets();
  const group = data.groups.find(g => g.id === req.params.groupId);
  if (!group) return res.status(404).json({ error: '资产组不存在' });
  const s = ensureGroupStrategy(group);
  res.json({ success: true, lastResult: s.lastResult });
});

app.post('/api/groups/:groupId/strategy/disable', (req, res) => {
  const data = readAssets();
  const group = data.groups.find(g => g.id === req.params.groupId);
  if (!group) return res.status(404).json({ error: '资产组不存在' });
  const s = ensureGroupStrategy(group);
  s.enabled = false;
  if (!writeAssets(data)) return res.status(500).json({ error: '保存失败' });
  stopStrategyTimer(group.id);
  res.json({ success: true, strategy: s });
});

// 手动触发一次策略运行
app.post('/api/groups/:groupId/strategy/run-once', async (req, res) => {
  try {
    const result = await runRebalanceOnce(req.params.groupId);
    res.json({ success: true, result });
  } catch (e) {
    res.status(500).json({ error: e.message || '执行失败' });
  }
});

// 重置股票持仓到基线状态（修复失败交易导致的持仓错误）
app.post('/api/groups/:groupId/reset-stock-positions', (req, res) => {
  try {
    const data = readAssets();
    const group = data.groups.find(g => g.id === req.params.groupId);
    if (!group) return res.status(404).json({ error: '资产组不存在' });
    
    const s = ensureGroupStrategy(group);
    const baseline = s.baselineSnapshot;
    if (!baseline) {
      return res.status(400).json({ error: '没有基线数据，无法重置' });
    }
    
    let resetCount = 0;
    const stockSymbols = ['TSLAUSDT_UMCBL', 'NVDAUSDT_UMCBL'];
    
    for (const asset of group.assets) {
      if (stockSymbols.includes(asset.symbol)) {
        const baselineAsset = baseline.assets.find(a => a.symbol === asset.symbol);
        if (baselineAsset) {
          const oldQuantity = asset.quantity;
          asset.quantity = baselineAsset.quantity;
          asset.unrealizedQuantity = 0;
          asset.updatedAt = new Date().toISOString();
          resetCount++;
          console.log(`🔄 重置 ${asset.symbol} 持仓: ${oldQuantity} -> ${baselineAsset.quantity}`);
        }
      }
    }
    
    if (writeAssets(data)) {
      res.json({ 
        success: true, 
        message: `已重置 ${resetCount} 个股票持仓到基线状态`,
        resetCount 
      });
    } else {
      res.status(500).json({ error: '保存失败' });
    }
  } catch (e) {
    res.status(500).json({ error: e.message || '重置失败' });
  }
});

// 获取最近一次调仓结果
app.get('/api/groups/:groupId/strategy/last-result', (req, res) => {
  const data = readAssets();
  const group = data.groups.find(g => g.id === req.params.groupId);
  if (!group) return res.status(404).json({ error: '资产组不存在' });
  const s = ensureGroupStrategy(group);
  res.json({ success: true, lastResult: s.lastResult || null });
});

// 列出所有资产组的策略与定时器状态
app.get('/api/strategy/status', (req, res) => {
  const data = readAssets();
  const list = (data.groups || []).map(g => {
    const s = ensureGroupStrategy(g);
    return {
      groupId: g.id,
      name: g.name,
      enabled: !!s.enabled,
      frequency: s.frequency,
      minTradeUSDT: s.minTradeUSDT,
      maxTradeUSDT: s.maxTradeUSDT,
      hasTimer: STRATEGY_TIMERS.has(g.id),
      lastResultAt: s.lastResult?.timestamp || null
    };
  });
  res.json({ success: true, groups: list });
});

// 资产变动统计：从开启策略时的基线到当前
app.get('/api/groups/:groupId/stats', (req, res) => {
  const data = readAssets();
  const group = data.groups.find(g => g.id === req.params.groupId);
  if (!group) return res.status(404).json({ success: false, error: '资产组不存在' });
  const s = ensureGroupStrategy(group);
  const baseline = s.baselineSnapshot;
  if (!baseline) return res.json({ success: true, hasBaseline: false });
  
  const currentTotal = group.assets.reduce((sum, a) => sum + (Number(a.price || 0) * Number(a.quantity || 0)), 0);
  const baselineMap = new Map((baseline.assets || []).map(a => [a.symbol, a]));
  
  // 计算持仓不动策略的当前价值（使用基线持仓数量 + 当前价格）
  let buyAndHoldTotal = 0;
  const buyAndHoldByAsset = [];
  
  for (const a of group.assets) {
    const b = baselineMap.get(a.symbol) || { quantity: 0, price: 0 };
    const buyAndHoldValue = Number(b.quantity || 0) * Number(a.price || 0);
    buyAndHoldTotal += buyAndHoldValue;
    
    buyAndHoldByAsset.push({
      symbol: a.symbol,
      quantity: Number(b.quantity || 0), // 基线持仓数量
      priceStart: Number(b.price || 0),
      priceNow: Number(a.price || 0),
      valueStart: Number(b.quantity || 0) * Number(b.price || 0),
      valueNow: buyAndHoldValue,
      deltaValue: buyAndHoldValue - (Number(b.quantity || 0) * Number(b.price || 0))
    });
  }
  
  // 计算自动平衡策略的当前价值
  const rebalanceByAsset = [];
  for (const a of group.assets) {
    const b = baselineMap.get(a.symbol) || { quantity: 0, price: 0 };
    rebalanceByAsset.push({
      symbol: a.symbol,
      quantityStart: Number(b.quantity || 0),
      quantityNow: Number(a.quantity || 0),
      deltaQuantity: Number(a.quantity || 0) - Number(b.quantity || 0),
      valueStart: Number(b.quantity || 0) * Number(b.price || 0),
      valueNow: Number(a.quantity || 0) * Number(a.price || 0),
      deltaValue: (Number(a.quantity || 0) * Number(a.price || 0)) - (Number(b.quantity || 0) * Number(b.price || 0))
    });
  }
  
  // 计算策略对比
  const baselineTotal = Number(baseline.totalValue || 0);
  const buyAndHoldReturn = buyAndHoldTotal - baselineTotal;
  const rebalanceReturn = currentTotal - baselineTotal;
  const buyAndHoldReturnPercent = baselineTotal > 0 ? (buyAndHoldReturn / baselineTotal) * 100 : 0;
  const rebalanceReturnPercent = baselineTotal > 0 ? (rebalanceReturn / baselineTotal) * 100 : 0;
  const outperformance = rebalanceReturn - buyAndHoldReturn;
  const outperformancePercent = baselineTotal > 0 ? (outperformance / baselineTotal) * 100 : 0;
  
  res.json({
    success: true,
    hasBaseline: true,
    baselineAt: baseline.timestamp,
    totalStart: baselineTotal,
    
    // 自动平衡策略结果
    rebalanceStrategy: {
      totalNow: currentTotal,
      deltaTotal: rebalanceReturn,
      returnPercent: rebalanceReturnPercent,
      byAsset: rebalanceByAsset
    },
    
    // 持仓不动策略结果
    buyAndHoldStrategy: {
      totalNow: buyAndHoldTotal,
      deltaTotal: buyAndHoldReturn,
      returnPercent: buyAndHoldReturnPercent,
      byAsset: buyAndHoldByAsset
    },
    
    // 策略对比
    strategyComparison: {
      outperformance: outperformance,
      outperformancePercent: outperformancePercent,
      betterStrategy: outperformance > 0 ? 'rebalance' : 'buyAndHold',
      daysSinceStart: Math.floor((new Date() - new Date(baseline.timestamp)) / (1000 * 60 * 60 * 24))
    },
    
    // 兼容旧版本
    totalNow: currentTotal,
    deltaTotal: rebalanceReturn,
    byAsset: rebalanceByAsset
  });
});

// 策略对比分析：详细对比自动平衡策略与持仓不动策略
app.get('/api/groups/:groupId/strategy-comparison', (req, res) => {
  const data = readAssets();
  const group = data.groups.find(g => g.id === req.params.groupId);
  if (!group) return res.status(404).json({ success: false, error: '资产组不存在' });
  const s = ensureGroupStrategy(group);
  const baseline = s.baselineSnapshot;
  if (!baseline) return res.json({ success: true, hasBaseline: false });
  
  const currentTotal = group.assets.reduce((sum, a) => sum + (Number(a.price || 0) * Number(a.quantity || 0)), 0);
  const baselineMap = new Map((baseline.assets || []).map(a => [a.symbol, a]));
  const baselineTotal = Number(baseline.totalValue || 0);
  
  // 计算持仓不动策略
  let buyAndHoldTotal = 0;
  const buyAndHoldDetails = [];
  
  for (const a of group.assets) {
    const b = baselineMap.get(a.symbol) || { quantity: 0, price: 0 };
    const buyAndHoldValue = Number(b.quantity || 0) * Number(a.price || 0);
    buyAndHoldTotal += buyAndHoldValue;
    
    const priceChange = Number(a.price || 0) - Number(b.price || 0);
    const priceChangePercent = Number(b.price || 0) > 0 ? (priceChange / Number(b.price || 0)) * 100 : 0;
    
    buyAndHoldDetails.push({
      symbol: a.symbol,
      quantity: Number(b.quantity || 0),
      priceStart: Number(b.price || 0),
      priceNow: Number(a.price || 0),
      priceChange: priceChange,
      priceChangePercent: priceChangePercent,
      valueStart: Number(b.quantity || 0) * Number(b.price || 0),
      valueNow: buyAndHoldValue,
      deltaValue: buyAndHoldValue - (Number(b.quantity || 0) * Number(b.price || 0))
    });
  }
  
  // 计算自动平衡策略
  const rebalanceDetails = [];
  for (const a of group.assets) {
    const b = baselineMap.get(a.symbol) || { quantity: 0, price: 0 };
    const currentValue = Number(a.quantity || 0) * Number(a.price || 0);
    const baselineValue = Number(b.quantity || 0) * Number(b.price || 0);
    
    rebalanceDetails.push({
      symbol: a.symbol,
      quantityStart: Number(b.quantity || 0),
      quantityNow: Number(a.quantity || 0),
      deltaQuantity: Number(a.quantity || 0) - Number(b.quantity || 0),
      priceStart: Number(b.price || 0),
      priceNow: Number(a.price || 0),
      valueStart: baselineValue,
      valueNow: currentValue,
      deltaValue: currentValue - baselineValue
    });
  }
  
  // 计算总体对比
  const buyAndHoldReturn = buyAndHoldTotal - baselineTotal;
  const rebalanceReturn = currentTotal - baselineTotal;
  const buyAndHoldReturnPercent = baselineTotal > 0 ? (buyAndHoldReturn / baselineTotal) * 100 : 0;
  const rebalanceReturnPercent = baselineTotal > 0 ? (rebalanceReturn / baselineTotal) * 100 : 0;
  const outperformance = rebalanceReturn - buyAndHoldReturn;
  const outperformancePercent = baselineTotal > 0 ? (outperformance / baselineTotal) * 100 : 0;
  
  // 计算年化收益率
  const daysSinceStart = Math.floor((new Date() - new Date(baseline.timestamp)) / (1000 * 60 * 60 * 24));
  const yearsSinceStart = daysSinceStart / 365.25;
  const buyAndHoldAnnualized = yearsSinceStart > 0 ? Math.pow(1 + buyAndHoldReturnPercent / 100, 1 / yearsSinceStart) - 1 : 0;
  const rebalanceAnnualized = yearsSinceStart > 0 ? Math.pow(1 + rebalanceReturnPercent / 100, 1 / yearsSinceStart) - 1 : 0;
  
  res.json({
    success: true,
    hasBaseline: true,
    baselineAt: baseline.timestamp,
    totalStart: baselineTotal,
    daysSinceStart: daysSinceStart,
    
    // 持仓不动策略
    buyAndHoldStrategy: {
      name: '持仓不动策略',
      description: '从策略开始时的持仓数量保持不变，只受价格波动影响',
      totalNow: buyAndHoldTotal,
      deltaTotal: buyAndHoldReturn,
      returnPercent: buyAndHoldReturnPercent,
      annualizedReturn: buyAndHoldAnnualized * 100,
      byAsset: buyAndHoldDetails
    },
    
    // 自动平衡策略
    rebalanceStrategy: {
      name: '自动平衡策略',
      description: '根据价格波动自动调整持仓比例，维持目标权重',
      totalNow: currentTotal,
      deltaTotal: rebalanceReturn,
      returnPercent: rebalanceReturnPercent,
      annualizedReturn: rebalanceAnnualized * 100,
      byAsset: rebalanceDetails
    },
    
    // 策略对比
    comparison: {
      outperformance: outperformance,
      outperformancePercent: outperformancePercent,
      betterStrategy: outperformance > 0 ? 'rebalance' : 'buyAndHold',
      betterStrategyName: outperformance > 0 ? '自动平衡策略' : '持仓不动策略',
      performanceGap: Math.abs(outperformance),
      performanceGapPercent: Math.abs(outperformancePercent),
      
      // 风险调整后收益（简化版）
      riskAdjustedReturn: {
        buyAndHold: buyAndHoldReturnPercent / Math.max(1, Math.abs(buyAndHoldReturnPercent)),
        rebalance: rebalanceReturnPercent / Math.max(1, Math.abs(rebalanceReturnPercent))
      }
    },
    
    // 总结
    summary: {
      message: outperformance > 0 
        ? `自动平衡策略表现更好，超出持仓不动策略 ${outperformance.toFixed(2)} USDT (${outperformancePercent.toFixed(2)}%)`
        : `持仓不动策略表现更好，超出自动平衡策略 ${Math.abs(outperformance).toFixed(2)} USDT (${Math.abs(outperformancePercent).toFixed(2)}%)`,
      recommendation: outperformance > 0 
        ? '建议继续使用自动平衡策略'
        : '建议考虑持仓不动策略或调整平衡参数'
    }
  });
});

// 手续费配置管理
const FEE_CONFIG_FILE = path.join(__dirname, 'fee_config.json');

function readFeeConfig() {
  try {
    if (fs.existsSync(FEE_CONFIG_FILE)) {
      const raw = fs.readFileSync(FEE_CONFIG_FILE, 'utf8');
      return JSON.parse(raw || '{}');
    }
  } catch (e) {}
  return { 
    tradingFeePercent: 0.1, // 默认0.1%手续费
    enabled: true 
  };
}

function writeFeeConfig(cfg) {
  try {
    fs.writeFileSync(FEE_CONFIG_FILE, JSON.stringify(cfg, null, 2));
    return true;
  } catch (e) { 
    return false; 
  }
}

// 获取手续费配置
app.get('/api/fee-config', (req, res) => {
  const cfg = readFeeConfig();
  res.json({ success: true, config: cfg });
});

// 更新手续费配置
app.put('/api/fee-config', (req, res) => {
  const { tradingFeePercent, enabled } = req.body || {};
  const current = readFeeConfig();
  const next = {
    tradingFeePercent: tradingFeePercent !== undefined ? Number(tradingFeePercent) : current.tradingFeePercent,
    enabled: enabled !== undefined ? !!enabled : current.enabled
  };
  
  if (next.tradingFeePercent < 0 || next.tradingFeePercent > 10) {
    return res.status(400).json({ success: false, error: '手续费百分比必须在0-10之间' });
  }
  
  if (!writeFeeConfig(next)) {
    return res.status(500).json({ success: false, error: '保存失败' });
  }
  res.json({ success: true, config: next });
});

// 计算手续费和实际盈利
function calculateFeesAndNetProfit(groupId) {
  const feeConfig = readFeeConfig();
  const logs = readTradingLogs();
  
  // 筛选成功交易
  const successfulTrades = logs.filter(log => 
    log.groupId === groupId && 
    log.status === 'success' && 
    log.valueUSDT && 
    log.valueUSDT > 0
  );
  
  // 计算总交易额
  const totalTradingVolume = successfulTrades.reduce((sum, log) => sum + Number(log.valueUSDT || 0), 0);
  
  // 计算手续费
  const totalFees = feeConfig.enabled ? totalTradingVolume * (feeConfig.tradingFeePercent / 100) : 0;
  
  return {
    totalTradingVolume,
    totalFees,
    tradingFeePercent: feeConfig.tradingFeePercent,
    feeEnabled: feeConfig.enabled,
    tradeCount: successfulTrades.length
  };
}

// 获取带手续费的策略对比
app.get('/api/groups/:groupId/strategy-comparison-with-fees', (req, res) => {
  const data = readAssets();
  const group = data.groups.find(g => g.id === req.params.groupId);
  if (!group) return res.status(404).json({ success: false, error: '资产组不存在' });
  const s = ensureGroupStrategy(group);
  const baseline = s.baselineSnapshot;
  if (!baseline) return res.json({ success: true, hasBaseline: false });
  
  const currentTotal = group.assets.reduce((sum, a) => sum + (Number(a.price || 0) * Number(a.quantity || 0)), 0);
  const baselineMap = new Map((baseline.assets || []).map(a => [a.symbol, a]));
  const baselineTotal = Number(baseline.totalValue || 0);
  
  // 计算手续费
  const feeData = calculateFeesAndNetProfit(req.params.groupId);
  
  // 计算持仓不动策略
  let buyAndHoldTotal = 0;
  const buyAndHoldDetails = [];
  
  for (const a of group.assets) {
    const b = baselineMap.get(a.symbol) || { quantity: 0, price: 0 };
    const buyAndHoldValue = Number(b.quantity || 0) * Number(a.price || 0);
    buyAndHoldTotal += buyAndHoldValue;
    
    const priceChange = Number(a.price || 0) - Number(b.price || 0);
    const priceChangePercent = Number(b.price || 0) > 0 ? (priceChange / Number(b.price || 0)) * 100 : 0;
    
    buyAndHoldDetails.push({
      symbol: a.symbol,
      quantity: Number(b.quantity || 0),
      priceStart: Number(b.price || 0),
      priceNow: Number(a.price || 0),
      priceChange: priceChange,
      priceChangePercent: priceChangePercent,
      valueStart: Number(b.quantity || 0) * Number(b.price || 0),
      valueNow: buyAndHoldValue,
      deltaValue: buyAndHoldValue - (Number(b.quantity || 0) * Number(b.price || 0))
    });
  }
  
  // 计算自动平衡策略
  const rebalanceDetails = [];
  for (const a of group.assets) {
    const b = baselineMap.get(a.symbol) || { quantity: 0, price: 0 };
    const currentValue = Number(a.quantity || 0) * Number(a.price || 0);
    const baselineValue = Number(b.quantity || 0) * Number(b.price || 0);
    
    rebalanceDetails.push({
      symbol: a.symbol,
      quantityStart: Number(b.quantity || 0),
      quantityNow: Number(a.quantity || 0),
      deltaQuantity: Number(a.quantity || 0) - Number(b.quantity || 0),
      priceStart: Number(b.price || 0),
      priceNow: Number(a.price || 0),
      valueStart: baselineValue,
      valueNow: currentValue,
      deltaValue: currentValue - baselineValue
    });
  }
  
  // 计算总体对比
  const buyAndHoldReturn = buyAndHoldTotal - baselineTotal;
  const rebalanceReturn = currentTotal - baselineTotal;
  const buyAndHoldReturnPercent = baselineTotal > 0 ? (buyAndHoldReturn / baselineTotal) * 100 : 0;
  const rebalanceReturnPercent = baselineTotal > 0 ? (rebalanceReturn / baselineTotal) * 100 : 0;
  
  // 计算扣除手续费后的实际收益
  const rebalanceNetReturn = rebalanceReturn - feeData.totalFees;
  const rebalanceNetReturnPercent = baselineTotal > 0 ? (rebalanceNetReturn / baselineTotal) * 100 : 0;
  
  const outperformance = rebalanceNetReturn - buyAndHoldReturn;
  const outperformancePercent = baselineTotal > 0 ? (outperformance / baselineTotal) * 100 : 0;
  
  // 计算年化收益率
  const daysSinceStart = Math.floor((new Date() - new Date(baseline.timestamp)) / (1000 * 60 * 60 * 24));
  const yearsSinceStart = daysSinceStart / 365.25;
  const buyAndHoldAnnualized = yearsSinceStart > 0 ? Math.pow(1 + buyAndHoldReturnPercent / 100, 1 / yearsSinceStart) - 1 : 0;
  const rebalanceAnnualized = yearsSinceStart > 0 ? Math.pow(1 + rebalanceNetReturnPercent / 100, 1 / yearsSinceStart) - 1 : 0;
  
  res.json({
    success: true,
    hasBaseline: true,
    baselineAt: baseline.timestamp,
    totalStart: baselineTotal,
    daysSinceStart: daysSinceStart,
    
    // 手续费信息
    feeInfo: {
      totalTradingVolume: feeData.totalTradingVolume,
      totalFees: feeData.totalFees,
      tradingFeePercent: feeData.tradingFeePercent,
      feeEnabled: feeData.feeEnabled,
      tradeCount: feeData.tradeCount
    },
    
    // 持仓不动策略
    buyAndHoldStrategy: {
      name: '持仓不动策略',
      description: '从策略开始时的持仓数量保持不变，只受价格波动影响',
      totalNow: buyAndHoldTotal,
      deltaTotal: buyAndHoldReturn,
      returnPercent: buyAndHoldReturnPercent,
      annualizedReturn: buyAndHoldAnnualized * 100,
      byAsset: buyAndHoldDetails
    },
    
    // 自动平衡策略（扣除手续费）
    rebalanceStrategy: {
      name: '自动平衡策略',
      description: '根据价格波动自动调整持仓比例，维持目标权重',
      totalNow: currentTotal,
      grossReturn: rebalanceReturn,
      grossReturnPercent: rebalanceReturnPercent,
      netReturn: rebalanceNetReturn,
      netReturnPercent: rebalanceNetReturnPercent,
      annualizedReturn: rebalanceAnnualized * 100,
      byAsset: rebalanceDetails
    },
    
    // 策略对比
    comparison: {
      outperformance: outperformance,
      outperformancePercent: outperformancePercent,
      betterStrategy: outperformance > 0 ? 'rebalance' : 'buyAndHold',
      betterStrategyName: outperformance > 0 ? '自动平衡策略' : '持仓不动策略',
      performanceGap: Math.abs(outperformance),
      performanceGapPercent: Math.abs(outperformancePercent)
    },
    
    // 总结
    summary: {
      message: outperformance > 0 
        ? `自动平衡策略表现更好，扣除手续费后超出持仓不动策略 ${outperformance.toFixed(2)} USDT (${outperformancePercent.toFixed(2)}%)`
        : `持仓不动策略表现更好，超出自动平衡策略 ${Math.abs(outperformance).toFixed(2)} USDT (${Math.abs(outperformancePercent).toFixed(2)}%)`,
      recommendation: outperformance > 0 
        ? '建议继续使用自动平衡策略'
        : '建议考虑持仓不动策略或调整平衡参数'
    }
  });
});

// 清空交易日志
app.post('/api/trading/logs/clear', (req, res) => {
  try {
    fs.writeFileSync(TRADING_LOG_FILE, JSON.stringify([], null, 2));
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: '清空失败' });
  }
});

// === 手动交易（真实下单）===
async function getUsdtPriceForCoinOrSymbol(coinOrSymbol) {
  // 统一转为 *USDT_UMCBL 以取期货最新价
  const symbol = deriveBitgetSymbol(coinOrSymbol);
  const price = await fetchBitgetV1TickerLast(symbol);
  return { symbol, price };
}

function runPythonMarketOrder({ coin, side, size, marginMode, cfg }) {
  return new Promise((resolve) => {
    const args = [
      'bitget_api.py',
      '--api-key', cfg.apiKey || '',
      '--secret-key', cfg.secretKey || '',
      '--passphrase', cfg.passphrase || '',
    ];
    if (cfg.sandbox) args.push('--sandbox');
    args.push('market', coin, side, String(size), '--margin-mode', marginMode);
    const proc = spawn('python3', args, { cwd: __dirname });
    let out = '';
    let err = '';
    proc.stdout.on('data', (d) => out += d.toString());
    proc.stderr.on('data', (d) => err += d.toString());
    proc.on('close', (code) => {
      const success = out.includes('订单提交成功') || out.includes('✅');
      resolve({ code, success, out, err });
    });
  });
}

function runPythonSetupAccount({ symbol, side, cfg }) {
  return new Promise((resolve) => {
    const args = [
      'bitget_api.py',
      '--api-key', cfg.apiKey || '',
      '--secret-key', cfg.secretKey || '',
      '--passphrase', cfg.passphrase || '',
    ];
    if (cfg.sandbox) args.push('--sandbox');
    const hold = side.toLowerCase() === 'sell' ? 'short' : 'long';
    args.push('setup', '--product-type', 'umcbl', '--position-mode', 'oneWay', '--margin-mode', 'isolated', '--symbol', symbol, '--leverage', '3', '--hold-side', hold);
    const proc = spawn('python3', args, { cwd: __dirname });
    let out = '';
    let err = '';
    proc.stdout.on('data', (d) => out += d.toString());
    proc.stderr.on('data', (d) => err += d.toString());
    proc.on('close', (code) => {
      resolve({ code, out, err });
    });
  });
}

app.post('/api/trade/manual', async (req, res) => {
  try {
    const { symbolOrCoin, side, usdt, marginMode, exchange } = req.body || {};
    if (!symbolOrCoin || !side || !usdt) {
      return res.status(400).json({ success: false, error: 'symbolOrCoin, side, usdt 必填' });
    }
    const usdtAmt = Number(usdt);
    if (!(usdtAmt > 0)) return res.status(400).json({ success: false, error: '无效的金额' });

    const orderSide = String(side || '').toUpperCase();
    if (!['BUY', 'SELL'].includes(orderSide)) {
      return res.status(400).json({ success: false, error: 'side 仅支持 BUY / SELL' });
    }

    const runtime = getExchangeRuntimeConfig();
    const normalizedRequestExchange = normalizeTradeExchange(exchange);
    const assetsData = readAssets();
    const allAssets = (assetsData.groups || []).flatMap(g => g.assets || []);
    const symbolUpper = String(symbolOrCoin || '').toUpperCase();
    const matchedAsset = allAssets.find((asset) => {
      const symbols = getAssetExchangeSymbols(asset);
      const candidates = [asset.symbol, symbols.bitget, symbols.aster, deriveAsterSymbol(asset.symbol), deriveBitgetSymbol(symbolUpper)];
      return candidates.filter(Boolean).some(sym => String(sym).toUpperCase() === symbolUpper);
    });

    let targetExchange = normalizedRequestExchange;
    if (!targetExchange && matchedAsset) {
      targetExchange = getAssetTradeExchange(matchedAsset, runtime);
    }
    if (!targetExchange) {
      if (hasBitgetCredentials(runtime.bitget)) {
        targetExchange = 'bitget';
      } else if (hasAsterCredentials(runtime.aster)) {
        targetExchange = 'aster';
      } else {
        return res.status(400).json({ success: false, error: '未配置可用交易所 API' });
      }
    }

    const priceInfo = await getUsdtPriceForCoinOrSymbol(symbolOrCoin);
    const price = Number(priceInfo.price || 0);
    if (!(price > 0)) {
      return res.status(400).json({ success: false, error: '无法获取价格，稍后重试' });
    }

    const rawQuantity = usdtAmt / price;
    if (!(rawQuantity > 0)) {
      return res.status(400).json({ success: false, error: '下单数量过小' });
    }

    if (targetExchange === 'bitget') {
      const cfg = runtime.bitget;
      if (!cfg.apiKey || !cfg.secretKey || !cfg.passphrase) {
        return res.status(400).json({ success: false, error: 'Bitget配置未完成' });
      }
      const size = +(rawQuantity.toFixed(6));
      if (!(size > 0)) {
        return res.status(400).json({ success: false, error: '下单数量过小' });
      }
      const coinParam = symbolOrCoin.toUpperCase().endsWith('USDT')
        ? symbolOrCoin.toUpperCase()
        : (symbolOrCoin.toUpperCase() + 'USDT');
      const tradeSymbol = coinParam;
      await runPythonSetupAccount({ symbol: tradeSymbol, side: orderSide.toLowerCase(), cfg });
      const result = await runPythonMarketOrder({
        coin: coinParam,
        side: orderSide.toLowerCase(),
        size,
        marginMode: marginMode || 'isolated',
        cfg
      });
      const ok = !!result.success;
      if (ok) {
        const ts = new Date().toISOString();
        appendTradingLog({
          timestamp: ts,
          groupId: 'manual',
          symbol: deriveBitgetSymbol(tradeSymbol),
          side: orderSide,
          valueUSDT: usdtAmt,
          quantity: size,
          exchange: 'bitget',
          status: 'real',
          note: '手动交易（Bitget）'
        });
      }
      return res.json({ success: ok, exchange: 'bitget', output: result.out, errorOutput: result.err });
    }

    if (targetExchange === 'aster') {
      const cfg = runtime.aster;
      if (!cfg.apiKey || !cfg.secretKey) {
        return res.status(400).json({ success: false, error: 'Aster配置未完成' });
      }
      const tradeSymbol = deriveAsterSymbol(symbolOrCoin);
      await ensureAsterExchangeInfo();
      const normalized = normalizeAsterOrderQuantity(tradeSymbol, rawQuantity);
      if (!(normalized.qty > 0)) {
        return res.status(400).json({ success: false, error: '下单数量过小' });
      }
      if (normalized.minQty && normalized.qty < normalized.minQty) {
        return res.status(400).json({ success: false, error: `最小下单数量为 ${normalized.minQty}` });
      }
      const execution = await placeAsterMarketOrder({
        symbol: tradeSymbol,
        side: orderSide,
        quantity: normalized.qty,
        config: cfg
      });
      const executedQty = execution.quantity;
      const ts = new Date().toISOString();
      appendTradingLog({
        timestamp: ts,
        groupId: 'manual',
        symbol: tradeSymbol,
        side: orderSide,
        valueUSDT: usdtAmt,
        quantity: executedQty,
        exchange: 'aster',
        status: 'real',
        note: '手动交易（Aster）'
      });
      return res.json({
        success: true,
        exchange: 'aster',
        executedQuantity: executedQty,
        output: execution.result
      });
    }

    if (targetExchange === 'sandbox') {
      return res.status(400).json({ success: false, error: '当前为 Sandbox 模式，不执行真实下单' });
    }

    return res.status(400).json({ success: false, error: `暂不支持的交易所: ${targetExchange}` });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message || '下单失败' });
  }
});

app.get('/api/exchange/config', (req, res) => {
  const cfg = getExchangeRuntimeConfig();
  const response = {
    activeExchange: cfg.activeExchange || 'sandbox',
    bitget: {
      apiKeyMasked: maskSensitive(cfg.bitget.apiKey || ''),
      hasSecret: !!cfg.bitget.secretKey,
      passphraseMasked: cfg.bitget.passphrase ? '•'.repeat(Math.min(8, cfg.bitget.passphrase.length)) : '',
      sandbox: !!cfg.bitget.sandbox
    },
    aster: {
      apiKeyMasked: maskSensitive(cfg.aster.apiKey || ''),
      hasSecret: !!cfg.aster.secretKey,
      recvWindow: cfg.aster.recvWindow,
      defaultLeverage: cfg.aster.defaultLeverage
    }
  };
  res.json({ success: true, config: response });
});

app.put('/api/exchange/config', (req, res) => {
  const { activeExchange, bitget, aster } = req.body || {};
  const current = readExchangeConfig();
  const next = { ...current };

  if (activeExchange && typeof activeExchange === 'string') {
    const normalized = activeExchange.toLowerCase();
    if (['bitget', 'aster', 'sandbox'].includes(normalized)) {
      next.activeExchange = normalized;
    }
  }

  if (bitget && typeof bitget === 'object') {
    next.bitget = normalizeBitgetConfig({ ...next.bitget, ...bitget });
  }

  if (aster && typeof aster === 'object') {
    next.aster = normalizeAsterConfig({ ...next.aster, ...aster });
  }

  if (!writeExchangeConfig(next)) {
    return res.status(500).json({ success: false, error: '保存失败' });
  }
  res.json({ success: true });
});

app.get('/api/bitget/config', (req, res) => {
  const cfg = readBitgetCfg();
  const response = {
    apiKeyMasked: maskSensitive(cfg.apiKey || ''),
    passphraseMasked: cfg.passphrase ? '•'.repeat(Math.min(8, cfg.passphrase.length)) : '',
    hasSecret: !!cfg.secretKey,
    sandbox: !!cfg.sandbox
  };
  res.json({ success: true, config: response });
});

app.put('/api/bitget/config', (req, res) => {
  const { apiKey, secretKey, passphrase, sandbox } = req.body || {};
  const patch = {};
  if (apiKey !== undefined) patch.apiKey = apiKey;
  if (secretKey !== undefined) patch.secretKey = secretKey;
  if (passphrase !== undefined) patch.passphrase = passphrase;
  if (sandbox !== undefined) patch.sandbox = sandbox;
  if (!writeBitgetCfg(patch)) return res.status(500).json({ success: false, error: '保存失败' });
  res.json({ success: true });
});
// 股票价格查询API - 解决CORS问题
app.get('/api/stock-price/:symbol', async (req, res) => {
  const { symbol } = req.params;
  
  try {
    const price = await getStockPrice(symbol);
    if (price) {
      res.json({ success: true, symbol: symbol.toUpperCase(), price: price });
    } else {
      res.status(404).json({ success: false, error: '无法获取股票价格' });
    }
  } catch (error) {
    console.error(`获取股票价格失败 ${symbol}:`, error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 批量获取股票价格
app.post('/api/stock-prices/batch', async (req, res) => {
  const { symbols } = req.body;
  
  if (!Array.isArray(symbols)) {
    return res.status(400).json({ error: 'Symbols must be an array' });
  }
  
  try {
    const prices = {};
    for (const symbol of symbols) {
      try {
        const price = await getStockPrice(symbol);
        if (price) {
          prices[symbol.toUpperCase()] = price;
        }
      } catch (error) {
        console.error(`获取${symbol}价格失败:`, error);
      }
      // 添加延迟避免请求过快
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    
    res.json({ success: true, prices: prices });
  } catch (error) {
    console.error('批量获取股票价格失败:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 获取股票价格的函数
function getStockPrice(symbol) {
  return new Promise((resolve, reject) => {
    // 由于所有免费股票API都需要注册获取密钥，这里使用智能价格生成
    // 实际使用时，建议注册以下任一免费API服务：
    
    // 1. Alpha Vantage (推荐) - 免费版：每分钟5次请求，每天500次
    // 注册地址: https://www.alphavantage.co/support/#api-key
    // API端点: https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=TSLA&apikey=YOUR_KEY
    
    // 2. IEX Cloud - 免费版：每月500,000次请求
    // 注册地址: https://iexcloud.io/cloud-login#/register
    // API端点: https://cloud.iexapis.com/stable/stock/TSLA/quote?token=YOUR_TOKEN
    
    // 3. Finnhub - 免费版：每分钟60次请求
    // 注册地址: https://finnhub.io/register
    // API端点: https://finnhub.io/api/v1/quote?symbol=TSLA&token=YOUR_TOKEN
    
    // 4. Twelve Data - 免费版：每天800次请求
    // 注册地址: https://twelvedata.com/pricing
    // API端点: https://api.twelvedata.com/price?symbol=TSLA&apikey=YOUR_KEY
    
    // 当前使用智能价格生成系统
    const smartPrice = generateSmartPrice(symbol);
    resolve(smartPrice);
  });
}

// 生成智能价格（基于真实持仓和市场数据）
function generateSmartPrice(symbol) {
  // 获取当前持仓中的价格作为基准
  const assets = readAssets();
  const currentAsset = assets.stocks.find(s => s.name.toUpperCase() === symbol);
  
  if (currentAsset) {
    const basePrice = currentAsset.price;
    
    // 基于当前价格生成合理的市场波动
    // 使用更小的波动范围，更接近真实市场
    const variation = (Math.random() - 0.5) * 0.08; // ±4%
    const newPrice = basePrice * (1 + variation);
    
    console.log(`${symbol} 基于持仓价格 ${basePrice} 生成智能价格: ${newPrice.toFixed(2)}`);
    return parseFloat(newPrice.toFixed(2));
  }
  
  // 如果没有找到持仓，使用预设的市场价格
  const marketPrices = {
    'TSLA': 277.70,
    'NVDA': 166.46,
    'MARA': 14.65,
    'AAPL': 175.50,
    'GOOGL': 140.20,
    'MSFT': 330.80,
    'AMZN': 130.40,
    'META': 280.30,
    'SPY': 420.50,
    'QQQ': 350.20
  };
  
  const defaultPrice = marketPrices[symbol] || 100;
  const variation = (Math.random() - 0.5) * 0.06; // ±3%
  const newPrice = defaultPrice * (1 + variation);
  
  console.log(`${symbol} 使用市场基准价格 ${defaultPrice} 生成智能价格: ${newPrice.toFixed(2)}`);
  return parseFloat(newPrice.toFixed(2));
}


app.listen(PORT, () => {
  console.log(`Asset Manager server running on http://localhost:${PORT}`);
  
  // 启动内存监控
  startMemoryMonitor();
  console.log('内存监控已启动');
  
  // 服务启动时恢复已开启策略的定时器
  try {
    const data = readAssets();
    for (const g of data.groups || []) {
      const s = ensureGroupStrategy(g);
      if (s.enabled) startStrategyTimer(g.id);
    }
    console.log('策略定时器已恢复');
  } catch (error) {
    console.error('恢复策略定时器失败:', error.message);
  }
});
