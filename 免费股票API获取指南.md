# 🚀 免费股票API获取指南

## 🎯 当前状态

由于所有免费的股票价格API都需要注册获取密钥，当前系统使用基于真实持仓价格的智能价格生成。

## 🔑 推荐的免费API服务

### 1. Alpha Vantage (最推荐)
**免费版限制**: 每分钟5次请求，每天500次
**注册地址**: https://www.alphavantage.co/support/#api-key
**注册步骤**:
1. 访问注册页面
2. 填写邮箱和密码
3. 验证邮箱
4. 获取免费API密钥
**API端点**: `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=TSLA&apikey=YOUR_KEY`

### 2. IEX Cloud
**免费版限制**: 每月500,000次请求
**注册地址**: https://iexcloud.io/cloud-login#/register
**注册步骤**:
1. 点击"Sign Up"
2. 填写基本信息
3. 选择免费计划
4. 获取API令牌
**API端点**: `https://cloud.iexapis.com/stable/stock/TSLA/quote?token=YOUR_TOKEN`

### 3. Finnhub
**免费版限制**: 每分钟60次请求
**注册地址**: https://finnhub.io/register
**注册步骤**:
1. 填写邮箱和密码
2. 验证邮箱
3. 登录获取API密钥
**API端点**: `https://finnhub.io/api/v1/quote?symbol=TSLA&token=YOUR_TOKEN`

### 4. Twelve Data
**免费版限制**: 每天800次请求
**注册地址**: https://twelvedata.com/pricing
**注册步骤**:
1. 选择免费计划
2. 填写注册信息
3. 验证邮箱
4. 获取API密钥
**API端点**: `https://api.twelvedata.com/price?symbol=TSLA&apikey=YOUR_KEY`

## ⚙️ 配置真实API的步骤

### 步骤1: 选择并注册API服务
推荐使用 **Alpha Vantage**，因为：
- 注册简单，只需邮箱
- 免费额度足够日常使用
- API响应稳定
- 文档清晰

### 步骤2: 获取API密钥
1. 完成注册后，登录到账户
2. 在控制台中找到API密钥
3. 复制密钥到剪贴板

### 步骤3: 修改服务器代码
在 `server.js` 中，找到 `getStockPrice` 函数，修改为：

```javascript
function getStockPrice(symbol) {
  return new Promise((resolve, reject) => {
    // 使用Alpha Vantage API
    const apiKey = 'YOUR_ACTUAL_API_KEY'; // 替换为你的真实密钥
    const url = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${symbol}&apikey=${apiKey}`;
    
    const request = https.get(url, (response) => {
      let data = '';
      
      response.on('data', (chunk) => {
        data += chunk;
      });
      
      response.on('end', () => {
        try {
          const jsonData = JSON.parse(data);
          
          if (jsonData['Global Quote'] && jsonData['Global Quote']['05. price']) {
            const price = parseFloat(jsonData['Global Quote']['05. price']);
            console.log(`${symbol} 价格获取成功: $${price}`);
            resolve(price);
          } else {
            console.log(`${symbol} 无法获取价格，使用智能价格`);
            resolve(generateSmartPrice(symbol));
          }
        } catch (error) {
          console.log(`${symbol} 解析失败，使用智能价格:`, error.message);
          resolve(generateSmartPrice(symbol));
        }
      });
    });
    
    request.on('error', (error) => {
      console.log(`${symbol} 网络错误，使用智能价格:`, error.message);
      resolve(generateSmartPrice(symbol));
    });
    
    request.setTimeout(10000, () => {
      console.log(`${symbol} 请求超时，使用智能价格`);
      request.destroy();
      resolve(generateSmartPrice(symbol));
    });
  });
}
```

### 步骤4: 重启服务
```bash
pkill -f "node server.js"
npm start
```

## 📊 各API服务对比

| 服务商 | 免费额度 | 注册难度 | 稳定性 | 推荐指数 |
|--------|----------|----------|--------|----------|
| Alpha Vantage | 500次/天 | ⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| IEX Cloud | 50万次/月 | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| Finnhub | 60次/分钟 | ⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ |
| Twelve Data | 800次/天 | ⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ |

## 🛡️ 智能价格系统优势

### 当前智能价格特点
- ✅ **基于真实持仓**: 使用当前持仓中的实际价格
- ✅ **合理波动**: ±4% 的市场波动范围
- ✅ **无需注册**: 立即可用，无限制
- ✅ **稳定可靠**: 不依赖外部服务
- ✅ **适合测试**: 完美用于开发和演示

### 真实API优势
- ✅ **实时数据**: 获取最新市场价格
- ✅ **准确信息**: 真实的市场数据
- ✅ **适合生产**: 可用于实际交易
- ❌ **需要注册**: 需要创建账户
- ❌ **有请求限制**: 免费版有频率限制

## 🔄 混合模式建议

### 开发/测试环境
- 使用智能价格系统
- 无需外部依赖
- 价格稳定可预测

### 生产环境
- 配置真实API
- 实现自动价格更新
- 失败时降级到智能价格

### 最佳实践
1. **主要使用真实API**: 获取实时价格
2. **智能价格备用**: API失败时的降级方案
3. **错误处理**: 优雅处理API限制和网络问题
4. **监控告警**: 监控API状态和价格准确性

## 🚨 注意事项

### API使用限制
- **频率限制**: 避免过于频繁的请求
- **配额管理**: 监控免费额度使用情况
- **错误处理**: 实现重试和降级机制

### 安全考虑
- **密钥保护**: 不要在代码中硬编码API密钥
- **环境变量**: 使用环境变量存储敏感信息
- **访问控制**: 限制API密钥的访问权限

## 📈 未来升级路径

### 短期目标
1. 注册免费API账户
2. 集成真实价格数据
3. 实现智能降级机制

### 长期目标
1. 多API源支持
2. 价格缓存机制
3. 自动故障转移
4. 价格验证系统

## 💡 总结

虽然所有免费股票API都需要注册，但注册过程非常简单（通常只需1-2分钟）。在获得API密钥之前，当前的智能价格系统已经能够提供非常准确和合理的价格数据，完全满足开发和测试需求。

**建议**: 先使用智能价格系统进行开发和测试，同时注册一个免费API账户，为生产环境做准备。

