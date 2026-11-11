const $app = document.getElementById("app");
const S = { me: null, id: null, d: null, cfg: null };
const DEFAULT_COLOR = "#5865f2";

// ---------- util ----------
const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "value" || k === "checked" || k === "selected") el[k] = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
};

async function api(path, opts = {}) {
  const res = await fetch(path, {
    credentials: "same-origin",
    method: opts.method || "GET",
    headers: opts.body ? { "Content-Type": "application/json" } : {},
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch {}
  if (!res.ok) {
    const err = new Error(data?.error || `Error ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

function toast(msg, bad = false) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.className = "show" + (bad ? " bad" : "");
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (t.className = ""), 3500);
}

try { const t = localStorage.getItem("theme"); if (t) document.documentElement.dataset.theme = t; } catch {}
function toggleTheme() {
  const cur = document.documentElement.dataset.theme ||
    (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  const next = cur === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem("theme", next); } catch {}
}

async function logout() {
  try { await api("/api/auth/logout", { method: "POST", body: {} }); } catch {}
  S.me = null;
  location.hash = "";
  route();
}

function shell(...content) {
  $app.replaceChildren(
    h("header", { class: "top" },
      h("a", { class: "brand", href: "#/" }, "◆ Bot Panel"),
      h("div", { class: "top-r" },
        h("button", { class: "btn ghost", onclick: toggleTheme }, "Theme"),
        S.me && h("span", { class: "who" }, S.me.user.name),
        S.me && h("button", { class: "btn ghost", onclick: logout }, "Log out"))),
    h("main", { class: "wrap" }, ...content));
}

// ---------- routing ----------
async function route() {
  try {
    if (!S.me) S.me = await api("/api/me");
  } catch (e) {
    if (e.status === 401) return renderLogin(new URLSearchParams(location.search).get("error"));
    return renderMessage("Something went wrong", e.message);
  }
  const m = location.hash.match(/^#\/g\/(\d+)/);
  if (m) return renderIntro(m[1]);
  renderServers();
}

function renderMessage(title, text) {
  shell(h("div", { class: "center" }, h("h1", {}, title), h("p", { class: "muted" }, text),
    h("p", {}, h("a", { href: "#/" }, "← All servers"))));
}

function renderLogin(error) {
  shell(h("div", { class: "center" },
    h("h1", {}, "Bot Panel"),
    h("p", { class: "muted" }, "Log in with Discord to manage the bot in your servers."),
    error && h("p", { class: "warn" }, error),
    h("p", { style: "margin-top:18px" }, h("a", { class: "btn primary", href: "/api/auth/login" }, "Log in with Discord"))));
}

function renderServers() {
  const list = S.me.guilds;
  shell(
    h("h1", {}, "Your servers"),
    h("p", { class: "muted" }, "Servers where you have Manage Server permission."),
    h("div", { class: "servers" }, list.map((g) =>
      h("div", { class: "srv" },
        g.icon
          ? h("img", { src: `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png?size=64`, alt: "" })
          : h("div", { class: "ph" }, g.name.slice(0, 1).toUpperCase()),
        h("div", { class: "srv-n" }, g.name),
        g.botIn
          ? h("a", { class: "btn primary", href: `#/g/${g.id}` }, "Manage")
          : h("a", { class: "btn", target: "_blank", rel: "noopener",
              href: `${S.me.inviteUrl}&guild_id=${g.id}&disable_guild_select=true` }, "Invite bot")))),
    !list.length && h("p", { class: "muted", style: "margin-top:16px" }, "No servers found."));
}

// ---------- Introductions ----------
async function renderIntro(id) {
  shell(h("p", { class: "muted" }, "Loading…"));
  try {
    S.d = await api(`/api/intro?guild=${id}`);
  } catch (e) {
    return renderMessage("Can't open this server", e.message);
  }
  S.id = id;
  S.cfg = JSON.parse(JSON.stringify(S.d.config));
  drawIntro();
}

const fmtTime = (ms) => new Date(ms).toLocaleString();

function drawIntro() {
  const cfg = S.cfg;
  const d = S.d;

  // --- helpers
  const sel = (list, value, onchange, none, prefix = "") => {
    const s = h("select", { onchange: (e) => onchange(e.target.value) },
      h("option", { value: "" }, none),
      list.map((x) => h("option", { value: x.id }, prefix + x.name)));
    if (value && !list.some((x) => x.id === value)) s.append(h("option", { value }, "(unknown)"));
    s.value = value || "";
    return s;
  };
  const txt = (value, max, oninput, ph) =>
    h("input", { type: "text", value: value || "", maxlength: max, placeholder: ph || "", oninput: (e) => oninput(e.target.value) });
  const field = (label, hint, control) =>
    h("label", { class: "f" }, label, hint && h("span", { class: "hint" }, hint), control);

  // --- header
  const pill = h("span", { class: "pill" });
  const count = h("span", { class: "muted" });
  const drawHead = () => {
    pill.className = "pill " + (cfg.enabled ? "ok" : "off");
    pill.textContent = cfg.enabled ? "Active" : "Disabled";
    count.textContent = `${d.cards.length} card${d.cards.length === 1 ? "" : "s"} posted`;
  };

  // --- roles warning
  const warn = h("div", { class: "warn" });
  const drawWarn = () => {
    const r = d.roles.find((x) => x.id === cfg.roleId);
    warn.textContent = r && r.position >= d.botTop
      ? "The bot's role must be above this role (Server Settings → Roles), or it can't give it."
      : "";
  };

  // --- questions
  const qBox = h("div");
  const addBtn = h("button", { class: "btn", style: "margin-top:10px", onclick: () => {
    if (cfg.questions.length >= 5) return;
    cfg.questions.push({ label: "New question", placeholder: "", emoji: "", required: false, style: 1, maxLength: 100 });
    drawQs(); drawPreview();
  } }, "+ Add question");

  function move(i, dir) {
    const j = i + dir;
    if (j < 0 || j >= cfg.questions.length) return;
    [cfg.questions[i], cfg.questions[j]] = [cfg.questions[j], cfg.questions[i]];
    drawQs(); drawPreview();
  }
  function drawQs() {
    qBox.replaceChildren(...cfg.questions.map((q, i) =>
      h("div", { class: "q" },
        h("div", { class: "q-top" },
          h("span", { class: "q-n" }, `Question ${i + 1}`),
          h("div", { class: "q-btns" },
            h("button", { class: "icon", title: "Move up", disabled: i === 0, onclick: () => move(i, -1) }, "▲"),
            h("button", { class: "icon", title: "Move down", disabled: i === cfg.questions.length - 1, onclick: () => move(i, 1) }, "▼"),
            h("button", { class: "icon danger", title: "Remove", disabled: cfg.questions.length <= 1,
              onclick: () => { cfg.questions.splice(i, 1); drawQs(); drawPreview(); } }, "✕"))),
        h("div", { class: "row" },
          txt(q.label, 45, (v) => { q.label = v; drawPreview(); }, "Label (max 45)"),
          (() => { const e = txt(q.emoji, 16, (v) => { q.emoji = v; drawPreview(); }, "😀"); e.className = "small"; return e; })()),
        h("div", { class: "row" }, txt(q.placeholder, 100, (v) => { q.placeholder = v; drawPreview(); }, "Placeholder / hint")),
        h("div", { class: "row" },
          h("label", { class: "chk" },
            h("input", { type: "checkbox", checked: q.required, onchange: (e) => { q.required = e.target.checked; } }), "Required"),
          h("select", { onchange: (e) => {
              q.style = Number(e.target.value);
              q.maxLength = Math.min(q.maxLength, q.style === 2 ? 1000 : 200);
              drawQs();
            } },
            h("option", { value: "1", selected: q.style !== 2 }, "One line"),
            h("option", { value: "2", selected: q.style === 2 }, "Paragraph")),
          h("input", { type: "number", min: 1, max: q.style === 2 ? 1000 : 200, value: q.maxLength,
            title: "Max characters", onchange: (e) => {
              q.maxLength = Math.min(q.style === 2 ? 1000 : 200, Math.max(1, Number(e.target.value) || 1));
              e.target.value = q.maxLength;
            } })))));
    addBtn.disabled = cfg.questions.length >= 5;
  }

  // --- preview
  const pv = h("div");
  const fillT = (t, name) =>
    String(t || "").split("{name}").join(name).split("{username}").join("username").split("{server}").join(d.guild.name);
  function drawPreview() {
    const p = cfg.panel;
    const title = fillT(p.title, "Name");
    const panel = h("div", { class: "dc" },
      h("div", { class: "dc-author" }, h("i"), "Your bot", h("small", {}, "APP")),
      h("div", { class: "dc-embed", style: `border-left-color:${p.color}` },
        title && h("h4", {}, title),
        h("div", { class: "body" }, p.message),
        p.footer && h("div", { class: "foot" }, p.footer)),
      h("div", {}, h("span", { class: "dc-btn" }, `${p.emoji ? p.emoji + " " : ""}${p.buttonLabel || "Introduction"}`)));

    const lines = cfg.questions.filter((q) => q.label).map((q) =>
      `• ${q.emoji || "•"} · ${q.label}:\n${q.placeholder || "…"}`).join("\n\n");
    const card = h("div", { class: "dc" },
      h("div", { class: "dc-author" }, h("i"), "Your bot", h("small", {}, "APP")),
      h("div", { class: "dc-embed", style: `border-left-color:${p.color}` },
        h("img", { class: "thumb", src: S.me.user.avatarUrl, alt: "" }),
        fillT(cfg.card.title, S.me.user.name) && h("h4", {}, fillT(cfg.card.title, S.me.user.name)),
        h("div", { class: "body" }, lines)));

    pv.replaceChildren(
      h("div", { class: "pv-label" }, "The panel"), panel,
      h("div", { class: "pv-label" }, "A member's card (hints shown as answers)"), card);
  }

  // --- submitted list
  const listBox = h("div");
  function drawCards() {
    drawHead();
    listBox.replaceChildren(...(d.cards.length
      ? d.cards.map((c) => h("div", { class: "sub" },
          h("div", { style: "min-width:0;flex:1 1 240px" },
            h("div", { class: "sub-n" }, c.name, " ", h("span", { class: "sub-t" }, fmtTime(c.updatedAt))),
            h("div", { class: "sub-s" }, c.summary)),
          h("div", { class: "sub-a" },
            h("a", { class: "btn", href: c.url, target: "_blank", rel: "noopener" }, "Open"),
            h("button", { class: "btn bad", onclick: async () => {
              if (!confirm(`Remove ${c.name}'s introduction?`)) return;
              try {
                await api(`/api/intro?guild=${S.id}&action=remove`, { method: "POST", body: { userId: c.userId } });
                d.cards = d.cards.filter((x) => x.userId !== c.userId);
                drawCards(); toast("Removed");
              } catch (e) { toast(e.message, true); }
            } }, "Remove"))))
      : [h("p", { class: "muted" }, "No introductions yet.")]));
  }
  async function refresh() {
    try {
      const fresh = await api(`/api/intro?guild=${S.id}`);
      d.cards = fresh.cards;
      drawCards();
    } catch (e) { toast(e.message, true); }
  }

  // --- actions
  async function save(quiet) {
    const r = await api(`/api/intro?guild=${S.id}&action=save`, { method: "POST", body: cfg });
    // Hanya salin field milik server; jangan ganti objek yang dipakai form.
    cfg.guildName = r.config.guildName;
    cfg.panelChannelId = r.config.panelChannelId;
    cfg.panelMessageId = r.config.panelMessageId;
    if (!quiet) toast("Saved");
  }
  const saveBtn = h("button", { class: "btn primary", onclick: async () => {
    saveBtn.disabled = true;
    try { await save(); } catch (e) { toast(e.message, true); }
    saveBtn.disabled = false;
  } }, "Save changes");
  const postBtn = h("button", { class: "btn", onclick: async () => {
    if (!cfg.channelId) return toast("Pick an intro channel first.", true);
    postBtn.disabled = true;
    try {
      await save(true);
      await api(`/api/intro?guild=${S.id}&action=post`, { method: "POST", body: {} });
      toast("Panel posted in the intro channel ✓");
    } catch (e) { toast(e.message, true); }
    postBtn.disabled = false;
  } }, "Post / re-post panel");

  // --- bind helper for text fields
  const bindTxt = (obj, key, max, ph) => txt(obj[key], max, (v) => { obj[key] = v; drawPreview(); }, ph);
  const msgBox = h("textarea", { maxlength: 2000, oninput: (e) => { cfg.panel.message = e.target.value; drawPreview(); } });
  msgBox.value = cfg.panel.message;
  const colorIn = h("input", { type: "color", value: cfg.panel.color, oninput: (e) => { cfg.panel.color = e.target.value; drawPreview(); } });

  // --- layout
  shell(
    h("p", {}, h("a", { href: "#/" }, "← All servers")),
    h("div", { class: "card" },
      h("div", { class: "head" },
        h("div", {},
          h("h1", {}, "Introductions"),
          h("p", { class: "muted" }, `${d.guild.name} · A button opens a form with your questions. Answers post as a card with the member's avatar. Pressing again edits their card.`)),
        h("div", { style: "text-align:right" },
          h("label", { class: "switch" },
            h("input", { type: "checkbox", checked: cfg.enabled, onchange: (e) => { cfg.enabled = e.target.checked; drawHead(); } }), "Enabled"),
          h("div", {}, pill, " ", count)))),
    h("div", { class: "actions" }, saveBtn, postBtn),
    h("div", { class: "grid" },
      h("div", {},
        h("div", { class: "card" },
          h("h2", {}, "Channel & roles"),
          field("Intro channel", "The panel lives here and cards are posted here.",
            sel(d.channels, cfg.channelId, (v) => { cfg.channelId = v; }, "None", "# ")),
          field("Role on intro (optional)", "Granted when a member posts their first card — a soft gate.",
            sel(d.roles, cfg.roleId, (v) => { cfg.roleId = v; drawWarn(); }, "None", "@")),
          warn,
          field("Ping role (optional)", "Pinged when a NEW intro lands (not on edits).",
            sel(d.roles, cfg.pingRoleId, (v) => { cfg.pingRoleId = v; }, "None", "@"))),
        h("div", { class: "card" },
          h("h2", {}, "Questions"),
          h("p", { class: "muted" }, "Up to 5 (Discord's form limit). Labels max 45 characters."),
          qBox, addBtn),
        h("div", { class: "card" },
          h("h2", {}, "Panel appearance"),
          field("Title", "Use {server} for the server name.", bindTxt(cfg.panel, "title", 100)),
          h("div", { class: "row" },
            field("Button label", "", bindTxt(cfg.panel, "buttonLabel", 80)),
            field("Emoji", "", bindTxt(cfg.panel, "emoji", 16, "📝"))),
          field("Message", "", msgBox),
          field("Footer (empty = none)", "", bindTxt(cfg.panel, "footer", 200)),
          field("Accent colour", "", h("div", { class: "row", style: "flex-wrap:nowrap" }, colorIn,
            h("button", { class: "btn", style: "flex:0 0 auto", onclick: () => {
              cfg.panel.color = DEFAULT_COLOR; colorIn.value = DEFAULT_COLOR; drawPreview();
            } }, "Reset")))),
        h("div", { class: "card" },
          h("h2", {}, "Card & behaviour"),
          field("Card title", "Placeholders: {name} {username} {server}", bindTxt(cfg.card, "title", 200)),
          field("Edit cooldown (seconds)", "How long before a member can edit their card again. 0 = no limit.",
            h("input", { type: "number", min: 0, max: 86400, value: cfg.cooldown,
              onchange: (e) => { cfg.cooldown = Math.min(86400, Math.max(0, Number(e.target.value) || 0)); e.target.value = cfg.cooldown; } })),
          h("label", { class: "switch", style: "margin-top:14px" },
            h("input", { type: "checkbox", checked: cfg.keepPanelBottom !== false, onchange: (e) => { cfg.keepPanelBottom = e.target.checked; } }),
            "Keep the panel at the bottom"),
          h("p", { class: "muted" }, "After each new introduction the bot re-posts the panel below it, so the button is always the newest message."))),
      h("div", { class: "sticky" },
        h("div", { class: "card" }, h("h2", {}, "Live preview"), pv))),
    h("div", { class: "card" },
      h("div", { class: "head" },
        h("div", {}, h("h2", {}, "Submitted introductions"), h("p", { class: "muted" }, "Newest first")),
        h("button", { class: "btn", onclick: refresh }, "Refresh")),
      listBox));

  drawQs(); drawPreview(); drawCards(); drawWarn();
}

window.addEventListener("hashchange", route);
route();
