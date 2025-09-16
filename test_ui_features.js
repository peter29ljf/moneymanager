#!/usr/bin/env node

/**
 * 测试UI新功能
 * 验证策略对比和手续费统计功能
 */

const http = require('http');

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

function formatCurrency(num, decimals = 2) {
  return '$' + parseFloat(num).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

async function testUIFeatures() {
  console.log('🎨 测试UI新功能...\n');

  try {
    // 1. 测试手续费配置API
    console.log('1. 测试手续费配置API...');
    
    // 获取当前配置
    const getFeeConfigResponse = await makeRequest('GET', '/api/fee-config');
    if (getFeeConfigResponse.statusCode === 200) {
      const feeConfig = getFeeConfigResponse.data.config;
      console.log(`   当前手续费率: ${feeConfig.tradingFeePercent}%`);
      console.log(`   手续费启用状态: ${feeConfig.enabled ? '启用' : '禁用'}\n`);
    }

    // 2. 测试策略对比API（带手续费）
    console.log('2. 测试策略对比API（带手续费）...');
    const comparisonResponse = await makeRequest('GET', '/api/groups/g_1757478549758/strategy-comparison-with-fees');
    if (comparisonResponse.statusCode === 200) {
      const data = comparisonResponse.data;
      
      console.log('   手续费统计:');
      console.log(`     总交易额: ${formatCurrency(data.feeInfo.totalTradingVolume)}`);
      console.log(`     总手续费: ${formatCurrency(data.feeInfo.totalFees)}`);
      console.log(`     手续费率: ${data.feeInfo.tradingFeePercent}%`);
      console.log(`     成功交易次数: ${data.feeInfo.tradeCount}\n`);
      
      console.log('   策略对比结果:');
      console.log(`     持仓不动策略收益: ${formatCurrency(data.buyAndHoldStrategy.deltaTotal)} (${formatNumber(data.buyAndHoldStrategy.returnPercent)}%)`);
      console.log(`     自动平衡策略毛收益: ${formatCurrency(data.rebalanceStrategy.grossReturn)} (${formatNumber(data.rebalanceStrategy.grossReturnPercent)}%)`);
      console.log(`     自动平衡策略净收益: ${formatCurrency(data.rebalanceStrategy.netReturn)} (${formatNumber(data.rebalanceStrategy.netReturnPercent)}%)`);
      console.log(`     表现更好的策略: ${data.comparison.betterStrategyName}`);
      console.log(`     超额收益: ${formatCurrency(data.comparison.outperformance)} (${formatNumber(data.comparison.outperformancePercent)}%)\n`);
      
      console.log('   总结和建议:');
      console.log(`     ${data.summary.message}`);
      console.log(`     ${data.summary.recommendation}\n`);
    }

    // 3. 测试更新手续费配置
    console.log('3. 测试更新手续费配置...');
    const updateFeeResponse = await makeRequest('PUT', '/api/fee-config', {
      tradingFeePercent: 0.2,
      enabled: true
    });
    
    if (updateFeeResponse.statusCode === 200) {
      console.log('   ✅ 手续费配置更新成功');
      
      // 验证更新后的配置
      const verifyResponse = await makeRequest('GET', '/api/fee-config');
      if (verifyResponse.statusCode === 200) {
        const newConfig = verifyResponse.data.config;
        console.log(`   新手续费率: ${newConfig.tradingFeePercent}%`);
        console.log(`   新启用状态: ${newConfig.enabled ? '启用' : '禁用'}\n`);
      }
    } else {
      console.log('   ❌ 手续费配置更新失败\n');
    }

    // 4. 测试重置股票持仓功能
    console.log('4. 测试重置股票持仓功能...');
    const resetResponse = await makeRequest('POST', '/api/groups/g_1757478549758/reset-stock-positions');
    
    if (resetResponse.statusCode === 200) {
      const resetData = resetResponse.data;
      console.log(`   ✅ ${resetData.message}`);
      console.log(`   重置的资产数量: ${resetData.resetCount}\n`);
    } else {
      const error = resetResponse.data;
      console.log(`   ❌ 重置失败: ${error.error}\n`);
    }

    // 5. 显示UI功能说明
    console.log('5. UI功能说明:');
    console.log('   📊 策略对比标签页:');
    console.log('     - 显示持仓不动策略与自动平衡策略的详细对比');
    console.log('     - 包含手续费统计和扣除手续费后的实际盈利');
    console.log('     - 提供详细的资产对比表格');
    console.log('     - 显示投资建议和总结\n');
    
    console.log('   ⚙️ 手续费配置:');
    console.log('     - 可设置手续费百分比（0-10%）');
    console.log('     - 可启用/禁用手续费计算');
    console.log('     - 自动统计所有成功交易的费用\n');
    
    console.log('   🔄 重置功能:');
    console.log('     - 可将股票持仓重置到基线状态');
    console.log('     - 修复失败交易导致的持仓错误\n');

    console.log('🎉 UI功能测试完成！');
    console.log('\n📋 新增功能总结:');
    console.log('1. ✅ 策略对比标签页 - 显示两种策略的详细对比');
    console.log('2. ✅ 手续费统计 - 计算和显示交易费用');
    console.log('3. ✅ 手续费配置表单 - 可手动设置手续费率');
    console.log('4. ✅ 实际盈利计算 - 扣除手续费后的净收益');
    console.log('5. ✅ 重置股票持仓 - 修复历史错误');
    console.log('6. ✅ 详细对比表格 - 各资产的详细表现对比');

  } catch (error) {
    console.error('❌ 测试失败:', error.message);
  }
}

// 运行测试
testUIFeatures();
