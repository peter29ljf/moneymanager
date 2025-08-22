# 股票价格配置说明

## 🎯 当前状态

由于免费股票API都有请求频率限制，当前系统使用基于真实持仓价格的智能模拟价格。

## 🔧 价格生成逻辑

### 基于真实持仓价格
- **TSLA**: 基于当前持仓价格 $277.70，波动范围 ±6%
- **NVDA**: 基于当前持仓价格 $166.46，波动范围 ±6%  
- **MARA**: 基于当前持仓价格 $14.65，波动范围 ±6%

### 价格波动范围
- 正常市场波动: ±6%
- 模拟真实市场环境
- 避免价格跳跃过大

## 🚀 获取真实价格的方法

### 1. Alpha Vantage (推荐)
**免费版限制**: 每分钟5次请求，每天500次
**注册地址**: https://www.alphavantage.co/support/#api-key
**API端点**: `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=TSLA&apikey=YOUR_KEY`

### 2. IEX Cloud
**免费版限制**: 每月500,000次请求
**注册地址**: https://iexcloud.io/cloud-login#/register
**API端点**: `https://cloud.iexapis.com/stable/stock/TSLA/quote?token=YOUR_TOKEN`

### 3. Finnhub
**免费版限制**: 每分钟60次请求
**注册地址**: https://finnhub.io/register
**API端点**: `https://finnhub.io/api/v1/quote?symbol=TSLA&token=YOUR_TOKEN`

## ⚙️ 配置步骤

### 步骤1: 注册免费API
1. 选择上述任一服务商
2. 注册免费账户
3. 获取API密钥

### 步骤2: 修改配置文件
在 `server.js` 中取消注释并填入你的API密钥：

```javascript
// 取消注释并填入你的API密钥
const apis = [
  `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${symbol}&apikey=YOUR_FREE_API_KEY`,
  // 或者使用其他API
];
```

### 步骤3: 重启服务
```bash
pkill -f "node server.js"
npm start
```

## 📊 当前价格准确性

### 模拟价格特点
- ✅ 基于真实持仓价格
- ✅ 合理的市场波动范围
- ✅ 适合测试和演示
- ❌ 不是实时市场价格

### 真实价格优势
- ✅ 实时市场数据
- ✅ 准确的价格信息
- ✅ 适合实际交易
- ❌ 有API请求限制

## 🔄 价格更新频率

### 当前设置
- 手动更新: 点击"刷新股票价格"按钮
- 更新间隔: 200ms (避免API限制)
- 批量更新: 一次性更新所有股票

### 建议设置
- 生产环境: 每小时自动更新
- 交易时段: 每15分钟更新
- 非交易时段: 每天更新一次

## 🛠️ 故障排除

### 常见问题
1. **API限制**: 等待一段时间后重试
2. **网络错误**: 检查网络连接
3. **密钥无效**: 确认API密钥正确

### 调试方法
1. 查看服务器控制台日志
2. 检查API响应状态
3. 验证API密钥权限

## 📈 未来改进

### 计划功能
1. **多API源**: 自动切换备用API
2. **缓存机制**: 减少重复请求
3. **智能重试**: 失败后自动重试
4. **价格验证**: 检查价格合理性

### 性能优化
1. **请求队列**: 管理API请求
2. **错误处理**: 优雅降级到模拟价格
3. **监控告警**: API状态监控

## 💡 使用建议

### 开发/测试环境
- 使用当前模拟价格系统
- 适合功能测试和演示
- 无需外部依赖

### 生产环境
- 配置真实股票API
- 实现自动价格更新
- 添加价格验证机制

### 混合模式
- 主要使用真实API
- 失败时降级到模拟价格
- 确保系统可用性

