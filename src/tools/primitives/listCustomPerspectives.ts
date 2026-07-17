import { executeOmniFocusScript } from '../../utils/scriptExecution.js';

export interface ListCustomPerspectivesOptions {
  format?: 'simple' | 'detailed';
}

export async function listCustomPerspectives(options: ListCustomPerspectivesOptions = {}): Promise<string> {
  const { format = 'simple' } = options;
  
  try {
    console.error('🚀 开始执行 listCustomPerspectives 脚本...');
    
    // Execute the list custom perspectives script
    const result = await executeOmniFocusScript('@listCustomPerspectives.js', {});
    
    console.error('📋 脚本执行完成，结果类型:', typeof result);
    console.error('📋 脚本执行结果:', result);
    
    // 处理各种可能的返回类型
    let data: any;
    
    if (typeof result === 'string') {
      console.error('📝 结果是字符串，尝试解析 JSON...');
      try {
        data = JSON.parse(result);
        console.error('✅ JSON 解析成功:', data);
      } catch (parseError) {
        console.error('❌ JSON 解析失败:', parseError);
        throw new Error(`解析字符串结果失败: ${result}`);
      }
    } else if (typeof result === 'object' && result !== null) {
      console.error('🔄 结果是对象，直接使用...');
      data = result;
    } else {
      console.error('❌ 无效的结果类型:', typeof result, result);
      throw new Error(`脚本执行返回了无效的结果类型: ${typeof result}, 值: ${result}`);
    }
    
    // 检查是否有错误
    if (!data.success) {
      throw new Error(data.error || 'Unknown error occurred');
    }
    
    // 格式化输出
    if (data.count === 0) {
      return "📋 **自定义透视列表**\n\n暂无自定义透视。";
    }
    
    if (format === 'simple') {
      // 简单格式：只显示名称列表
      const perspectiveNames = data.perspectives.map((p: any) => p.name);
      return `📋 **自定义透视列表** (${data.count}个)\n\n${perspectiveNames.map((name: string, index: number) => `${index + 1}. ${name}`).join('\n')}`;
    } else {
      // 详细格式：显示名称和标识符
      const perspectiveDetails = data.perspectives.map((p: any, index: number) => 
        `${index + 1}. **${p.name}**\n   🆔 ${p.identifier}`
      );
      return `📋 **自定义透视列表** (${data.count}个)\n\n${perspectiveDetails.join('\n\n')}`;
    }
    
  } catch (error) {
    console.error('Error in listCustomPerspectives:', error);
    return `❌ **错误**: ${error instanceof Error ? error.message : String(error)}`;
  }
}