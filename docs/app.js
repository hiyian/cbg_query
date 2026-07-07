let META = { areas: [], schools: [], servers: [] };
let DATA = {
  roles: [],
  loaded: false,
  page: 1,
  pageSize: 50,
  total: 0,
  totalPages: 1,
  serverKeys: [],
  metaText: "",
};
let roleSort = { key: "material_ratio", dir: "desc" };
let selectedServerKeys = new Set();

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
  { key: "jinghua", label: "精华", css: "jinghua", sub: "名称含「精华」" },
  { key: "wuse_shi", label: "四色石", css: "wuse-shi", sub: "朱雀/青龙/白虎/玄武" },
];

const STONE_NAMES = new Set(["朱雀石", "青龙石", "白虎石", "玄武石"]);

function matchKeyItem(name, item) {
  if (!name) return false;
  if (item.key === "shendoudou") return name === "神兜兜";
  if (item.key === "baoshichui") return name.includes("宝石锤");
  if (item.key === "jinliulu") return name === "金柳露";
  if (item.key === "jinghua") return name.includes("精华");
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

function materialRatio(role) {
  if (role.material_ratio != null) return role.material_ratio;
  const price = Number(role.price ?? 0);
  if (!price) return null;
  const items = role._key_items || computeKeyItems(role);
  const gold = Number(role.金币 ?? 0);
  const jll = items.jinliulu || 0;
  const jllPart = jll >= 99 ? jll * 100 : 0;
  const value = gold + (items.shendoudou || 0) * 30000 + (items.baoshichui || 0) * 25000 + jllPart
    + shenshouCount(role) * SHENSHOU_GOLD;
  return value / price / 10000;
}

function fmtMaterialRatio(role) {
  const ratio = materialRatio(role);
  if (ratio == null) return "-";
  return ratio.toFixed(2);
}

function materialGold(role) {
  if (role.material_gold != null) return Number(role.material_gold);
  const items = role._key_items || computeKeyItems(role);
  const gold = Number(role.金币 ?? 0);
  return gold
    + (items.shendoudou || 0) * 30000
    + (items.baoshichui || 0) * 25000
    + (items.jinliulu || 0) * 100
    + shenshouCount(role) * SHENSHOU_GOLD;
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
const SHENSHOU_GOLD = 3000000;

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
}

function fmtSaleStatus(role) {
  return role.sale_status_label || "-";
}

function fmtSaleTime(role) {
  const status = role.sale_status;
  if (status === "sold") return "已售出";
  if (role.sale_time_text) return role.sale_time_text;
  const sellingTime = Number(role.selling_time || 0);
  if (!status || !sellingTime) return "-";

  const ts = sellingTime > 1_000_000_000_000 ? Math.floor(sellingTime / 1000) : sellingTime;
  const dt = new Date(ts * 1000);
  const timeText = `${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")} ${String(dt.getHours()).padStart(2, "0")}:${String(dt.getMinutes()).padStart(2, "0")}`;

  if (status === "fair_show") {
    const remain = ts - Math.floor(Date.now() / 1000);
    if (remain > 0) return `${fmtRemain(remain)}后上架`;
    return `${timeText} 上架`;
  }
  if (status === "onsale") return `${timeText} 上架`;
  if (status === "reviewing") return "审核中";
  return timeText;
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

function getFilters() {
  return {
    serverKeys: getSelectedServerKeys(),
    saleStatuses: getSelectedSaleStatuses(),
    goldMin: $("#goldMin").value ? Number($("#goldMin").value) : null,
    roleName: $("#roleName").value.trim(),
    school: $("#school").value,
    priceMin: $("#priceMin").value ? Number($("#priceMin").value) : null,
    priceMax: $("#priceMax").value ? Number($("#priceMax").value) : null,
    ratioMin: $("#ratioMin").value ? Number($("#ratioMin").value) : null,
    hasShendoudou: isChipActive("hasShendoudou"),
    hasBaoshichui: isChipActive("hasBaoshichui"),
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
    <td>${esc(eq.name)}</td>
    <td>${esc(eq.amount ?? 1)}</td>
    <td>${esc(extra)}</td>
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
    <td>${esc(pet.name)}${isShenshou ? ' <span class="shenshou-tag">神兽</span>' : ""}</td>
    <td>${esc(pet.level ?? "-")}</td>
    <td>${esc(pet.pet_score ?? "-")}</td>
    <td class="${isShenshou ? "shenshou" : ""}">${esc(fmtLife(pet.life))}</td>
    <td>${esc(pet.skills ?? "-")}</td>
    <td>${esc(extra)}</td>
  </tr>`;
}

function showRoleDetail(role) {
  const stats = [
    ["大区", role.area_name], ["服务器", role.server_name],
    ["上架状态", fmtSaleStatus(role)], ["时间", fmtSaleTime(role)],
    ["金币（万）", fmtGoldWan(role)], ["冻结金币（万）", fmtFreezeWan(role)],
    ["金币/价格", fmtRatio(role)], ["物资比", fmtMaterialRatio(role)], ["物资估算金币", fmtMaterialGold(role)],
    ...KEY_ITEMS.map((item) => [item.label, keyItemCount(role, item.key) || "-"]),
    ["气血", role.气血], ["魔法", role.魔法], ["物伤", role.物伤], ["法伤", role.法伤],
    ["速度", role.速度], ["防御", role.防御], ["法防", role.法防],
    ["银币", role.银币], ["仙玉", role.仙玉],
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
      <div class="sub">${esc(role.ordersn)}</div>
      ${url ? `<a class="official-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer">查看官方原页 ↗</a>` : ""}
    </div>
    <div class="detail-stats">
      ${stats.map(([label, value]) => `
        <div class="stat-item">
          <div class="label">${esc(label)}</div>
          <div class="value">${esc(fmtStatValue(value))}</div>
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
}

function closeRoleModal() {
  roleModal.hidden = true;
  document.body.classList.remove("modal-open");
}

const DESC_SORT_KEYS = new Set([
  "material_ratio", "material_gold", "gold_ratio", "gold", "freeze", "price", "xianyu",
  "pet_slot", "shenshou", "shendoudou", "baoshichui", "jinliulu", "jinghua", "wuse_shi",
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
  rolesPanel.innerHTML = `<div class="roles-list">${renderListSummary(totals)}<div class="table-wrap"><table class="roles-table">
    <thead><tr>
      <th>大区</th>
      <th>服务器</th>
      <th>角色</th>
      <th>门派</th>
      <th class="num sortable" data-sort="level">${sortHeaderHtml("等级", "level")}</th>
      <th class="num sortable" data-sort="price">${sortHeaderHtml("价格", "price")}</th>
      <th>状态</th>
      <th>时间</th>
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
        <td class="name">${esc(r.role_name)}</td>
        <td>${esc(r.school)}</td>
        <td class="num">${esc(r.level ?? "-")}</td>
        <td class="num price">¥${esc(r.price)}</td>
        <td><span class="sale-tag ${esc(r.sale_status || "unknown")}">${esc(fmtSaleStatus(r))}</span></td>
        <td class="sale-time">${esc(fmtSaleTime(r))}</td>
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

function renderTable(panel, rows, columns) {
  if (!rows.length) {
    panel.innerHTML = '<div class="empty">无匹配数据</div>';
    return;
  }
  panel.innerHTML = `<div class="table-wrap"><table class="data-table">
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
}

function renderPagination() {
  if (!DATA.loaded || !DATA.serverKeys.length) {
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
  const list = META.servers
    .filter((s) => !areaFilter || s.area_name === areaFilter)
    .sort((a, b) => a.server_name.localeCompare(b.server_name, "zh-CN"));
  if (!list.length) {
    el.innerHTML = '<span class="empty-hint">暂无服务器</span>';
    updateServerMultiLabel();
    return;
  }
  el.innerHTML = list.map((s) => {
    const active = selectedServerKeys.has(s.key);
    return `<button
      type="button"
      class="multiselect-option${active ? " selected" : ""}"
      data-key="${esc(s.key)}"
      role="option"
      aria-selected="${active ? "true" : "false"}"
    >
      <span>${esc(s.server_name)}</span>
      <span class="multiselect-check" aria-hidden="true">✓</span>
    </button>`;
  }).join("");
  updateServerMultiLabel();
}

function buildFilterOptions() {
  fillSelect("area", META.areas);
  fillServerOptions($("#area").value);
  fillSelect("school", META.schools);
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
  if (!f.serverKeys.length) {
    throw new Error("请至少选择一个服务器");
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
  if (f.goldMin != null) params.set("gold_min", String(f.goldMin));
  if (f.roleName) params.set("role_name", f.roleName);
  if (f.school) params.set("school", f.school);
  if (f.priceMin != null) params.set("price_min", String(f.priceMin));
  if (f.priceMax != null) params.set("price_max", String(f.priceMax));
  if (f.ratioMin != null) params.set("ratio_min", String(f.ratioMin));
  if (f.hasShendoudou) params.set("has_shendoudou", "true");
  if (f.hasBaoshichui) params.set("has_baoshichui", "true");
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
  DATA.loaded = true;
  const names = f.serverKeys.map(
    (key) => META.servers.find((s) => s.key === key)?.server_name || key,
  );
  DATA.metaText = `${names.join("、")} · 共 ${DATA.total} 条 · 更新于 ${record.updated_at || "-"}`;
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

$("#searchBtn").addEventListener("click", async () => {
  const btn = $("#searchBtn");
  btn.disabled = true;
  try {
    await runSearch(1);
  } catch (err) {
    DATA.loaded = false;
    meta.textContent = `加载失败 — ${err.message}`;
    rolesPanel.innerHTML = `<div class="empty">${esc(err.message)}</div>`;
    paginationBar.hidden = true;
  } finally {
    btn.disabled = false;
  }
});

$("#area").addEventListener("change", () => {
  fillServerOptions($("#area").value);
});

$("#serverMultiTrigger").addEventListener("click", () => {
  setServerMultiOpen($("#serverMultiPanel").hidden);
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
    option.classList.add("selected");
    option.setAttribute("aria-selected", "true");
  });
  updateServerMultiLabel();
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
  });
});

document.addEventListener("click", (e) => {
  if (!$("#serverMulti").contains(e.target)) {
    setServerMultiOpen(false);
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (!$("#serverMultiPanel").hidden) {
    setServerMultiOpen(false);
    $("#serverMultiTrigger").focus();
    return;
  }
  if (!roleModal.hidden) closeRoleModal();
});

rolesPanel.innerHTML = '<div class="empty">请至少选择一个服务器后点击「查询」</div>';
detailsPanel.innerHTML = '<div class="empty">请至少选择一个服务器后点击「查询」</div>';
petsPanel.innerHTML = '<div class="empty">请至少选择一个服务器后点击「查询」</div>';

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
["goldMin", "roleName", "school", "priceMin", "priceMax", "ratioMin"].forEach((id) => {
  const el = $(`#${id}`);
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter") $("#searchBtn").click();
  });
});

rolesPanel.addEventListener("click", (e) => {
  const sortHeader = e.target.closest("th.sortable");
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
