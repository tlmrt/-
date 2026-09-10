// ============================================================
// MAA 任务队列（「一键长草」）配置模型 —— 纯逻辑，可单测
//
// 直接读写 MAA 的配置文件 config/gui.new.json：
//   Configurations[当前配置名].TaskQueue = [ { $type, TaskType, Name, IsEnable, ...参数 } ]
// 本模块定义各任务类型的可编辑字段（与 MAA 界面一致），并提供类型转换。
// ============================================================

// 字段类型：
//   bool / int / text        —— 基本类型
//   list                     —— 数组（如关卡列表、保留标签）
//   textlist                 —— 分号分隔的字符串（如购物黑名单）
//   select                   —— 下拉（options: [[值, 显示名], ...]）
const TASK_META = {
  StartUp: {
    label: '开始唤醒',
    fields: [
      { key: 'AccountSwitchEnabled', label: '切换账号', type: 'bool' },
      { key: 'AccountName', label: '账号名', type: 'text' },
    ],
  },
  Fight: {
    label: '刷理智',
    fields: [
      { key: 'StagePlan', label: '关卡（可搜索选择，按顺序执行）', type: 'list', widget: 'levels' },
      { key: 'UseMedicine', label: '自动吃理智药', type: 'bool' },
      { key: 'MedicineCount', label: '吃药数量（0 = 不限）', type: 'int', min: 0 },
      { key: 'UseStone', label: '自动碎石', type: 'bool' },
      { key: 'StoneCount', label: '碎石数量', type: 'int', min: 0 },
      { key: 'UseExpiringMedicine', label: '使用将过期的理智药', type: 'bool' },
      { key: 'EnableTimesLimit', label: '限制作战次数', type: 'bool' },
      { key: 'TimesLimit', label: '次数上限', type: 'int', min: 0 },
      { key: 'Series', label: '连战次数（0 = 不连战）', type: 'int', min: 0 },
      { key: 'UseCustomAnnihilation', label: '自定义剿灭关卡', type: 'bool' },
      { key: 'AnnihilationStage', label: '剿灭关卡', type: 'text' },
    ],
  },
  Infrast: {
    label: '基建换班',
    fields: [
      { key: 'Mode', label: '换班模式', type: 'select', options: [['Normal', '普通'], ['Rotation', '轮换'], ['Custom', '自定义']] },
      { key: 'UsesOfDrones', label: '无人机用途', type: 'select', options: [['Money', '贸易站'], ['SyntheticJade', '合成玉'], ['CombatRecord', '经验书'], ['PureGold', '赤金'], ['OriginStone', '源石碎片'], ['Chip', '芯片']] },
      { key: 'DormThreshold', label: '宿舍心情阈值(%)', type: 'int', min: 0 },
      { key: 'DormTrustEnabled', label: '宿舍信赖位', type: 'bool' },
      { key: 'OriginiumShardAutoReplenishment', label: '源石碎片自动补货', type: 'bool' },
      { key: 'ReceptionMessageBoard', label: '会客室领取信用', type: 'bool' },
      { key: 'ReceptionClueExchange', label: '会客室线索交流', type: 'bool' },
      { key: 'SendClue', label: '赠送线索', type: 'bool' },
      { key: 'ContinueTraining', label: '专精继续训练', type: 'bool' },
      { key: 'Filename', label: '自定义排班文件（留空 = 使用 MAA 排班）', type: 'text' },
    ],
  },
  Recruit: {
    label: '自动公招',
    fields: [
      { key: 'MaxTimes', label: '招募次数', type: 'int', min: 0 },
      { key: 'RefreshLevel3', label: '自动刷新 3 星标签', type: 'bool' },
      { key: 'ForceRefresh', label: '强制刷新', type: 'bool' },
      { key: 'Level3Choose', label: '3 星也招募', type: 'bool' },
      { key: 'Level4Choose', label: '4 星招募', type: 'bool' },
      { key: 'Level5Choose', label: '5 星招募', type: 'bool' },
      { key: 'Level6Choose', label: '6 星招募', type: 'bool' },
      { key: 'Level3Time', label: '3 星等待时间（秒）', type: 'int', min: 0 },
      { key: 'Level4Time', label: '4 星等待时间（秒）', type: 'int', min: 0 },
      { key: 'PreferTagEnabled', label: '启用优先标签', type: 'bool' },
      { key: 'PreserveTagEnabled', label: '启用保留标签', type: 'bool' },
      { key: 'PreserveTagList', label: '保留标签列表（每行一个）', type: 'list' },
    ],
  },
  Mall: {
    label: '收取信用及购物',
    fields: [
      { key: 'Shopping', label: '信用购物', type: 'bool' },
      { key: 'OnlyBuyDiscount', label: '只买打折商品', type: 'bool' },
      { key: 'ShoppingIgnoreBlackListWhenFull', label: '信用满时忽略黑名单', type: 'bool' },
      { key: 'ReserveMaxCredit', label: '保留信用买最大件', type: 'bool' },
      { key: 'FirstList', label: '优先购买（分号分隔）', type: 'textlist' },
      { key: 'BlackList', label: '购物黑名单（分号分隔）', type: 'textlist' },
      { key: 'CreditFight', label: '信用作战', type: 'bool' },
      { key: 'CreditFightOnceADay', label: '信用作战每日仅一次', type: 'bool' },
      { key: 'VisitFriends', label: '访问好友', type: 'bool' },
      { key: 'VisitFriendsOnceADay', label: '访问好友每日仅一次', type: 'bool' },
    ],
  },
  Award: {
    label: '领取奖励',
    fields: [
      { key: 'Award', label: '日常 / 周常奖励', type: 'bool' },
      { key: 'Mail', label: '邮件', type: 'bool' },
      { key: 'FreeGacha', label: '免费单抽', type: 'bool' },
      { key: 'Orundum', label: '合成玉', type: 'bool' },
      { key: 'Mining', label: '幸运墙', type: 'bool' },
      { key: 'SpecialAccess', label: '专属访问', type: 'bool' },
    ],
  },
  Roguelike: {
    label: '自动肉鸽',
    fields: [
      { key: 'Theme', label: '主题', type: 'text' },
      { key: 'Mode', label: '模式', type: 'text' },
      { key: 'StartCount', label: '开始次数', type: 'int', min: 0 },
      { key: 'Squad', label: '分队', type: 'text' },
      { key: 'CoreChar', label: '核心干员', type: 'text' },
      { key: 'Investment', label: '存源石锭', type: 'bool' },
      { key: 'InvestCount', label: '投资次数', type: 'int', min: 0 },
    ],
  },
  Reclamation: {
    label: '生息演算',
    fields: [
      { key: 'Theme', label: '主题', type: 'text' },
      { key: 'Mode', label: '模式', type: 'text' },
      { key: 'ClearStore', label: '清空商店', type: 'bool' },
      { key: 'MaxCraftCountPerRound', label: '每轮最大合成数', type: 'int', min: 0 },
    ],
  },
  UserDataUpdate: {
    label: '仓库 / 干员识别',
    fields: [
      { key: 'UpdateOperBox', label: '更新干员盒', type: 'bool' },
      { key: 'UpdateDepot', label: '更新仓库', type: 'bool' },
      { key: 'TriggerInterval', label: '触发间隔', type: 'text' },
    ],
  },
  Depot: { label: '仓库识别', fields: [] },
  OperBox: { label: '干员识别', fields: [] },
  CloseDown: { label: '关闭游戏', fields: [] },
  Custom: { label: '自定义任务', fields: [] },
};

function taskLabel(taskType) {
  const meta = TASK_META[taskType];
  return meta ? meta.label : String(taskType || '未知任务');
}

function fieldMeta(taskType, key) {
  const meta = TASK_META[taskType];
  if (!meta) return null;
  return meta.fields.find((f) => f.key === key) || null;
}

// 数组 → 多行文本
function listText(v) {
  return Array.isArray(v) ? v.join('\n') : (v == null ? '' : String(v));
}

// 多行文本 → 数组（去空行）
function parseListText(str) {
  return String(str == null ? '' : str)
    .split(/[\n\r]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

// 分号（或逗号、换行）分隔字符串 → 规范化字符串
function normalizeTextList(str) {
  return String(str == null ? '' : str)
    .split(/[;；,，\n\r]+/)
    .map((x) => x.trim())
    .filter(Boolean)
    .join(';');
}

// 界面值 → 存回 MAA 的原始值
function toStoredValue(type, raw, meta) {
  switch (type) {
    case 'bool':
      return !!raw;
    case 'int': {
      const n = Math.round(Number(raw));
      if (!Number.isFinite(n)) return 0;
      const min = meta && typeof meta.min === 'number' ? meta.min : -Infinity;
      return Math.max(min, n);
    }
    case 'list':
      return Array.isArray(raw) ? raw : parseListText(raw);
    case 'textlist':
      return normalizeTextList(raw);
    default:
      return raw == null ? '' : String(raw);
  }
}

// 原始值 → 界面值
function toUiValue(type, v) {
  switch (type) {
    case 'bool':
      return !!v;
    case 'int':
      return Number.isFinite(Number(v)) ? Number(v) : 0;
    case 'list':
      return listText(v);
    case 'textlist':
      return typeof v === 'string' ? v.split(/[;；]/).filter(Boolean).join('; ') : listText(v);
    default:
      return v == null ? '' : String(v);
  }
}

// 把 TaskQueue 转成界面可编辑结构（只暴露元数据里定义的常用字段，其余字段原样保留在文件里）
function buildEditableQueue(queue) {
  if (!Array.isArray(queue)) return [];
  return queue.map((t, index) => {
    const taskType = (t && (t.TaskType || (t.$type || '').replace(/Task$/, ''))) || 'Custom';
    const meta = TASK_META[taskType] || { label: taskLabel(taskType), fields: [] };
    const fields = meta.fields.map((f) => ({
      key: f.key,
      label: f.label,
      type: f.type,
      widget: f.widget,
      min: f.min,
      options: f.options,
      value: toUiValue(f.type, t ? t[f.key] : undefined),
    }));
    return {
      index,
      taskType,
      label: meta.label,
      name: (t && t.Name) || '',
      enabled: !!(t && t.IsEnable),
      fields,
      known: !!TASK_META[taskType],
    };
  });
}

// 把界面改动写回任务对象（浅拷贝，保留未列出的字段）
function applyTaskPatch(task, patch) {
  const out = { ...(task || {}) };
  if (!patch) return out;
  if (patch.enabled !== undefined) out.IsEnable = !!patch.enabled;
  if (patch.name !== undefined) out.Name = String(patch.name || '');
  if (patch.fields && typeof patch.fields === 'object') {
    const taskType = out.TaskType || String(out.$type || '').replace(/Task$/, '');
    for (const [key, raw] of Object.entries(patch.fields)) {
      const meta = fieldMeta(taskType, key) || { type: 'text' };
      out[key] = toStoredValue(meta.type, raw, meta);
    }
  }
  return out;
}

// 为某天建议一个 MAA 配置名（如 日历-09-12，重名则追加序号）
function suggestConfigName(date, existingNames) {
  const list = Array.isArray(existingNames) ? existingNames : [];
  const md = String(date || '').slice(5).replace('-', '');
  const base = md ? `日历-${md}` : '日历配置';
  if (!list.includes(base)) return base;
  let i = 2;
  while (list.includes(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

// ---------- 关卡匹配（配合 MAA 的 stages.json）----------

// 归一化写法：忽略大小写、空格、横线、下划线（"ce6"/"CE-6"/"ce 6" → "CE6"）
function stageKey(s) {
  return String(s == null ? '' : s).toUpperCase().replace(/[\s\-_]/g, '');
}

// 把用户输入修正为关卡清单里的标准代号；找不到返回 null
function normalizeStageCode(input, levels) {
  const raw = String(input == null ? '' : input).trim();
  if (!raw) return null;
  const list = Array.isArray(levels) ? levels : [];
  const key = stageKey(raw);
  if (!key) return null;
  // 1) 完全一致（忽略分隔符与大小写）
  let hit = list.find((l) => stageKey(l.code) === key);
  if (hit) return hit.code;
  // 2) 前缀一致（如输入 1-7 而清单里有 1-7）
  hit = list.find((l) => stageKey(l.code) === key || stageKey(l.code).startsWith(key));
  if (hit) return hit.code;
  // 3) 去掉开头字母再试（如输入 "7" 匹配 "1-7" 的最后一段）
  hit = list.find((l) => stageKey(l.code).endsWith(key));
  if (hit) return hit.code;
  return null;
}

// 搜索关卡：支持代号模糊匹配 + 掉落物名匹配，返回候选项（最多 limit 条）
function searchLevels(keyword, levels, limit) {
  const list = Array.isArray(levels) ? levels : [];
  const max = Number.isFinite(limit) ? limit : 12;
  const raw = String(keyword == null ? '' : keyword).trim();
  if (!raw) return list.slice(0, max);
  const key = stageKey(raw);
  const lower = raw.toLowerCase();
  const scored = [];
  for (const l of list) {
    const codeKey = stageKey(l.code);
    let score = 0;
    if (codeKey === key) score = 100;
    else if (codeKey.startsWith(key)) score = 80;
    else if (codeKey.includes(key)) score = 60;
    else if ((l.drops || []).some((d) => String(d).toLowerCase().includes(lower))) score = 40;
    else if ((l.stageId || '').toLowerCase().includes(lower)) score = 20;
    if (score > 0) scored.push({ score, level: l });
  }
  scored.sort((a, b) => b.score - a.score || String(a.level.code).localeCompare(String(b.level.code)));
  return scored.slice(0, max).map((x) => x.level);
}

module.exports = {
  TASK_META,
  taskLabel,
  fieldMeta,
  listText,
  parseListText,
  normalizeTextList,
  toStoredValue,
  toUiValue,
  buildEditableQueue,
  applyTaskPatch,
  suggestConfigName,
  stageKey,
  normalizeStageCode,
  searchLevels,
};
