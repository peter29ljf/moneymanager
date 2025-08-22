class AssetManager {
    constructor() {
        this.assets = { crypto: [], stocks: [] };
        this.tradingEnabled = false;
        this.init();
    }

    async init() {
        this.bindEvents();
        await this.loadAssets();
        this.updateDisplay();
        this.loadTradingLog();
        this.loadTradingStatus();
    }

    bindEvents() {
        document.getElementById('crypto-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.addAsset('crypto');
        });

        document.getElementById('stocks-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.addAsset('stocks');
        });

        // 交易开关事件
        document.getElementById('trading-toggle').addEventListener('change', (e) => {
            this.toggleTrading(e.target.checked);
        });

        // 价格刷新事件
        document.getElementById('refresh-crypto-prices').addEventListener('click', () => {
            this.refreshCryptoPrices();
        });

        document.getElementById('refresh-stock-prices').addEventListener('click', () => {
            this.refreshStockPrices();
        });
    }

    async loadAssets() {
        try {
            const response = await fetch('/api/assets');
            if (response.ok) {
                const data = await response.json();
                this.assets = data;
                this.updateSummary(data.totals);
            }
        } catch (error) {
            console.error('Error loading assets:', error);
        }
    }

    async addAsset(type) {
        const nameId = type === 'crypto' ? 'crypto-name' : 'stock-name';
        const priceId = type === 'crypto' ? 'crypto-price' : 'stock-price';
        const quantityId = type === 'crypto' ? 'crypto-quantity' : 'stock-quantity';

        const name = document.getElementById(nameId).value;
        const price = parseFloat(document.getElementById(priceId).value);
        const quantity = parseFloat(document.getElementById(quantityId).value);

        if (!name || isNaN(price) || isNaN(quantity)) {
            alert('请填写所有字段');
            return;
        }

        const assetData = { name, price, quantity };

        try {
            const response = await fetch(`/api/assets/${type}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(assetData)
            });

            if (response.ok) {
                document.getElementById(nameId).value = '';
                document.getElementById(nameId).value = '';
                document.getElementById(priceId).value = '';
                document.getElementById(quantityId).value = '';
                await this.loadAssets();
                this.updateDisplay();
            } else {
                const error = await response.json();
                alert('添加失败: ' + error.error);
            }
        } catch (error) {
            console.error('Error adding asset:', error);
            alert('添加失败');
        }
    }

    async deleteAsset(type, id) {
        if (!confirm('确定要删除这个资产吗？')) {
            return;
        }

        try {
            const response = await fetch(`/api/assets/${type}/${id}`, {
                method: 'DELETE'
            });

            if (response.ok) {
                await this.loadAssets();
                this.updateDisplay();
            } else {
                const error = await response.json();
                alert('删除失败: ' + error.error);
            }
        } catch (error) {
            console.error('Error deleting asset:', error);
            alert('删除失败');
        }
    }

    async editAsset(type, id, currentAsset) {
        const newName = prompt('新名称:', currentAsset.name);
        if (newName === null) return;

        const newPrice = prompt('新价格:', currentAsset.price);
        if (newPrice === null) return;

        const newQuantity = prompt('新数量:', currentAsset.quantity);
        if (newQuantity === null) return;

        const updatedAsset = {
            name: newName || currentAsset.name,
            price: parseFloat(newPrice) || currentAsset.price,
            quantity: parseFloat(newQuantity) || currentAsset.quantity
        };

        try {
            const response = await fetch(`/api/assets/${type}/${id}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(updatedAsset)
            });

            if (response.ok) {
                await this.loadAssets();
                this.updateDisplay();
            } else {
                const error = await response.json();
                alert('更新失败: ' + error.error);
            }
        } catch (error) {
            console.error('Error updating asset:', error);
            alert('更新失败');
        }
    }

    // 交易开关功能
    async toggleTrading(enabled) {
        this.tradingEnabled = enabled;
        const statusElement = document.getElementById('trading-status');
        const toggleElement = document.getElementById('trading-toggle');
        
        if (enabled) {
            statusElement.textContent = '已开启';
            statusElement.className = 'log-success';
            console.log('自动交易已开启');
            
            // 这里可以添加启动自动交易的逻辑
            // 例如调用后端API启动交易监控
        } else {
            statusElement.textContent = '已关闭';
            statusElement.className = 'log-error';
            console.log('自动交易已关闭');
            
            // 这里可以添加停止自动交易的逻辑
        }
        
        // 保存状态到localStorage
        localStorage.setItem('tradingEnabled', enabled);
    }

    // 加载交易状态
    loadTradingStatus() {
        const savedStatus = localStorage.getItem('tradingEnabled') === 'true';
        const toggleElement = document.getElementById('trading-toggle');
        toggleElement.checked = savedStatus;
        this.toggleTrading(savedStatus);
    }

    // 刷新加密货币价格
    async refreshCryptoPrices() {
        const button = document.getElementById('refresh-crypto-prices');
        button.disabled = true;
        button.textContent = '更新中...';
        
        try {
            // 使用Coinbase公共API获取价格
            const cryptoList = this.assets.crypto.map(asset => asset.name.toUpperCase());
            const updatedPrices = {};
            
            for (const crypto of cryptoList) {
                try {
                    // Coinbase API
                    const response = await fetch(`https://api.coinbase.com/v2/prices/${crypto}-USD/spot`);
                    if (response.ok) {
                        const data = await response.json();
                        const price = parseFloat(data.data.amount);
                        updatedPrices[crypto] = price;
                    }
                } catch (error) {
                    console.error(`获取${crypto}价格失败:`, error);
                }
            }
            
            // 更新本地价格
            if (Object.keys(updatedPrices).length > 0) {
                await this.updateCryptoPrices(updatedPrices);
                this.showUpdateStatus('加密货币价格更新成功！', 'success');
            } else {
                this.showUpdateStatus('价格更新失败，请稍后重试', 'error');
            }
            
        } catch (error) {
            console.error('刷新价格失败:', error);
            this.showUpdateStatus('价格更新失败: ' + error.message, 'error');
        } finally {
            button.disabled = false;
            button.textContent = '刷新加密货币价格';
        }
    }

    // 刷新股票价格
    async refreshStockPrices() {
        const button = document.getElementById('refresh-stock-prices');
        button.disabled = true;
        button.textContent = '更新中...';
        
        try {
            // 使用后端API获取股票价格（解决CORS问题）
            const stockList = this.assets.stocks.map(asset => asset.name.toUpperCase());
            
            // 调用后端批量获取价格API
            const response = await fetch('/api/stock-prices/batch', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ symbols: stockList })
            });
            
            if (response.ok) {
                const data = await response.json();
                
                if (data.success && data.prices) {
                    const updatedPrices = data.prices;
                    console.log('获取到的股票价格:', updatedPrices);
                    
                    // 更新本地价格
                    if (Object.keys(updatedPrices).length > 0) {
                        await this.updateStockPrices(updatedPrices);
                        this.showUpdateStatus(`成功更新 ${Object.keys(updatedPrices).length} 只股票价格！`, 'success');
                    } else {
                        this.showUpdateStatus('价格更新失败，请稍后重试', 'error');
                    }
                } else {
                    this.showUpdateStatus('价格更新失败: ' + (data.error || '未知错误'), 'error');
                }
            } else {
                const errorData = await response.json();
                this.showUpdateStatus('价格更新失败: ' + (errorData.error || 'HTTP错误'), 'error');
            }
            
        } catch (error) {
            console.error('刷新价格失败:', error);
            this.showUpdateStatus('价格更新失败: ' + error.message, 'error');
        } finally {
            button.disabled = false;
            button.textContent = '刷新股票价格';
        }
    }

    // 更新加密货币价格
    async updateCryptoPrices(updatedPrices) {
        for (const [crypto, price] of Object.entries(updatedPrices)) {
            const asset = this.assets.crypto.find(a => a.name.toUpperCase() === crypto);
            if (asset) {
                try {
                    const response = await fetch(`/api/assets/crypto/${asset.id}`, {
                        method: 'PUT',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({ price: price })
                    });
                    
                    if (response.ok) {
                        console.log(`${crypto}价格已更新为: $${price}`);
                    }
                } catch (error) {
                    console.error(`更新${crypto}价格失败:`, error);
                }
            }
        }
        
        // 重新加载资产数据
        await this.loadAssets();
        this.updateDisplay();
    }

    // 更新股票价格
    async updateStockPrices(updatedPrices) {
        for (const [stock, price] of Object.entries(updatedPrices)) {
            const asset = this.assets.stocks.find(a => a.name.toUpperCase() === stock);
            if (asset) {
                try {
                    const response = await fetch(`/api/assets/stocks/${asset.id}`, {
                        method: 'PUT',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({ price: price })
                    });
                    
                    if (response.ok) {
                        console.log(`${stock}价格已更新为: $${price}`);
                    }
                } catch (error) {
                    console.error(`更新${stock}价格失败:`, error);
                }
            }
        }
        
        // 重新加载资产数据
        await this.loadAssets();
        this.updateDisplay();
    }

    // 显示更新状态
    showUpdateStatus(message, type) {
        const statusElement = document.getElementById('update-status');
        statusElement.textContent = message;
        statusElement.className = `update-status update-${type}`;
        statusElement.style.display = 'block';
        
        // 3秒后自动隐藏
        setTimeout(() => {
            statusElement.style.display = 'none';
        }, 3000);
    }

    // 加载交易记录
    async loadTradingLog() {
        try {
            // 这里应该调用后端API获取交易记录
            // 暂时使用模拟数据
            const mockLogs = [
                {
                    timestamp: new Date().toISOString(),
                    action: 'BUY',
                    coin: 'BTC',
                    size: 0.1,
                    status: 'success',
                    details: '自动买入 0.1 BTC'
                },
                {
                    timestamp: new Date(Date.now() - 3600000).toISOString(),
                    action: 'SELL',
                    coin: 'ETH',
                    size: 2.5,
                    status: 'success',
                    details: '自动卖出 2.5 ETH'
                }
            ];
            
            this.displayTradingLog(mockLogs);
        } catch (error) {
            console.error('加载交易记录失败:', error);
            document.getElementById('trading-log-content').innerHTML = '<div class="log-error">加载交易记录失败</div>';
        }
    }

    // 显示交易记录
    displayTradingLog(logs) {
        const logContent = document.getElementById('trading-log-content');
        
        if (logs.length === 0) {
            logContent.innerHTML = '<div class="loading">暂无交易记录</div>';
            return;
        }
        
        logContent.innerHTML = logs.map(log => {
            const statusClass = log.status === 'success' ? 'log-success' : 'log-error';
            const statusText = log.status === 'success' ? '成功' : '失败';
            const timestamp = new Date(log.timestamp).toLocaleString('zh-CN');
            
            return `
                <div class="log-item">
                    <div class="log-timestamp">${timestamp}</div>
                    <div class="log-action ${statusClass}">
                        <span class="status-indicator status-${log.status}"></span>
                        ${log.action} ${log.size} ${log.coin} - ${statusText}
                    </div>
                    <div class="log-details">${log.details}</div>
                </div>
            `;
        }).join('');
    }

    updateSummary(totals) {
        document.getElementById('crypto-total').textContent = `$${totals.crypto.toFixed(2)}`;
        document.getElementById('stocks-total').textContent = `$${totals.stocks.toFixed(2)}`;
        document.getElementById('total-value').textContent = `$${totals.overall.toFixed(2)}`;
    }

    updateDisplay() {
        this.displayAssets('crypto', this.assets.crypto);
        this.displayAssets('stocks', this.assets.stocks);
    }

    displayAssets(type, assets) {
        const listElement = document.getElementById(`${type}-list`);
        
        if (assets.length === 0) {
            listElement.innerHTML = '<div class="loading">暂无资产</div>';
            return;
        }

        listElement.innerHTML = assets.map(asset => {
            const totalValue = asset.price * asset.quantity;
            return `
                <div class="asset-item">
                    <div class="asset-info">
                        <div class="asset-name">${asset.name}</div>
                        <div class="asset-details">
                            价格: $${asset.price.toFixed(2)} | 
                            数量: ${asset.quantity} | 
                            添加时间: ${new Date(asset.createdAt).toLocaleString('zh-CN')}
                        </div>
                    </div>
                    <div class="asset-value">$${totalValue.toFixed(2)}</div>
                    <div class="asset-actions">
                        <button class="btn btn-edit" onclick="assetManager.editAsset('${type}', '${asset.id}', ${JSON.stringify(asset).replace(/"/g, '&quot;')})">编辑</button>
                        <button class="btn btn-danger" onclick="assetManager.deleteAsset('${type}', '${asset.id}')">删除</button>
                    </div>
                </div>
            `;
        }).join('');
    }
}

function switchTab(tabName) {
    document.querySelectorAll('.tab').forEach(tab => tab.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
    
    event.target.classList.add('active');
    document.getElementById(`${tabName}-tab`).classList.add('active');
}

const assetManager = new AssetManager();