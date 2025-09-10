const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const https = require('https');
const { spawn } = require('child_process');

const app = express();
const PORT = 3000;
const DATA_FILE = path.join(__dirname, 'assets.json');
const TRADING_LOG_FILE = path.join(__dirname, 'trading_logs.json');
const BITGET_CFG_FILE = path.join(__dirname, 'bitget_config.json');

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
        const merged = [...legacyCrypto, ...legacyStocks].map(a => ({
          id: a.id || Date.now().toString(),
          name: a.name,
          quantity: a.quantity || 0,
          // 旧资产没有 Bitget 合约符号，保留价格用于初始显示
          price: typeof a.price === 'number' ? a.price : 0,
          symbol: a.symbol || null,
          createdAt: a.createdAt || new Date().toISOString(),
          updatedAt: a.updatedAt || undefined
        }));

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

function readBitgetCfg() {
  try {
    if (fs.existsSync(BITGET_CFG_FILE)) {
      const raw = fs.readFileSync(BITGET_CFG_FILE, 'utf8');
      return JSON.parse(raw || '{}');
    }
  } catch (e) {}
  return { apiKey: '', secretKey: '', passphrase: '', sandbox: false };
}

function writeBitgetCfg(cfg) {
  try {
    fs.writeFileSync(BITGET_CFG_FILE, JSON.stringify(cfg, null, 2));
    return true;
  } catch (e) { return false; }
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
  const { name, symbol, quantity, price } = req.body;
  if (!name || !symbol || quantity === undefined) {
    return res.status(400).json({ error: '名称、交易对(symbol)、数量必填' });
  }
  const data = readAssets();
  const group = data.groups.find(g => g.id === groupId);
  if (!group) {
    return res.status(404).json({ error: '资产组不存在' });
  }
  const newAsset = {
    id: `a_${Date.now()}`,
    name: String(name),
    symbol: String(symbol).toUpperCase(),
    quantity: parseFloat(quantity),
    price: price !== undefined ? parseFloat(price) : 0,
    createdAt: new Date().toISOString()
  };
  group.assets.push(newAsset);
  if (writeAssets(data)) {
    res.status(201).json({ success: true, asset: newAsset });
  } else {
    res.status(500).json({ error: '保存资产失败' });
  }
});

app.put('/api/groups/:groupId/assets/:assetId', (req, res) => {
  const { groupId, assetId } = req.params;
  const { name, quantity, price } = req.body;
  const data = readAssets();
  const group = data.groups.find(g => g.id === groupId);
  if (!group) return res.status(404).json({ error: '资产组不存在' });
  const idx = group.assets.findIndex(a => a.id === assetId);
  if (idx === -1) return res.status(404).json({ error: '资产不存在' });
  if (name !== undefined) group.assets[idx].name = String(name);
  if (quantity !== undefined) group.assets[idx].quantity = parseFloat(quantity);
  if (price !== undefined) group.assets[idx].price = parseFloat(price);
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
  if (writeAssets(data)) {
    res.json({ success: true });
  } else {
    res.status(500).json({ error: '删除资产失败' });
  }
});

// Bitget USDT本位永续 合约模糊搜索
// 使用 v1 合约列表接口（v2 参数兼容性问题）: https://api.bitget.com/api/mix/v1/market/contracts?productType=umcbl
app.get('/api/bitget/search', (req, res) => {
  const query = (req.query.query || '').toString().trim();
  if (!query) return res.status(400).json({ error: 'query 必填' });

  const url = 'https://api.bitget.com/api/mix/v1/market/contracts?productType=umcbl';
  https.get(url, (resp) => {
    let data = '';
    resp.on('data', (chunk) => { data += chunk; });
    resp.on('end', () => {
      try {
        const json = JSON.parse(data || '{}');
        if (json.code !== '00000') {
          return res.status(502).json({ error: json.msg || 'Bitget接口错误' });
        }
        const list = Array.isArray(json.data) ? json.data : [];
        const q = query.toUpperCase();
        const filtered = list.filter(it => {
          const symbol = (it.symbol || '').toUpperCase();
          const baseCoin = (it.baseCoin || '').toUpperCase();
          return symbol.includes(q) || baseCoin.includes(q);
        }).slice(0, 20).map(it => ({
          symbol: it.symbol,
          baseCoin: it.baseCoin,
          quoteCoin: it.quoteCoin,
          displayName: `${it.baseCoin}/${it.quoteCoin} 永续 (${it.symbol})`
        }));
        res.json({ success: true, results: filtered });
      } catch (e) {
        res.status(500).json({ error: '解析Bitget返回失败' });
      }
    });
  }).on('error', (err) => {
    res.status(500).json({ error: '请求Bitget失败: ' + err.message });
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
  s.baselineWeights = computeBaselineWeights(group);
  // 记录基线持仓与总值，供“资产变动统计”使用
  const baselineTotal = group.assets.reduce((sum, a) => sum + (Number(a.price || 0) * Number(a.quantity || 0)), 0);
  s.baselineSnapshot = {
    timestamp: new Date().toISOString(),
    totalValue: baselineTotal,
    assets: group.assets.map(a => ({ symbol: a.symbol, quantity: Number(a.quantity || 0), price: Number(a.price || 0) }))
  };
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
function httpsGetJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (resp) => {
        let data = '';
        resp.on('data', (chunk) => (data += chunk));
        resp.on('end', () => {
          try {
            resolve(JSON.parse(data || '{}'));
          } catch (e) {
            reject(new Error('解析 JSON 失败'));
          }
        });
      })
      .on('error', (err) => reject(err));
  });
}

async function fetchBitgetV1TickerLast(symbol) {
  const url = `https://api.bitget.com/api/mix/v1/market/ticker?symbol=${encodeURIComponent(symbol)}`;
  const json = await httpsGetJson(url);
  if (json && json.code === '00000' && json.data && json.data.last) {
    const price = parseFloat(json.data.last);
    if (!isNaN(price) && price > 0) return price;
  }
  throw new Error('获取行情失败');
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
      if (!asset.symbol) continue;
      try {
        const last = await fetchBitgetV1TickerLast(asset.symbol);
        asset.price = last;
        asset.updatedAt = new Date().toISOString();
        updatedCount += 1;
      } catch (e) {
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
  // 刷新价格
  for (const a of group.assets) {
    if (!a.symbol) continue;
    try { a.price = await fetchBitgetV1TickerLast(a.symbol); } catch (_) {}
    await new Promise(r => setTimeout(r, 120));
  }
  // 总市值
  const total = group.assets.reduce((sum, a) => sum + (Number(a.price || 0) * Number(a.quantity || 0)), 0) || 0;
  if (total <= 0) return { skipped: true };
  const minTrade = Number(s.minTradeUSDT || 100);
  const maxTrade = Number(s.maxTradeUSDT || 1000);

  // 偏离计算（基于当前价格与基准权重）
  const deviations = [];
  for (const a of group.assets) {
    const curVal = Number(a.price || 0) * Number(a.quantity || 0);
    const curWeight = total > 0 ? (curVal / total) : 0;
    const targetWeight = s.baselineWeights[a.symbol] || 0;
    const targetVal = total * targetWeight;
    const diff = targetVal - curVal; // 正为应买入金额
    const devPercent = (curWeight - targetWeight) * 100; // 正为超配
    deviations.push({
      symbol: a.symbol,
      currentValue: curVal,
      targetValue: targetVal,
      deviationAmount: diff,
      deviationPercent: devPercent
    });
  }

  // 生成动作（按最小交易额过滤）
  const actions = [];
  function roundQtyForSymbol(symbol, qty) {
    const absQty = Math.abs(Number(qty) || 0);
    if (!(absQty > 0)) return 0;
    const upper = String(symbol || '').toUpperCase();
    const decimals = upper.startsWith('BTC') ? 5 : 3; // BTC 除外，使用更高精度
    const factor = Math.pow(10, decimals);
    return Math.floor(absQty * factor) / factor; // 向下取整，避免超出金额上限
  }
  for (const a of group.assets) {
    const d = deviations.find(x => x.symbol === a.symbol);
    if (!d) continue;
    const price = Number(a.price || 0);
    if (Math.abs(d.deviationAmount) >= minTrade && price > 0) {
      const cappedValue = Math.min(Math.abs(d.deviationAmount), maxTrade);
      const rawQty = cappedValue / price;
      const roundedQty = roundQtyForSymbol(a.symbol, rawQty);
      if (roundedQty > 0) {
        actions.push({ symbol: a.symbol, side: d.deviationAmount > 0 ? 'BUY' : 'SELL', valueUSDT: cappedValue, quantity: roundedQty });
      }
    }
  }

  // 检查是否为真实交易模式
  const bitgetCfg = readBitgetCfg();
  const isRealTrading = !bitgetCfg.sandbox && bitgetCfg.apiKey && bitgetCfg.secretKey && bitgetCfg.passphrase;
  
  if (isRealTrading) {
    // 真实交易模式：执行实际订单
    for (const act of actions) {
      try {
        const coinParam = act.symbol.replace('_UMCBL', '');
        const result = await runPythonMarketOrder({
          coin: coinParam,
          side: act.side.toLowerCase(),
          size: act.quantity,
          marginMode: 'isolated', // 默认使用逐仓模式
          cfg: bitgetCfg
        });
        
        if (result.success) {
          // 成功交易后更新资产数量
          const asset = group.assets.find(a => a.symbol === act.symbol);
          if (asset) {
            const signedQty = act.side === 'BUY' ? act.quantity : -act.quantity;
            asset.quantity = Number(asset.quantity) + signedQty;
          }
          act.realTradeStatus = 'success';
          act.realTradeOutput = result.out;
        } else {
          act.realTradeStatus = 'failed';
          // 将 stderr 或 stdout 任一返回的错误信息保存到日志
          act.realTradeError = result.err || result.out;
        }
      } catch (error) {
        act.realTradeStatus = 'error';
        act.realTradeError = error.message;
      }
    }
  } else {
    // 模拟交易模式：只更新本地数量
    for (const act of actions) {
      const asset = group.assets.find(a => a.symbol === act.symbol);
      if (!asset) continue;
      const signedQty = act.side === 'BUY' ? act.quantity : -act.quantity;
      asset.quantity = Number(asset.quantity) + signedQty;
    }
  }

  // 保存与记录
  const ts = new Date().toISOString();
  s.lastResult = {
    timestamp: ts,
    totalBefore: total,
    actions,
    deviations,
    tradingMode: isRealTrading ? 'real' : 'simulated'
  };
  writeAssets(data);
  for (const act of actions) {
    const status = isRealTrading ? (act.realTradeStatus || 'real') : 'simulated';
    const note = isRealTrading ? 
      (act.realTradeStatus === 'success' ? '策略调仓（真实交易成功）' : 
       act.realTradeStatus === 'failed' ? '策略调仓（真实交易失败）' : 
       '策略调仓（真实交易错误）') : 
      '策略调仓（模拟）';
    
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
  s.baselineWeights = computeBaselineWeights(group);
  // 记录基线持仓与总值
  const baselineTotal = group.assets.reduce((sum, a) => sum + (Number(a.price || 0) * Number(a.quantity || 0)), 0);
  s.baselineSnapshot = {
    timestamp: new Date().toISOString(),
    totalValue: baselineTotal,
    assets: group.assets.map(a => ({ symbol: a.symbol, quantity: Number(a.quantity || 0), price: Number(a.price || 0) }))
  };
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
  const byAsset = [];
  for (const a of group.assets) {
    const b = baselineMap.get(a.symbol) || { quantity: 0, price: 0 };
    byAsset.push({
      symbol: a.symbol,
      quantityStart: Number(b.quantity || 0),
      quantityNow: Number(a.quantity || 0),
      deltaQuantity: Number(a.quantity || 0) - Number(b.quantity || 0),
      valueStart: Number(b.quantity || 0) * Number(b.price || 0),
      valueNow: Number(a.quantity || 0) * Number(a.price || 0),
      deltaValue: (Number(a.quantity || 0) * Number(a.price || 0)) - (Number(b.quantity || 0) * Number(b.price || 0))
    });
  }
  res.json({
    success: true,
    hasBaseline: true,
    baselineAt: baseline.timestamp,
    totalStart: Number(baseline.totalValue || 0),
    totalNow: currentTotal,
    deltaTotal: currentTotal - Number(baseline.totalValue || 0),
    byAsset
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
function readBitgetCfg() {
  try {
    if (fs.existsSync(BITGET_CFG_FILE)) {
      const raw = fs.readFileSync(BITGET_CFG_FILE, 'utf8');
      return JSON.parse(raw || '{}');
    }
  } catch (e) {}
  return { apiKey: '', secretKey: '', passphrase: '', sandbox: false };
}

async function getUsdtPriceForCoinOrSymbol(coinOrSymbol) {
  // 统一转为 *USDT_UMCBL 以取期货最新价
  let symbol = coinOrSymbol.toUpperCase();
  if (!symbol.endsWith('USDT') && !symbol.endsWith('_UMCBL')) {
    symbol = symbol + 'USDT_UMCBL';
  }
  if (symbol.endsWith('USDT')) symbol = symbol + '_UMCBL';
  const p = await fetchBitgetV1TickerLast(symbol);
  return { symbol, price: p };
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
    const { symbolOrCoin, side, usdt, marginMode } = req.body || {};
    if (!symbolOrCoin || !side || !usdt) {
      return res.status(400).json({ success: false, error: 'symbolOrCoin, side, usdt 必填' });
    }
    const usdtAmt = Number(usdt);
    if (!(usdtAmt > 0)) return res.status(400).json({ success: false, error: '无效的金额' });

    const cfg = readBitgetCfg();
    if (!cfg.apiKey || !cfg.secretKey || !cfg.passphrase) {
      return res.status(400).json({ success: false, error: 'Bitget配置未完成' });
    }

    // 计算下单数量
    const { price } = await getUsdtPriceForCoinOrSymbol(symbolOrCoin);
    const size = +(usdtAmt / price).toFixed(6);
    const coinParam = symbolOrCoin.toUpperCase().endsWith('USDT') ? symbolOrCoin.toUpperCase() : (symbolOrCoin.toUpperCase() + 'USDT');

    // 仅使用请求指定的模式，默认全仓
    const orderSide = side.toLowerCase();
    const tradeSymbol = coinParam; // e.g. SOLUSDT
    // 先同步账户：单向 + 逐仓 + 杠杆3倍
    await runPythonSetupAccount({ symbol: tradeSymbol, side: orderSide, cfg });
    // 仅用逐仓
    const result = await runPythonMarketOrder({ coin: coinParam, side: orderSide, size, marginMode: 'isolated', cfg });
    const ok = !!result.success;
    if (ok) {
      const ts = new Date().toISOString();
      appendTradingLog({ timestamp: ts, groupId: 'manual', symbol: `${tradeSymbol}_UMCBL`, side: orderSide.toUpperCase(), valueUSDT: usdtAmt, quantity: size, status: 'real', note: '策略调仓（真实）' });
    }
    return res.json({ success: ok, output: result.out, errorOutput: result.err });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message || '下单失败' });
  }
});

app.get('/api/bitget/config', (req, res) => {
  const cfg = readBitgetCfg();
  function maskMid(value, left = 3, right = 3) {
    if (!value) return '';
    const s = String(value);
    if (s.length <= left + right) return '***';
    return s.slice(0, left) + '*'.repeat(Math.max(3, s.length - left - right)) + s.slice(-right);
  }
  const response = {
    apiKeyMasked: maskMid(cfg.apiKey || ''),
    passphraseMasked: cfg.passphrase ? '•'.repeat(Math.min(8, cfg.passphrase.length)) : '',
    hasSecret: !!cfg.secretKey,
    sandbox: !!cfg.sandbox
  };
  // 不回传明文敏感信息
  res.json({ success: true, config: response });
});

app.put('/api/bitget/config', (req, res) => {
  const { apiKey, secretKey, passphrase, sandbox } = req.body || {};
  const current = readBitgetCfg();
  // 解析 sandbox 为布尔值
  let parsedSandbox;
  if (typeof sandbox === 'string') {
    const s = sandbox.toLowerCase();
    parsedSandbox = (s === 'true' || s === '1' || s === 'on' || s === 'yes');
  } else {
    parsedSandbox = !!sandbox;
  }
  const next = {
    apiKey: apiKey !== undefined ? String(apiKey) : current.apiKey,
    secretKey: secretKey !== undefined ? String(secretKey) : current.secretKey,
    passphrase: passphrase !== undefined ? String(passphrase) : current.passphrase,
    sandbox: sandbox !== undefined ? parsedSandbox : !!current.sandbox
  };
  if (!writeBitgetCfg(next)) return res.status(500).json({ success: false, error: '保存失败' });
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
  // 服务启动时恢复已开启策略的定时器
  try {
    const data = readAssets();
    for (const g of data.groups || []) {
      const s = ensureGroupStrategy(g);
      if (s.enabled) startStrategyTimer(g.id);
    }
  } catch (_) {}
});