# 💰 MoneyManager - 个人资产管理系统

一个功能完整的个人资产管理系统，支持加密货币和股票管理、自动交易、实时价格更新等功能。

## 🌟 主要功能

### 💼 资产管理
- **加密货币管理**: 添加、编辑、删除加密货币持仓
- **股票管理**: 添加、编辑、删除股票持仓
- **实时总览**: 显示总资产价值和分类汇总
- **数据持久化**: 所有数据保存在本地JSON文件中

### 📈 价格更新
- **加密货币价格**: 使用Coinbase API获取实时价格
- **股票价格**: 使用智能价格生成系统（支持多种API集成）
- **批量更新**: 一键刷新所有持仓价格
- **状态反馈**: 显示更新进度和结果

### 🤖 自动交易
- **交易开关**: 可控制的自动交易开关
- **投资组合监控**: 基于资产变化自动执行交易
- **Bitget API集成**: 支持市价单、限价单、平仓等操作
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
- **Coinbase API**: 免费加密货币价格数据
- **Bitget API**: 专业交易所API
- **多种股票API**: Alpha Vantage、IEX Cloud、Finnhub等

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

### 添加资产
1. 选择"加密货币"或"股票"标签页
2. 填写资产名称、价格和数量
3. 点击"添加"按钮

### 更新价格
1. 点击"刷新加密货币价格"或"刷新股票价格"按钮
2. 系统自动获取最新价格并更新显示
3. 查看更新状态提示

### 启用自动交易
1. 打开"自动交易开关"
2. 系统开始监控资产变化
3. 在"交易记录"标签页查看交易历史

### Python命令行工具

**查询价格:**
```bash
python bitget_api.py --api-key YOUR_KEY --secret-key YOUR_SECRET --passphrase YOUR_PASS price BTC ETH SOL
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
├── config.json           # API配置文件
├── assets.json           # 资产数据文件
├── package.json          # Node.js依赖
├── API_README.md         # API文档
└── UI功能说明.md         # UI功能说明
```

## 🔧 API接口

### 资产管理API
- `GET /api/assets` - 获取所有资产和汇总
- `POST /api/assets/crypto` - 添加加密货币
- `POST /api/assets/stocks` - 添加股票
- `PUT /api/assets/crypto/:id` - 更新加密货币
- `PUT /api/assets/stocks/:id` - 更新股票
- `DELETE /api/assets/crypto/:id` - 删除加密货币
- `DELETE /api/assets/stocks/:id` - 删除股票

### 价格查询API
- `GET /api/stock-price/:symbol` - 获取单个股票价格
- `POST /api/stock-prices/batch` - 批量获取股票价格

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
- **Bitget**: 完整的交易功能支持

### 支持的API服务
- **Coinbase**: 免费加密货币价格
- **Alpha Vantage**: 股票价格API
- **IEX Cloud**: 专业股票数据
- **Finnhub**: 实时股票数据
- **Yahoo Finance**: 免费股票数据

### 计划功能
- [ ] 更多交易所支持
- [ ] 实时WebSocket价格推送
- [ ] 价格图表和技术分析
- [ ] 移动端适配
- [ ] 数据导出功能
- [ ] 投资组合分析报告

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
