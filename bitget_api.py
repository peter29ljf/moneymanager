#!/usr/bin/env python3
"""
Bitget 交易API
支持市价单、限价单和多币种交易
"""

import hashlib
import hmac
import base64
import time
import json
import requests
import os
import random
from typing import Optional, Dict, Any
import argparse
from datetime import datetime


class BitgetAPI:
    """Bitget 交易API类"""
    
    def __init__(self, api_key: str, secret_key: str, passphrase: str, 
                 sandbox: bool = False, log_file: str = "trading_log.json"):
        """
        初始化API客户端
        
        Args:
            api_key: API密钥
            secret_key: API私钥
            passphrase: API密码短语
            sandbox: 是否使用测试环境
            log_file: 交易日志文件路径
        """
        self.api_key = api_key
        self.secret_key = secret_key
        self.passphrase = passphrase
        self.base_url = "https://api.bitget.com"
        self.sandbox = sandbox
        self.log_file = log_file
        
        # 合约交易对缓存 - 存储所有可用的合约信息
        self.contracts_cache = {}  # symbol -> contract_info
        self.contracts_loaded = False
        
        # 合约信息存储文件
        self.contracts_cache_file = "bitget_contracts_cache.json"
        
        # 向后兼容的币种映射（已更新为正确的Bitget永续合约格式）
        self.legacy_symbols = {
            "BTC": "BTCUSDT",
            "ETH": "ETHUSDT", 
            "BNB": "BNBUSDT",
            "ADA": "ADAUSDT",
            "SOL": "SOLUSDT",
            "DOGE": "DOGEUSDT",
            "XRP": "XRPUSDT",
            "LTC": "LTCUSDT",
            "DOT": "DOTUSDT",
            "MATIC": "MATICUSDT",
            "LINK": "LINKUSDT",
            "TSLA": "TSLAUSDT",
            "NVDA": "NVDAUSDT"
        }
        
        # 初始化日志文件
        self._init_log_file()
        
        # 预加载合约信息
        self._load_contracts_cache()
    
    def _load_contracts_cache(self):
        """加载合约信息缓存"""
        try:
            # 尝试从文件加载缓存
            if os.path.exists(self.contracts_cache_file):
                with open(self.contracts_cache_file, 'r', encoding='utf-8') as f:
                    cache_data = json.load(f)
                    # 检查缓存是否过期（24小时）
                    cache_time = cache_data.get('cached_at', 0)
                    if time.time() - cache_time < 24 * 3600:
                        self.contracts_cache = cache_data.get('contracts', {})
                        self.contracts_loaded = True
                        print(f"📦 已加载 {len(self.contracts_cache)} 个合约缓存")
                        return
            
            # 缓存不存在或已过期，从API获取
            print("🔄 正在获取最新合约信息...")
            self._refresh_contracts_cache()
            
        except Exception as e:
            print(f"⚠️ 加载合约缓存失败: {str(e)}")
            # 使用备用方案
            self.contracts_cache = {}
            self.contracts_loaded = False
    
    def _refresh_contracts_cache(self):
        """刷新合约信息缓存"""
        try:
            # 获取USDT永续合约
            url = f"{self.base_url}/api/v2/mix/market/contracts?productType=USDT-FUTURES"
            response = requests.get(url, timeout=10)
            
            if response.status_code == 200:
                data = response.json()
                if data.get('code') == '00000':
                    contracts = data.get('data', [])
                    
                    # 处理合约数据
                    self.contracts_cache = {}
                    for contract in contracts:
                        symbol = contract.get('symbol', '')
                        if symbol:
                            # 存储完整的合约信息
                            self.contracts_cache[symbol] = {
                                'symbol': symbol,
                                'baseCoin': contract.get('baseCoin', ''),
                                'quoteCoin': contract.get('quoteCoin', ''),
                                'minTradeNum': contract.get('minTradeNum', '0'),
                                'priceEndStep': contract.get('priceEndStep', '0'),
                                'volumePlace': contract.get('volumePlace', 0),
                                'pricePlace': contract.get('pricePlace', 0),
                                'sizeMultiplier': contract.get('sizeMultiplier', '1'),
                                'minTradeUSDT': contract.get('minTradeUSDT', '0'),
                                'maxTradeUSDT': contract.get('maxTradeUSDT', '0'),
                                'openCostUpRate': contract.get('openCostUpRate', '0'),
                                'supportMarginCoins': contract.get('supportMarginCoins', []),
                                'offTime': contract.get('offTime', ''),
                                'limitOpenTime': contract.get('limitOpenTime', ''),
                                'deliveryTime': contract.get('deliveryTime', ''),
                                'deliveryStartTime': contract.get('deliveryStartTime', ''),
                                'launchTime': contract.get('launchTime', ''),
                                'fundingTime': contract.get('fundingTime', ''),
                                'minLever': contract.get('minLever', '1'),
                                'maxLever': contract.get('maxLever', '125'),
                                'posLimit': contract.get('posLimit', '0'),
                                'maintainTime': contract.get('maintainTime', '')
                            }
                    
                    # 保存到文件
                    cache_data = {
                        'cached_at': time.time(),
                        'contracts': self.contracts_cache
                    }
                    
                    with open(self.contracts_cache_file, 'w', encoding='utf-8') as f:
                        json.dump(cache_data, f, indent=2, ensure_ascii=False)
                    
                    self.contracts_loaded = True
                    print(f"✅ 已缓存 {len(self.contracts_cache)} 个合约信息")
                else:
                    raise Exception(f"API错误: {data.get('msg', '未知错误')}")
            else:
                raise Exception(f"HTTP错误: {response.status_code}")
                
        except Exception as e:
            print(f"❌ 刷新合约缓存失败: {str(e)}")
            self.contracts_loaded = False
    
    def search_contracts(self, query: str, limit: int = 20) -> list:
        """
        搜索合约交易对
        
        Args:
            query: 搜索关键字
            limit: 返回结果数量限制
            
        Returns:
            匹配的合约列表
        """
        if not self.contracts_loaded:
            self._refresh_contracts_cache()
        
        if not self.contracts_cache:
            return []
        
        query = query.upper().strip()
        matches = []
        
        for symbol, contract in self.contracts_cache.items():
            # 搜索逻辑：symbol、baseCoin、quoteCoin 中包含查询词
            symbol_upper = symbol.upper()
            base_coin = contract.get('baseCoin', '').upper()
            quote_coin = contract.get('quoteCoin', '').upper()
            
            if (query in symbol_upper or 
                query in base_coin or 
                query in quote_coin):
                
                matches.append({
                    'symbol': symbol,
                    'baseCoin': contract.get('baseCoin', ''),
                    'quoteCoin': contract.get('quoteCoin', ''),
                    'displayName': f"{contract.get('baseCoin', '')}/{contract.get('quoteCoin', '')} 永续 ({symbol})",
                    'minTradeNum': contract.get('minTradeNum', '0'),
                    'pricePlace': contract.get('pricePlace', 0),
                    'volumePlace': contract.get('volumePlace', 0),
                    'minTradeUSDT': contract.get('minTradeUSDT', '0'),
                    'maxLever': contract.get('maxLever', '125'),
                    'contractInfo': contract  # 完整合约信息
                })
        
        # 按相关性排序（完全匹配优先）
        def sort_key(item):
            symbol = item['symbol'].upper()
            base_coin = item['baseCoin'].upper()
            
            if symbol == query:
                return 0  # 完全匹配symbol
            elif base_coin == query:
                return 1  # 完全匹配baseCoin
            elif symbol.startswith(query):
                return 2  # symbol开头匹配
            elif base_coin.startswith(query):
                return 3  # baseCoin开头匹配
            else:
                return 4  # 其他包含匹配
        
        matches.sort(key=sort_key)
        return matches[:limit]
    
    def get_contract_info(self, symbol: str) -> Optional[Dict[str, Any]]:
        """
        获取指定交易对的合约信息
        
        Args:
            symbol: 交易对符号
            
        Returns:
            合约信息字典，如果不存在返回None
        """
        if not self.contracts_loaded:
            self._refresh_contracts_cache()
        
        return self.contracts_cache.get(symbol)
    
    def _init_log_file(self):
        """初始化交易日志文件"""
        if not os.path.exists(self.log_file):
            initial_log = {
                "trading_records": [],
                "created_at": datetime.now().isoformat(),
                "last_updated": datetime.now().isoformat()
            }
            with open(self.log_file, 'w', encoding='utf-8') as f:
                json.dump(initial_log, f, indent=2, ensure_ascii=False)
    
    def _log_trade(self, trade_info: Dict[str, Any]):
        """记录交易日志"""
        try:
            with open(self.log_file, 'r', encoding='utf-8') as f:
                log_data = json.load(f)
            
            # 添加交易记录
            trade_record = {
                "timestamp": datetime.now().isoformat(),
                "trade_id": f"trade_{int(time.time())}",
                **trade_info
            }
            
            log_data["trading_records"].append(trade_record)
            log_data["last_updated"] = datetime.now().isoformat()
            
            # 保存日志
            with open(self.log_file, 'w', encoding='utf-8') as f:
                json.dump(log_data, f, indent=2, ensure_ascii=False)
                
            print(f"📝 交易日志已记录: {trade_record['trade_id']}")
            
        except Exception as e:
            print(f"❌ 记录交易日志失败: {str(e)}")
    
    def auto_trade_based_on_portfolio_change(self, assets_file: str = "assets.json"):
        """
        基于投资组合变化自动交易
        
        Args:
            assets_file: 资产文件路径
        """
        try:
            # 读取当前资产文件
            with open(assets_file, 'r', encoding='utf-8') as f:
                current_assets = json.load(f)
            
            # 读取历史资产文件（如果存在）
            history_file = "assets_history.json"
            if os.path.exists(history_file):
                with open(history_file, 'r', encoding='utf-8') as f:
                    history_assets = json.load(f)
            else:
                # 如果没有历史文件，创建当前快照
                history_assets = current_assets.copy()
                with open(history_file, 'w', encoding='utf-8') as f:
                    json.dump(history_assets, f, indent=2, ensure_ascii=False)
                print("📁 创建历史资产快照")
                return
            
            # 分析变化并执行交易
            crypto_changes = self._analyze_portfolio_changes(
                history_assets.get('crypto', []),
                current_assets.get('crypto', [])
            )
            
            if crypto_changes:
                print(f"🔄 检测到 {len(crypto_changes)} 个币种数量变化")
                self._execute_portfolio_trades(crypto_changes)
                
                # 更新历史文件
                with open(history_file, 'w', encoding='utf-8') as f:
                    json.dump(current_assets, f, indent=2, ensure_ascii=False)
                print("✅ 历史资产文件已更新")
            else:
                print("✅ 没有检测到数量变化")
                
        except Exception as e:
            print(f"❌ 自动交易失败: {str(e)}")
    
    def _analyze_portfolio_changes(self, history_crypto: list, current_crypto: list) -> list:
        """分析投资组合变化"""
        changes = []
        
        # 创建历史数据的索引
        history_dict = {item['name'].upper(): item for item in history_crypto}
        current_dict = {item['name'].upper(): item for item in current_crypto}
        
        # 检查所有币种的变化
        all_coins = set(history_dict.keys()) | set(current_dict.keys())
        
        for coin in all_coins:
            history_qty = history_dict.get(coin, {}).get('quantity', 0)
            current_qty = current_dict.get(coin, {}).get('quantity', 0)
            
            if abs(current_qty - history_qty) > 0.000001:  # 考虑浮点精度
                change = current_qty - history_qty
                changes.append({
                    'coin': coin,
                    'old_quantity': history_qty,
                    'new_quantity': current_qty,
                    'change': change,
                    'action': 'buy' if change > 0 else 'sell',
                    'size': abs(change)
                })
        
        return changes
    
    def _execute_portfolio_trades(self, changes: list):
        """执行投资组合交易"""
        for change in changes:
            coin = change['coin']
            action = change['action']
            size = change['size']
            
            print(f"\n🔄 执行交易: {action.upper()} {size} {coin}")
            
            try:
                if action == 'buy':
                    result = self.place_market_order(coin, 'buy', str(size))
                else:  # sell
                    result = self.place_market_order(coin, 'sell', str(size))
                
                # 记录交易日志
                trade_info = {
                    "coin": coin,
                    "action": action,
                    "size": size,
                    "old_quantity": change['old_quantity'],
                    "new_quantity": change['new_quantity'],
                    "api_response": result,
                    "status": "success" if result['status_code'] == 200 else "failed"
                }
                
                self._log_trade(trade_info)
                
                if result['status_code'] == 200:
                    print(f"✅ {action.upper()} {size} {coin} 成功")
                else:
                    print(f"❌ {action.upper()} {size} {coin} 失败")
                    
            except Exception as e:
                print(f"❌ 交易执行失败: {str(e)}")
                
                # 记录失败日志
                trade_info = {
                    "coin": coin,
                    "action": action,
                    "size": size,
                    "old_quantity": change['old_quantity'],
                    "new_quantity": change['new_quantity'],
                    "error": str(e),
                    "status": "failed"
                }
                
                self._log_trade(trade_info)
    
    def get_trading_log(self, limit: int = 50) -> Dict[str, Any]:
        """获取交易日志"""
        try:
            with open(self.log_file, 'r', encoding='utf-8') as f:
                log_data = json.load(f)
            
            # 限制返回的记录数量
            recent_records = log_data['trading_records'][-limit:] if limit > 0 else log_data['trading_records']
            
            return {
                "total_records": len(log_data['trading_records']),
                "recent_records": recent_records,
                "last_updated": log_data.get('last_updated', '')
            }
            
        except Exception as e:
            return {
                "error": f"读取交易日志失败: {str(e)}"
            }
    
    def clear_trading_log(self):
        """清空交易日志"""
        try:
            initial_log = {
                "trading_records": [],
                "created_at": datetime.now().isoformat(),
                "last_updated": datetime.now().isoformat()
            }
            
            with open(self.log_file, 'w', encoding='utf-8') as f:
                json.dump(initial_log, f, indent=2, ensure_ascii=False)
            
            print("🗑️ 交易日志已清空")
            
        except Exception as e:
            print(f"❌ 清空交易日志失败: {str(e)}")
    
    def _generate_signature(self, timestamp: str, method: str, 
                          request_path: str, body: str) -> str:
        """生成API签名"""
        message = timestamp + method + request_path + body
        mac = hmac.new(
            bytes(self.secret_key, encoding='utf8'),
            bytes(message, encoding='utf-8'),
            digestmod='sha256'
        )
        return base64.b64encode(mac.digest()).decode()
    
    def _make_request(self, method: str, endpoint: str, data: Dict[str, Any]) -> Dict[str, Any]:
        """发送API请求"""
        timestamp = str(int(time.time() * 1000))
        body = json.dumps(data, separators=(',', ':'))
        signature = self._generate_signature(timestamp, method, endpoint, body)
        
        headers = {
            "ACCESS-KEY": self.api_key,
            "ACCESS-SIGN": signature,
            "ACCESS-PASSPHRASE": self.passphrase,
            "ACCESS-TIMESTAMP": timestamp,
            "locale": "zh-CN",
            "Content-Type": "application/json"
        }
        
        url = self.base_url + endpoint
        response = requests.post(url, headers=headers, data=body)
        
        return {
            "status_code": response.status_code,
            "response": response.json() if response.text else {}
        }
    
    def _get_symbol(self, coin: str) -> str:
        """
        获取交易对符号 - 新版本支持完整合约信息
        
        Args:
            coin: 币种符号或完整交易对
            
        Returns:
            有效的交易对符号
        """
        coin_upper = coin.upper().strip()
        
        # 1. 直接检查是否为有效的合约符号
        if self.contracts_loaded and coin_upper in self.contracts_cache:
            return coin_upper
        
        # 2. 检查向后兼容的映射
        if coin_upper in self.legacy_symbols:
            return self.legacy_symbols[coin_upper]
        
        # 3. 如果以USDT结尾，直接检查是否为有效的永续合约
        if coin_upper.endswith("USDT"):
            if self.contracts_loaded and coin_upper in self.contracts_cache:
                return coin_upper
            # 如果不是完整符号，但以USDT结尾，可能是现货，直接返回
            return coin_upper
        
        # 4. 尝试搜索合约
        if self.contracts_loaded:
            matches = self.search_contracts(coin_upper, limit=1)
            if matches:
                return matches[0]['symbol']
        
        # 5. 最后尝试构造USDT永续合约符号
        constructed_symbol = f"{coin_upper}USDT"
        if self.contracts_loaded and constructed_symbol in self.contracts_cache:
            return constructed_symbol
        
        # 如果都没有找到，抛出错误
        raise ValueError(f"未找到币种: {coin}. 请使用完整的交易对符号（如BTCUSDT）或确保合约信息已加载")
    
    def place_market_order(self, coin: str, side: str, size: str, 
                          margin_mode: str = "isolated", leverage: str = "1") -> Dict[str, Any]:
        """
        下市价单
        
        Args:
            coin: 币种 (如 BTC, ETH 或 BTCUSDT)
            side: 方向 (buy/sell)
            size: 数量
            margin_mode: 保证金模式 (crossed/isolated)
            leverage: 杠杆倍数 (1-125)
        """
        symbol = self._get_symbol(coin)
        product_type = "SUSDT-FUTURES" if self.sandbox else "USDT-FUTURES"
        
        order_data = {
            "symbol": symbol,
            "productType": product_type,
            "marginMode": margin_mode,
            "marginCoin": "USDT",
            "size": str(size),
            "side": side,
            "orderType": "market",
            "clientOid": f"market_{int(time.time() * 1000)}_{random.randint(1000, 9999)}"
        }
        
        # 设置保证金模式和杠杆倍数
        if margin_mode == "isolated":
            print(f"🔄 设置 {symbol} 为逐仓模式...")
            self._set_margin_mode(symbol, margin_mode)
            
        if leverage != "1":
            print(f"🔄 设置 {symbol} 杠杆为 {leverage}x...")
            self._set_leverage(symbol, margin_mode, leverage)
        
        return self._make_request("POST", "/api/v2/mix/order/place-order", order_data)
    
    def place_market_order_with_contract_info(self, symbol: str, side: str, size: str, 
                                            contract_info: Optional[Dict[str, Any]] = None,
                                            margin_mode: str = "isolated", leverage: str = "1") -> Dict[str, Any]:
        """
        使用合约信息下市价单（推荐使用此方法）
        
        Args:
            symbol: 完整的交易对符号 (如 BTCUSDT_UMCBL)
            side: 方向 (buy/sell)
            size: 数量
            contract_info: 合约信息（如果提供则不需要查询）
            margin_mode: 保证金模式 (crossed/isolated)
            leverage: 杠杆倍数 (1-125)
        """
        product_type = "SUSDT-FUTURES" if self.sandbox else "USDT-FUTURES"
        
        # 获取合约信息
        if contract_info is None:
            contract_info = self.get_contract_info(symbol)
            if not contract_info:
                raise ValueError(f"未找到交易对 {symbol} 的合约信息")
        
        # 验证数量精度
        volume_place = int(contract_info.get('volumePlace', 0))
        min_trade_num = float(contract_info.get('minTradeNum', '0'))
        
        try:
            size_float = float(size)
            if size_float < min_trade_num:
                raise ValueError(f"数量 {size} 小于最小交易数量 {min_trade_num}")
            
            # 调整精度
            if volume_place > 0:
                size = f"{size_float:.{volume_place}f}"
            else:
                size = str(int(size_float) if size_float == int(size_float) else size_float)
                
        except ValueError as e:
            raise ValueError(f"无效的数量格式: {size}")
        
        order_data = {
            "symbol": symbol,
            "productType": product_type,
            "marginMode": margin_mode,
            "marginCoin": "USDT",
            "size": size,
            "side": side,
            "orderType": "market",
            "clientOid": f"market_{int(time.time() * 1000)}_{random.randint(1000, 9999)}"
        }
        
        # 设置保证金模式和杠杆倍数
        if margin_mode == "isolated":
            print(f"🔄 设置 {symbol} 为逐仓模式...")
            self._set_margin_mode(symbol, margin_mode)
            
        if leverage != "1":
            print(f"🔄 设置 {symbol} 杠杆为 {leverage}x...")
            self._set_leverage(symbol, margin_mode, leverage)
        
        print(f"📊 合约信息: {contract_info.get('baseCoin', '')}/{contract_info.get('quoteCoin', '')} - 最小数量: {min_trade_num}")
        
        return self._make_request("POST", "/api/v2/mix/order/place-order", order_data)
    
    def _set_leverage(self, symbol: str, margin_mode: str, leverage: str) -> Dict[str, Any]:
        """设置杠杆倍数"""
        product_type = "SUSDT-FUTURES" if self.sandbox else "USDT-FUTURES"
        
        leverage_data = {
            "symbol": symbol,
            "productType": product_type,
            "marginMode": margin_mode,
            "leverage": str(leverage)
        }
        
        return self._make_request("POST", "/api/v2/mix/account/set-leverage", leverage_data)
    
    def _set_margin_mode(self, symbol: str, margin_mode: str) -> Dict[str, Any]:
        """设置保证金模式"""
        product_type = "SUSDT-FUTURES" if self.sandbox else "USDT-FUTURES"
        
        margin_data = {
            "symbol": symbol,
            "productType": product_type,
            "marginMode": margin_mode
        }
        
        return self._make_request("POST", "/api/v2/mix/account/set-margin-mode", margin_data)
    
    def place_limit_order(self, coin: str, side: str, size: str, price: str,
                         margin_mode: str = "isolated", 
                         force: str = "gtc") -> Dict[str, Any]:
        """
        下限价单
        
        Args:
            coin: 币种 (如 BTC, ETH 或 BTCUSDT)
            side: 方向 (buy/sell)
            size: 数量
            price: 价格
            margin_mode: 保证金模式 (crossed/isolated)
            force: 订单有效期 (gtc/ioc/fok/post_only)
        """
        symbol = self._get_symbol(coin)
        product_type = "SUSDT-FUTURES" if self.sandbox else "USDT-FUTURES"
        
        order_data = {
            "symbol": symbol,
            "productType": product_type,
            "marginMode": margin_mode,
            "marginCoin": "USDT",
            "size": str(size),
            "price": str(price),
            "side": side,
            "tradeSide": "open",
            "orderType": "limit",
            "force": force,
            "clientOid": f"limit_{int(time.time() * 1000)}_{random.randint(1000, 9999)}"
        }
        
        return self._make_request("POST", "/api/v2/mix/order/place-order", order_data)
    
    def close_position(self, coin: str, side: str, size: str,
                      order_type: str = "market", price: Optional[str] = None) -> Dict[str, Any]:
        """
        平仓
        
        Args:
            coin: 币种
            side: 平仓方向 (buy/sell) 
            size: 平仓数量
            order_type: 订单类型 (market/limit)
            price: 限价单价格(仅限价单需要)
        """
        symbol = self._get_symbol(coin)
        product_type = "SUSDT-FUTURES" if self.sandbox else "USDT-FUTURES"
        
        order_data = {
            "symbol": symbol,
            "productType": product_type,
            "marginMode": "isolated",
            "marginCoin": "USDT",
            "size": str(size),
            "side": side,
            "tradeSide": "close",  # 平仓
            "orderType": order_type,
            "clientOid": f"close_{int(time.time() * 1000)}_{random.randint(1000, 9999)}"
        }
        
        if order_type == "limit" and price:
            order_data["price"] = str(price)
            order_data["force"] = "gtc"
        
        return self._make_request("POST", "/api/v2/mix/order/place-order", order_data)
    
    def get_ticker_price(self, coin: str) -> Dict[str, Any]:
        """
        获取币种最新价格
        
        Args:
            coin: 币种 (如 BTC, ETH 或 BTCUSDT)
            
        Returns:
            包含价格信息的字典
        """
        try:
            symbol = self._get_symbol(coin)
        except ValueError:
            # 如果符号解析失败，直接使用原始输入
            symbol = coin.upper().strip()
        
        # 优先尝试期货市场API（因为我们主要处理永续合约）
        futures_url = f"{self.base_url}/api/v2/mix/market/ticker?symbol={symbol}&productType=USDT-FUTURES"
        
        try:
            response = requests.get(futures_url, timeout=10)
            if response.status_code == 200:
                data = response.json()
                if data.get('code') == '00000':
                    ticker_data = data.get('data', [])
                    if ticker_data:
                        ticker = ticker_data[0] if isinstance(ticker_data, list) else ticker_data
                        return {
                            "success": True,
                            "symbol": symbol,
                            "price": float(ticker.get('lastPr', 0)),
                            "price_change_24h": float(ticker.get('chgUTC', 0)),
                            "price_change_percent_24h": float(ticker.get('chgUtcRate', 0)) * 100,
                            "volume_24h": float(ticker.get('baseVolume', 0)),
                            "timestamp": ticker.get('ts', ''),
                            "market_type": "futures"
                        }
                else:
                    return {
                        "success": False,
                        "error": data.get('msg', '期货API错误'),
                        "code": data.get('code', '')
                    }
            else:
                return {
                    "success": False,
                    "error": f"HTTP错误: {response.status_code}"
                }
            
        except Exception as e:
            return {
                "success": False,
                "error": f"网络请求失败: {str(e)}"
            }
    
    def get_multiple_prices(self, coins: list) -> Dict[str, Dict[str, Any]]:
        """
        批量获取多个币种的最新价格
        
        Args:
            coins: 币种列表 (如 ['BTC', 'ETH', 'SOL'])
            
        Returns:
            包含所有币种价格信息的字典
        """
        prices = {}
        for coin in coins:
            price_info = self.get_ticker_price(coin)
            prices[coin.upper()] = price_info
        
        return prices


def main():
    """命令行接口"""
    parser = argparse.ArgumentParser(description="Bitget 交易API命令行工具")
    parser.add_argument("--api-key", required=True, help="API密钥")
    parser.add_argument("--secret-key", required=True, help="API私钥")
    parser.add_argument("--passphrase", required=True, help="API密码短语")
    parser.add_argument("--sandbox", action="store_true", help="使用测试环境")
    
    subparsers = parser.add_subparsers(dest="command", help="操作命令")
    
    # 市价单命令
    market_parser = subparsers.add_parser("market", help="下市价单")
    market_parser.add_argument("coin", help="币种 (如 BTC, ETH)")
    market_parser.add_argument("side", choices=["buy", "sell"], help="方向")
    market_parser.add_argument("size", help="数量")
    market_parser.add_argument("--margin-mode", default="crossed", 
                              choices=["crossed", "isolated"], help="保证金模式")
    
    # 限价单命令
    limit_parser = subparsers.add_parser("limit", help="下限价单")
    limit_parser.add_argument("coin", help="币种 (如 BTC, ETH)")
    limit_parser.add_argument("side", choices=["buy", "sell"], help="方向")
    limit_parser.add_argument("size", help="数量")
    limit_parser.add_argument("price", help="价格")
    limit_parser.add_argument("--margin-mode", default="crossed",
                             choices=["crossed", "isolated"], help="保证金模式")
    limit_parser.add_argument("--force", default="gtc",
                             choices=["gtc", "ioc", "fok", "post_only"], help="订单有效期")
    
    # 平仓命令
    close_parser = subparsers.add_parser("close", help="平仓")
    close_parser.add_argument("coin", help="币种")
    close_parser.add_argument("side", choices=["buy", "sell"], help="平仓方向")
    close_parser.add_argument("size", help="平仓数量")
    close_parser.add_argument("--type", default="market", 
                             choices=["market", "limit"], help="订单类型")
    close_parser.add_argument("--price", help="限价单价格")
    
    # 价格查询命令
    price_parser = subparsers.add_parser("price", help="查询币种价格")
    price_parser.add_argument("coins", nargs="+", help="币种列表 (如 BTC ETH SOL)")
    
    # 更新投资组合命令
    portfolio_parser = subparsers.add_parser("portfolio", help="更新投资组合分析")
    portfolio_parser.add_argument("--file", default="portfolio_analysis.json", 
                                 help="投资组合文件路径")
    
    # 自动交易命令
    auto_trade_parser = subparsers.add_parser("auto-trade", help="基于资产变化自动交易")
    auto_trade_parser.add_argument("--assets-file", default="assets.json", 
                                  help="资产文件路径")
    
    # 交易日志命令
    log_parser = subparsers.add_parser("log", help="交易日志管理")
    log_parser.add_argument("--limit", type=int, default=50, 
                           help="显示最近的记录数量")
    log_parser.add_argument("--clear", action="store_true", 
                           help="清空交易日志")
    
    # 合约搜索命令
    search_parser = subparsers.add_parser("search", help="搜索合约交易对")
    search_parser.add_argument("query", help="搜索关键字 (如 BTC, ETH, TSLA)")
    search_parser.add_argument("--limit", type=int, default=10, 
                              help="返回结果数量限制")
    
    # 合约信息命令
    info_parser = subparsers.add_parser("info", help="查看合约详细信息")
    info_parser.add_argument("symbol", help="合约符号 (如 BTCUSDT_UMCBL)")
    
    # 刷新缓存命令
    refresh_parser = subparsers.add_parser("refresh-cache", help="刷新合约信息缓存")
    
    args = parser.parse_args()
    
    if not args.command:
        parser.print_help()
        return
    
    # 创建API客户端
    api = BitgetAPI(args.api_key, args.secret_key, args.passphrase, args.sandbox)
    
    try:
        if args.command == "market":
            result = api.place_market_order(args.coin, args.side, args.size, args.margin_mode)
            handle_order_result(result)
            
        elif args.command == "limit":
            result = api.place_limit_order(args.coin, args.side, args.size, args.price,
                                         args.margin_mode, args.force)
            handle_order_result(result)
            
        elif args.command == "close":
            result = api.close_position(args.coin, args.side, args.size, args.type, args.price)
            handle_order_result(result)
            
        elif args.command == "price":
            handle_price_query(api, args.coins)
            
        elif args.command == "portfolio":
            handle_portfolio_update(api, args.file)
            
        elif args.command == "auto-trade":
            handle_auto_trade(api, args.assets_file)
            
        elif args.command == "log":
            handle_trading_log(api, args.limit, args.clear)
            
        elif args.command == "search":
            handle_contract_search(api, args.query, args.limit)
            
        elif args.command == "info":
            handle_contract_info(api, args.symbol)
            
        elif args.command == "refresh-cache":
            handle_refresh_cache(api)
        
    except Exception as e:
        print(f"❌ 发生错误: {str(e)}")


def handle_order_result(result):
    """处理订单结果"""
    print(f"状态码: {result['status_code']}")
    response = result['response']
    
    if result['status_code'] == 200 and response.get('code') == '00000':
        print("✅ 订单提交成功!")
        data = response.get('data', {})
        if 'orderId' in data:
            print(f"订单ID: {data['orderId']}")
        if 'clientOid' in data:
            print(f"客户端ID: {data['clientOid']}")
    else:
        print("❌ 订单失败!")
        print(f"错误信息: {response.get('msg', '未知错误')}")
        if 'code' in response:
            print(f"错误代码: {response['code']}")
    
    print(f"完整响应: {json.dumps(response, indent=2, ensure_ascii=False)}")


def handle_price_query(api, coins):
    """处理价格查询"""
    print("📊 正在查询最新价格...")
    
    prices = api.get_multiple_prices(coins)
    
    print("\n=== 最新价格信息 ===")
    for coin, info in prices.items():
        if info.get('success'):
            price = info['price']
            change_24h = info['price_change_percent_24h']
            change_symbol = "📈" if change_24h >= 0 else "📉"
            
            print(f"{coin:>6}: ${price:>10,.2f} {change_symbol} {change_24h:>6.2f}%")
        else:
            print(f"{coin:>6}: ❌ {info.get('error', '获取失败')}")


def handle_portfolio_update(api, file_path):
    """处理投资组合更新"""
    print("🔄 正在更新投资组合分析...")
    
    try:
        # 读取当前投资组合
        with open(file_path, 'r', encoding='utf-8') as f:
            portfolio = json.load(f)
        
        holdings = portfolio['portfolio_analysis']['holdings']
        coins = list(holdings.keys())
        
        # 获取最新价格
        print(f"正在获取 {', '.join(coins)} 的最新价格...")
        prices = api.get_multiple_prices(coins)
        
        # 更新价格和计算
        total_value = 0
        updated_holdings = {}
        
        for coin in coins:
            if coin == "USDT":
                # USDT价格固定为1
                price = 1.0
                success = True
            else:
                price_info = prices.get(coin, {})
                success = price_info.get('success', False)
                price = price_info.get('price', 0) if success else 0
            
            if success and price > 0:
                quantity = holdings[coin]['quantity']
                market_value = quantity * price
                total_value += market_value
                
                updated_holdings[coin] = {
                    "quantity": quantity,
                    "current_price_usd": price,
                    "market_value_usd": round(market_value, 2)
                }
                
                print(f"✅ {coin}: ${price:,.2f} (持仓: {quantity} 价值: ${market_value:,.2f})")
            else:
                print(f"❌ {coin}: 获取价格失败")
                return
        
        # 计算占比
        for coin in updated_holdings:
            percentage = (updated_holdings[coin]['market_value_usd'] / total_value) * 100
            updated_holdings[coin]['percentage_of_portfolio'] = round(percentage, 2)
        
        # 更新JSON文件
        portfolio['portfolio_analysis']['current_market_prices'] = {
            coin: updated_holdings[coin]['current_price_usd'] for coin in updated_holdings
        }
        portfolio['portfolio_analysis']['holdings'] = updated_holdings
        portfolio['portfolio_analysis']['analysis_date'] = time.strftime('%Y-%m-%d')
        
        # 保存文件
        with open(file_path, 'w', encoding='utf-8') as f:
            json.dump(portfolio, f, indent=2, ensure_ascii=False)
        
        print(f"\n✅ 投资组合已更新!")
        print(f"📊 总资产价值: ${total_value:,.2f}")
        print(f"📝 文件已保存到: {file_path}")
        
        # 显示资产分配
        print("\n=== 最新资产分配 ===")
        sorted_holdings = sorted(updated_holdings.items(), 
                               key=lambda x: x[1]['market_value_usd'], reverse=True)
        
        for coin, info in sorted_holdings:
            print(f"{coin:>6}: ${info['market_value_usd']:>10,.2f} ({info['percentage_of_portfolio']:>5.2f}%)")
        
    except FileNotFoundError:
        print(f"❌ 文件不存在: {file_path}")
    except json.JSONDecodeError:
        print(f"❌ JSON文件格式错误: {file_path}")
    except Exception as e:
        print(f"❌ 更新失败: {str(e)}")


def handle_auto_trade(api, assets_file):
    """处理自动交易"""
    print("🤖 启动自动交易系统...")
    print(f"📁 监控资产文件: {assets_file}")
    
    try:
        api.auto_trade_based_on_portfolio_change(assets_file)
        print("✅ 自动交易完成")
        
    except Exception as e:
        print(f"❌ 自动交易失败: {str(e)}")


def handle_trading_log(api, limit, clear):
    """处理交易日志"""
    if clear:
        api.clear_trading_log()
        return
    
    print("📊 交易日志:")
    log_data = api.get_trading_log(limit)
    
    if 'error' in log_data:
        print(f"❌ {log_data['error']}")
        return
    
    print(f"📈 总交易记录: {log_data['total_records']}")
    print(f"🕒 最后更新: {log_data['last_updated']}")
    
    if log_data['recent_records']:
        print(f"\n=== 最近 {len(log_data['recent_records'])} 条记录 ===")
        for record in reversed(log_data['recent_records']):
            status_emoji = "✅" if record['status'] == 'success' else "❌"
            print(f"{status_emoji} {record['timestamp']} | {record['action'].upper()} {record['size']} {record['coin']} | {record['status']}")
    else:
        print("📝 暂无交易记录")


def handle_contract_search(api, query, limit):
    """处理合约搜索"""
    print(f"🔍 搜索合约: {query}")
    
    try:
        results = api.search_contracts(query, limit)
        
        if not results:
            print("❌ 未找到匹配的合约")
            return
        
        print(f"\n=== 找到 {len(results)} 个匹配的合约 ===")
        for i, contract in enumerate(results, 1):
            symbol = contract['symbol']
            display_name = contract['displayName']
            min_trade = contract['minTradeNum']
            max_lever = contract['maxLever']
            
            print(f"{i:>2}. {display_name}")
            print(f"     交易对: {symbol}")
            print(f"     最小数量: {min_trade} | 最大杠杆: {max_lever}x")
            print()
            
    except Exception as e:
        print(f"❌ 搜索失败: {str(e)}")


def handle_contract_info(api, symbol):
    """处理合约信息查询"""
    print(f"📊 查询合约信息: {symbol}")
    
    try:
        info = api.get_contract_info(symbol)
        
        if not info:
            print(f"❌ 未找到合约: {symbol}")
            return
        
        print(f"\n=== {symbol} 合约详情 ===")
        print(f"基础币种: {info.get('baseCoin', 'N/A')}")
        print(f"计价币种: {info.get('quoteCoin', 'N/A')}")
        print(f"最小交易数量: {info.get('minTradeNum', 'N/A')}")
        print(f"数量精度: {info.get('volumePlace', 'N/A')} 位小数")
        print(f"价格精度: {info.get('pricePlace', 'N/A')} 位小数")
        print(f"最小杠杆: {info.get('minLever', 'N/A')}x")
        print(f"最大杠杆: {info.get('maxLever', 'N/A')}x")
        print(f"最小交易金额(USDT): {info.get('minTradeUSDT', 'N/A')}")
        print(f"最大交易金额(USDT): {info.get('maxTradeUSDT', 'N/A')}")
        print(f"支持保证金币种: {', '.join(info.get('supportMarginCoins', []))}")
        
        if info.get('launchTime'):
            print(f"上线时间: {info.get('launchTime', 'N/A')}")
        if info.get('fundingTime'):
            print(f"资金费用时间: {info.get('fundingTime', 'N/A')}")
            
    except Exception as e:
        print(f"❌ 查询失败: {str(e)}")


def handle_refresh_cache(api):
    """处理缓存刷新"""
    print("🔄 刷新合约信息缓存...")
    
    try:
        api._refresh_contracts_cache()
        print("✅ 缓存刷新完成")
        
    except Exception as e:
        print(f"❌ 刷新失败: {str(e)}")


if __name__ == "__main__":
    main() 