// API配置文件
const API_CONFIG = {
    // Coinbase API (免费，无需密钥)
    COINBASE: {
        BASE_URL: 'https://api.coinbase.com/v2',
        ENDPOINTS: {
            SPOT_PRICE: '/prices/{symbol}-USD/spot'
        }
    },
    
    // Alpha Vantage API (免费版：每分钟5次请求，每天500次请求)
    ALPHA_VANTAGE: {
        BASE_URL: 'https://www.alphavantage.co/query',
        API_KEY: '', // 请在此处填入你的API密钥
        ENDPOINTS: {
            GLOBAL_QUOTE: 'GLOBAL_QUOTE',
            TIME_SERIES_DAILY: 'TIME_SERIES_DAILY'
        }
    },
    
    // Yahoo Finance API (完全免费，无需密钥，推荐使用)
    YAHOO_FINANCE: {
        BASE_URL: 'https://query1.finance.yahoo.com/v8/finance/chart',
        ENDPOINTS: {
            QUOTE: '/{symbol}?interval=1d&range=1d'
        },
        FEATURES: [
            '完全免费，无需API密钥',
            '实时股票价格数据',
            '支持全球主要股票市场',
            '数据质量高，更新及时'
        ]
    },
    
    // 其他免费股票API选项
    ALTERNATIVES: {
        // IEX Cloud (免费版：每月500,000次请求)
        IEX_CLOUD: {
            BASE_URL: 'https://cloud.iexapis.com/stable',
            API_KEY: '', // 需要注册获取免费API密钥
            ENDPOINTS: {
                QUOTE: '/stock/{symbol}/quote'
            }
        },
        
        // Finnhub (免费版：每分钟60次请求)
        FINNHUB: {
            BASE_URL: 'https://finnhub.io/api/v1',
            API_KEY: '', // 需要注册获取免费API密钥
            ENDPOINTS: {
                QUOTE: '/quote?symbol={symbol}'
            }
        }
    }
};

// 获取API配置
function getApiConfig(provider) {
    return API_CONFIG[provider] || null;
}

// 检查API密钥是否配置
function isApiKeyConfigured(provider) {
    const config = getApiConfig(provider);
    return config && config.API_KEY && config.API_KEY.trim() !== '';
}

// 导出配置
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { API_CONFIG, getApiConfig, isApiKeyConfigured };
}
