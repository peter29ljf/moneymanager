#!/usr/bin/env node

/**
 * 测试策略对比功能
 * 验证自动平衡策略与持仓不动策略的盈利对比
 */

const http = require('http');

const BASE_URL = 'http://localhost:3000';
const GROUP_ID = 'g_1757478549758';

// 发送HTTP请求的辅助函数
function makeRequest(method, path, data = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 3000,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try {
          resolve({
            statusCode: res.statusCode,
            data: JSON.parse(body)
          });
        } catch (e) {
          resolve({
            statusCode: res.statusCode,
            data: body
          });
        }
      });
    });

    req.on('error', reject);

    if (data) {
      req.write(JSON.stringify(data));
    }
    req.end();
  });
}

function formatNumber(num, decimals = 2) {
  return parseFloat(num).toFixed(decimals);
}

function formatPercent(num, decimals = 2) {
  return parseFloat(num).toFixed(decimals) + '%';
}

function formatCurrency(num, decimals = 2) {
  return '$' + parseFloat(num).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

async function testStrategyComparison() {
  console.log('📊 测试策略对比功能...\n');

  try {
    // 1. 获取基础统计信息
    console.log('1. 获取基础统计信息...');
    const statsResponse = await makeRequest('GET', `/api/groups/${GROUP_ID}/stats`);
    if (statsResponse.statusCode !== 200) {
      throw new Error('获取基础统计失败');
    }

    const stats = statsResponse.data;
    console.log(`   策略开始时间: ${stats.baselineAt}`);
    console.log(`   初始总价值: ${formatCurrency(stats.totalStart)}`);
    console.log(`   运行天数: ${stats.strategyComparison.daysSinceStart} 天\n`);

    // 2. 获取详细策略对比
    console.log('2. 获取详细策略对比...');
    const comparisonResponse = await makeRequest('GET', `/api/groups/${GROUP_ID}/strategy-comparison`);
    if (comparisonResponse.statusCode !== 200) {
      throw new Error('获取策略对比失败');
    }

    const comparison = comparisonResponse.data;
    
    // 3. 显示持仓不动策略结果
    console.log('3. 持仓不动策略结果:');
    const buyAndHold = comparison.buyAndHoldStrategy;
    console.log(`   当前总价值: ${formatCurrency(buyAndHold.totalNow)}`);
    console.log(`   总收益: ${formatCurrency(buyAndHold.deltaTotal)} (${formatPercent(buyAndHold.returnPercent)})`);
    console.log(`   年化收益率: ${formatPercent(buyAndHold.annualizedReturn)}`);
    console.log('   各资产表现:');
    buyAndHold.byAsset.forEach(asset => {
      const priceChange = asset.priceChangePercent > 0 ? '📈' : '📉';
      console.log(`     ${asset.symbol}: ${formatCurrency(asset.valueNow)} (${priceChange} ${formatPercent(asset.priceChangePercent)})`);
    });
    console.log('');

    // 4. 显示自动平衡策略结果
    console.log('4. 自动平衡策略结果:');
    const rebalance = comparison.rebalanceStrategy;
    console.log(`   当前总价值: ${formatCurrency(rebalance.totalNow)}`);
    console.log(`   总收益: ${formatCurrency(rebalance.deltaTotal)} (${formatPercent(rebalance.returnPercent)})`);
    console.log(`   年化收益率: ${formatPercent(rebalance.annualizedReturn)}`);
    console.log('   各资产表现:');
    rebalance.byAsset.forEach(asset => {
      const quantityChange = asset.deltaQuantity > 0 ? '+' : '';
      console.log(`     ${asset.symbol}: ${formatCurrency(asset.valueNow)} (持仓变化: ${quantityChange}${formatNumber(asset.deltaQuantity)})`);
    });
    console.log('');

    // 5. 显示策略对比
    console.log('5. 策略对比分析:');
    const comp = comparison.comparison;
    console.log(`   表现更好的策略: ${comp.betterStrategyName}`);
    console.log(`   超额收益: ${formatCurrency(comp.outperformance)} (${formatPercent(comp.outperformancePercent)})`);
    console.log(`   收益差距: ${formatCurrency(comp.performanceGap)} (${formatPercent(comp.performanceGapPercent)})`);
    console.log('');

    // 6. 显示总结和建议
    console.log('6. 总结和建议:');
    console.log(`   ${comparison.summary.message}`);
    console.log(`   建议: ${comparison.summary.recommendation}`);
    console.log('');

    // 7. 显示详细对比表格
    console.log('7. 详细对比表格:');
    console.log('┌─────────────────┬─────────────────┬─────────────────┬─────────────────┐');
    console.log('│ 资产            │ 持仓不动策略    │ 自动平衡策略    │ 差异            │');
    console.log('├─────────────────┼─────────────────┼─────────────────┼─────────────────┤');
    
    for (let i = 0; i < buyAndHold.byAsset.length; i++) {
      const buyHoldAsset = buyAndHold.byAsset[i];
      const rebalanceAsset = rebalance.byAsset[i];
      const difference = rebalanceAsset.valueNow - buyHoldAsset.valueNow;
      const diffPercent = buyHoldAsset.valueNow > 0 ? (difference / buyHoldAsset.valueNow) * 100 : 0;
      
      const symbol = buyHoldAsset.symbol.replace('_UMCBL', '');
      const buyHoldValue = formatCurrency(buyHoldAsset.valueNow);
      const rebalanceValue = formatCurrency(rebalanceAsset.valueNow);
      const diffValue = formatCurrency(difference);
      const diffPercentStr = formatPercent(diffPercent);
      
      console.log(`│ ${symbol.padEnd(15)} │ ${buyHoldValue.padEnd(15)} │ ${rebalanceValue.padEnd(15)} │ ${diffValue.padEnd(15)} │`);
    }
    
    console.log('└─────────────────┴─────────────────┴─────────────────┴─────────────────┘');
    console.log('');

    // 8. 显示关键指标对比
    console.log('8. 关键指标对比:');
    console.log('┌─────────────────┬─────────────────┬─────────────────┐');
    console.log('│ 指标            │ 持仓不动策略    │ 自动平衡策略    │');
    console.log('├─────────────────┼─────────────────┼─────────────────┤');
    console.log(`│ 总收益          │ ${formatCurrency(buyAndHold.deltaTotal).padEnd(15)} │ ${formatCurrency(rebalance.deltaTotal).padEnd(15)} │`);
    console.log(`│ 收益率          │ ${formatPercent(buyAndHold.returnPercent).padEnd(15)} │ ${formatPercent(rebalance.returnPercent).padEnd(15)} │`);
    console.log(`│ 年化收益率      │ ${formatPercent(buyAndHold.annualizedReturn).padEnd(15)} │ ${formatPercent(rebalance.annualizedReturn).padEnd(15)} │`);
    console.log(`│ 当前总价值      │ ${formatCurrency(buyAndHold.totalNow).padEnd(15)} │ ${formatCurrency(rebalance.totalNow).padEnd(15)} │`);
    console.log('└─────────────────┴─────────────────┴─────────────────┘');

    console.log('\n🎉 策略对比测试完成！');

  } catch (error) {
    console.error('❌ 测试失败:', error.message);
  }
}

// 运行测试
testStrategyComparison();
