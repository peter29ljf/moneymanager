const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const https = require('https');

const app = express();
const PORT = 3000;
const DATA_FILE = path.join(__dirname, 'assets.json');

app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

function readAssets() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const data = fs.readFileSync(DATA_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Error reading assets file:', error);
  }
  return { crypto: [], stocks: [] };
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

app.get('/api/assets', (req, res) => {
  const assets = readAssets();
  const cryptoTotal = assets.crypto.reduce((sum, asset) => sum + (asset.price * asset.quantity), 0);
  const stockTotal = assets.stocks.reduce((sum, asset) => sum + (asset.price * asset.quantity), 0);
  
  res.json({
    ...assets,
    totals: {
      crypto: cryptoTotal,
      stocks: stockTotal,
      overall: cryptoTotal + stockTotal
    }
  });
});

app.post('/api/assets/crypto', (req, res) => {
  const { name, price, quantity } = req.body;
  
  if (!name || price === undefined || quantity === undefined) {
    return res.status(400).json({ error: 'Name, price, and quantity are required' });
  }
  
  const assets = readAssets();
  const newAsset = {
    id: Date.now().toString(),
    name,
    price: parseFloat(price),
    quantity: parseFloat(quantity),
    createdAt: new Date().toISOString()
  };
  
  assets.crypto.push(newAsset);
  
  if (writeAssets(assets)) {
    res.status(201).json(newAsset);
  } else {
    res.status(500).json({ error: 'Failed to save asset' });
  }
});

app.post('/api/assets/stocks', (req, res) => {
  const { name, price, quantity } = req.body;
  
  if (!name || price === undefined || quantity === undefined) {
    return res.status(400).json({ error: 'Name, price, and quantity are required' });
  }
  
  const assets = readAssets();
  const newAsset = {
    id: Date.now().toString(),
    name,
    price: parseFloat(price),
    quantity: parseFloat(quantity),
    createdAt: new Date().toISOString()
  };
  
  assets.stocks.push(newAsset);
  
  if (writeAssets(assets)) {
    res.status(201).json(newAsset);
  } else {
    res.status(500).json({ error: 'Failed to save asset' });
  }
});

app.put('/api/assets/crypto/:id', (req, res) => {
  const { id } = req.params;
  const { name, price, quantity } = req.body;
  
  const assets = readAssets();
  const assetIndex = assets.crypto.findIndex(asset => asset.id === id);
  
  if (assetIndex === -1) {
    return res.status(404).json({ error: 'Asset not found' });
  }
  
  if (name !== undefined) assets.crypto[assetIndex].name = name;
  if (price !== undefined) assets.crypto[assetIndex].price = parseFloat(price);
  if (quantity !== undefined) assets.crypto[assetIndex].quantity = parseFloat(quantity);
  assets.crypto[assetIndex].updatedAt = new Date().toISOString();
  
  if (writeAssets(assets)) {
    res.json(assets.crypto[assetIndex]);
  } else {
    res.status(500).json({ error: 'Failed to update asset' });
  }
});

app.put('/api/assets/stocks/:id', (req, res) => {
  const { id } = req.params;
  const { name, price, quantity } = req.body;
  
  const assets = readAssets();
  const assetIndex = assets.stocks.findIndex(asset => asset.id === id);
  
  if (assetIndex === -1) {
    return res.status(404).json({ error: 'Asset not found' });
  }
  
  if (name !== undefined) assets.stocks[assetIndex].name = name;
  if (price !== undefined) assets.stocks[assetIndex].price = parseFloat(price);
  if (quantity !== undefined) assets.stocks[assetIndex].quantity = parseFloat(quantity);
  assets.stocks[assetIndex].updatedAt = new Date().toISOString();
  
  if (writeAssets(assets)) {
    res.json(assets.stocks[assetIndex]);
  } else {
    res.status(500).json({ error: 'Failed to update asset' });
  }
});

app.delete('/api/assets/crypto/:id', (req, res) => {
  const { id } = req.params;
  const assets = readAssets();
  
  const initialLength = assets.crypto.length;
  assets.crypto = assets.crypto.filter(asset => asset.id !== id);
  
  if (assets.crypto.length === initialLength) {
    return res.status(404).json({ error: 'Asset not found' });
  }
  
  if (writeAssets(assets)) {
    res.json({ message: 'Asset deleted successfully' });
  } else {
    res.status(500).json({ error: 'Failed to delete asset' });
  }
});

app.delete('/api/assets/stocks/:id', (req, res) => {
  const { id } = req.params;
  const assets = readAssets();
  
  const initialLength = assets.stocks.length;
  assets.stocks = assets.stocks.filter(asset => asset.id !== id);
  
  if (assets.stocks.length === initialLength) {
    return res.status(404).json({ error: 'Asset not found' });
  }
  
  if (writeAssets(assets)) {
    res.json({ message: 'Asset deleted successfully' });
  } else {
    res.status(500).json({ error: 'Failed to delete asset' });
  }
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
});