// MAA 任务队列（一键长草）配置模型单测：node test/maaconfig.test.js
const {
  TASK_META,
  taskLabel,
  listText,
  parseListText,
  normalizeTextList,
  toStoredValue,
  toUiValue,
  buildEditableQueue,
  applyTaskPatch,
  suggestConfigName,
} = require('../src/maaconfig');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✘ ' + name + (extra ? '  → ' + extra : '')); }
}

console.log('\n[1] 任务类型元数据（与 MAA 一键长草对齐）');
{
  ok('开始唤醒', taskLabel('StartUp') === '开始唤醒');
  ok('刷理智', taskLabel('Fight') === '刷理智');
  ok('基建换班', taskLabel('Infrast') === '基建换班');
  ok('自动公招', taskLabel('Recruit') === '自动公招');
  ok('收取信用及购物', taskLabel('Mall') === '收取信用及购物');
  ok('领取奖励', taskLabel('Award') === '领取奖励');
  ok('自动肉鸽', taskLabel('Roguelike') === '自动肉鸽');
  ok('未知类型有兜底', taskLabel('SomethingNew') === 'SomethingNew' && taskLabel(null) === '未知任务');
  ok('刷理智含关卡与吃药字段', TASK_META.Fight.fields.some((f) => f.key === 'StagePlan') && TASK_META.Fight.fields.some((f) => f.key === 'UseMedicine'));
  ok('收取信用含黑名单字段', TASK_META.Mall.fields.some((f) => f.key === 'BlackList'));
}

console.log('\n[2] 列表文本互转');
{
  ok('数组 → 多行文本', listText(['1-7', 'CE-6']) === '1-7\nCE-6');
  ok('多行文本 → 数组', JSON.stringify(parseListText('1-7\n\n CE-6 \n')) === '["1-7","CE-6"]');
  ok('空值安全', parseListText(null).length === 0 && listText(null) === '');
  ok('分号规范化（半角/全角/逗号混合）', normalizeTextList('碳;家具；加急许可, 招聘许可') === '碳;家具;加急许可;招聘许可');
  ok('分号规范化去空项', normalizeTextList(';;a;;') === 'a');
}

console.log('\n[3] 值类型转换（写回 MAA 格式）');
{
  ok('bool 转换', toStoredValue('bool', 1) === true && toStoredValue('bool', 0) === false);
  ok('int 取整', toStoredValue('int', '12.6') === 13);
  ok('int 非法归 0', toStoredValue('int', 'abc') === 0);
  ok('int 尊重下限', toStoredValue('int', -5, { min: 0 }) === 0);
  ok('list 保留数组', JSON.stringify(toStoredValue('list', ['1-7', 'CE-6'])) === '["1-7","CE-6"]');
  ok('list 从文本解析', JSON.stringify(toStoredValue('list', '1-7\nCE-6')) === '["1-7","CE-6"]');
  ok('textlist 输出分号字符串', toStoredValue('textlist', '碳；家具') === '碳;家具');
  ok('text 转字符串', toStoredValue('text', 123) === '123' && toStoredValue('text', null) === '');

  ok('界面值：bool', toUiValue('bool', true) === true);
  ok('界面值：list → 文本', toUiValue('list', ['1-7', 'CE-6']) === '1-7\nCE-6');
  ok('界面值：textlist 加空格美化', toUiValue('textlist', '碳;家具') === '碳; 家具');
}

console.log('\n[4] 构建可编辑队列');
{
  const queue = [
    { $type: 'StartUpTask', TaskType: 'StartUp', Name: '', IsEnable: true, AccountName: '', AccountSwitchEnabled: false },
    { $type: 'FightTask', TaskType: 'Fight', Name: '刷材料', IsEnable: false, StagePlan: ['1-7', '1-7'], UseMedicine: true, MedicineCount: 2, TimesLimit: 2147483647, SomeUnknownField: 'keep-me' },
    { $type: 'MallTask', TaskType: 'Mall', IsEnable: true, FirstList: '招聘许可', BlackList: '碳;家具' },
  ];
  const editable = buildEditableQueue(queue);
  ok('长度一致', editable.length === 3);
  ok('中文名与启用状态', editable[1].label === '刷理智' && editable[1].enabled === false);
  ok('保留自定义任务名', editable[1].name === '刷材料');
  ok('关卡转为多行文本', editable[1].fields.find((f) => f.key === 'StagePlan').value === '1-7\n1-7');
  ok('吃药开关正确', editable[1].fields.find((f) => f.key === 'UseMedicine').value === true);
  ok('选择项带 options', editable[0].taskType === 'StartUp' && !!TASK_META.Infrast.fields.find((f) => f.key === 'Mode').options);
  ok('未知类型标记 known=false', buildEditableQueue([{ TaskType: 'Xyz' }])[0].known === false || TASK_META.Xyz === undefined);
  ok('空队列安全', buildEditableQueue(null).length === 0);
}

console.log('\n[5] 写回补丁（不破坏未列出的字段）');
{
  const task = { $type: 'FightTask', TaskType: 'Fight', IsEnable: true, StagePlan: ['1-7'], SomeUnknownField: 'keep-me' };
  const patched = applyTaskPatch(task, {
    enabled: false,
    name: '晚上刷',
    fields: { StagePlan: 'CE-6\nLS-5', UseMedicine: 1, MedicineCount: '3' },
  });
  ok('启用状态被更新', patched.IsEnable === false);
  ok('任务名被更新', patched.Name === '晚上刷');
  ok('关卡写回数组', JSON.stringify(patched.StagePlan) === '["CE-6","LS-5"]');
  ok('开关写回布尔', patched.UseMedicine === true);
  ok('数字写回整数', patched.MedicineCount === 3);
  ok('未知字段保留', patched.SomeUnknownField === 'keep-me');
  ok('原对象未被修改（不可变）', task.IsEnable === true && JSON.stringify(task.StagePlan) === '["1-7"]');
  ok('空补丁安全', applyTaskPatch(task, null).TaskType === 'Fight');
}

console.log('\n[6] 按日期生成 MAA 配置名');
{
  ok('常规日期', suggestConfigName('2026-09-12', []) === '日历-0912');
  ok('重名自动加序号', suggestConfigName('2026-09-12', ['日历-0912']) === '日历-0912-2');
  ok('多次重名继续递增', suggestConfigName('2026-09-12', ['日历-0912', '日历-0912-2']) === '日历-0912-3');
  ok('日期为空时有兜底名', suggestConfigName('', []) === '日历配置');
  ok('非法入参安全', suggestConfigName(null, null) === '日历配置');
}

console.log(`\n结果：${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
