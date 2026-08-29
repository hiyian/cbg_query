let META = { areas: [], schools: [], servers: [], tasks: [] };
let DATA = {
  roles: [],
  loaded: false,
  page: 1,
  pageSize: 50,
  total: 0,
  totalPages: 1,
  serverKeys: [],
  taskKeys: [],
  metaText: "",
};
let roleSort = { key: "material_ratio", dir: "desc" };
let selectedServerKeys = new Set();
let selectedTaskKeys = new Set();

const $ = (sel) => document.querySelector(sel);
const meta = $("#meta");
const rolesPanel = $("#rolesPanel");
const detailsPanel = $("#detailsPanel");
const petsPanel = $("#petsPanel");
const paginationBar = $("#pagination");
const pageInfo = $("#pageInfo");
const prevPageBtn = $("#prevPage");
const nextPageBtn = $("#nextPage");
const roleModal = $("#roleModal");
const roleModalBody = $("#roleModalBody");

const EQUIP_TYPE_ORDER = ["身上装备", "仓库装备", "仓库物品", "背包物品"];

const KEY_ITEMS = [
  { key: "shendoudou", label: "神兜兜", css: "shendoudou", sub: "" },
  { key: "baoshichui", label: "宝石锤", css: "baoshichui", sub: "" },
  { key: "jinliulu", label: "金柳露", css: "jinliulu", sub: "" },
  { key: "jinghua", label: "精华", css: "jinghua", sub: "后缀「·精华」（展示用）" },
  { key: "wuse_shi", label: "四色石", css: "wuse-shi", sub: "朱雀/青龙/白虎/玄武" },
];

const STONE_NAMES = new Set(["朱雀石", "青龙石", "白虎石", "玄武石"]);

const DEFAULT_MATERIAL_PRICES = {
  shendoudou: 30000,
  baoshichui: 25000,
  jinliulu: 100,
  shenshou: 3000000,
  fabaoJinghua: 9000,
  jinliuluMinForRatio: 99,
};
const MATERIAL_PRICES_STORAGE_KEY = "cbg_material_prices";

function loadMaterialPrices() {
  try {
    const raw = localStorage.getItem(MATERIAL_PRICES_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_MATERIAL_PRICES };
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_MATERIAL_PRICES, ...parsed };
  } catch {
    return { ...DEFAULT_MATERIAL_PRICES };
  }
}

let materialPrices = loadMaterialPrices();

function saveMaterialPrices() {
  localStorage.setItem(MATERIAL_PRICES_STORAGE_KEY, JSON.stringify(materialPrices));
}

function getMaterialPrices() {
  return materialPrices;
}

function matchKeyItem(name, item) {
  if (!name) return false;
  if (item.key === "shendoudou") return name === "神兜兜";
  if (item.key === "baoshichui") return name.includes("宝石锤");
  if (item.key === "jinliulu") return name === "金柳露";
  if (item.key === "jinghua") return name.endsWith("·精华");
  if (item.key === "wuse_shi") return STONE_NAMES.has(name);
  return false;
}

function esc(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function roleKey(role) {
  return `${role._server_key || ""}:${role.ordersn}`;
}

function officialUrl(role) {
  const sn = role.ordersn;
  if (!sn) return null;
  let sid = role.serverid;
  if (!sid) {
    const parts = String(sn).split("-");
    if (parts.length >= 2) sid = parts[1];
  }
  if (!sid) return null;
  return `https://my.cbg.163.com/cgi/mweb/equip/${sid}/${encodeURIComponent(sn)}`;
}

const YI = 100_000_000;
const EXP_69_TO_89 = 18.38 * YI;
const EXP_69_TO_115 = 87.49 * YI;
const EXP_89_TO_115 = 69.11 * YI;

/** 时空区开服日（官网公告）。直升 115 仅非时空区，或开区已满 2 年的时空区服。 */
const SHIKONG_OPEN_DATES = {
  英雄本色: "2024-06-21",
  传说: "2024-07-12",
  一心一意: "2024-07-26",
  友情岁月: "2024-08-02",
  我们结婚吧: "2024-08-09",
  出神入化: "2024-08-16",
  侠客行: "2024-08-23",
  同桌的你: "2024-08-30",
  晚安大小姐: "2024-09-06",
  家好月圆: "2024-09-13",
  秋风满月: "2024-09-20",
  华夏: "2024-09-27",
  诗和远方: "2024-10-04",
  佳人有约: "2024-11-01",
  "＃２４": "2024-11-22",
};

function currentExp(role) {
  const n = Number(role.当前经验);
  return Number.isFinite(n) ? n : null;
}

function totalExp(role) {
  const n = Number(role.总经验);
  return Number.isFinite(n) ? n : null;
}

function usableExp(role) {
  const total = totalExp(role);
  const current = currentExp(role);
  if (total == null || current == null) return null;
  return Math.max(0, total - current);
}

function fmtExpYi(n) {
  if (n == null || Number.isNaN(n)) return "-";
  const yi = n / YI;
  if (yi >= 100) return `${Math.round(yi).toLocaleString("zh-CN")}亿`;
  if (yi >= 10) return `${yi.toFixed(1)}亿`;
  return `${yi.toFixed(2)}亿`;
}

function twoYearsAgoDate() {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 2);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function showBoost115(role) {
  if ((role.area_name || "") !== "时空区") return true;
  const opened = SHIKONG_OPEN_DATES[role.server_name];
  if (!opened) return false;
  return opened <= twoYearsAgoDate();
}

function boostProgress(have, need, alreadyDone) {
  if (alreadyDone) return { pct: 1, have: have ?? 0, need, done: true };
  if (have == null || !need) return null;
  return { pct: Math.max(0, Math.min(1, have / need)), have, need, done: have >= need };
}

function boost89(role) {
  const have = usableExp(role);
  const level = Number(role.level || 0);
  return boostProgress(have, EXP_69_TO_89, level >= 89);
}

function boost115(role) {
  if (!showBoost115(role)) return null;
  const have = usableExp(role);
  const level = Number(role.level || 0);
  if (level >= 115) return boostProgress(have, EXP_89_TO_115, true);
  const need = level >= 89 ? EXP_89_TO_115 : EXP_69_TO_115;
  return boostProgress(have, need, false);
}

function renderBoostBar(info, label) {
  if (!info) return `<span class="muted">-</span>`;
  const pct = Math.round(info.pct * 100);
  const title = info.done
    ? `${label} 已达`
    : `${label} ${fmtExpYi(info.have)} / ${fmtExpYi(info.need)}（${pct}%）`;
  return `<div class="boost-bar" title="${esc(title)}">
    <span class="boost-label">${esc(label)}</span>
    <span class="boost-track"><span class="boost-fill${info.done ? " done" : ""}" style="width:${pct}%"></span></span>
    <span class="boost-pct">${info.done ? "满" : `${pct}%`}</span>
  </div>`;
}

function goldWan(role) {
  const gold = Number(role.金币 ?? 0);
  return gold / 10000;
}

function goldRatio(role) {
  const price = Number(role.price ?? 0);
  if (!price) return null;
  return goldWan(role) / price;
}

function fmtGoldWan(role) {
  const wan = goldWan(role);
  if (!wan) return "0";
  return wan >= 100 ? Math.round(wan).toLocaleString("zh-CN") : wan.toFixed(1);
}

function freezeGold(role) {
  const value = role["冻结金币"];
  if (value == null || value === "") return null;
  return Number(value);
}

function fmtFreezeWan(role) {
  const gold = freezeGold(role);
  if (gold == null || Number.isNaN(gold)) return "-";
  const wan = gold / 10000;
  if (!wan) return "0";
  return wan >= 100 ? Math.round(wan).toLocaleString("zh-CN") : wan.toFixed(1);
}

function fmtRatio(role) {
  const ratio = goldRatio(role);
  if (ratio == null) return "-";
  return ratio.toFixed(2);
}

function fabaoJinghuaCount(role) {
  if (role.fabao_jinghua != null) return Number(role.fabao_jinghua) || 0;
  let n = 0;
  for (const eq of role.equips || []) {
    if (eq.type !== "仓库物品") continue;
    const name = eq.name || "";
    if (!name.endsWith("·精华") || name.includes("礼包")) continue;
    n += Number(eq.amount || 1);
  }
  return n;
}

function materialRatio(role) {
  const prices = getMaterialPrices();
  const price = Number(role.price ?? 0);
  if (!price) return null;
  const items = role._key_items || computeKeyItems(role);
  const gold = Number(role.金币 ?? 0);
  const jll = items.jinliulu || 0;
  const jllPart = jll >= prices.jinliuluMinForRatio ? jll * prices.jinliulu : 0;
  const value = gold
    + (items.shendoudou || 0) * prices.shendoudou
    + (items.baoshichui || 0) * prices.baoshichui
    + jllPart
    + fabaoJinghuaCount(role) * prices.fabaoJinghua
    + shenshouCount(role) * prices.shenshou;
  return value / price / 10000;
}

function fmtMaterialRatio(role) {
  const ratio = materialRatio(role);
  if (ratio == null) return "-";
  return ratio.toFixed(2);
}

function materialGold(role) {
  const prices = getMaterialPrices();
  const items = role._key_items || computeKeyItems(role);
  const gold = Number(role.金币 ?? 0);
  return gold
    + (items.shendoudou || 0) * prices.shendoudou
    + (items.baoshichui || 0) * prices.baoshichui
    + (items.jinliulu || 0) * prices.jinliulu
    + fabaoJinghuaCount(role) * prices.fabaoJinghua
    + shenshouCount(role) * prices.shenshou;
}

function fmtMaterialGold(role) {
  const value = materialGold(role);
  if (!value) return "0";
  return value.toLocaleString("zh-CN");
}

function fmtMaterialGoldWan(role) {
  const wan = materialGold(role) / 10000;
  if (!wan) return "0";
  return wan >= 100 ? Math.round(wan).toLocaleString("zh-CN") : wan.toFixed(1);
}

function computeKeyItems(role) {
  const counts = Object.fromEntries(KEY_ITEMS.map((item) => [item.key, 0]));
  for (const eq of role.equips || []) {
    const name = eq.name || "";
    const amount = Number(eq.amount || 1);
    for (const item of KEY_ITEMS) {
      if (matchKeyItem(name, item)) counts[item.key] += amount;
    }
  }
  return counts;
}

function keyItemCount(role, key) {
  const items = role._key_items || computeKeyItems(role);
  return items[key] || 0;
}

const SHENSHOU_LIFE = 999999;

function shenshouCount(role) {
  if (role["神兽数"] != null) return Number(role["神兽数"]) || 0;
  let n = 0;
  for (const pet of role.summons || []) {
    if (Number(pet.life) === SHENSHOU_LIFE) n++;
  }
  return n;
}

function fmtLife(life) {
  if (life == null || life === "") return "-";
  const n = Number(life);
  if (n === SHENSHOU_LIFE) return "永久";
  return Number.isNaN(n) ? String(life) : n.toLocaleString("zh-CN");
}

function computeItemTotals(roles) {
  const totals = Object.fromEntries(KEY_ITEMS.map((item) => [item.key, { count: 0, roles: 0 }]));
  for (const role of roles) {
    for (const item of KEY_ITEMS) {
      const n = keyItemCount(role, item.key);
      if (n > 0) {
        totals[item.key].count += n;
        totals[item.key].roles += 1;
      }
    }
  }
  return totals;
}

function renderListSummary(totals) {
  return `<div class="list-summary">
    <div class="list-summary-title">当前列表汇总</div>
    <div class="list-summary-grid">${KEY_ITEMS.map((item) => {
      const t = totals[item.key];
      const sub = item.sub ? `${item.sub} · ${t.roles} 角色` : `${t.roles} 角色`;
      return `<div class="list-summary-item ${item.css}">
        <span class="label">${esc(item.label)}</span>
        <span class="value">${esc(t.count.toLocaleString("zh-CN"))}</span>
        <span class="sub">${esc(sub)}</span>
      </div>`;
    }).join("")}</div>
  </div>`;
}

function getSelectedServerKeys() {
  return [...selectedServerKeys];
}

function updateServerMultiLabel() {
  const label = $("#serverMultiLabel");
  const keys = getSelectedServerKeys();
  if (!keys.length) {
    label.textContent = "请选择服务器";
    return;
  }
  const names = keys.map(
    (key) => META.servers.find((s) => s.key === key)?.server_name || key,
  );
  if (names.length <= 2) {
    label.textContent = names.join("、");
    return;
  }
  label.textContent = `${names.slice(0, 2).join("、")} 等 ${names.length} 个`;
}

function setServerMultiOpen(open) {
  const panel = $("#serverMultiPanel");
  const trigger = $("#serverMultiTrigger");
  panel.hidden = !open;
  trigger.setAttribute("aria-expanded", open ? "true" : "false");
  $("#serverMulti").classList.toggle("open", open);
  if (open) {
    requestAnimationFrame(() => {
      const input = $("#serverSearch");
      if (input) {
        input.focus();
        input.select();
      }
    });
  } else {
    const input = $("#serverSearch");
    if (input) input.value = "";
    fillServerOptions($("#area").value);
  }
}

function normalizeServerSearch(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[\s·\-_.]/g, "");
}

function serverHaystack(s) {
  const pinyin = s.pinyin || s.key || "";
  return [
    s.server_name,
    s.area_name,
    s.key,
    pinyin,
    s.area_pinyin,
    pinyin.replace(/_/g, " "),
    pinyin.replace(/_/g, ""),
  ]
    .map(normalizeServerSearch)
    .join("|");
}

function serverMatchesSearch(s, query) {
  const q = (query || "").trim();
  if (!q) return true;
  const nq = normalizeServerSearch(q);
  if (nq && serverHaystack(s).includes(nq)) return true;
  if ((s.server_name || "").includes(q)) return true;
  if ((s.area_name || "").includes(q)) return true;
  return false;
}

function highlightMatch(text, query) {
  const raw = String(text ?? "");
  if (!raw) return "";
  const q = (query || "").trim();
  if (!q) return esc(raw);
  const lower = raw.toLowerCase();
  const ql = q.toLowerCase();
  const idx = lower.indexOf(ql);
  if (idx >= 0) {
    return (
      esc(raw.slice(0, idx))
      + `<mark class="search-hit">${esc(raw.slice(idx, idx + q.length))}</mark>`
      + esc(raw.slice(idx + q.length))
    );
  }
  return esc(raw);
}

function getServerSearchQuery() {
  return ($("#serverSearch")?.value || "").trim();
}

function sellingTs(role) {
  const raw = Number(role?.selling_time || 0);
  if (!raw) return 0;
  return raw > 1_000_000_000_000 ? Math.floor(raw / 1000) : raw;
}

function liveSaleStatus(role, nowMs = Date.now()) {
  const stored = role.sale_status || "";
  if (stored === "sold" || stored === "reviewing") return stored;
  const ts = sellingTs(role);
  if (!ts) return stored;
  return ts * 1000 > nowMs ? "fair_show" : "onsale";
}

function saleStatusLabel(status) {
  if (status === "fair_show") return "公示期";
  if (status === "onsale") return "上架中";
  if (status === "reviewing") return "审核中";
  if (status === "sold") return "已售出";
  return status || "-";
}

function fmtSaleStatus(role) {
  return saleStatusLabel(liveSaleStatus(role));
}

function fmtSaleTime(role, nowMs = Date.now()) {
  const status = liveSaleStatus(role, nowMs);
  if (status === "sold") return "已售出";
  if (status === "reviewing") return "审核中";
  const ts = sellingTs(role);
  if (!ts) {
    return status === "fair_show" ? "公示结束时间未收录" : "-";
  }

  const dt = new Date(ts * 1000);
  const timeText = `${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")} ${String(dt.getHours()).padStart(2, "0")}:${String(dt.getMinutes()).padStart(2, "0")}`;
  if (status === "fair_show") {
    const remain = ts - Math.floor(nowMs / 1000);
    if (remain > 0) return `至 ${timeText} · ${fmtRemain(remain)}后可买`;
    return `${timeText} 已可买`;
  }
  if (status === "onsale") return `${timeText} 上架`;
  return timeText;
}

function saleTimeHtml(role) {
  const ts = sellingTs(role);
  const status = liveSaleStatus(role);
  const remain = ts ? ts - Math.floor(Date.now() / 1000) : 0;
  const counting = status === "fair_show" && remain > 0;
  const extras = [
    counting ? "is-countdown" : "",
    status === "fair_show" ? "is-fair" : "",
    status === "sold" ? "is-sold" : "",
  ].filter(Boolean).join(" ");
  return `<span class="sale-time${extras ? ` ${extras}` : ""}" data-sale-status="${esc(role.sale_status || "")}" data-selling-time="${ts}">${esc(fmtSaleTime(role))}</span>`;
}

let saleTickTimer = null;

function refreshSaleTimes() {
  const allowed = getSelectedSaleStatuses();
  document.querySelectorAll(".sale-time[data-selling-time]").forEach((el) => {
    const role = {
      sale_status: el.dataset.saleStatus,
      selling_time: Number(el.dataset.sellingTime || 0),
    };
    const live = liveSaleStatus(role);
    const remain = sellingTs(role) ? sellingTs(role) - Math.floor(Date.now() / 1000) : 0;
    el.textContent = fmtSaleTime(role);
    el.classList.toggle("is-countdown", live === "fair_show" && remain > 0);
    el.classList.toggle("is-fair", live === "fair_show");
    el.classList.toggle("is-sold", live === "sold");
    const row = el.closest(".role-row, .stat-item");
    const tag = row?.querySelector(".sale-tag");
    if (tag) {
      tag.className = `sale-tag ${live || "unknown"}`;
      tag.textContent = saleStatusLabel(live);
    }
    const listRow = el.closest(".role-row");
    if (listRow && allowed.length) {
      listRow.hidden = Boolean(live && !allowed.includes(live));
    }
  });
}

function startSaleTick() {
  if (saleTickTimer) clearInterval(saleTickTimer);
  saleTickTimer = null;
  if (!document.querySelector(".sale-time.is-countdown")) return;
  saleTickTimer = setInterval(refreshSaleTimes, 1000);
}

function fmtRemain(seconds) {
  let remain = Math.max(seconds, 0);
  const days = Math.floor(remain / 86400);
  remain %= 86400;
  const hours = Math.floor(remain / 3600);
  remain %= 3600;
  const minutes = Math.floor(remain / 60);
  const secs = remain % 60;
  if (days) return `${days}天${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
  if (hours) return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function isChipActive(id) {
  const el = $(`#${id}`);
  return el?.getAttribute("aria-pressed") === "true";
}

function getSelectedSaleStatuses() {
  return ["saleFairShow", "saleOnsale", "saleSold"]
    .filter((id) => isChipActive(id))
    .map((id) => $(`#${id}`).dataset.value);
}

function getPetSlotMinFilter() {
  const raw = $("#petSlotMin")?.value;
  if (raw !== "" && raw != null) {
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  }
  if (isChipActive("petSlotGt12")) {
    return Number($("#petSlotGt12")?.dataset.min || 12);
  }
  return null;
}

function getSelectedTaskKeys() {
  return [...selectedTaskKeys];
}

function updateTaskMultiLabel() {
  const label = $("#taskMultiLabel");
  if (!label) return;
  const keys = getSelectedTaskKeys();
  if (!keys.length) {
    label.textContent = "全部任务";
    return;
  }
  const names = keys.map(
    (key) => (META.tasks || []).find((t) => t.key === key)?.label || key,
  );
  if (names.length <= 2) {
    label.textContent = names.join("、");
    return;
  }
  label.textContent = `${names.slice(0, 2).join("、")} 等 ${names.length} 个`;
}

function setTaskMultiOpen(open) {
  const panel = $("#taskMultiPanel");
  const trigger = $("#taskMultiTrigger");
  if (!panel || !trigger) return;
  panel.hidden = !open;
  trigger.setAttribute("aria-expanded", open ? "true" : "false");
  $("#taskMulti")?.classList.toggle("open", open);
}

function fillTaskOptions() {
  const el = $("#taskList");
  if (!el) return;
  const list = [...(META.tasks || [])].sort((a, b) =>
    String(a.label || a.key).localeCompare(String(b.label || b.key), "zh-CN"),
  );
  if (!list.length) {
    el.innerHTML = '<span class="empty-hint">暂无任务标记</span>';
    updateTaskMultiLabel();
    return;
  }
  el.innerHTML = list.map((t) => {
    const active = selectedTaskKeys.has(t.key);
    const count = t.count != null ? ` · ${t.count}` : "";
    return `<button
      type="button"
      class="multiselect-option${active ? " selected" : ""}"
      data-key="${esc(t.key)}"
      role="option"
      aria-selected="${active ? "true" : "false"}"
    >
      <span class="option-main">
        <span>${esc(t.label || t.key)}</span>
        <span class="option-sub">${esc(t.key)}${esc(count)}</span>
      </span>
      <span class="multiselect-check" aria-hidden="true">✓</span>
    </button>`;
  }).join("");
  updateTaskMultiLabel();
}

function fmtCrawlTasks(role) {
  const tags = Array.isArray(role.crawl_tags) ? role.crawl_tags : [];
  const labels = [...new Set(tags.map((t) => t.task_label || t.task).filter(Boolean))];
  if (!labels.length) return '<span class="muted">-</span>';
  return `<span class="task-tags">${labels.map((label) =>
    `<span class="task-tag">${esc(label)}</span>`
  ).join("")}</span>`;
}

function getFilters() {
  return {
    serverKeys: getSelectedServerKeys(),
    taskKeys: getSelectedTaskKeys(),
    saleStatuses: getSelectedSaleStatuses(),
    goldMin: $("#goldMin").value ? Number($("#goldMin").value) : null,
    roleName: $("#roleName").value.trim(),
    school: $("#school").value,
    priceMin: $("#priceMin").value ? Number($("#priceMin").value) : null,
    priceMax: $("#priceMax").value ? Number($("#priceMax").value) : null,
    ratioMin: $("#ratioMin").value ? Number($("#ratioMin").value) : null,
    hasShendoudou: isChipActive("hasShendoudou"),
    hasBaoshichui: isChipActive("hasBaoshichui"),
    petSlotMin: getPetSlotMinFilter(),
  };
}

function filterRoles() {
  return DATA.roles;
}

function flattenDetails(roles) {
  const rows = [];
  for (const role of roles) {
    for (const eq of role.equips || []) {
      rows.push({
        area_name: role.area_name,
        server_name: role.server_name,
        role_name: role.role_name,
        price: role.price,
        gold_wan: fmtGoldWan(role),
        gold_ratio: fmtRatio(role),
        shendoudou: keyItemCount(role, "shendoudou") || "",
        baoshichui: keyItemCount(role, "baoshichui") || "",
        明细类型: eq.type,
        名称: eq.name,
        数量: eq.amount,
        属性: eq.props,
        特效: eq.special,
        宠物评分: "",
        召唤等级: eq.level,
        速度: "",
        技能: "",
        参战: eq.wearing ? "穿戴" : "",
      });
    }
    for (const pet of role.summons || []) {
      rows.push({
        area_name: role.area_name,
        server_name: role.server_name,
        role_name: role.role_name,
        price: role.price,
        gold_wan: fmtGoldWan(role),
        gold_ratio: fmtRatio(role),
        shendoudou: keyItemCount(role, "shendoudou") || "",
        baoshichui: keyItemCount(role, "baoshichui") || "",
        明细类型: pet.type,
        名称: pet.name,
        数量: "",
        属性: "",
        特效: "",
        宠物评分: pet.pet_score,
        召唤等级: pet.level,
        速度: pet.speed,
        技能: pet.skills,
        参战: pet.fighting,
      });
    }
  }
  return rows;
}

function fmtStatValue(value) {
  if (value == null || value === "") return "-";
  if (typeof value === "number") return fmtNum(value);
  return String(value);
}

function fmtNum(n) {
  if (n == null || n === "") return "-";
  return Number(n).toLocaleString("zh-CN");
}

function groupEquips(equips) {
  const groups = {};
  for (const eq of equips || []) {
    const type = eq.type || "其他";
    (groups[type] ||= []).push(eq);
  }
  const order = [...EQUIP_TYPE_ORDER, ...Object.keys(groups).filter((t) => !EQUIP_TYPE_ORDER.includes(t))];
  return order.filter((t) => groups[t]?.length).map((type) => ({ type, items: groups[type] }));
}

function renderEquipRow(eq) {
  const extra = [eq.props, eq.special, eq.score != null ? `评分${eq.score}` : "", eq.wearing ? "穿戴" : ""]
    .filter(Boolean)
    .join(" · ");
  return `<tr>
    <td data-label="名称">${esc(eq.name)}</td>
    <td data-label="数量">${esc(eq.amount ?? 1)}</td>
    <td data-label="属性">${esc(extra)}</td>
  </tr>`;
}

function renderPetRow(pet) {
  const extra = [
    pet.hp != null ? `气血${pet.hp}` : "",
    pet.speed != null ? `速${pet.speed}` : "",
    pet.growth != null ? `成长${pet.growth}` : "",
    pet.fighting ? "参战" : "",
  ].filter(Boolean).join(" · ");
  const isShenshou = Number(pet.life) === SHENSHOU_LIFE;
  return `<tr>
    <td data-label="名称">${esc(pet.name)}${isShenshou ? ' <span class="shenshou-tag">神兽</span>' : ""}</td>
    <td data-label="等级">${esc(pet.level ?? "-")}</td>
    <td data-label="评分">${esc(pet.pet_score ?? "-")}</td>
    <td data-label="寿命" class="${isShenshou ? "shenshou" : ""}">${esc(fmtLife(pet.life))}</td>
    <td data-label="技能">${esc(pet.skills ?? "-")}</td>
    <td data-label="属性">${esc(extra)}</td>
  </tr>`;
}

function showRoleDetail(role) {
  const stats = [
    ["大区", role.area_name], ["服务器", role.server_name],
    ["上架状态", fmtSaleStatus(role)], ["可购买", fmtSaleTime(role)],
    ["金币（万）", fmtGoldWan(role)], ["冻结金币（万）", fmtFreezeWan(role)],
    ["金币/价格", fmtRatio(role)], ["物资比", fmtMaterialRatio(role)], ["物资估算金币", fmtMaterialGold(role)],
    ...KEY_ITEMS.map((item) => [item.label, keyItemCount(role, item.key) || "-"]),
    ["气血", role.气血], ["魔法", role.魔法], ["物伤", role.物伤], ["法伤", role.法伤],
    ["速度", role.速度], ["防御", role.防御], ["法防", role.法防],
    ["银币", role.银币], ["仙玉", role.仙玉],
    ["当前经验", fmtExpYi(currentExp(role))], ["总经验", fmtExpYi(totalExp(role))],
    ["可使用经验", fmtExpYi(usableExp(role))],
    ["人物评分", role["人物评分"]], ["装备评分", role["装备评分"]],
    ["召唤灵评分", role["召唤灵评分"]], ["修炼评分", role.修炼评分],
    ["宠物格子", role["宠物格子数"]], ["神兽数", shenshouCount(role)],
  ];

  const equipGroups = groupEquips(role.equips);
  const summons = role.summons || [];
  const url = officialUrl(role);

  roleModalBody.innerHTML = `
    <div class="detail-header">
      <h2>${esc(role.role_name)} · ${esc(role.school)} Lv${esc(role.level)}</h2>
      <div class="price">¥${esc(role.price)}</div>
      <div class="sub">${esc(role.area_name)} · ${esc(role.server_name)} · ${esc(role.desc_sumup)}</div>
      <div class="sub">金币 ${esc(fmtGoldWan(role))} 万 · 金币/价格 ${esc(fmtRatio(role))} · 物资比 ${esc(fmtMaterialRatio(role))}</div>
      <div class="sub">当前经验 ${esc(fmtExpYi(currentExp(role)))} · 总经验 ${esc(fmtExpYi(totalExp(role)))} · 可使用 ${esc(fmtExpYi(usableExp(role)))}</div>
      <div class="boost-bars detail-boost">${renderBoostBar(boost89(role), "直升89")}${renderBoostBar(boost115(role), "直升115")}</div>
      <div class="sub">${esc(role.ordersn)}</div>
      ${url ? `<a class="official-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer">查看官方原页 ↗</a>` : ""}
    </div>
    <div class="detail-stats">
      ${stats.map(([label, value]) => `
        <div class="stat-item">
          <div class="label">${esc(label)}</div>
          <div class="value">${label === "可购买" ? saleTimeHtml(role) : esc(fmtStatValue(value))}</div>
        </div>
      `).join("")}
    </div>
    <div class="detail-section">
      <h3>装备 / 物品 (${(role.equips || []).length})</h3>
      ${equipGroups.length ? equipGroups.map((g) => `
        <div class="subgroup">
          <div class="subgroup-title">${esc(g.type)} (${g.items.length})</div>
          <table class="detail-table">
            <thead><tr><th>名称</th><th>数量</th><th>属性 / 备注</th></tr></thead>
            <tbody>${g.items.map(renderEquipRow).join("")}</tbody>
          </table>
        </div>
      `).join("") : '<div class="empty">无装备物品明细</div>'}
    </div>
    <div class="detail-section">
      <h3>召唤灵 (${summons.length})</h3>
      ${summons.length ? `
        <table class="detail-table">
          <thead><tr><th>名称</th><th>等级</th><th>评分</th><th>寿命</th><th>技能</th><th>属性</th></tr></thead>
          <tbody>${summons.map(renderPetRow).join("")}</tbody>
        </table>
      ` : '<div class="empty">无召唤灵</div>'}
    </div>
  `;

  roleModal.hidden = false;
  document.body.classList.add("modal-open");
  startSaleTick();
}

function closeRoleModal() {
  roleModal.hidden = true;
  document.body.classList.remove("modal-open");
}

const DESC_SORT_KEYS = new Set([
  "material_ratio", "material_gold", "gold_ratio", "gold", "freeze", "price", "xianyu",
  "pet_slot", "shenshou", "shendoudou", "baoshichui", "jinliulu", "jinghua", "wuse_shi",
  "current_exp", "total_exp", "usable_exp", "boost89", "boost115",
]);

const ROLE_SORT_KEYS = {
  material_ratio: (role) => materialRatio(role) ?? -1,
  material_gold: (role) => materialGold(role),
  gold_ratio: (role) => goldRatio(role) ?? -1,
  price: (role) => Number(role.price ?? 0),
  gold: (role) => goldWan(role),
  freeze: (role) => freezeGold(role) ?? -1,
  xianyu: (role) => Number(role.仙玉 ?? 0),
  level: (role) => Number(role.level ?? 0),
  pet_slot: (role) => Number(role["宠物格子数"] ?? 0),
  shenshou: (role) => shenshouCount(role),
  shendoudou: (role) => keyItemCount(role, "shendoudou"),
  baoshichui: (role) => keyItemCount(role, "baoshichui"),
  jinliulu: (role) => keyItemCount(role, "jinliulu"),
  jinghua: (role) => keyItemCount(role, "jinghua"),
  wuse_shi: (role) => keyItemCount(role, "wuse_shi"),
  current_exp: (role) => currentExp(role) ?? -1,
  total_exp: (role) => totalExp(role) ?? -1,
  usable_exp: (role) => usableExp(role) ?? -1,
  boost89: (role) => boost89(role)?.pct ?? -1,
  boost115: (role) => boost115(role)?.pct ?? -1,
};

function sortRoles(roles) {
  const getter = ROLE_SORT_KEYS[roleSort.key] || ROLE_SORT_KEYS.material_ratio;
  const dir = roleSort.dir === "asc" ? 1 : -1;
  return [...roles].sort((a, b) => {
    const av = getter(a);
    const bv = getter(b);
    if (av < bv) return -1 * dir;
    if (av > bv) return 1 * dir;
    return String(a.role_name || "").localeCompare(String(b.role_name || ""), "zh-CN");
  });
}

const MOBILE_SORTS = [
  ["material_ratio", "物资比"],
  ["price", "价格"],
  ["gold", "金币"],
  ["gold_ratio", "金币/价格"],
  ["usable_exp", "可使用经验"],
  ["boost115", "直升115"],
  ["boost89", "直升89"],
  ["level", "等级"],
  ["xianyu", "仙玉"],
  ["shenshou", "神兽"],
];

function isMobileLayout() {
  return window.matchMedia("(max-width: 768px)").matches;
}

function setFiltersOpen(open) {
  $("#filtersCard")?.classList.toggle("is-open", open);
  document.body.classList.toggle("filters-open", open);
}

function renderMobileSortBar() {
  return `<label class="mobile-sort mobile-only">排序
    <select id="mobileSort" aria-label="排序">
      ${MOBILE_SORTS.map(([key, label]) =>
        `<option value="${esc(key)}"${roleSort.key === key ? " selected" : ""}>${esc(label)}</option>`
      ).join("")}
    </select>
  </label>`;
}

function renderRoleCard(r) {
  const itemTags = KEY_ITEMS.filter((item) => keyItemCount(r, item.key) > 0)
    .map((item) => `<span class="tag key-item ${item.css}">${esc(item.label)} ${esc(keyItemCount(r, item.key))}</span>`)
    .join("");
  const shenshou = shenshouCount(r);
  return `<article class="role-card role-row" data-role-key="${esc(roleKey(r))}" tabindex="0">
    <div class="role-card-top">
      <div>
        <div class="role-card-name">${esc(r.role_name)} · ${esc(r.school)} ${esc(r.level ?? "")}</div>
        <div class="role-card-sub">${esc(r.area_name || "")} ${esc(r.server_name || "")}</div>
      </div>
      <div class="role-card-price">¥${esc(r.price)}</div>
    </div>
    <div class="role-card-meta">
      <span class="sale-tag ${esc(liveSaleStatus(r) || "unknown")}">${esc(fmtSaleStatus(r))}</span>
      ${saleTimeHtml(r)}
      ${fmtCrawlTasks(r)}
    </div>
    <div class="role-card-grid">
      <div class="role-card-kv"><div class="k">金币</div><div class="v gold">${esc(fmtGoldWan(r))}万</div></div>
      <div class="role-card-kv"><div class="k">金币/价格</div><div class="v ratio">${esc(fmtRatio(r))}</div></div>
      <div class="role-card-kv"><div class="k">物资比</div><div class="v ratio">${esc(fmtMaterialRatio(r))}</div></div>
      <div class="role-card-kv"><div class="k">可使用经验</div><div class="v">${esc(fmtExpYi(usableExp(r)))}</div></div>
    </div>
    <div class="boost-bars">${renderBoostBar(boost89(r), "89")}${renderBoostBar(boost115(r), "115")}</div>
    ${itemTags || shenshou ? `<div class="role-card-items">${itemTags}${shenshou ? `<span class="tag key-item">${esc(`神兽 ${shenshou}`)}</span>` : ""}</div>` : ""}
  </article>`;
}

function sortHeaderHtml(label, key) {
  const active = roleSort.key === key;
  const arrow = active ? (roleSort.dir === "asc" ? "↑" : "↓") : "↕";
  const cls = active ? "sort-arrow active" : "sort-arrow";
  return `${esc(label)}<span class="${cls}" aria-label="${active ? (roleSort.dir === "asc" ? "升序" : "降序") : "可排序"}">${arrow}</span>`;
}

function renderRoles(roles) {
  if (!DATA.loaded) {
    rolesPanel.innerHTML = '<div class="empty">数据加载中…</div>';
    return;
  }
  if (!roles.length) {
    rolesPanel.innerHTML = '<div class="empty">无匹配角色</div>';
    return;
  }
  const sorted = sortRoles(roles);
  const totals = computeItemTotals(roles);
  rolesPanel.innerHTML = `<div class="roles-list">${renderListSummary(totals)}${renderMobileSortBar()}<div class="role-cards mobile-only">${sorted.map(renderRoleCard).join("")}</div><div class="table-wrap desktop-only"><table class="roles-table">
    <thead><tr>
      <th>大区</th>
      <th>服务器</th>
      <th>任务</th>
      <th>角色</th>
      <th>门派</th>
      <th class="num sortable" data-sort="level">${sortHeaderHtml("等级", "level")}</th>
      <th class="num sortable" data-sort="current_exp">${sortHeaderHtml("当前经验", "current_exp")}</th>
      <th class="num sortable" data-sort="total_exp">${sortHeaderHtml("总经验", "total_exp")}</th>
      <th class="num sortable" data-sort="usable_exp">${sortHeaderHtml("可使用经验", "usable_exp")}</th>
      <th class="col-boost sortable" data-sort="boost89">${sortHeaderHtml("直升89", "boost89")}</th>
      <th class="col-boost sortable" data-sort="boost115">${sortHeaderHtml("直升115", "boost115")}</th>
      <th class="num sortable" data-sort="price">${sortHeaderHtml("价格", "price")}</th>
      <th>状态</th>
      <th>可购买</th>
      <th class="num sortable" data-sort="gold">${sortHeaderHtml("金币(万)", "gold")}</th>
      <th class="num sortable" data-sort="xianyu">${sortHeaderHtml("仙玉", "xianyu")}</th>
      <th class="num sortable" data-sort="freeze">${sortHeaderHtml("冻结(万)", "freeze")}</th>
      <th class="num sortable" data-sort="gold_ratio">${sortHeaderHtml("金币/价格", "gold_ratio")}</th>
      <th class="num sortable col-material-ratio" data-sort="material_ratio">${sortHeaderHtml("物资比", "material_ratio")}</th>
      <th class="num sortable col-material-gold" data-sort="material_gold">${sortHeaderHtml("物资估算金币", "material_gold")}</th>
      <th class="num sortable" data-sort="shendoudou">${sortHeaderHtml("神兜兜", "shendoudou")}</th>
      <th class="num sortable" data-sort="baoshichui">${sortHeaderHtml("宝石锤", "baoshichui")}</th>
      <th class="num sortable" data-sort="jinliulu">${sortHeaderHtml("金柳露", "jinliulu")}</th>
      <th class="num sortable" data-sort="jinghua">${sortHeaderHtml("精华", "jinghua")}</th>
      <th class="num sortable" data-sort="wuse_shi">${sortHeaderHtml("四色石", "wuse_shi")}</th>
      <th class="num sortable" data-sort="pet_slot">${sortHeaderHtml("宠物格子", "pet_slot")}</th>
      <th class="num sortable col-shenshou" data-sort="shenshou">${sortHeaderHtml("神兽", "shenshou")}</th>
      <th class="num">人物评分</th>
      <th class="num">装备评分</th>
      <th class="num">召唤灵评分</th>
    </tr></thead>
    <tbody>${sorted.map((r) => `
      <tr class="role-row" data-role-key="${esc(roleKey(r))}" tabindex="0" title="点击查看明细">
        <td>${esc(r.area_name)}</td>
        <td>${esc(r.server_name)}</td>
        <td class="task-cell">${fmtCrawlTasks(r)}</td>
        <td class="name">${esc(r.role_name)}</td>
        <td>${esc(r.school)}</td>
        <td class="num">${esc(r.level ?? "-")}</td>
        <td class="num exp">${esc(fmtExpYi(currentExp(r)))}</td>
        <td class="num exp">${esc(fmtExpYi(totalExp(r)))}</td>
        <td class="num exp">${esc(fmtExpYi(usableExp(r)))}</td>
        <td class="col-boost">${renderBoostBar(boost89(r), "89")}</td>
        <td class="col-boost">${renderBoostBar(boost115(r), "115")}</td>
        <td class="num price">¥${esc(r.price)}</td>
        <td><span class="sale-tag ${esc(liveSaleStatus(r) || "unknown")}">${esc(fmtSaleStatus(r))}</span></td>
        <td>${saleTimeHtml(r)}</td>
        <td class="num gold">${esc(fmtGoldWan(r))}</td>
        <td class="num xianyu">${esc(fmtNum(r["仙玉"]))}</td>
        <td class="num freeze">${esc(fmtFreezeWan(r))}</td>
        <td class="num ratio">${esc(fmtRatio(r))}</td>
        <td class="num ratio col-material-ratio">${esc(fmtMaterialRatio(r))}</td>
        <td class="num material-gold col-material-gold">${esc(fmtMaterialGold(r))}</td>
        <td class="num">${esc(keyItemCount(r, "shendoudou") || "-")}</td>
        <td class="num">${esc(keyItemCount(r, "baoshichui") || "-")}</td>
        <td class="num item-jinliulu">${esc(keyItemCount(r, "jinliulu") || "-")}</td>
        <td class="num item-jinghua">${esc(keyItemCount(r, "jinghua") || "-")}</td>
        <td class="num item-wuse-shi">${esc(keyItemCount(r, "wuse_shi") || "-")}</td>
        <td class="num">${esc(r["宠物格子数"] ?? "-")}</td>
        <td class="num shenshou col-shenshou">${esc(shenshouCount(r) || "-")}</td>
        <td class="num">${esc(fmtNum(r["人物评分"]))}</td>
        <td class="num">${esc(fmtNum(r["装备评分"]))}</td>
        <td class="num">${esc(fmtNum(r["召唤灵评分"]))}</td>
      </tr>
    `).join("")}</tbody>
  </table></div></div>`;
}

function renderDataCard(row, columns) {
  const title = row["名称"] || row.role_name || "-";
  const skip = new Set(["名称"]);
  const sub = [row.area_name, row.server_name, row.role_name]
    .filter((v, i, arr) => v && arr.indexOf(v) === i)
    .join(" · ");
  const kvs = columns
    .filter((c) => !skip.has(c.key) && row[c.key] != null && row[c.key] !== "")
    .map((c) => `<div class="role-card-kv"><div class="k">${esc(c.label)}</div><div class="v">${esc(row[c.key])}</div></div>`)
    .join("");
  return `<article class="data-card">
    <div class="data-card-title">${esc(title)}</div>
    ${sub ? `<div class="data-card-sub">${esc(sub)}</div>` : ""}
    <div class="role-card-grid">${kvs}</div>
  </article>`;
}

function renderTable(panel, rows, columns) {
  if (!rows.length) {
    panel.innerHTML = '<div class="empty">无匹配数据</div>';
    return;
  }
  panel.innerHTML = `<div class="data-cards mobile-only">${rows.map((row) => renderDataCard(row, columns)).join("")}</div><div class="table-wrap desktop-only"><table class="data-table">
    <thead><tr>${columns.map((c) => `<th>${esc(c.label)}</th>`).join("")}</tr></thead>
    <tbody>${rows.map((row) => `<tr>${columns.map((c) => `<td>${esc(row[c.key])}</td>`).join("")}</tr>`).join("")}</tbody>
  </table></div>`;
}

function render() {
  const roles = filterRoles();
  const details = flattenDetails(roles);
  const pets = details.filter((d) =>
    d["明细类型"] === "召唤灵" || d["明细类型"] === "仓库召唤灵" || d["明细类型"] === "子女"
  );

  renderRoles(roles);
  renderTable(detailsPanel, details, [
    { key: "area_name", label: "大区" },
    { key: "server_name", label: "服务器" },
    { key: "role_name", label: "角色" },
    { key: "price", label: "价格" },
    { key: "gold_wan", label: "金币(万)" },
    { key: "gold_ratio", label: "金币/价格" },
    { key: "shendoudou", label: "神兜兜" },
    { key: "baoshichui", label: "宝石锤" },
    { key: "明细类型", label: "类型" },
    { key: "名称", label: "名称" },
    { key: "数量", label: "数量" },
    { key: "属性", label: "属性" },
    { key: "技能", label: "技能" },
  ]);
  renderTable(petsPanel, pets, [
    { key: "area_name", label: "大区" },
    { key: "role_name", label: "角色" },
    { key: "price", label: "价格" },
    { key: "gold_wan", label: "金币(万)" },
    { key: "gold_ratio", label: "金币/价格" },
    { key: "名称", label: "召唤灵" },
    { key: "宠物评分", label: "评分" },
    { key: "召唤等级", label: "等级" },
    { key: "速度", label: "速度" },
    { key: "技能", label: "技能" },
  ]);

  meta.textContent = DATA.metaText
    ? `${DATA.metaText} · 本页 ${roles.length} 条`
    : `本页 ${roles.length} 条`;
  renderPagination();
  startSaleTick();
}

function renderPagination() {
  if (!DATA.loaded) {
    paginationBar.hidden = true;
    return;
  }
  paginationBar.hidden = false;
  pageInfo.textContent = `第 ${DATA.page} / ${DATA.totalPages} 页 · 共 ${DATA.total} 条`;
  prevPageBtn.disabled = DATA.page <= 1;
  nextPageBtn.disabled = DATA.page >= DATA.totalPages;
}

function fillSelect(id, values) {
  const el = $(`#${id}`);
  const current = el.value;
  el.innerHTML = `<option value="">全部</option>${values.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join("")}`;
  if (values.includes(current)) el.value = current;
}

function fillServerOptions(areaFilter = "") {
  const el = $("#serverList");
  const query = getServerSearchQuery();
  const list = META.servers
    .filter((s) => !areaFilter || s.area_name === areaFilter)
    .filter((s) => serverMatchesSearch(s, query))
    .sort((a, b) => a.server_name.localeCompare(b.server_name, "zh-CN"));
  if (!list.length) {
    el.innerHTML = query
      ? '<span class="multiselect-empty">无匹配服务器，试试拼音或中文</span>'
      : '<span class="empty-hint">暂无服务器</span>';
    updateServerMultiLabel();
    return;
  }
  el.innerHTML = list.map((s) => {
    const active = selectedServerKeys.has(s.key);
    const hint = query && (s.pinyin || s.key)
      ? `<span class="option-sub">${esc(s.area_name || "")}${s.area_name ? " · " : ""}${esc(s.pinyin || s.key)}</span>`
      : "";
    return `<button
      type="button"
      class="multiselect-option${active ? " selected" : ""}"
      data-key="${esc(s.key)}"
      role="option"
      aria-selected="${active ? "true" : "false"}"
    >
      <span class="option-main">
        <span>${highlightMatch(s.server_name, query)}</span>
        ${hint}
      </span>
      <span class="multiselect-check" aria-hidden="true">✓</span>
    </button>`;
  }).join("");
  updateServerMultiLabel();
}

function buildFilterOptions() {
  fillSelect("area", META.areas);
  fillServerOptions($("#area").value);
  fillSelect("school", META.schools);
  fillTaskOptions();
}

function apiBase() {
  const cfg = window.MHCBG_CONFIG || {};
  // 空字符串表示同域部署（Vercel），请求 /api/*
  if (cfg.apiBase === undefined || cfg.apiBase === null) {
    return "";
  }
  return String(cfg.apiBase).replace(/\/$/, "");
}

function apiUrl(path) {
  const base = apiBase();
  const p = path.startsWith("/") ? path : `/${path}`;
  return base ? `${base}${p}` : p;
}

async function loadMeta() {
  const resp = await fetch(apiUrl("/api/meta"));
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  META = await resp.json();
  buildFilterOptions();
}

async function fetchRoles(page = DATA.page) {
  const f = getFilters();
  if (!f.serverKeys.length && !f.taskKeys.length) {
    throw new Error("请选择服务器或任务");
  }

  const params = new URLSearchParams({
    page: String(page),
    page_size: String(DATA.pageSize),
    sort: roleSort.key,
    sort_dir: roleSort.dir,
  });
  for (const key of f.serverKeys) {
    params.append("server_key", key);
  }
  for (const key of f.taskKeys) {
    params.append("task_key", key);
  }
  if (f.goldMin != null) params.set("gold_min", String(f.goldMin));
  if (f.roleName) params.set("role_name", f.roleName);
  if (f.school) params.set("school", f.school);
  if (f.priceMin != null) params.set("price_min", String(f.priceMin));
  if (f.priceMax != null) params.set("price_max", String(f.priceMax));
  if (f.ratioMin != null) params.set("ratio_min", String(f.ratioMin));
  if (f.hasShendoudou) params.set("has_shendoudou", "true");
  if (f.hasBaoshichui) params.set("has_baoshichui", "true");
  if (f.petSlotMin != null) params.set("pet_slot_min", String(f.petSlotMin));
  for (const status of f.saleStatuses) {
    params.append("sale_status", status);
  }

  meta.textContent = "加载中…";
  const resp = await fetch(`${apiUrl("/api/roles")}?${params}`);
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    const detail = err.detail;
    const message = typeof detail === "string"
      ? detail
      : Array.isArray(detail)
        ? detail.map((d) => d.msg || d).join("; ")
        : `HTTP ${resp.status}`;
    throw new Error(message);
  }
  const record = await resp.json();
  DATA.roles = record.roles || [];
  DATA.page = record.page || page;
  DATA.pageSize = record.page_size || DATA.pageSize;
  DATA.total = record.total || 0;
  DATA.totalPages = record.total_pages || 1;
  DATA.serverKeys = f.serverKeys;
  DATA.taskKeys = f.taskKeys;
  DATA.loaded = true;
  const names = f.serverKeys.map(
    (key) => META.servers.find((s) => s.key === key)?.server_name || key,
  );
  const taskNames = f.taskKeys.map(
    (key) => (META.tasks || []).find((t) => t.key === key)?.label || key,
  );
  const parts = [];
  if (names.length) parts.push(names.join("、"));
  if (taskNames.length) parts.push(taskNames.join("、"));
  DATA.metaText = `${parts.join(" · ") || "全部"} · 共 ${DATA.total} 条 · 更新于 ${record.updated_at || "-"}`;
}

document.querySelectorAll(".tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(`${btn.dataset.tab}Panel`).classList.add("active");
  });
});

async function runSearch(page = 1) {
  DATA.page = page;
  await fetchRoles(page);
  render();
}

async function handleSearchClick() {
  const btn = $("#searchBtn");
  const mobileBtn = $("#searchBtnMobile");
  btn.disabled = true;
  if (mobileBtn) mobileBtn.disabled = true;
  try {
    await runSearch(1);
    if (isMobileLayout()) setFiltersOpen(false);
  } catch (err) {
    DATA.loaded = false;
    meta.textContent = `加载失败 — ${err.message}`;
    rolesPanel.innerHTML = `<div class="empty">${esc(err.message)}</div>`;
    paginationBar.hidden = true;
  } finally {
    btn.disabled = false;
    if (mobileBtn) mobileBtn.disabled = false;
  }
}

$("#searchBtn").addEventListener("click", handleSearchClick);
$("#searchBtnMobile")?.addEventListener("click", () => $("#searchBtn").click());
$("#openFilters")?.addEventListener("click", () => {
  const open = $("#filtersCard")?.classList.contains("is-open");
  setFiltersOpen(!open);
});
$("#closeFilters")?.addEventListener("click", () => setFiltersOpen(false));

if (isMobileLayout()) setFiltersOpen(true);

$("#area").addEventListener("change", () => {
  fillServerOptions($("#area").value);
});

$("#serverSearch").addEventListener("input", () => {
  fillServerOptions($("#area").value);
});

$("#serverSearch").addEventListener("keydown", (e) => {
  e.stopPropagation();
  if (e.key === "Enter") {
    e.preventDefault();
    const first = $("#serverList").querySelector(".multiselect-option");
    if (first) first.click();
  }
});

$("#serverMultiTrigger").addEventListener("click", () => {
  setServerMultiOpen($("#serverMultiPanel").hidden);
  setTaskMultiOpen(false);
});

$("#serverList").addEventListener("click", (e) => {
  const option = e.target.closest(".multiselect-option");
  if (!option) return;
  const key = option.dataset.key;
  if (selectedServerKeys.has(key)) {
    selectedServerKeys.delete(key);
    option.classList.remove("selected");
    option.setAttribute("aria-selected", "false");
  } else {
    selectedServerKeys.add(key);
    option.classList.add("selected");
    option.setAttribute("aria-selected", "true");
  }
  updateServerMultiLabel();
});

$("#selectAllServers").addEventListener("click", () => {
  $("#serverList").querySelectorAll(".multiselect-option").forEach((option) => {
    selectedServerKeys.add(option.dataset.key);
  });
  fillServerOptions($("#area").value);
});

$("#clearServers").addEventListener("click", () => {
  selectedServerKeys.clear();
  $("#serverList").querySelectorAll(".multiselect-option").forEach((option) => {
    option.classList.remove("selected");
    option.setAttribute("aria-selected", "false");
  });
  updateServerMultiLabel();
});

document.querySelectorAll(".chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    const active = chip.getAttribute("aria-pressed") === "true";
    chip.setAttribute("aria-pressed", active ? "false" : "true");
    if (chip.id === "petSlotGt12") {
      if (!active) {
        $("#petSlotMin").value = chip.dataset.min || "12";
      } else if ($("#petSlotMin").value === (chip.dataset.min || "12")) {
        $("#petSlotMin").value = "";
      }
    }
  });
});

$("#petSlotMin")?.addEventListener("input", () => {
  const chipMin = $("#petSlotGt12")?.dataset.min || "12";
  const active = $("#petSlotMin").value === chipMin;
  $("#petSlotGt12")?.setAttribute("aria-pressed", active ? "true" : "false");
});

function initMaterialPriceInputs() {
  const fields = [
    ["priceShendoudou", "shendoudou"],
    ["priceBaoshichui", "baoshichui"],
    ["priceJinliulu", "jinliulu"],
    ["priceFabaoJinghua", "fabaoJinghua"],
    ["priceShenshou", "shenshou"],
    ["priceJinliuluMin", "jinliuluMinForRatio"],
  ];
  for (const [id, key] of fields) {
    const el = $(`#${id}`);
    if (!el) continue;
    el.value = String(materialPrices[key]);
    el.addEventListener("change", () => {
      const value = Number(el.value);
      if (!Number.isFinite(value) || value < 0) {
        el.value = String(materialPrices[key]);
        return;
      }
      materialPrices = { ...materialPrices, [key]: value };
      saveMaterialPrices();
      if (DATA.loaded) render();
    });
  }
  $("#resetMaterialPrices")?.addEventListener("click", () => {
    materialPrices = { ...DEFAULT_MATERIAL_PRICES };
    saveMaterialPrices();
    for (const [id, key] of fields) {
      const el = $(`#${id}`);
      if (el) el.value = String(materialPrices[key]);
    }
    if (DATA.loaded) render();
  });
}

initMaterialPriceInputs();

$("#taskMultiTrigger")?.addEventListener("click", () => {
  setTaskMultiOpen($("#taskMultiPanel").hidden);
  setServerMultiOpen(false);
});

$("#taskList")?.addEventListener("click", (e) => {
  const option = e.target.closest(".multiselect-option");
  if (!option) return;
  const key = option.dataset.key;
  if (selectedTaskKeys.has(key)) {
    selectedTaskKeys.delete(key);
    option.classList.remove("selected");
    option.setAttribute("aria-selected", "false");
  } else {
    selectedTaskKeys.add(key);
    option.classList.add("selected");
    option.setAttribute("aria-selected", "true");
  }
  updateTaskMultiLabel();
});

$("#selectAllTasks")?.addEventListener("click", () => {
  (META.tasks || []).forEach((t) => selectedTaskKeys.add(t.key));
  fillTaskOptions();
});

$("#clearTasks")?.addEventListener("click", () => {
  selectedTaskKeys.clear();
  fillTaskOptions();
});

document.addEventListener("click", (e) => {
  if (!$("#serverMulti")?.contains(e.target)) {
    setServerMultiOpen(false);
  }
  if (!$("#taskMulti")?.contains(e.target)) {
    setTaskMultiOpen(false);
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if ($("#filtersCard")?.classList.contains("is-open") && isMobileLayout()) {
    setFiltersOpen(false);
    return;
  }
  if ($("#taskMultiPanel") && !$("#taskMultiPanel").hidden) {
    setTaskMultiOpen(false);
    $("#taskMultiTrigger")?.focus();
    return;
  }
  if (!$("#serverMultiPanel").hidden) {
    setServerMultiOpen(false);
    $("#serverMultiTrigger").focus();
    return;
  }
  if (!roleModal.hidden) closeRoleModal();
});

rolesPanel.innerHTML = '<div class="empty">请选择服务器或任务后点击「查询」</div>';
detailsPanel.innerHTML = '<div class="empty">请选择服务器或任务后点击「查询」</div>';
petsPanel.innerHTML = '<div class="empty">请选择服务器或任务后点击「查询」</div>';

prevPageBtn.addEventListener("click", async () => {
  if (DATA.page <= 1) return;
  $("#searchBtn").disabled = true;
  try {
    await runSearch(DATA.page - 1);
  } catch (err) {
    meta.textContent = `加载失败 — ${err.message}`;
  } finally {
    $("#searchBtn").disabled = false;
  }
});

nextPageBtn.addEventListener("click", async () => {
  if (DATA.page >= DATA.totalPages) return;
  $("#searchBtn").disabled = true;
  try {
    await runSearch(DATA.page + 1);
  } catch (err) {
    meta.textContent = `加载失败 — ${err.message}`;
  } finally {
    $("#searchBtn").disabled = false;
  }
});
["goldMin", "roleName", "school", "priceMin", "priceMax", "ratioMin", "petSlotMin"].forEach((id) => {
  const el = $(`#${id}`);
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter") $("#searchBtn").click();
  });
});

rolesPanel.addEventListener("change", (e) => {
  if (e.target.id !== "mobileSort") return;
  const key = e.target.value;
  if (!key || !ROLE_SORT_KEYS[key]) return;
  if (roleSort.key === key) return;
  roleSort.key = key;
  roleSort.dir = DESC_SORT_KEYS.has(key) ? "desc" : "asc";
  if (DATA.loaded) $("#searchBtn").click();
});

rolesPanel.addEventListener("click", (e) => {
  const sortHeader = e.target.closest("th.sortable");
  if (e.target.id === "mobileSort" || e.target.closest?.("#mobileSort")) {
    return;
  }
  if (sortHeader?.dataset.sort) {
    const key = sortHeader.dataset.sort;
    if (roleSort.key === key) {
      roleSort.dir = roleSort.dir === "desc" ? "asc" : "desc";
    } else {
      roleSort.key = key;
      roleSort.dir = DESC_SORT_KEYS.has(key) ? "desc" : "asc";
    }
    if (DATA.loaded) $("#searchBtn").click();
    return;
  }
  const row = e.target.closest(".role-row");
  if (!row) return;
  const role = DATA.roles.find((r) => roleKey(r) === row.dataset.roleKey);
  if (role) showRoleDetail(role);
});

rolesPanel.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" && e.key !== " ") return;
  const row = e.target.closest(".role-row");
  if (!row) return;
  e.preventDefault();
  const role = DATA.roles.find((r) => roleKey(r) === row.dataset.roleKey);
  if (role) showRoleDetail(role);
});

roleModal.addEventListener("click", (e) => {
  if (e.target.closest("[data-close]")) closeRoleModal();
});

loadMeta().catch((err) => {
  meta.textContent = `元数据加载失败 — ${err.message}`;
});
