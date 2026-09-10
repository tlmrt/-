// 本地 HTTP 接口路由与鉴权单测：node test/localapi.test.js
const { matchRoute, checkToken, extractToken, parseQuery, ROUTES } = require('../src/localapi');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✘ ' + name + (extra ? '  → ' + extra : '')); }
}

console.log('\n[1] 路由匹配');
{
  ok('GET /api/ping', matchRoute('GET', '/api/ping') && matchRoute('GET', '/api/ping').name === 'ping');
  ok('ping 不需要 token', matchRoute('GET', '/api/ping').auth === false);
  ok('GET /api/tasks', matchRoute('GET', '/api/tasks').name === 'tasks.list');
  ok('POST /api/tasks', matchRoute('POST', '/api/tasks').name === 'tasks.create');
  ok('DELETE 带 id', JSON.stringify(matchRoute('DELETE', '/api/tasks/abc123').params) === '["abc123"]');
  ok('PUT 带 id', matchRoute('PUT', '/api/tasks/abc').name === 'tasks.update');
  ok('id 会做 URL 解码', matchRoute('GET', '/api/tasks/a%20b').params[0] === 'a b');
  ok('GET /api/segments', matchRoute('GET', '/api/segments').name === 'segments.list');
  ok('GET /api/now', matchRoute('GET', '/api/now').name === 'now');
  ok('POST /api/maa/start', matchRoute('POST', '/api/maa/start').name === 'maa.start');
  ok('POST /api/maa/stop', matchRoute('POST', '/api/maa/stop').name === 'maa.stop');
  ok('GET /api/maa/status', matchRoute('GET', '/api/maa/status').name === 'maa.status');
  ok('POST /api/webhook/test', matchRoute('POST', '/api/webhook/test').name === 'webhook.test');
  ok('忽略 query 后仍能匹配', matchRoute('GET', '/api/tasks?date=2026-09-10').name === 'tasks.list');
  ok('大小写不敏感', matchRoute('get', '/API/PING').name === 'ping');
  ok('未知路径 → null', matchRoute('GET', '/api/unknown') === null);
  ok('方法不匹配 → null', matchRoute('POST', '/api/now') === null);
  ok('所有路由都需要鉴权（ping 除外）', ROUTES.filter((r) => r.auth === false).length === 1);
}

console.log('\n[2] token 校验');
{
  ok('未配置 token 时放行', checkToken('whatever', '') === true && checkToken('', null) === true);
  ok('token 正确放行', checkToken('abc', 'abc') === true);
  ok('token 错误拒绝', checkToken('abc', 'xyz') === false);
  ok('缺少 token 拒绝', checkToken(undefined, 'xyz') === false);
}

console.log('\n[3] token 提取');
{
  ok('从 x-api-token 头取', extractToken({ 'x-api-token': 'abc' }, {}) === 'abc');
  ok('从 Bearer 头取', extractToken({ authorization: 'Bearer tok123' }, {}) === 'tok123');
  ok('从 query 取', extractToken({}, { token: 'q1' }) === 'q1');
  ok('头优先于 query', extractToken({ 'x-api-token': 'h1' }, { token: 'q1' }) === 'h1');
  ok('都没有时为空串', extractToken({}, {}) === '');
}

console.log('\n[4] query 解析');
{
  const q = parseQuery('/api/tasks?date=2026-09-10&limit=5&token=abc');
  ok('解析多个参数', q.date === '2026-09-10' && q.limit === '5' && q.token === 'abc');
  ok('无 query 返回空对象', Object.keys(parseQuery('/api/tasks')).length === 0);
  ok('支持 + 作为空格', parseQuery('/api/tasks?q=a+b').q === 'a b');
  ok('支持 URL 编码', parseQuery('/api/tasks?q=%E4%B8%AD%E6%96%87').q === '中文');
}

console.log(`\n结果：${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
