# 资产管理系统 API 使用说明

## 概述
这是一个个人资产管理系统，支持管理加密货币和股票资产。系统提供了完整的 REST API 用于资产的增删改查操作。

## 启动系统

### 安装依赖
```bash
npm install
```

### 启动服务器
```bash
npm start
# 或者使用开发模式
npm run dev
```

服务器将在 `http://localhost:3000` 启动。

### 访问Web界面
打开浏览器访问：`http://localhost:3000`

## API 端点

### 基础URL
```
http://localhost:3000/api
```

### 1. 获取所有资产
**端点**: `GET /api/assets`

**描述**: 获取所有加密货币和股票资产，包含总计信息

**响应示例**:
```json
{
  "crypto": [
    {
      "id": "1691234567890",
      "name": "比特币",
      "price": 68400,
      "quantity": 0.5,
      "createdAt": "2023-08-05T10:30:00.000Z"
    }
  ],
  "stocks": [
    {
      "id": "1691234567891", 
      "name": "苹果公司",
      "price": 150,
      "quantity": 100,
      "createdAt": "2023-08-05T10:35:00.000Z"
    }
  ],
  "totals": {
    "crypto": 34200,
    "stocks": 15000,
    "overall": 49200
  }
}
```

### 2. 添加加密货币资产
**端点**: `POST /api/assets/crypto`

**请求体**:
```json
{
  "name": "比特币",
  "price": 68400,
  "quantity": 0.5
}
```

**响应示例**:
```json
{
  "id": "1691234567890",
  "name": "比特币", 
  "price": 68400,
  "quantity": 0.5,
  "createdAt": "2023-08-05T10:30:00.000Z"
}
```

**cURL 示例**:
```bash
curl -X POST http://localhost:3000/api/assets/crypto \
  -H "Content-Type: application/json" \
  -d '{"name":"比特币","price":68400,"quantity":0.5}'
```

### 3. 添加股票资产
**端点**: `POST /api/assets/stocks`

**请求体**:
```json
{
  "name": "苹果公司",
  "price": 150,
  "quantity": 100
}
```

**响应示例**:
```json
{
  "id": "1691234567891",
  "name": "苹果公司",
  "price": 150,
  "quantity": 100,
  "createdAt": "2023-08-05T10:35:00.000Z"
}
```

**cURL 示例**:
```bash
curl -X POST http://localhost:3000/api/assets/stocks \
  -H "Content-Type: application/json" \
  -d '{"name":"苹果公司","price":150,"quantity":100}'
```

### 4. 更新加密货币资产
**端点**: `PUT /api/assets/crypto/:id`

**请求体** (所有字段可选):
```json
{
  "name": "以太坊",
  "price": 3400,
  "quantity": 2
}
```

**响应示例**:
```json
{
  "id": "1691234567890",
  "name": "以太坊",
  "price": 3400,
  "quantity": 2,
  "createdAt": "2023-08-05T10:30:00.000Z",
  "updatedAt": "2023-08-05T11:00:00.000Z"
}
```

**cURL 示例**:
```bash
curl -X PUT http://localhost:3000/api/assets/crypto/1691234567890 \
  -H "Content-Type: application/json" \
  -d '{"name":"以太坊","price":3400,"quantity":2}'
```

### 5. 更新股票资产
**端点**: `PUT /api/assets/stocks/:id`

**请求体** (所有字段可选):
```json
{
  "name": "特斯拉",
  "price": 250,
  "quantity": 50
}
```

**cURL 示例**:
```bash
curl -X PUT http://localhost:3000/api/assets/stocks/1691234567891 \
  -H "Content-Type: application/json" \
  -d '{"name":"特斯拉","price":250,"quantity":50}'
```

### 6. 删除加密货币资产
**端点**: `DELETE /api/assets/crypto/:id`

**响应示例**:
```json
{
  "message": "Asset deleted successfully"
}
```

**cURL 示例**:
```bash
curl -X DELETE http://localhost:3000/api/assets/crypto/1691234567890
```

### 7. 删除股票资产
**端点**: `DELETE /api/assets/stocks/:id`

**响应示例**:
```json
{
  "message": "Asset deleted successfully"
}
```

**cURL 示例**:
```bash
curl -X DELETE http://localhost:3000/api/assets/stocks/1691234567891
```

## 错误处理

### 常见错误响应

**400 Bad Request** - 缺少必需字段:
```json
{
  "error": "Name, price, and quantity are required"
}
```

**404 Not Found** - 资产不存在:
```json
{
  "error": "Asset not found"
}
```

**500 Internal Server Error** - 服务器错误:
```json
{
  "error": "Failed to save asset"
}
```

## 数据存储

系统使用 JSON 文件 (`assets.json`) 存储数据，格式如下：

```json
{
  "crypto": [
    {
      "id": "唯一标识符",
      "name": "资产名称",
      "price": "价格(数字)",
      "quantity": "数量(数字)",
      "createdAt": "创建时间(ISO字符串)",
      "updatedAt": "更新时间(ISO字符串,可选)"
    }
  ],
  "stocks": [
    "同样格式的股票数组"
  ]
}
```

## 使用示例

### 完整的资产管理流程示例

```bash
# 1. 获取当前所有资产
curl http://localhost:3000/api/assets

# 2. 添加一个比特币资产
curl -X POST http://localhost:3000/api/assets/crypto \
  -H "Content-Type: application/json" \
  -d '{"name":"比特币","price":68400,"quantity":0.1}'

# 3. 添加一个股票资产
curl -X POST http://localhost:3000/api/assets/stocks \
  -H "Content-Type: application/json" \
  -d '{"name":"苹果公司","price":150,"quantity":10}'

# 4. 查看更新后的资产列表
curl http://localhost:3000/api/assets

# 5. 更新比特币价格 (假设ID为1691234567890)
curl -X PUT http://localhost:3000/api/assets/crypto/1691234567890 \
  -H "Content-Type: application/json" \
  -d '{"price":69000}'

# 6. 删除股票资产 (假设ID为1691234567891)
curl -X DELETE http://localhost:3000/api/assets/stocks/1691234567891
```

## 注意事项

1. 所有价格和数量都使用数字类型，支持小数
2. 系统会自动生成唯一的资产ID
3. 创建和更新时间会自动记录
4. 系统支持CORS，可以从任何域名访问
5. 数据实时保存到JSON文件，重启服务器后数据不会丢失