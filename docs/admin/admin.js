(function () {
  "use strict";

  const TOKEN_KEY = "xunmi_admin_token";
  const $ = (id) => document.getElementById(id);

  function api(path) {
    return path.startsWith("/") ? path : `/${path}`;
  }

  async function req(path, opts = {}) {
    const headers = Object.assign({ "Content-Type": "application/json" }, opts.headers || {});
    const token = localStorage.getItem(TOKEN_KEY);
    if (token) headers["X-Admin-Token"] = token;
    const r = await fetch(api(path), { ...opts, headers });
    let body = null;
    try {
      body = await r.json();
    } catch (_) {
      body = null;
    }
    if (!r.ok) {
      const detail = body && body.detail;
      throw new Error(typeof detail === "string" ? detail : r.statusText || String(r.status));
    }
    return body;
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }

  function fmtTime(iso) {
    if (!iso) return "";
    try {
      return new Date(iso).toLocaleString();
    } catch (_) {
      return iso;
    }
  }

  function showApp() {
    $("loginView").hidden = true;
    $("appView").hidden = false;
    loadKeys();
  }

  function showLogin(err) {
    $("loginView").hidden = false;
    $("appView").hidden = true;
    if (err) {
      $("loginError").hidden = false;
      $("loginError").textContent = err;
    }
  }

  $("loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const token = $("adminToken").value.trim();
    if (!token) return;
    localStorage.setItem(TOKEN_KEY, token);
    try {
      await req("/api/admin/keys?limit=1");
      $("loginError").hidden = true;
      showApp();
    } catch (err) {
      localStorage.removeItem(TOKEN_KEY);
      showLogin(err.message);
    }
  });

  $("logoutBtn").addEventListener("click", () => {
    localStorage.removeItem(TOKEN_KEY);
    showLogin();
  });

  document.querySelectorAll(".tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b === btn));
      document.querySelectorAll(".panel").forEach((p) =>
        p.classList.toggle("active", p.id === `panel-${btn.dataset.tab}`)
      );
      if (btn.dataset.tab === "events") loadEvents();
      if (btn.dataset.tab === "feedbacks") loadFeedbacks();
      if (btn.dataset.tab === "keys") loadKeys();
    });
  });

  function setDuration(days, hours, minutes) {
    $("genDays").value = String(Math.max(0, Number(days) || 0));
    $("genHours").value = String(Math.max(0, Number(hours) || 0));
    $("genMinutes").value = String(Math.max(0, Number(minutes) || 0));
  }

  function readDuration() {
    const days = Math.max(0, Math.floor(Number($("genDays").value) || 0));
    const hours = Math.max(0, Math.floor(Number($("genHours").value) || 0));
    const minutes = Math.max(0, Math.floor(Number($("genMinutes").value) || 0));
    return { days, hours, minutes };
  }

  function formatDuration(d, h, m) {
    const parts = [];
    if (d) parts.push(`${d} 天`);
    if (h) parts.push(`${h} 小时`);
    if (m) parts.push(`${m} 分钟`);
    return parts.length ? parts.join(" ") : "0";
  }

  $("genKind").addEventListener("change", () => {
    setDuration($("genKind").value === "test" ? 7 : 30, 0, 0);
    if ($("genKind").value === "test" && Number($("genCount").value) < 2) {
      $("genCount").value = 10;
    }
  });

  document.querySelectorAll("#countPresets [data-count]").forEach((btn) => {
    btn.addEventListener("click", () => {
      $("genCount").value = btn.dataset.count;
    });
  });

  document.querySelectorAll("#durationPresets [data-d]").forEach((btn) => {
    btn.addEventListener("click", () => {
      setDuration(btn.dataset.d, btn.dataset.h, btn.dataset.m);
    });
  });

  let lastGeneratedCodes = [];

  $("genBtn").addEventListener("click", async () => {
    try {
      const count = Math.max(1, Math.min(100, Number($("genCount").value) || 1));
      $("genCount").value = String(count);
      const dur = readDuration();
      if (dur.days * 24 * 60 + dur.hours * 60 + dur.minutes < 1) {
        alert("有效期至少 1 分钟");
        return;
      }
      const body = {
        kind: $("genKind").value,
        count,
        days: dur.days,
        hours: dur.hours,
        minutes: dur.minutes,
        note: $("genNote").value.trim(),
      };
      const data = await req("/api/admin/keys", { method: "POST", body: JSON.stringify(body) });
      const keys = data.keys || [];
      lastGeneratedCodes = keys.map((k) => k.code);
      $("genResultWrap").hidden = false;
      $("genResultTitle").textContent =
        `已生成 ${keys.length} 张（${body.kind === "test" ? "测试" : "正式"} · ${formatDuration(dur.days, dur.hours, dur.minutes)}）`;
      $("genResult").textContent = lastGeneratedCodes.join("\n");
      loadKeys();
    } catch (e) {
      alert("生成失败: " + e.message);
    }
  });

  $("copyCodesBtn").addEventListener("click", async () => {
    const text = lastGeneratedCodes.join("\n");
    if (!text) {
      alert("暂无可复制的卡密");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      $("copyCodesBtn").textContent = "已复制";
      setTimeout(() => {
        $("copyCodesBtn").textContent = "复制全部卡密";
      }, 1500);
    } catch (_) {
      // fallback
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      alert("已复制到剪贴板");
    }
  });

  $("refreshKeys").addEventListener("click", loadKeys);
  $("filterKind").addEventListener("change", loadKeys);

  async function loadKeys() {
    try {
      const kind = $("filterKind").value;
      const q = kind ? `?kind=${encodeURIComponent(kind)}` : "";
      const data = await req(`/api/admin/keys${q}`);
      const rows = data.keys || [];
      $("keysBody").innerHTML = rows.length
        ? rows
            .map((k) => {
              const st = k.effective_status || k.status;
              return `<tr>
                <td><code>${esc(k.code)}</code></td>
                <td><span class="badge ${esc(k.kind)}">${esc(k.kind)}</span></td>
                <td><span class="badge ${esc(st)}">${esc(st)}</span></td>
                <td>${esc(fmtTime(k.expires_at))}</td>
                <td>${esc(k.machine_count ?? 0)}${k.max_machines == null ? " / ∞" : " / " + k.max_machines}</td>
                <td>${esc(k.note)}</td>
                <td class="ops">
                  <button type="button" data-machines="${k.id}" data-code="${esc(k.code)}">机器码</button>
                  <button type="button" data-unbind="${k.id}">解绑</button>
                  <button type="button" class="danger" data-revoke="${k.id}">吊销</button>
                </td>
              </tr>`;
            })
            .join("")
        : '<tr><td colspan="7">暂无卡密</td></tr>';

      $("keysBody").querySelectorAll("[data-machines]").forEach((el) =>
        el.addEventListener("click", () => showMachines(el.dataset.machines, el.dataset.code))
      );
      $("keysBody").querySelectorAll("[data-unbind]").forEach((el) =>
        el.addEventListener("click", async () => {
          if (!confirm("确认解绑该卡下全部机器？")) return;
          try {
            await req(`/api/admin/keys/${el.dataset.unbind}/unbind`, { method: "POST", body: "{}" });
            loadKeys();
            $("machinesBox").hidden = true;
          } catch (e) {
            alert(e.message);
          }
        })
      );
      $("keysBody").querySelectorAll("[data-revoke]").forEach((el) =>
        el.addEventListener("click", async () => {
          if (!confirm("确认吊销？吊销后不可再激活。")) return;
          try {
            await req(`/api/admin/keys/${el.dataset.revoke}/revoke`, { method: "POST", body: "{}" });
            loadKeys();
          } catch (e) {
            alert(e.message);
          }
        })
      );
    } catch (e) {
      $("keysBody").innerHTML = `<tr><td colspan="7">${esc(e.message)}</td></tr>`;
    }
  }

  async function showMachines(keyId, code) {
    try {
      const data = await req(`/api/admin/keys/${keyId}/machines`);
      $("machinesBox").hidden = false;
      $("machinesTitle").textContent = code || keyId;
      const rows = data.machines || [];
      $("machinesBody").innerHTML = rows.length
        ? rows
            .map(
              (m) => `<tr>
                <td><code>${esc(m.machine_id)}</code></td>
                <td>${esc(m.machine_label)}</td>
                <td>${esc(fmtTime(m.first_seen_at))}</td>
                <td>${esc(fmtTime(m.last_seen_at))}</td>
                <td>${esc(m.activate_count)}</td>
              </tr>`
            )
            .join("")
        : '<tr><td colspan="5">尚无机器记录</td></tr>';
    } catch (e) {
      alert(e.message);
    }
  }

  $("refreshEvents").addEventListener("click", loadEvents);
  async function loadEvents() {
    try {
      const params = new URLSearchParams();
      if ($("eventFilter").value.trim()) params.set("event", $("eventFilter").value.trim());
      if ($("eventMachine").value.trim()) params.set("machine_id", $("eventMachine").value.trim());
      const q = params.toString() ? `?${params}` : "";
      const data = await req(`/api/admin/events${q}`);
      const rows = data.events || [];
      $("eventsBody").innerHTML = rows.length
        ? rows
            .map(
              (ev) => `<tr>
                <td>${esc(fmtTime(ev.occurred_at))}</td>
                <td><code>${esc(ev.event)}</code></td>
                <td><code>${esc(ev.machine_id)}</code></td>
                <td>${esc(ev.license_key_id ?? "")}</td>
                <td><code>${esc(JSON.stringify(ev.props || {}))}</code></td>
              </tr>`
            )
            .join("")
        : '<tr><td colspan="5">暂无数据</td></tr>';
    } catch (e) {
      $("eventsBody").innerHTML = `<tr><td colspan="5">${esc(e.message)}</td></tr>`;
    }
  }

  $("refreshFeedbacks").addEventListener("click", loadFeedbacks);
  async function loadFeedbacks() {
    try {
      const data = await req("/api/admin/feedbacks");
      const rows = data.feedbacks || [];
      $("feedbacksBody").innerHTML = rows.length
        ? rows
            .map(
              (f) => `<tr>
                <td>${esc(fmtTime(f.created_at))}</td>
                <td>${esc(f.category)}</td>
                <td>${esc(f.content)}</td>
                <td><code>${esc(f.machine_id)}</code></td>
                <td>${esc(f.contact)}</td>
                <td>${esc(f.app_version)} / ${esc(f.os)}</td>
              </tr>`
            )
            .join("")
        : '<tr><td colspan="6">暂无反馈</td></tr>';
    } catch (e) {
      $("feedbacksBody").innerHTML = `<tr><td colspan="6">${esc(e.message)}</td></tr>`;
    }
  }

  // boot
  if (localStorage.getItem(TOKEN_KEY)) {
    req("/api/admin/keys?limit=1")
      .then(showApp)
      .catch(() => {
        localStorage.removeItem(TOKEN_KEY);
        showLogin();
      });
  }
})();
