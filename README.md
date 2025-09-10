# 💰 MoneyManager - 个人资产管理系统

一个功能完整的个人资产管理系统，支持多资产组管理、Bitget永续合约交易、策略自动化交易等功能。

## 🌟 主要功能

### 💼 资产管理
- **资产组管理**: 支持多个投资组合的独立管理
- **智能资产添加**: 通过Bitget API智能搜索和添加交易对
- **实时价格更新**: 批量刷新资产组内所有资产价格
- **资产组统计**: 显示每个资产组的总价值和占比分析
- **数据持久化**: 所有数据保存在本地JSON文件中

### 📈 价格更新
- **Bitget实时价格**: 通过Bitget API获取所有永续合约实时价格
- **批量价格刷新**: 一键刷新资产组内所有资产价格
- **价格缓存**: 智能缓存机制提升价格查询性能
- **状态反馈**: 显示更新进度和结果

### 🤖 自动交易
- **交易开关**: 可控制的自动交易开关
- **资产组管理**: 支持多个资产组和策略管理
- **Bitget API集成**: 支持市价单、限价单、平仓等操作
- **合约搜索**: 智能搜索和匹配所有Bitget永续合约
- **逐仓交易**: 默认使用逐仓保证金模式
- **交易日志**: 完整的交易记录和状态跟踪

### 📊 交易记录
- **实时记录**: 记录所有交易活动
- **状态跟踪**: 成功/失败状态可视化
- **时间戳**: 详细的交易时间记录
- **日志管理**: 支持查看和清空交易日志

## 🚀 技术架构

### 前端技术
- **HTML5 + CSS3**: 现代化响应式UI设计
- **原生JavaScript**: 轻量级前端交互
- **实时更新**: Ajax异步数据交互
- **本地存储**: localStorage状态持久化

### 后端技术
- **Node.js + Express**: 轻量级后端服务
- **RESTful API**: 标准化API接口设计
- **CORS支持**: 跨域资源共享
- **文件存储**: JSON文件数据持久化

### 外部API集成
- **Bitget API**: 专业永续合约交易和价格数据
- **智能合约搜索**: 实时搜索546个USDT永续合约
- **价格缓存机制**: 本地缓存提升查询性能

## 📦 安装和运行

### 环境要求
- Node.js 14+ 
- npm 或 yarn
- Python 3.7+ (用于交易功能)

### 快速开始

1. **克隆项目**
```bash
git clone https://github.com/peter29ljf/moneymanager.git
cd moneymanager
```

2. **安装依赖**
```bash
npm install
```

3. **启动服务**
```bash
# 开发模式
npm run dev

# 生产模式
npm start
```

4. **访问系统**
打开浏览器访问: http://localhost:3000

### Python交易功能设置

1. **安装Python依赖**
```bash
pip install requests
```

2. **配置API密钥**
编辑 `config.json` 文件，添加您的Bitget API密钥:
```json
{
  "api_key": "your_api_key_here",
  "secret_key": "your_secret_key_here", 
  "passphrase": "your_passphrase_here",
  "sandbox": false
}
```

## 🎯 使用指南

### 管理资产组
1. 点击"新建资产组"创建投资组合
2. 选择资产组后点击"添加资产"
3. 在搜索框中输入币种名称（如BTC、ETH）
4. 系统自动匹配Bitget合约并添加到资产组

### 更新价格
1. 选择要更新的资产组
2. 点击"刷新价格"按钮
3. 系统通过Bitget API获取最新价格
4. 查看资产组总价值和占比变化

### 启用策略交易
1. 在"策略设置"标签页选择资产组
2. 配置策略参数（目标权重、再平衡阈值等）
3. 点击"开启策略"启动自动交易
4. 在"交易记录"查看策略执行结果

### Python命令行工具

**搜索合约:**
```bash
python bitget_api.py --api-key YOUR_KEY --secret-key YOUR_SECRET --passphrase YOUR_PASS search BTC --limit 5
```

**查询价格:**
```bash
python bitget_api.py --api-key YOUR_KEY --secret-key YOUR_SECRET --passphrase YOUR_PASS price BTC ETH SOL
```

**查看合约详情:**
```bash
python bitget_api.py --api-key YOUR_KEY --secret-key YOUR_SECRET --passphrase YOUR_PASS info BTCUSDT
```

**下市价单:**
```bash
python bitget_api.py --api-key YOUR_KEY --secret-key YOUR_SECRET --passphrase YOUR_PASS market BTC buy 0.001
```

**自动交易:**
```bash
python bitget_api.py --api-key YOUR_KEY --secret-key YOUR_SECRET --passphrase YOUR_PASS auto-trade --assets-file assets.json
```

**查看交易日志:**
```bash
python bitget_api.py --api-key YOUR_KEY --secret-key YOUR_SECRET --passphrase YOUR_PASS log --limit 10
```

## 📁 项目结构

```
moneymanager/
├── public/                 # 前端文件
│   ├── index.html         # 主页面
│   ├── app.js            # 前端逻辑
│   └── config.js         # 前端配置
├── server.js             # Express后端服务
├── bitget_api.py         # Python交易API
├── config.json           # Bitget API配置文件
├── assets.json           # 资产组数据文件
├── trading_logs.json     # 交易记录日志
├── bitget_contracts_cache.json  # Bitget合约缓存
├── bitget_config.json    # Bitget配置文件
├── api_examples.json     # API使用示例
└── package.json          # Node.js依赖
```

## 🔧 API接口

### 资产组管理API
- `GET /api/groups` - 获取所有资产组
- `POST /api/groups` - 创建新资产组
- `DELETE /api/groups/:groupId` - 删除资产组
- `POST /api/groups/:groupId/assets` - 添加资产到资产组
- `PUT /api/groups/:groupId/assets/:assetId` - 更新资产信息
- `DELETE /api/groups/:groupId/assets/:assetId` - 删除资产
- `POST /api/groups/:groupId/refresh-prices` - 刷新资产组价格

### 策略交易API
- `GET /api/groups/:groupId/strategy` - 获取策略配置
- `PUT /api/groups/:groupId/strategy` - 更新策略配置
- `POST /api/groups/:groupId/strategy/enable` - 启用策略
- `POST /api/groups/:groupId/strategy/disable` - 禁用策略
- `POST /api/groups/:groupId/strategy/rebalance` - 执行再平衡

### Bitget API
- `GET /api/bitget/search` - 搜索合约交易对
- `GET /api/bitget/config` - 获取API配置
- `PUT /api/bitget/config` - 更新API配置
- `POST /api/trade/manual` - 手动执行交易

### 交易记录API
- `GET /api/trading/logs` - 获取交易日志
- `POST /api/trading/logs/clear` - 清空交易日志

## 🛡️ 安全特性

### 数据安全
- 本地文件存储，数据不上传第三方
- API密钥本地配置
- 支持测试环境(sandbox)模式

### 交易安全
- 手动交易开关控制
- 详细的交易日志记录
- 错误处理和重试机制
- 请求频率限制

## 🔮 扩展功能

### 当前支持的交易所
- **Bitget**: 
  - 完整的永续合约交易功能
  - 546个USDT永续合约支持
  - 智能合约搜索和匹配
  - 逐仓保证金模式
  - 自动数量精度调整
  - 合约信息本地缓存

### 核心技术栈
- **Bitget API**: 专业永续合约交易API
- **Express.js**: 轻量级后端服务框架
- **原生JavaScript**: 前端交互和UI管理
- **Python**: 高性能交易算法和API调用
- **JSON文件存储**: 本地数据持久化

### 最近更新 (v2.0)
- ✅ Bitget API全面升级
- ✅ 支持所有USDT永续合约
- ✅ 智能合约搜索功能
- ✅ 逐仓保证金模式
- ✅ 合约信息缓存机制
- ✅ 自动数量精度调整
- ✅ 策略保护机制

### 计划功能
- [ ] WebSocket实时价格推送
- [ ] 更多交易所支持（Binance、OKX等）
- [ ] 价格图表和技术分析
- [ ] 移动端PWA应用
- [ ] 数据导出功能
- [ ] 高级策略配置（网格交易、DCA等）
- [ ] 投资组合分析报告
- [ ] 风险管理和止损设置

## 🤝 贡献指南

欢迎提交Issue和Pull Request！

1. Fork 项目
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 打开Pull Request

## 📄 许可证

本项目采用 MIT 许可证 - 详见 [LICENSE](LICENSE) 文件

## 📞 联系方式

- 项目地址: https://github.com/peter29ljf/moneymanager
- 作者: peter29ljf
- 邮箱: [您的邮箱]

## 🙏 致谢

- [Coinbase API](https://developers.coinbase.com/) - 免费加密货币价格数据
- [Bitget API](https://bitgetlimited.github.io/apidoc/en/mix/) - 专业交易API
- [Express.js](https://expressjs.com/) - 轻量级Web框架
- [Node.js](https://nodejs.org/) - 高性能JavaScript运行时

---

⭐ 如果这个项目对您有帮助，请给个Star支持一下！
