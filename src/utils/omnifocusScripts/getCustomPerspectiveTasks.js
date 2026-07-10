// 通过自定义透视名称获取任务（支持层级关系）
// 基于用户提供的优秀代码改进

(() => {
  try {
    // Helper function to format dates consistently
    function formatDate(date) {
      if (!date) return null;
      const p = n => (n < 10 ? '0' : '') + n;
      const off = -date.getTimezoneOffset(), s = off >= 0 ? '+' : '-', a = Math.abs(off);
      return date.getFullYear() + '-' + p(date.getMonth() + 1) + '-' + p(date.getDate()) +
        'T' + p(date.getHours()) + ':' + p(date.getMinutes()) + ':' + p(date.getSeconds()) +
        s + p(Math.floor(a / 60)) + ':' + p(a % 60);
    }

    // 获取注入的参数
    const perspectiveName = injectedArgs && injectedArgs.perspectiveName ? injectedArgs.perspectiveName : null;

    if (!perspectiveName) {
      throw new Error("透视名称不能为空");
    }

    // 通过名称获取自定义透视
    let perspective = Perspective.Custom.byName(perspectiveName);
    if (!perspective) {
      throw new Error(`未找到名为 "${perspectiveName}" 的自定义透视`);
    }

    // 读取自定义透视需要一个打开的窗口
    if (!document.windows || document.windows.length === 0) {
      throw new Error("无法读取自定义透视：OmniFocus 没有打开的窗口");
    }
    let win = document.windows[0];

    // 用于存储所有任务，key为任务ID（支持层级关系）
    let taskMap = {};

    // 保存用户当前透视，切换到目标透视读取，之后在 finally 中恢复，
    // 避免这个只读工具静默改变用户可见的窗口
    let previousPerspective = win.perspective;
    win.perspective = perspective;

    // 遍历内容树，收集任务信息（含层级关系）
    let rootNode = win.content.rootNode;

    function collectTasks(node, parentId) {
      if (node.object && node.object instanceof Task) {
        let t = node.object;
        let id = t.id.primaryKey;

        // 记录任务信息（包含层级关系）
        taskMap[id] = {
          id: id,
          name: t.name,
          note: t.note || "",
          project: t.containingProject ? t.containingProject.name : (t.project ? t.project.name : null),
          tags: t.tags ? t.tags.map(tag => tag.name) : [],
          dueDate: formatDate(t.dueDate),
          deferDate: formatDate(t.deferDate),
          plannedDate: formatDate(t.plannedDate),
          completed: t.completed,
          flagged: t.flagged,
          estimatedMinutes: t.estimatedMinutes || null,
          repetitionRule: t.repetitionRule ? t.repetitionRule.toString() : null,
          creationDate: formatDate(t.added),
          completionDate: formatDate(t.completedDate),
          parent: parentId,     // 父任务ID
          children: [],         // 子任务ID列表，后面补充
        };

        // 递归收集子任务
        node.children.forEach(childNode => {
          if (childNode.object && childNode.object instanceof Task) {
            let childId = childNode.object.id.primaryKey;
            taskMap[id].children.push(childId);
            collectTasks(childNode, id);
          } else {
            collectTasks(childNode, id);
          }
        });
      } else {
        // 不是任务节点，递归子节点
        node.children.forEach(childNode => collectTasks(childNode, parentId));
      }
    }

    // 开始收集任务（根任务的parent为null），完成后恢复用户之前的透视
    try {
      if (rootNode && rootNode.children) {
        rootNode.children.forEach(node => collectTasks(node, null));
      }
    } finally {
      try { win.perspective = previousPerspective; } catch (e) {}
    }

    // 计算任务总数
    const taskCount = Object.keys(taskMap).length;

    // 返回结果（包含层级结构）
    const result = {
      success: true,
      perspectiveName: perspectiveName,
      perspectiveId: perspective.identifier,
      count: taskCount,
      taskMap: taskMap
    };

    return JSON.stringify(result);

  } catch (error) {
    // 错误处理
    const errorResult = {
      success: false,
      error: error.message || String(error),
      perspectiveName: perspectiveName || null,
      perspectiveId: null,
      count: 0,
      taskMap: {}
    };

    return JSON.stringify(errorResult);
  }
})();