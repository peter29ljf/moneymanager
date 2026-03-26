class AssetManager {
    constructor() {
        this.groups = [];
        this.currentGroupId = null;
        this.tradingEnabled = false;
        this.strategyEnabled = false; // 新增：策略状态
        this.ws = null;
        this.wsSymbols = new Set();
        this.priceCache = {}; // symbol -> price
        this.activeExchange = 'sandbox';
        this.assetSearchExchange = 'bitget';
        this.init();
    }

    async init() {
        this.bindEvents();
        await this.loadGroups();
        this.updateGroupDisplay();
        this.loadTradingLog();
        this.loadFeeConfig();
        this.loadStrategyComparison();
        await this.loadExchangeConfig();
        this.startPriceRefreshLoop();
    }

    bindEvents() {
        const btnNewGroup = document.getElementById('btn-new-group');
        const btnAddAsset = document.getElementById('btn-add-asset');
        const refreshGroupPrices = document.getElementById('refresh-group-prices');
        const groupSelector = document.getElementById('group-selector');
        const strategyGroupSelector = document.getElementById('strategy-group-selector');
        const strategySave = document.getElementById('strategy-save');
        const strategyEnable = document.getElementById('strategy-enable');
        const strategyDisable = document.getElementById('strategy-disable');
        const strategyRefreshNow = document.getElementById('strategy-refresh-now');
        const refreshLogsBtn = document.getElementById('refresh-logs');
        const exchangeSave = document.getElementById('exchange-save');
        const exchangeSelector = document.getElementById('exchange-active');
        const deleteGroupBtn = document.getElementById('btn-delete-group');
        const clearLogsBtn = document.getElementById('clear-logs');
        
        // 策略对比相关元素
        const comparisonGroupSelector = document.getElementById('comparison-group-selector');
        const refreshComparisonBtn = document.getElementById('refresh-comparison');
        const saveFeeConfigBtn = document.getElementById('save-fee-config');

        // 新建资产组按钮 - 添加错误处理
        if (btnNewGroup) {
            btnNewGroup.addEventListener('click', () => this.openWizard('create-group'));
        } else {
            console.error('新建资产组按钮元素未找到');
        }
        
        // 添加资产按钮 - 添加错误处理
        if (btnAddAsset) {
            btnAddAsset.addEventListener('click', () => this.openWizard('add-asset'));
        } else {
            console.error('添加资产按钮元素未找到');
        }
        refreshGroupPrices.addEventListener('click', () => this.refreshCurrentGroupPrices());
        groupSelector.addEventListener('change', (e) => {
            this.currentGroupId = e.target.value || null;
            this.updateGroupDisplay();
            this.rebuildWsSubscriptions();
            this.renderStrategySelectors();
            this.loadStrategy();
        });

        if (strategyGroupSelector) {
            strategyGroupSelector.addEventListener('change', (e) => {
                this.currentGroupId = e.target.value || null;
                this.renderGroupSelector();
                this.updateGroupDisplay();
                this.loadStrategy();
            });
        }
        if (strategySave) strategySave.addEventListener('click', () => this.saveStrategy());
        if (strategyEnable) strategyEnable.addEventListener('click', () => this.enableStrategy());
        if (strategyDisable) strategyDisable.addEventListener('click', () => this.disableStrategy());
        if (strategyRefreshNow) strategyRefreshNow.addEventListener('click', () => this.runStrategyOnce());
        if (refreshLogsBtn) refreshLogsBtn.addEventListener('click', () => this.loadTradingLog());
        if (exchangeSave) exchangeSave.addEventListener('click', () => this.saveExchangeConfig());
        if (exchangeSelector) exchangeSelector.addEventListener('change', (e) => {
            const value = e.target.value;
            this.activeExchange = value;
            this.toggleExchangeFields(value);
        });
        if (deleteGroupBtn) deleteGroupBtn.addEventListener('click', () => this.deleteCurrentGroup());
        if (clearLogsBtn) clearLogsBtn.addEventListener('click', () => this.clearTradingLogs());
        
        // 策略对比事件监听器
        if (comparisonGroupSelector) {
            comparisonGroupSelector.addEventListener('change', (e) => {
                this.currentGroupId = e.target.value || null;
                this.loadStrategyComparison();
            });
        }
        if (refreshComparisonBtn) refreshComparisonBtn.addEventListener('click', () => this.loadStrategyComparison());
        if (saveFeeConfigBtn) saveFeeConfigBtn.addEventListener('click', () => this.saveFeeConfig());

        // 向导按钮
        document.getElementById('wizard-cancel').addEventListener('click', () => this.closeWizard());
        document.getElementById('wizard-back').addEventListener('click', () => this.wizardPrev());
        document.getElementById('wizard-next').addEventListener('click', () => this.wizardNext());
    }

    async loadGroups() {
        try {
            const response = await fetch('/api/groups');
            if (!response.ok) return;
            const data = await response.json();
            if (data.success) {
                this.groups = data.groups || [];
                if (!this.currentGroupId && this.groups.length > 0) {
                    this.currentGroupId = this.groups[0].id;
                }
                this.renderGroupSelector();
                this.renderStrategySelectors();
                this.updateSummaryForCurrentGroup();
                this.rebuildWsSubscriptions();
                this.loadStrategy();
            }
        } catch (error) {
            console.error('Error loading groups:', error);
        }
    }

    async addAssetToGroup({ groupId, name, symbol, quantity, price, exchangeSymbols, tradeExchange }) {
        try {
            const response = await fetch(`/api/groups/${groupId}/assets`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, symbol, quantity, price, exchangeSymbols, tradeExchange })
            });
            const json = await response.json();
            if (!response.ok || !json.success) throw new Error(json.error || '添加失败');
            await this.loadGroups();
            this.updateGroupDisplay();
        } catch (error) {
            alert('添加失败: ' + error.message);
        }
    }

    formatBitgetSymbol(symbol) {
        if (!symbol) return '';
        const upper = String(symbol).trim().toUpperCase();
        if (upper.endsWith('_UMCBL') || upper.endsWith('_CMCBL')) return upper;
        if (upper.endsWith('USDT')) return `${upper}_UMCBL`;
        if (upper.includes('_')) return upper;
        return `${upper}USDT_UMCBL`;
    }

    formatAsterSymbol(symbol) {
        if (!symbol) return '';
        const upper = String(symbol).trim().toUpperCase();
        if (upper.endsWith('_UMCBL') || upper.endsWith('_CMCBL')) return upper.slice(0, -7);
        return upper.replace(/[^A-Z0-9]/g, '');
    }

    async deleteCurrentGroup() {
        const group = this.getCurrentGroup();
        if (!group) { alert('暂无选择的资产组'); return; }
        if (!confirm(`确定删除资产组“${group.name}”？此操作不可恢复`)) return;
        try {
            const resp = await fetch(`/api/groups/${group.id}`, { method: 'DELETE' });
            const json = await resp.json();
            if (!resp.ok || !json.success) throw new Error(json.error || '删除失败');
            await this.loadGroups();
            this.updateGroupDisplay();
            this.renderStrategySelectors();
            this.showUpdateStatus('资产组已删除', 'success');
        } catch (e) {
            alert('删除失败: ' + (e.message || ''));
        }
    }

    async deleteAsset(groupId, id) {
        if (!confirm('确定要删除这个资产吗？')) {
            return;
        }

        try {
            const response = await fetch(`/api/groups/${groupId}/assets/${id}`, {
                method: 'DELETE'
            });

            if (response.ok) {
                await this.loadGroups();
                this.updateGroupDisplay();
            } else {
                const error = await response.json();
                alert('删除失败: ' + error.error);
            }
        } catch (error) {
            console.error('Error deleting asset:', error);
            alert('删除失败');
        }
    }

    async editAsset(groupId, id, currentAsset) {
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

        const currentExchange = currentAsset.tradeExchange || (currentAsset.exchangeSymbols?.aster ? 'aster' : 'bitget');
        const exchangeInput = prompt('交易所 (bitget/aster)', currentExchange);
        if (exchangeInput === null) return;
        const exchangeNormalized = exchangeInput.trim().toLowerCase();
        if (exchangeNormalized === 'bitget' || exchangeNormalized === 'aster') {
            updatedAsset.tradeExchange = exchangeNormalized;
        }

        try {
            const response = await fetch(`/api/groups/${groupId}/assets/${id}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(updatedAsset)
            });

            if (response.ok) {
                await this.loadGroups();
                this.updateGroupDisplay();
            } else {
                const error = await response.json();
                alert('更新失败: ' + error.error);
            }
        } catch (error) {
            console.error('Error updating asset:', error);
            alert('更新失败');
        }
    }

    // 兼容旧开关：已移除

    // 刷新当前资产组价格（使用缓存或WS最新价回落）
    async refreshCurrentGroupPrices() {
        const button = document.getElementById('refresh-group-prices');
        button.disabled = true;
        button.textContent = '更新中...';
        try {
            const group = this.getCurrentGroup();
            if (!group) return;
            const resp = await fetch(`/api/groups/${group.id}/refresh-prices`, { method: 'POST' });
            const json = await resp.json();
            if (!resp.ok || !json.success) throw new Error(json.error || '刷新失败');
            await this.loadGroups();
            this.showUpdateStatus(`价格更新成功，已更新 ${json.updated} 项`, 'success');
        } finally {
            button.disabled = false;
            button.textContent = '刷新当前组价格';
        }
    }

    async bulkUpdateGroupPrices(groupId, symbolToPrice) {
        // 没有专门的批量接口，逐个调用PUT，确保简单直观
        const group = this.groups.find(g => g.id === groupId);
        if (!group) return;
        for (const [symbol, price] of Object.entries(symbolToPrice)) {
            const asset = group.assets.find(a => a.symbol === symbol);
            if (!asset) continue;
            try {
                await fetch(`/api/groups/${groupId}/assets/${asset.id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ price })
                });
            } catch (e) {}
        }
        await this.loadGroups();
        this.updateGroupDisplay();
    }

    // 每分钟刷新当前组价格（Bitget REST，失败则仅刷新显示）
    startPriceRefreshLoop() {
        if (this.priceTimer) clearInterval(this.priceTimer);
        const run = async () => {
            try {
                const group = this.getCurrentGroup();
                if (group) {
                    await fetch(`/api/groups/${group.id}/refresh-prices`, { method: 'POST' });
                    await this.loadGroups();
                }
            } catch (_) {
                // 忽略错误，仅刷新显示
            } finally {
                this.updateGroupDisplay();
            }
        };
        run();
        this.priceTimer = setInterval(run, 60 * 1000);
    }

    // refreshPricesForCurrentGroupViaRest 已由后端接口替代

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
            const resp = await fetch('/api/trading/logs');
            const json = await resp.json();
            let logs = (resp.ok && json.success && Array.isArray(json.logs)) ? json.logs : [];
            // 时间倒序 -> 按时间顺序排列（旧->新）
            logs = logs.sort((a,b)=> new Date(a.timestamp) - new Date(b.timestamp));
            // 适配显示结构
            const mapped = logs.map(l => {
                const isSuccess = (l.status === 'simulated' || l.status === 'real' || l.status === 'success');
                const status = isSuccess ? 'success' : 'failed';
                const tag = l.status === 'real' ? '（真实）' : (l.status === 'simulated' ? '（模拟）' : '');
                return {
                    timestamp: l.timestamp,
                    action: l.side,
                    coin: l.symbol,
                    size: l.quantity,
                    status,
                    details: `${(l.note || '').replace('（模拟）','（真实）')}${tag} 价值: ${Number(l.valueUSDT || 0).toFixed(2)} USDT`
                };
            });
            this.displayTradingLog(mapped);
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

    // 清空交易日志
    async clearTradingLogs() {
        if (!confirm('确定清空所有交易记录？此操作不可恢复')) return;
        try {
            const resp = await fetch('/api/trading/logs/clear', { method: 'POST' });
            const json = await resp.json();
            if (!resp.ok || !json.success) throw new Error(json.error || '清空失败');
            this.showUpdateStatus('已清空交易记录', 'success');
            this.loadTradingLog();
        } catch (e) {
            this.showUpdateStatus('清空失败: ' + (e.message || ''), 'error');
        }
    }

    // 资产变动统计
    async loadPortfolioStats() {
        const group = this.getCurrentGroup();
        const el = document.getElementById('portfolio-stats');
        if (!el || !group) return;
        try {
            const resp = await fetch(`/api/groups/${group.id}/stats`);
            const json = await resp.json();
            if (!resp.ok || !json.success || !json.hasBaseline) {
                el.innerHTML = '<div class="muted">暂无基线统计（请先开启策略）</div>';
                return;
            }
            const rows = [
                `<div>策略开始时间</div><div>${new Date(json.baselineAt).toLocaleString('zh-CN')}</div>`,
                `<div>总资产(开始)</div><div>$${Number(json.totalStart).toFixed(2)}</div>`,
                `<div>总资产(现在)</div><div>$${Number(json.totalNow).toFixed(2)}</div>`,
                `<div>总变化</div><div>$${Number(json.deltaTotal).toFixed(2)}</div>`
            ];
            rows.push('<div style="grid-column:1/-1;margin-top:6px;font-weight:600">各资产变化</div>');
            (json.byAsset || []).forEach(a => {
                rows.push(`<div>${a.symbol}</div><div>数量: ${a.quantityStart} → ${a.quantityNow}（Δ${a.deltaQuantity.toFixed(6)}） | 价值: $${a.valueStart.toFixed(2)} → $${a.valueNow.toFixed(2)}（Δ$${a.deltaValue.toFixed(2)}）</div>`);
            });
            el.innerHTML = rows.join('');
        } catch (e) {
            el.innerHTML = '<div class="muted">统计加载失败</div>';
        }
    }

    updateSummaryForCurrentGroup() {
        const group = this.getCurrentGroup();
        const totals = { overall: 0 };
        if (group) {
            totals.overall = group.assets.reduce((s, a) => s + (Number(a.price || 0) * Number(a.quantity || 0)), 0);
        }
        document.getElementById('crypto-total').textContent = `$0.00`;
        document.getElementById('stocks-total').textContent = `$0.00`;
        document.getElementById('total-value').textContent = `$${totals.overall.toFixed(2)}`;
    }

    renderGroupSelector() {
        const selector = document.getElementById('group-selector');
        selector.innerHTML = '';
        this.groups.forEach(g => {
            const opt = document.createElement('option');
            opt.value = g.id;
            opt.textContent = `${g.name}`;
            selector.appendChild(opt);
        });
        if (this.currentGroupId) selector.value = this.currentGroupId;
    }

    renderStrategySelectors() {
        const selector = document.getElementById('strategy-group-selector');
        const comparisonSelector = document.getElementById('comparison-group-selector');
        
        if (selector) {
            selector.innerHTML = '';
            this.groups.forEach(g => {
                const opt = document.createElement('option');
                opt.value = g.id;
                opt.textContent = `${g.name}`;
                selector.appendChild(opt);
            });
            if (this.currentGroupId) selector.value = this.currentGroupId;
        }
        
        if (comparisonSelector) {
            comparisonSelector.innerHTML = '';
            this.groups.forEach(g => {
                const opt = document.createElement('option');
                opt.value = g.id;
                opt.textContent = `${g.name}`;
                comparisonSelector.appendChild(opt);
            });
            if (this.currentGroupId) comparisonSelector.value = this.currentGroupId;
        }
    }

    getCurrentGroup() {
        return this.groups.find(g => g.id === this.currentGroupId) || null;
    }

    updateGroupDisplay() {
        const group = this.getCurrentGroup();
        const listElement = document.getElementById('group-assets');
        const summaryElement = document.getElementById('group-summary');
        if (!group) {
            listElement.innerHTML = '<div class="loading">暂无资产组，请先创建</div>';
            summaryElement.innerHTML = '';
            this.updateSummaryForCurrentGroup();
            return;
        }
        if (group.assets.length === 0) {
            listElement.innerHTML = '<div class="loading">该资产组暂无资产</div>';
        } else {
            const total = group.assets.reduce((s, a) => s + (Number(a.price || 0) * Number(a.quantity || 0)), 0) || 0;
            listElement.innerHTML = group.assets.map(asset => {
                const totalValue = Number(asset.price || 0) * Number(asset.quantity || 0);
                const percent = total > 0 ? (totalValue / total * 100) : 0;
                const exchangeSymbols = asset.exchangeSymbols || {};
                const bitgetSymbol = asset.symbol || exchangeSymbols.bitget || '-';
                const asterSymbol = exchangeSymbols.aster || null;
                const tradeExchange = asset.tradeExchange ? asset.tradeExchange.toUpperCase() : 'BITGET';
                const exchangeLines = [`<span style="display:block;color:#666;font-size:12px;">Bitget: ${bitgetSymbol}</span>`];
                if (asterSymbol) {
                    exchangeLines.push(`<span style="display:block;color:#666;font-size:12px;">Aster: ${asterSymbol}</span>`);
                }
                exchangeLines.push(`<span style="display:block;color:#0ea5e9;font-size:12px;">使用交易所: ${tradeExchange}</span>`);
                return `
                <div class="asset-item">
                    <div class="asset-info">
                        <div class="asset-name">${asset.name}
                            <div style="margin-top:6px">${exchangeLines.join('')}</div>
                        </div>
                        <div class="asset-details">
                            价格: $${Number(asset.price || 0).toFixed(4)} | 
                            数量: ${asset.quantity} | 
                            占比: ${percent.toFixed(2)}% | 
                            添加时间: ${new Date(asset.createdAt).toLocaleString('zh-CN')}
                        </div>
                    </div>
                    <div class="asset-value">$${totalValue.toFixed(2)}</div>
                    <div class="asset-actions">
                        <button class="btn btn-edit" onclick="assetManager.editAsset('${group.id}', '${asset.id}', ${JSON.stringify(asset).replace(/"/g, '&quot;')})">编辑</button>
                        <button class="btn btn-danger" onclick="assetManager.deleteAsset('${group.id}', '${asset.id}')">删除</button>
                    </div>
                </div>`;
            }).join('');

            summaryElement.innerHTML = group.assets.map(asset => {
                const totalValue = Number(asset.price || 0) * Number(asset.quantity || 0);
                const percent = total > 0 ? (totalValue / total * 100) : 0;
                const exchangeSymbols = asset.exchangeSymbols || {};
                const bitgetSymbol = asset.symbol || exchangeSymbols.bitget || '-';
                const asterSymbol = exchangeSymbols.aster ? ` / Aster: ${exchangeSymbols.aster}` : '';
                const exchangeLabel = asset.tradeExchange ? ` / 交易所: ${asset.tradeExchange.toUpperCase()}` : '';
                return `<div>${asset.name} (Bitget: ${bitgetSymbol}${asterSymbol}${exchangeLabel}) - $${totalValue.toFixed(2)} (${percent.toFixed(2)}%)`;
            }).join('');
        }
        this.updateSummaryForCurrentGroup();
    }
    // 检查策略状态
    async checkStrategyStatus() {
        const group = this.getCurrentGroup();
        if (!group) return false;
        
        try {
            const resp = await fetch(`/api/groups/${group.id}/strategy`);
            const json = await resp.json();
            if (resp.ok && json.success) {
                const strategy = json.strategy || {};
                this.strategyEnabled = !!strategy.enabled;
                return this.strategyEnabled;
            }
        } catch (e) {
            console.error('检查策略状态失败:', e);
        }
        return false;
    }

    // 向导：状态
    async openWizard(mode) {
        console.log('打开向导:', mode); // 调试信息
        
        // 如果是添加资产模式，检查策略状态
        if (mode === 'add-asset') {
            const isStrategyRunning = await this.checkStrategyStatus();
            if (isStrategyRunning) {
                alert('❌ 策略正在运行中，无法添加资产！\n\n请先在"策略设置"页面停止策略，然后再添加资产。');
                return;
            }
        }

        this.wizard = { step: 0, mode, data: {} };
        const overlay = document.getElementById('wizard-overlay');
        
        if (!overlay) {
            console.error('向导覆盖层元素未找到');
            alert('向导模态框初始化失败，请刷新页面重试');
            return;
        }
        
        overlay.style.display = 'flex';
        document.getElementById('wizard-back').style.display = 'none';
        document.getElementById('wizard-next').textContent = '下一步';
        this.renderWizard();
    }

    closeWizard() {
        const overlay = document.getElementById('wizard-overlay');
        overlay.style.display = 'none';
        this.wizard = null;
    }

    wizardPrev() {
        if (!this.wizard) return;
        if (this.wizard.step > 0) this.wizard.step -= 1;
        this.renderWizard();
    }

    async wizardNext() {
        if (!this.wizard) return;
        const stepOk = await this.collectWizardStepInput();
        if (!stepOk) return;
        this.wizard.step += 1;
        this.renderWizard();
    }

    renderWizard() {
        const body = document.getElementById('wizard-body');
        const backBtn = document.getElementById('wizard-back');
        const nextBtn = document.getElementById('wizard-next');
        const titleEl = document.getElementById('wizard-title');
        const mode = this.wizard.mode;
        const step = this.wizard.step;

        backBtn.style.display = step === 0 ? 'none' : 'inline-block';

        if (mode === 'create-group') {
            titleEl.textContent = '新建资产组';
            if (step === 0) {
                nextBtn.textContent = '创建';
                body.innerHTML = `
                    <div class="form-group">
                        <label>资产组名称</label>
                        <input id="wizard-group-name" type="text" placeholder="例如：长期投资组" />
                    </div>`;
            } else {
                this.closeWizard();
            }
            return;
        }

        if (mode === 'add-asset') {
            titleEl.textContent = '添加资产到资产组';
            if (!this.currentGroupId) {
                body.innerHTML = '<div class="loading">请先创建资产组</div>';
                nextBtn.style.display = 'none';
                return;
            }
            nextBtn.style.display = 'inline-block';
            if (step === 0) {
                nextBtn.textContent = '搜索';
                const defaultExchange = this.assetSearchExchange || (this.activeExchange === 'sandbox' ? 'bitget' : this.activeExchange);
                this.wizard.data = { assetName: '', chosenContract: null, quantity: 0, searchResults: [], searchExchange: defaultExchange };
                body.innerHTML = `
                    <div class="form-group">
                        <label>资产名称</label>
                        <input id="wizard-asset-name" type="text" placeholder="例如：BTC 或 比特币" />
                    </div>
                    <div class="form-group">
                        <label>选择交易所</label>
                        <select id="wizard-search-exchange" class="select">
                            <option value="bitget">Bitget</option>
                            <option value="aster">Aster</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label>选择交易对（当前：${this.describeExchange(defaultExchange)}）</label>
                        <div class="input-inline">
                            <input id="wizard-search-query" type="text" placeholder="输入关键字模糊搜索，例如：BTC" />
                            <button id="wizard-search-btn" class="btn">搜索</button>
                        </div>
                        <div id="wizard-search-results" class="search-results"></div>
                    </div>`;
                const exchangeSelect = document.getElementById('wizard-search-exchange');
                if (exchangeSelect) {
                    exchangeSelect.value = defaultExchange;
                    exchangeSelect.addEventListener('change', (e) => {
                        this.wizard.data.searchExchange = e.target.value;
                        this.assetSearchExchange = e.target.value;
                    });
                }
                document.getElementById('wizard-search-btn').onclick = () => this.searchContracts();
            } else if (step === 1) {
                nextBtn.textContent = '确认';
                const chosen = this.wizard.data.chosenContract;
                body.innerHTML = `
                    <div>已选择：<strong>${chosen ? chosen.displayName : '-'}</strong></div>
                    <div style="color:#666;margin-top:4px;">Bitget: ${chosen?.bitgetSymbol || '-'}</div>
                    <div style="color:#666;">Aster: ${chosen?.asterSymbol || '-'}</div>
                    <div class="form-group" style="margin-top:10px;">
                        <label>持有数量</label>
                        <input id="wizard-quantity" type="number" step="0.000001" placeholder="0" />
                    </div>`;
            } else if (step === 2) {
                nextBtn.textContent = '完成';
                const { assetName, chosenContract, quantity } = this.wizard.data;
                body.innerHTML = `
                    <div>资产名称：${assetName}</div>
                    <div>交易对：${chosenContract ? chosenContract.displayName : '-'}</div>
                    <div>Bitget: ${chosenContract?.bitgetSymbol || '-'}</div>
                    <div>Aster: ${chosenContract?.asterSymbol || '-'}</div>
                    <div>数量：${quantity}</div>
                    <div class="form-group" style="margin-top:10px;">
                        <label><input id="wizard-continue" type="checkbox" /> 继续添加下一个资产</label>
                    </div>`;
            } else {
                this.closeWizard();
            }
        }
    }

    async collectWizardStepInput() {
        const mode = this.wizard.mode;
        const step = this.wizard.step;
        if (mode === 'create-group') {
            if (step === 0) {
                const name = (document.getElementById('wizard-group-name').value || '').trim();
                if (!name) { alert('请输入资产组名称'); return false; }
                await this.createGroup(name);
                return true;
            }
            return true;
        }
        if (mode === 'add-asset') {
            if (step === 0) {
                const assetName = (document.getElementById('wizard-asset-name').value || '').trim();
                const chosen = this.wizard.data.chosenContract;
                if (!assetName) { alert('请输入资产名称'); return false; }
                if (!chosen) { alert('请先从搜索结果中选择正确交易对'); return false; }
                this.wizard.data.assetName = assetName;
                return true;
            }
            if (step === 1) {
                const q = parseFloat(document.getElementById('wizard-quantity').value);
                if (isNaN(q) || q <= 0) { alert('请输入有效数量'); return false; }
                this.wizard.data.quantity = q;
                // 创建资产
                const chosen = this.wizard.data.chosenContract || {};
                const bitgetSymbol = chosen.bitgetSymbol || chosen.symbol || this.formatBitgetSymbol(chosen.asterSymbol);
                const asterSymbol = chosen.asterSymbol || this.formatAsterSymbol(chosen.bitgetSymbol || chosen.symbol);
                const selectedExchange = (this.wizard.data.searchExchange || this.assetSearchExchange || 'bitget').toLowerCase();
                const normalizedExchange = selectedExchange === 'aster' ? 'aster' : 'bitget';
                await this.addAssetToGroup({
                    groupId: this.currentGroupId,
                    name: this.wizard.data.assetName,
                    symbol: bitgetSymbol,
                    quantity: q,
                    exchangeSymbols: {
                        bitget: bitgetSymbol,
                        aster: asterSymbol
                    },
                    tradeExchange: normalizedExchange
                });
                return true;
            }
            if (step === 2) {
                const cont = document.getElementById('wizard-continue')?.checked;
                if (cont) {
                    // 重置到搜索第一步
                    this.wizard.step = -1; // 渲染后会 +1 -> 0
                    this.wizard.data.assetName = '';
                    this.wizard.data.chosenContract = null;
                } else {
                    this.closeWizard();
                }
                return true;
            }
            return true;
        }
        return true;
    }

    async createGroup(name) {
        const resp = await fetch('/api/groups', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name })
        });
        const json = await resp.json();
        if (!resp.ok || !json.success) { throw new Error(json.error || '创建失败'); }
        await this.loadGroups();
        this.updateGroupDisplay();
    }

    async searchContracts() {
        const query = (document.getElementById('wizard-search-query').value || '').trim();
        if (!query) { alert('请输入搜索关键字'); return; }
        const exchangeSelect = document.getElementById('wizard-search-exchange');
        const exchange = exchangeSelect ? exchangeSelect.value : (this.wizard?.data?.searchExchange || this.assetSearchExchange || this.activeExchange || 'bitget');
        this.assetSearchExchange = exchange;
        if (this.wizard?.data) this.wizard.data.searchExchange = exchange;
        const resultsEl = document.getElementById('wizard-search-results');
        if (resultsEl) resultsEl.innerHTML = '<div class="loading">搜索中...</div>';
        if (this.wizard && this.wizard.data) {
            this.wizard.data.searchResults = [];
            this.wizard.data.chosenContract = null;
        }

        const renderResults = (list) => {
            if (!resultsEl) return;
            if (!list.length) {
                resultsEl.innerHTML = '<div class="loading">未找到结果，请重试</div>';
                return;
            }
            resultsEl.innerHTML = list.map((r, idx) => `
                <div class="search-item" onclick="assetManager.chooseContract(${idx})">
                    ${r.displayName}
                </div>
            `).join('');
            this.wizard.data.searchResults = list;
            this.wizard.data.chosenContract = null;
        };

        try {
            const resp = await fetch(`/api/exchange/search?query=${encodeURIComponent(query)}&exchange=${encodeURIComponent(exchange)}`);
            const json = await resp.json();
            if (!resp.ok || !json.success) throw new Error(json.error || '搜索失败');
            const list = (json.results || []).map(item => {
                const normalizedSource = item.source === 'aster' ? 'aster' : 'bitget';
                return {
                    ...item,
                    bitgetSymbol: item.bitgetSymbol || this.formatBitgetSymbol(item.symbol),
                    asterSymbol: item.asterSymbol || this.formatAsterSymbol(item.symbol),
                    source: normalizedSource
                };
            });
            renderResults(list);
        } catch (err) {
            console.warn('后端搜索失败，尝试直接调用交易所API', err);
            try {
                if (exchange === 'aster') {
                    const resp2 = await fetch('https://fapi.asterdex.com/fapi/v1/exchangeInfo');
                    const json2 = await resp2.json();
                    const all = Array.isArray(json2.symbols) ? json2.symbols : [];
                    const q = query.toUpperCase();
                    const filtered = all.filter(it => {
                        const symbol = String(it.symbol || '').toUpperCase();
                        const base = String(it.baseAsset || '').toUpperCase();
                        return symbol.includes(q) || base.includes(q);
                    }).slice(0, 20).map(it => ({
                        displayName: `${it.baseAsset}/${it.quoteAsset} 永续 (${it.symbol})`,
                        symbol: this.formatBitgetSymbol(it.symbol),
                        bitgetSymbol: this.formatBitgetSymbol(it.symbol),
                        asterSymbol: this.formatAsterSymbol(it.symbol),
                        baseAsset: it.baseAsset,
                        quoteAsset: it.quoteAsset,
                        source: 'aster'
                    }));
                    renderResults(filtered);
                } else {
                    const resp2 = await fetch('https://api.bitget.com/api/v2/mix/market/contracts?productType=USDT-FUTURES');
                    const json2 = await resp2.json();
                    if (json2.code !== '00000') throw new Error(json2.msg || 'Bitget接口错误');
                    const all = Array.isArray(json2.data) ? json2.data : [];
                    const q = query.toUpperCase();
                    const filtered = all.filter(it => {
                        const symbol = String(it.symbol || '').toUpperCase();
                        const base = String(it.baseCoin || '').toUpperCase();
                        return symbol.includes(q) || base.includes(q);
                    }).slice(0, 20).map(it => ({
                        displayName: `${it.baseCoin}/${it.quoteCoin} 永续 (${it.symbol})`,
                        symbol: this.formatBitgetSymbol(it.symbol),
                        bitgetSymbol: this.formatBitgetSymbol(it.symbol),
                        asterSymbol: this.formatAsterSymbol(it.symbol),
                        baseAsset: it.baseCoin,
                        quoteAsset: it.quoteCoin,
                        source: 'bitget'
                    }));
                    renderResults(filtered);
                }
            } catch (fallbackErr) {
                if (resultsEl) resultsEl.innerHTML = '';
                alert(`搜索失败：${err.message || ''}${fallbackErr?.message ? ' / ' + fallbackErr.message : ''}`);
            }
        }
    }

    chooseContract(index) {
        const list = this.wizard?.data?.searchResults || [];
        const chosen = list[index];
        if (!chosen) return;
        this.wizard.data.chosenContract = chosen;
        const sourceLabel = this.describeExchange(chosen.source || this.activeExchange || 'bitget');
        alert(`已选择：${chosen.displayName}\n来源：${sourceLabel}`);
    }

    // WS 订阅管理（可扩展为直连交易所WS；当前以定时REST为主）
    rebuildWsSubscriptions() {
        // 仅刷新显示，真实价格由 startPriceRefreshLoop 驱动
        if (this.wsTimer) clearInterval(this.wsTimer);
        this.wsTimer = setInterval(() => this.updateGroupDisplay(), 60 * 1000);
    }

    // 策略：加载/保存/开关
    async loadStrategy() {
        const group = this.getCurrentGroup();
        const statusEl = document.getElementById('strategy-status');
        if (!statusEl) return;
        if (!group) { statusEl.textContent = '请先选择资产组'; return; }
        try {
            const resp = await fetch(`/api/groups/${group.id}/strategy`);
            const json = await resp.json();
            if (!resp.ok || !json.success) throw new Error(json.error || '获取失败');
            const s = json.strategy || {};
            const unitEl = document.getElementById('strategy-frequency-unit');
            const valEl = document.getElementById('strategy-frequency-value');
            const minEl = document.getElementById('strategy-min-trade');
            const maxEl = document.getElementById('strategy-max-trade');
            if (unitEl) unitEl.value = s.frequency?.unit || 'hour';
            if (valEl) valEl.value = s.frequency?.value || 1;
            if (minEl) minEl.value = s.minTradeUSDT || 100;
            if (maxEl) maxEl.value = s.maxTradeUSDT || 1000;
            this.strategyEnabled = !!s.enabled; // 更新策略状态
            statusEl.textContent = s.enabled ? '策略状态：已开启' : '策略状态：已关闭';
            // 刷新显示最近结果
            await this.loadStrategyLastResult();
        } catch (e) {
            statusEl.textContent = '加载失败';
        }
    }

    async saveStrategy() {
        const group = this.getCurrentGroup();
        if (!group) return;
        const unit = document.getElementById('strategy-frequency-unit').value;
        const value = parseInt(document.getElementById('strategy-frequency-value').value, 10) || 1;
        const minTradeUSDT = parseFloat(document.getElementById('strategy-min-trade').value) || 100;
        const maxTradeUSDT = parseFloat(document.getElementById('strategy-max-trade').value) || 1000;
        const resp = await fetch(`/api/groups/${group.id}/strategy`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ unit, value, minTradeUSDT, maxTradeUSDT })
        });
        const json = await resp.json();
        if (!resp.ok || !json.success) { alert(json.error || '保存失败'); return; }
        this.loadStrategy();
        this.showUpdateStatus('策略设置已保存', 'success');
    }

    async enableStrategy() {
        const group = this.getCurrentGroup();
        if (!group) return;
        const resp = await fetch(`/api/groups/${group.id}/strategy/enable`, { method: 'POST' });
        const json = await resp.json();
        if (!resp.ok || !json.success) { alert(json.error || '开启失败'); return; }
        await this.loadStrategy();
        await this.loadStrategyLastResult();
        this.showUpdateStatus('策略已开启', 'success');
    }

    async disableStrategy() {
        const group = this.getCurrentGroup();
        if (!group) return;
        const resp = await fetch(`/api/groups/${group.id}/strategy/disable`, { method: 'POST' });
        const json = await resp.json();
        if (!resp.ok || !json.success) { alert(json.error || '关闭失败'); return; }
        await this.loadStrategy();
        await this.loadStrategyLastResult();
        this.showUpdateStatus('策略已关闭', 'success');
    }

    async runStrategyOnce() {
        const group = this.getCurrentGroup();
        if (!group) return;
        try {
            const resp = await fetch(`/api/groups/${group.id}/strategy/run-once`, { method: 'POST' });
            const json = await resp.json();
            if (!resp.ok || !json.success) throw new Error(json.error || '执行失败');
            await this.loadStrategyLastResult();
            this.showUpdateStatus('已完成一次刷新', 'success');
        } catch (e) {
            this.showUpdateStatus('刷新失败: ' + (e.message || ''), 'error');
        }
    }

    // 交易所配置
    toggleExchangeFields(active) {
        const asterFields = document.getElementById('aster-fields');
        if (asterFields) {
            asterFields.style.display = active === 'aster' ? 'block' : 'none';
        }
    }

    describeExchange(value) {
        const map = {
            sandbox: 'Sandbox 模式（仅模拟）',
            bitget: 'Bitget 永续',
            aster: 'Aster 永续'
        };
        return map[value] || map[this.activeExchange] || 'Bitget 永续';
    }

    async loadExchangeConfig() {
        const status = document.getElementById('exchange-config-status');
        try {
            const resp = await fetch('/api/exchange/config');
            const json = await resp.json();
            if (!resp.ok || !json.success) throw new Error(json.error || '加载失败');
            const cfg = json.config || {};
            const active = cfg.activeExchange || 'bitget';
            this.activeExchange = active;
            this.assetSearchExchange = active === 'sandbox' ? 'bitget' : active;
            const selector = document.getElementById('exchange-active');
            if (selector) {
                selector.value = active;
                this.toggleExchangeFields(active);
            }
            if (status) status.textContent = `当前模式：${this.describeExchange(active)}（敏感信息已隐藏）`;
            const activeSummary = document.getElementById('exchange-summary-active');
            if (activeSummary) {
                activeSummary.innerHTML = `<div>当前交易模式：${this.describeExchange(active)}</div>`;
            }

            // Bitget
            const bitgetCfg = cfg.bitget || {};
            const bitgetApi = document.getElementById('bitget-api-key');
            const bitgetSecret = document.getElementById('bitget-secret-key');
            const bitgetPass = document.getElementById('bitget-passphrase');
            if (bitgetApi) { bitgetApi.placeholder = bitgetCfg.apiKeyMasked || ''; bitgetApi.value = ''; }
            if (bitgetSecret) { bitgetSecret.placeholder = bitgetCfg.hasSecret ? '********' : ''; bitgetSecret.value = ''; }
            if (bitgetPass) { bitgetPass.placeholder = bitgetCfg.passphraseMasked || ''; bitgetPass.value = ''; }
            const sandboxBox = document.getElementById('bitget-sandbox');
            if (sandboxBox) sandboxBox.checked = !!bitgetCfg.sandbox;
            const bitgetSummary = document.getElementById('exchange-summary-bitget');
            if (bitgetSummary) {
                bitgetSummary.innerHTML = `
                    <div>API Key: ${bitgetCfg.apiKeyMasked || ''}</div>
                    <div>Secret Key: ${bitgetCfg.hasSecret ? '********' : '(未设置)'}</div>
                    <div>Passphrase: ${bitgetCfg.passphraseMasked || ''}</div>
                    <div>Sandbox: ${bitgetCfg.sandbox ? '开启' : '关闭'}</div>
                `;
            }

            // Aster
            const asterCfg = cfg.aster || {};
            const asterApi = document.getElementById('aster-api-key');
            const asterSecret = document.getElementById('aster-secret-key');
            const asterRecv = document.getElementById('aster-recv-window');
            const asterLev = document.getElementById('aster-default-leverage');
            if (asterApi) { asterApi.placeholder = asterCfg.apiKeyMasked || ''; asterApi.value = ''; }
            if (asterSecret) { asterSecret.placeholder = asterCfg.hasSecret ? '********' : ''; asterSecret.value = ''; }
            if (asterRecv) asterRecv.value = asterCfg.recvWindow || 5000;
            if (asterLev) asterLev.value = asterCfg.defaultLeverage || 3;
            const asterSummary = document.getElementById('exchange-summary-aster');
            if (asterSummary) {
                asterSummary.innerHTML = `
                    <div>API Key: ${asterCfg.apiKeyMasked || ''}</div>
                    <div>Secret Key: ${asterCfg.hasSecret ? '********' : '(未设置)'}</div>
                    <div>Recv Window: ${asterCfg.recvWindow || 5000} ms</div>
                    <div>默认杠杆: ${asterCfg.defaultLeverage || 3}</div>
                `;
            }

        } catch (e) {
            if (status) status.textContent = '加载失败';
        }
    }

    async saveExchangeConfig() {
        const status = document.getElementById('exchange-config-status');
        const activeSelect = document.getElementById('exchange-active');
        const activeExchange = activeSelect ? activeSelect.value : 'sandbox';

        const payload = { activeExchange };

        const bitgetPayload = {};
        const apiKeyVal = document.getElementById('bitget-api-key')?.value.trim();
        const secretVal = document.getElementById('bitget-secret-key')?.value.trim();
        const passVal = document.getElementById('bitget-passphrase')?.value.trim();
        const sandboxChecked = document.getElementById('bitget-sandbox')?.checked;
        if (apiKeyVal) bitgetPayload.apiKey = apiKeyVal;
        if (secretVal) bitgetPayload.secretKey = secretVal;
        if (passVal) bitgetPayload.passphrase = passVal;
        if (sandboxChecked !== undefined) bitgetPayload.sandbox = sandboxChecked;
        if (Object.keys(bitgetPayload).length > 0) payload.bitget = bitgetPayload;

        const asterPayload = {};
        const asterApiVal = document.getElementById('aster-api-key')?.value.trim();
        const asterSecretVal = document.getElementById('aster-secret-key')?.value.trim();
        const recvWindowVal = document.getElementById('aster-recv-window')?.value.trim();
        const leverageVal = document.getElementById('aster-default-leverage')?.value.trim();
        if (asterApiVal) asterPayload.apiKey = asterApiVal;
        if (asterSecretVal) asterPayload.secretKey = asterSecretVal;
        if (recvWindowVal) asterPayload.recvWindow = recvWindowVal;
        if (leverageVal) asterPayload.defaultLeverage = leverageVal;
        if (Object.keys(asterPayload).length > 0) payload.aster = asterPayload;

        try {
            const resp = await fetch('/api/exchange/config', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const json = await resp.json();
            if (!resp.ok || !json.success) throw new Error(json.error || '保存失败');
            await this.loadExchangeConfig();
            if (status) status.textContent = '已保存（敏感信息已隐藏）';
            this.showUpdateStatus('交易所配置已保存', 'success');
        } catch (e) {
            if (status) status.textContent = '保存失败';
            this.showUpdateStatus('保存失败: ' + (e.message || ''), 'error');
        }
    }

    async loadStrategyLastResult() {
        const group = this.getCurrentGroup();
        const box = document.getElementById('strategy-last-result');
        if (!box) return;
        if (!group) { box.innerHTML = '<div class="loading">请选择资产组</div>'; return; }
        try {
            const resp = await fetch(`/api/groups/${group.id}/strategy/last-result`);
            const json = await resp.json();
            if (!resp.ok || !json.success || !json.lastResult) { box.innerHTML = '<div class="loading">暂无刷新结果</div>'; return; }
            const { timestamp, deviations, actions } = json.lastResult;
            const timeStr = new Date(timestamp).toLocaleString('zh-CN');
            const assetMap = new Map((group.assets || []).map(a => [a.symbol, a]));
            const formatQty = (value) => {
                const num = Number(value);
                return Number.isFinite(num) ? num.toFixed(6) : '0.000000';
            };
            const formatValue = (value) => {
                const num = Number(value);
                return Number.isFinite(num) ? num.toFixed(2) : '0.00';
            };
            const devRows = (deviations || []).map(d => {
                const asset = assetMap.get(d.symbol);
                const prev = Number(d.previousUnrealizedQuantity);
                const prevUnrealized = Number.isFinite(prev) ? prev : Number(asset?.unrealizedQuantity || 0);
                const deviationQtyNum = Number(d.deviationQuantity);
                const deviationQty = Number.isFinite(deviationQtyNum) ? deviationQtyNum : 0;
                const pendingQtyNum = Number(d.pendingUnrealizedQuantity);
                const pendingQty = Number.isFinite(pendingQtyNum) ? pendingQtyNum : (prevUnrealized + deviationQty);
                const tradeValueNum = Number(d.pendingTradeValue);
                const priceSource = Number(d.price);
                const fallbackPrice = Number(asset?.price || 0);
                const pendingTradeValue = Number.isFinite(tradeValueNum) ? tradeValueNum : pendingQty * (Number.isFinite(priceSource) ? priceSource : fallbackPrice);
                return `
                <tr>
                    <td>${d.symbol}</td>
                    <td>${formatQty(prevUnrealized)}</td>
                    <td>${formatQty(deviationQty)}</td>
                    <td>${formatQty(pendingQty)}</td>
                    <td>${formatValue(pendingTradeValue)} USDT</td>
                </tr>`;
            }).join('');
            const actRows = (actions || []).map(a => {
                const asset = assetMap.get(a.symbol);
                const unrealized = asset ? Number(asset.unrealizedQuantity || 0) : 0;
                return `
                <tr>
                    <td>${a.symbol}</td>
                    <td>${a.side}</td>
                    <td>${a.quantity.toFixed(6)}</td>
                    <td>${a.valueUSDT.toFixed(2)} USDT</td>
                    <td>${unrealized.toFixed(6)}</td>
                </tr>`;
            }).join('');
            box.innerHTML = `
                <div>最近刷新时间：${timeStr}</div>
                <div style="margin-top:8px;">
                    <strong>偏离情况</strong>
                    <table style="width:100%;border-collapse:collapse;margin-top:4px;">
                        <thead><tr><th>交易对</th><th>上期未实现数量</th><th>本期偏离数量</th><th>本期未实现数量</th><th>本期应交易金额</th></tr></thead>
                        <tbody>${devRows || '<tr><td colspan="5">无</td></tr>'}</tbody>
                    </table>
                </div>
                <div style="margin-top:8px;">
                    <strong>本次交易</strong>
                    <table style="width:100%;border-collapse:collapse;margin-top:4px;">
                        <thead><tr><th>交易对</th><th>方向</th><th>数量</th><th>金额</th><th>刷新后未实现数量</th></tr></thead>
                        <tbody>${actRows || '<tr><td colspan="5">本次未达最小交易额，无调整</td></tr>'}</tbody>
                    </table>
                </div>
                <div style="margin-top:6px;color:#666;">已完成一次刷新</div>
            `;
        } catch (e) {
            box.innerHTML = '<div class="loading">加载失败</div>';
        }
    }

    // 加载手续费配置
    async loadFeeConfig() {
        try {
            const response = await fetch('/api/fee-config');
            if (!response.ok) return;
            const data = await response.json();
            if (data.success) {
                const config = data.config;
                document.getElementById('fee-percent').value = config.tradingFeePercent || 0.1;
                document.getElementById('fee-enabled').checked = config.enabled !== false;
            }
        } catch (error) {
            console.error('Error loading fee config:', error);
        }
    }

    // 保存手续费配置
    async saveFeeConfig() {
        try {
            const tradingFeePercent = parseFloat(document.getElementById('fee-percent').value);
            const enabled = document.getElementById('fee-enabled').checked;
            
            const response = await fetch('/api/fee-config', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tradingFeePercent, enabled })
            });
            
            if (response.ok) {
                this.showUpdateStatus('手续费配置已保存', 'success');
                this.loadStrategyComparison(); // 重新加载对比数据
            } else {
                const error = await response.json();
                this.showUpdateStatus(`保存失败: ${error.error}`, 'error');
            }
        } catch (error) {
            this.showUpdateStatus(`保存失败: ${error.message}`, 'error');
        }
    }

    // 加载策略对比
    async loadStrategyComparison() {
        if (!this.currentGroupId) {
            document.getElementById('strategy-comparison-content').innerHTML = 
                '<div class="muted">请选择资产组查看策略对比...</div>';
            return;
        }

        try {
            const response = await fetch(`/api/groups/${this.currentGroupId}/strategy-comparison-with-fees`);
            if (!response.ok) return;
            const data = await response.json();
            if (data.success && data.hasBaseline) {
                this.renderStrategyComparison(data);
            } else {
                document.getElementById('strategy-comparison-content').innerHTML = 
                    '<div class="muted">该资产组尚未启用策略，无法进行对比</div>';
            }
        } catch (error) {
            console.error('Error loading strategy comparison:', error);
            document.getElementById('strategy-comparison-content').innerHTML = 
                '<div class="muted">加载策略对比失败</div>';
        }
    }

    // 渲染策略对比
    renderStrategyComparison(data) {
        const container = document.getElementById('strategy-comparison-content');
        
        const feeInfo = data.feeInfo;
        const buyAndHold = data.buyAndHoldStrategy;
        const rebalance = data.rebalanceStrategy;
        const comparison = data.comparison;
        const summary = data.summary;

        container.innerHTML = `
            <!-- 手续费信息 -->
            <div class="card" style="margin-bottom:16px">
                <h3 style="margin:0 0 12px">手续费统计</h3>
                <div class="grid-2">
                    <div>
                        <div class="metric-title">总交易额</div>
                        <div class="metric-val">$${feeInfo.totalTradingVolume.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</div>
                    </div>
                    <div>
                        <div class="metric-title">总手续费</div>
                        <div class="metric-val">$${feeInfo.totalFees.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</div>
                    </div>
                    <div>
                        <div class="metric-title">手续费率</div>
                        <div class="metric-val">${feeInfo.tradingFeePercent}%</div>
                    </div>
                    <div>
                        <div class="metric-title">成功交易次数</div>
                        <div class="metric-val">${feeInfo.tradeCount}</div>
                    </div>
                </div>
            </div>

            <!-- 策略对比结果 -->
            <div class="grid-2" style="margin-bottom:16px">
                <!-- 持仓不动策略 -->
                <div class="card">
                    <h3 style="margin:0 0 12px">${buyAndHold.name}</h3>
                    <div class="metric-title">当前总价值</div>
                    <div class="metric-val">$${buyAndHold.totalNow.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</div>
                    <div class="metric-title" style="margin-top:12px">总收益</div>
                    <div class="metric-val" style="color:${buyAndHold.deltaTotal >= 0 ? 'var(--green)' : 'var(--red)'}">
                        $${buyAndHold.deltaTotal.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})} (${buyAndHold.returnPercent.toFixed(2)}%)
                    </div>
                    <div class="metric-title">年化收益率</div>
                    <div class="metric-val">${buyAndHold.annualizedReturn.toFixed(2)}%</div>
                </div>

                <!-- 自动平衡策略 -->
                <div class="card">
                    <h3 style="margin:0 0 12px">${rebalance.name}</h3>
                    <div class="metric-title">当前总价值</div>
                    <div class="metric-val">$${rebalance.totalNow.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</div>
                    <div class="metric-title" style="margin-top:12px">毛收益</div>
                    <div class="metric-val" style="color:${rebalance.grossReturn >= 0 ? 'var(--green)' : 'var(--red)'}">
                        $${rebalance.grossReturn.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})} (${rebalance.grossReturnPercent.toFixed(2)}%)
                    </div>
                    <div class="metric-title">扣除手续费后净收益</div>
                    <div class="metric-val" style="color:${rebalance.netReturn >= 0 ? 'var(--green)' : 'var(--red)'}">
                        $${rebalance.netReturn.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})} (${rebalance.netReturnPercent.toFixed(2)}%)
                    </div>
                    <div class="metric-title">年化收益率</div>
                    <div class="metric-val">${rebalance.annualizedReturn.toFixed(2)}%</div>
                </div>
            </div>

            <!-- 对比分析 -->
            <div class="card" style="margin-bottom:16px">
                <h3 style="margin:0 0 12px">策略对比分析</h3>
                <div class="grid-2">
                    <div>
                        <div class="metric-title">表现更好的策略</div>
                        <div class="metric-val" style="color:var(--primary)">${comparison.betterStrategyName}</div>
                    </div>
                    <div>
                        <div class="metric-title">超额收益</div>
                        <div class="metric-val" style="color:${comparison.outperformance >= 0 ? 'var(--green)' : 'var(--red)'}">
                            $${comparison.outperformance.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})} (${comparison.outperformancePercent.toFixed(2)}%)
                        </div>
                    </div>
                </div>
                <div style="margin-top:12px;padding:12px;background:#f8f9fa;border-radius:8px;">
                    <strong>总结：</strong>${summary.message}
                </div>
                <div style="margin-top:8px;padding:12px;background:#e3f2fd;border-radius:8px;">
                    <strong>建议：</strong>${summary.recommendation}
                </div>
            </div>

            <!-- 详细资产对比表格 -->
            <div class="card">
                <h3 style="margin:0 0 12px">详细资产对比</h3>
                <div style="overflow-x:auto;">
                    <table style="width:100%;border-collapse:collapse;">
                        <thead>
                            <tr style="background:#f8f9fa;">
                                <th style="padding:8px;text-align:left;border:1px solid #dee2e6;">资产</th>
                                <th style="padding:8px;text-align:right;border:1px solid #dee2e6;">持仓不动策略</th>
                                <th style="padding:8px;text-align:right;border:1px solid #dee2e6;">自动平衡策略</th>
                                <th style="padding:8px;text-align:right;border:1px solid #dee2e6;">差异</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${buyAndHold.byAsset.map((asset, index) => {
                                const rebalanceAsset = rebalance.byAsset[index];
                                const difference = rebalanceAsset.valueNow - asset.valueNow;
                                const diffPercent = asset.valueNow > 0 ? (difference / asset.valueNow) * 100 : 0;
                                return `
                                    <tr>
                                        <td style="padding:8px;border:1px solid #dee2e6;">${asset.symbol.replace('_UMCBL', '')}</td>
                                        <td style="padding:8px;text-align:right;border:1px solid #dee2e6;">$${asset.valueNow.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
                                        <td style="padding:8px;text-align:right;border:1px solid #dee2e6;">$${rebalanceAsset.valueNow.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
                                        <td style="padding:8px;text-align:right;border:1px solid #dee2e6;color:${difference >= 0 ? 'var(--green)' : 'var(--red)'}">
                                            $${difference.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})} (${diffPercent.toFixed(2)}%)
                                        </td>
                                    </tr>
                                `;
                            }).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    }

}

function switchTab(tabName, btn) {
    document.querySelectorAll('.tab').forEach(tab => tab.classList.remove('active'));
    document.querySelectorAll('.section').forEach(content => content.classList.remove('active'));
    
    if (btn) btn.classList.add('active');
    document.getElementById(`${tabName}-tab`).classList.add('active');
    if (tabName === 'strategy') {
        if (window.__strategyPoller) clearInterval(window.__strategyPoller);
        assetManager.loadStrategy();
        assetManager.loadStrategyLastResult();
        window.__strategyPoller = setInterval(() => assetManager.loadStrategyLastResult(), 30000);
    } else if (tabName === 'strategy-comparison') {
        assetManager.loadStrategyComparison();
    } else {
        if (window.__strategyPoller) {
            clearInterval(window.__strategyPoller);
            window.__strategyPoller = null;
        }
    }
    if (tabName === 'bitget') {
        assetManager.loadExchangeConfig();
    }
    if (tabName === 'trading-log') {
        assetManager.loadPortfolioStats();
        assetManager.loadTradingLog();
    }
}

const assetManager = new AssetManager();
