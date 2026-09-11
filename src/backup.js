// ============================================================
// 数据备份：命名 / 组装备份内容 / 解析校验 / 保留清理 —— 纯逻辑，可单测
//
// 为什么这么做：
// - 备份是**单个 JSON 文件**，内部保存各数据文件的**原始文本**，恢复时原样写回。
//   不引入 zip 依赖，出错时用记事本也能看懂、能手工把数据救回去。
// - 本模块不 require electron、不碰文件系统：真正的读写由主进程负责，
//   这里只回答四件事：叫什么名字、装什么内容、这份备份能不能信、该删哪几份。
//
// 安全（硬要求）：恢复时会拿 files 的键去数据目录里拼路径写文件，
// 所以只接受形如 ^[A-Za-z0-9._-]+\.json$ 的键；含路径分隔符（/ \\）、盘符、
// 冒号（NTFS 数据流）等一律过滤，否则一个损坏或被篡改的备份文件
// 就能把内容写到数据目录之外。
// ============================================================

// 默认备份的 5 个数据文件（与主进程里的 *_FILE() 常量对应）
const BACKUP_FILE_KEYS = ['tasks.json', 'prefs.json', 'segments.json', 'widgets.json', 'dayimages.json'];

const BACKUP_APP = '开源日历';   // 用来识别「这是不是本应用的备份」
const BACKUP_FORMAT = 1;         // 备份格式版本（内部结构变化时 +1）
const DEFAULT_KEEP = 7;          // 默认保留最近 7 份

// backup-YYYYMMDD-HHmmss.json
const BACKUP_NAME_RE = /^backup-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\.json$/;

// 恢复时允许写回的文件名（不含任何路径语义）
const SAFE_FILE_KEY_RE = /^[A-Za-z0-9._-]+\.json$/;

function pad2(n) {
  return String(n).padStart(2, '0');
}

// 非法/缺失的日期一律退回「现在」，保证本模块任何入参都不抛异常
function safeDate(date) {
  return (date instanceof Date && !Number.isNaN(date.getTime())) ? date : new Date();
}

// 备份文件名：backup-YYYYMMDD-HHmmss.json
// 定长、字典序即时间序，pruneList 直接按名字排序即可。
function backupName(date) {
  const d = safeDate(date);
  const day = String(d.getFullYear()).padStart(4, '0') + pad2(d.getMonth() + 1) + pad2(d.getDate());
  const time = pad2(d.getHours()) + pad2(d.getMinutes()) + pad2(d.getSeconds());
  return 'backup-' + day + '-' + time + '.json';
}

// 是否是「形如备份、且月日时分秒真的合法」的名字
// 垃圾值（desktop.ini / null / 数字 / 备份名形状但日期不存在）都判 false
function isBackupName(name) {
  if (typeof name !== 'string') return false;
  const m = BACKUP_NAME_RE.exec(name);
  if (!m) return false;
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const second = Number(m[6]);
  return month >= 1 && month <= 12 && day >= 1 && day <= 31 &&
    hour <= 23 && minute <= 59 && second <= 59;
}

// 组装备份内容（由调用方 JSON.stringify 后写文件）
// filesMap: { 'tasks.json': '<原始文本>', ... }
// 只保留键名安全且以 .json 结尾、值是字符串的项；空文本 '' 必须保留
// （用户可能真的把数据清空了，这本身就是需要备份的状态）。
function buildPayload(filesMap, date) {
  const src = (filesMap && typeof filesMap === 'object' && !Array.isArray(filesMap)) ? filesMap : {};
  const files = {};
  Object.keys(src).forEach((key) => {
    if (!SAFE_FILE_KEY_RE.test(key)) return;   // 非 .json，或含路径分隔符/盘符的危险键
    const text = src[key];
    if (typeof text !== 'string') return;      // 不是"原始文本"，恢复时无法原样写回
    files[key] = text;
  });
  return {
    app: BACKUP_APP,
    format: BACKUP_FORMAT,
    at: safeDate(date).toISOString(),
    files,
  };
}

// 解析备份（字符串或已解析对象）并做格式校验
// 返回 { ok:true, at, format, files, fileCount } 或 { ok:false, error:'中文说明' }
function parseBackup(textOrObj) {
  let obj = textOrObj;

  if (typeof obj === 'string') {
    const text = obj.trim();
    if (!text) return { ok: false, error: '备份内容为空，无法解析' };
    try {
      obj = JSON.parse(text);
    } catch (e) {
      const msg = (e && e.message) ? String(e.message) : '格式错误';
      return { ok: false, error: '不是合法的备份文件：JSON 解析失败（' + msg + '）' };
    }
  }

  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    return { ok: false, error: '备份内容不是 JSON 对象' };
  }

  // app 只在「写了但不是本应用」时报错：允许手写的备份省略它
  if (typeof obj.app === 'string' && obj.app && obj.app !== BACKUP_APP) {
    return { ok: false, error: '这不是「' + BACKUP_APP + '」的备份文件（app 为 ' + obj.app + '）' };
  }

  // format：写了就必须是数字，且不能比当前程序支持的更新
  let format = BACKUP_FORMAT;
  if (obj.format !== undefined && obj.format !== null) {
    if (typeof obj.format !== 'number' || !Number.isFinite(obj.format)) {
      return { ok: false, error: '备份的 format 字段不是数字，无法确认备份格式' };
    }
    if (obj.format > BACKUP_FORMAT) {
      return {
        ok: false,
        error: '备份格式版本（' + obj.format + '）比当前程序支持的（' + BACKUP_FORMAT + '）新，请先升级应用再恢复',
      };
    }
    format = obj.format;
  }

  // files：必须有，且必须是对象（不能是数组/字符串/null）
  const raw = obj.files;
  if (raw === undefined || raw === null) {
    return { ok: false, error: '备份里缺少 files 字段，没有可恢复的数据' };
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: '备份的 files 字段不是对象，备份已损坏' };
  }

  // 逐项过滤：危险键名、非字符串值一律丢弃；空文本 '' 保留
  const files = {};
  Object.keys(raw).forEach((key) => {
    if (!SAFE_FILE_KEY_RE.test(key)) return;   // 路径穿越 / 绝对路径 / 非 .json
    const text = raw[key];
    if (typeof text !== 'string') return;
    files[key] = text;
  });

  const fileCount = Object.keys(files).length;
  if (!fileCount) {
    return { ok: false, error: '备份里没有任何可恢复的数据文件，可能是空备份或已损坏' };
  }

  return {
    ok: true,
    at: typeof obj.at === 'string' ? obj.at : '',
    format,
    files,
    fileCount,
  };
}

// 从文件名列表里算出「保留哪些 / 删除哪些」（都按时间升序返回）
// - 只看 backup-YYYYMMDD-HHmmss.json 形状的名字，其余（desktop.ini、null、数字…）一律忽略
// - 同一天多份备份：保留字典序（=时间）靠后的
function pruneList(names, keep) {
  const k = (typeof keep === 'number' && Number.isFinite(keep) && keep >= 1)
    ? Math.floor(keep)
    : DEFAULT_KEEP;

  const list = (Array.isArray(names) ? names : []).filter(isBackupName);
  list.sort();   // 定长名字，字典序即时间序

  if (list.length <= k) return { keep: list, remove: [] };
  const cut = list.length - k;
  return { keep: list.slice(cut), remove: list.slice(0, cut) };
}

// 该时刻是否已经有当天备份（用于「每天只备份一次」）
// 跨天不命中：昨天的备份不会挡住今天的备份。
function hasBackupToday(names, date) {
  const d = safeDate(date);
  const day = String(d.getFullYear()).padStart(4, '0') + pad2(d.getMonth() + 1) + pad2(d.getDate());
  const prefix = 'backup-' + day + '-';
  return (Array.isArray(names) ? names : []).some(
    (n) => isBackupName(n) && n.startsWith(prefix)
  );
}

module.exports = {
  BACKUP_FILE_KEYS,
  DEFAULT_KEEP,
  backupName,
  buildPayload,
  parseBackup,
  pruneList,
  hasBackupToday,
};
