# 开源日历 · 本地联动接口文档

开源日历内置一个**只监听本机（127.0.0.1）**的 HTTP 接口，方便其它软件（MAA、脚本、快捷指令、自动化工具）读取日历数据、创建任务，甚至**启动 / 停止 MAA**。

- 默认地址：`http://127.0.0.1:8765`
- 开关与端口：**设置 → 外部联动**
- 鉴权：除 `/api/ping` 外，所有接口都要带令牌
  - 请求头：`X-Api-Token: <你的令牌>`
  - 或查询参数：`?token=<你的令牌>`
  - 也支持 `Authorization: Bearer <令牌>`
- 令牌在设置里可见，点「复制」即可；泄露或更换软件时点「重新生成」
- 全部返回 JSON，格式：成功 `{ "ok": true, ... }`，失败 `{ "ok": false, "error": "原因" }`

---

## 1. 接口一览

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/ping` | 探活（**免令牌**），返回应用名与版本 |
| GET | `/api/now` | 当前时间、今天的任务/时间段、进行中的时间段、下一个提醒 |
| GET | `/api/tasks?date=YYYY-MM-DD` | 任务列表（带 date 则只返回当天，含重复任务展开） |
| POST | `/api/tasks` | 创建任务（JSON body） |
| GET | `/api/tasks/:id` | 单个任务 |
| PUT | `/api/tasks/:id` | 更新任务 |
| DELETE | `/api/tasks/:id` | 删除任务 |
| GET | `/api/segments?date=YYYY-MM-DD` | 时间段列表 |
| POST | `/api/segments` | 创建时间段（液体倒计时） |
| POST | `/api/maa/start` | 启动 MAA（可选 body `{"task":"任务名"}`） |
| POST | `/api/maa/stop` | 停止由本应用启动的 MAA |
| GET | `/api/maa/status` | MAA 运行状态与配置情况 |
| POST | `/api/webhook/test` | 往配置的 webhook 推一条测试事件 |

---

## 2. 调用示例

### 探活

```bash
curl http://127.0.0.1:8765/api/ping
# {"ok":true,"name":"开源日历","version":"0.1.0","port":8765}
```

### 看看现在该干什么（推荐给 MAA 类自动化用）

```bash
curl -H "X-Api-Token: 你的令牌" http://127.0.0.1:8765/api/now
```

```json
{
  "ok": true,
  "now": "2026-09-10 22:03:11",
  "today": "2026-09-10",
  "tasks": [{ "id": "abc", "title": "清理理智", "time": "22:00", "priority": "high" }],
  "segments": [{ "id": "s1", "date": "2026-09-10", "start": "22:00", "end": "23:00", "title": "挂机", "color": "#4f6bff" }],
  "activeSegment": { "id": "s1", "title": "挂机", "...": "..." },
  "nextReminder": { "at": 1789000000000, "taskId": "abc", "title": "清理理智", "time": "2026-09-10 22:00" }
}
```

### 创建一个任务

```bash
curl -X POST http://127.0.0.1:8765/api/tasks \
  -H "X-Api-Token: 你的令牌" \
  -H "Content-Type: application/json" \
  -d '{"title":"每日任务","date":"2026-09-11","time":"08:00","priority":"medium","repeat":"daily","reminders":[{"id":"r1","offsetMinutes":10}]}'
```

### PowerShell

```powershell
$h = @{ 'X-Api-Token' = '你的令牌' }
Invoke-RestMethod -Uri 'http://127.0.0.1:8765/api/now' -Headers $h
```

> ⚠️ Windows PowerShell 5.1 发送中文时容易出现乱码（`??????`），这是客户端编码问题，不是接口问题。
> 解决办法：用 PowerShell 7+，或把 body 转成 UTF-8 字节再发送：
> ```powershell
> $json = @{ title='中文任务'; date='2026-09-11'; time='09:00' } | ConvertTo-Json
> $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
> Invoke-RestMethod -Uri 'http://127.0.0.1:8765/api/tasks' -Method Post -Headers $h `
>   -ContentType 'application/json; charset=utf-8' -Body $bytes
> ```

### Python

```python
import requests
r = requests.get('http://127.0.0.1:8765/api/now',
                 headers={'X-Api-Token': '你的令牌'}, timeout=5)
print(r.json())
```

---

## 3. MAA 联动

### 配置（设置 → 外部联动 → MAA 部分）

1. 点「选择…」指定 **MAA.exe** 路径
2. 填「启动参数模板」，支持占位符：
   - `{task}` 任务名（接口传的或设置里的默认任务名）
   - `{date}` 今天日期 `YYYY-MM-DD`
   - `{time}` 当前时间 `HH:mm`
   - `{title}` 同 `{task}`
   - 例：`--task "{task}"` → 启动时传 `--task "开始唤醒"`（按你所用 MAA 版本的参数说明填写）
3. 填「默认任务名」（接口不传 task 时用它）
4. 点「启动 MAA」测试

> 参数模板是为了兼容不同 MAA 版本/发行版（GUI、maa-cli）而做成可配置的，请按你实际使用的版本填写对应参数；留空则只启动程序本身。

### 让日历的提醒自动拉起 MAA

任何能发 HTTP 的软件都能触发：

```bash
curl -X POST http://127.0.0.1:8765/api/maa/start \
  -H "X-Api-Token: 你的令牌" -H "Content-Type: application/json" \
  -d '{"task":"开始唤醒"}'
```

```json
{ "ok": true, "pid": 24680, "task": "开始唤醒", "args": ["--task", "开始唤醒"] }
```

停止：

```bash
curl -X POST http://127.0.0.1:8765/api/maa/stop -H "X-Api-Token: 你的令牌"
```

---

## 4. 事件推送（webhook）

在设置里填入一个 URL 后，以下事件会以 `POST application/json` 推送给它：

| 事件 | 触发时机 | payload |
|---|---|---|
| `reminder.fired` | 任务到点提醒 | `{ task, at, atText }` |
| `task.saved` | 任务被创建/更新 | `{ task: {id,title,date,time} }` |
| `task.deleted` | 任务被删除 | `{ id }` |
| `segment.saved` | 时间段被创建/更新 | `{ segment }` |
| `maa.started` / `maa.stopped` | MAA 启动/停止 | `{ pid, task, args }` |
| `test` | 点「测试」或调用 `/api/webhook/test` | `{ message }` |

事件体格式：

```json
{
  "app": "开源日历",
  "event": "reminder.fired",
  "time": 1789000000000,
  "payload": { "task": { "id": "abc", "title": "清理理智" }, "at": 1789000000000, "atText": "2026-09-10 22:00" }
}
```

> 推送失败只记录日志，不会影响日历本身；接口与 webhook 都可在设置里随时关闭。

---

## 5. 错误码

| 状态码 | 含义 |
|---|---|
| 200 | 成功 |
| 400 | 参数错误（如缺 title、缺 date/start/end） |
| 401 | 令牌无效或缺失 |
| 404 | 接口或资源不存在 |
| 500 | 内部错误（返回 `error` 说明） |

---

## 6. 安全提示

- 接口**只绑定 127.0.0.1**，局域网内其它设备无法访问
- 因此不要用端口转发把它暴露到公网
- 令牌可随时「重新生成」，重新生成后请同步更新调用方配置
- 不需要联动时直接把「开启本地 HTTP 接口」关掉即可
