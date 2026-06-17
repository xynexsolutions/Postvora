const els = {
  navLinks: document.querySelectorAll(".nav-link"),
  jumpLinks: document.querySelectorAll("[data-jump]"),
  views: document.querySelectorAll("[data-view-panel]"),
  statusPill: document.querySelector("#statusPill"),
  refreshBtn: document.querySelector("#refreshBtn"),
  themeToggle: document.querySelector("#themeToggle"),
  themeLabel: document.querySelector("#themeLabel"),
  workspaceName: document.querySelector("#workspaceName"),
  workspacePlan: document.querySelector("#workspacePlan"),
  metricsGrid: document.querySelector("#metricsGrid"),
  providerStrip: document.querySelector("#providerStrip"),
  nextPostPreview: document.querySelector("#nextPostPreview"),
  accountOverview: document.querySelector("#accountOverview"),
  recentPosts: document.querySelector("#recentPosts"),
  mobileAccountDots: document.querySelector("#mobileAccountDots"),
  eventList: document.querySelector("#eventList"),
  postForm: document.querySelector("#postForm"),
  postText: document.querySelector("#postText"),
  mediaUrl: document.querySelector("#mediaUrl"),
  mediaFile: document.querySelector("#mediaFile"),
  mediaPreview: document.querySelector("#mediaPreview"),
  campaignName: document.querySelector("#campaignName"),
  scheduleDate: document.querySelector("#scheduleDate"),
  charCount: document.querySelector("#charCount"),
  draftBtn: document.querySelector("#draftBtn"),
  selectAllBtn: document.querySelector("#selectAllBtn"),
  platformPicker: document.querySelector("#platformPicker"),
  providers: document.querySelector("#providers"),
  activityList: document.querySelector("#activityList"),
  automationList: document.querySelector("#automationList"),
  apiKey: document.querySelector("#apiKey"),
  regenKeyBtn: document.querySelector("#regenKeyBtn"),
  adminPanel: document.querySelector("#adminPanel"),
  editPostModal: document.querySelector("#editPostModal"),
  editPostForm: document.querySelector("#editPostForm"),
  editPostText: document.querySelector("#editPostText"),
  editPostMedia: document.querySelector("#editPostMedia"),
  editPostSchedule: document.querySelector("#editPostSchedule"),
  editPostHint: document.querySelector("#editPostHint")
};

let uploadedMedia = null;
let currentTheme = localStorage.getItem("postvora-theme") || "dark";
let editingPostId = null;

const state = {
  profile: null,
  providers: [],
  posts: [],
  automations: [],
  events: [],
  analytics: {},
  user: null,
  isAdmin: false,
  bootstrapped: false,
  selectedPlatforms: new Set()
};

let queueFilter = "all";

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "content-type": "application/json" },
    ...options
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}

function setStatus(message) {
  els.statusPill.textContent = message;
}

function applyTheme(theme) {
  currentTheme = theme === "light" ? "light" : "dark";
  document.documentElement.dataset.theme = currentTheme;
  localStorage.setItem("postvora-theme", currentTheme);
  if (els.themeLabel) els.themeLabel.textContent = currentTheme === "light" ? "Light" : "Dark";
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#039;"
  }[char]));
}

function formatDate(value) {
  if (!value) return "Post now";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

function toDatetimeLocal(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60000);
  return local.toISOString().slice(0, 16);
}

function providerIcon(provider, size = "") {
  const initials = provider.icon || provider.name.slice(0, 2);
  return `
    <span class="provider-icon ${size}" data-color="${escapeHtml(provider.color)}" data-fallback="${escapeHtml(initials)}">
      <img src="${provider.logoUrl}" alt="${escapeHtml(provider.name)} logo" loading="lazy" onerror="this.remove()">
    </span>
  `;
}

function mediaStyle(url) {
  return url ? ` style="background-image: linear-gradient(135deg, rgba(23, 105, 255, 0.12), rgba(123, 44, 255, 0.08)), url('${escapeHtml(url)}')"` : "";
}

function mediaBackground(url) {
  return url
    ? `background-image: linear-gradient(135deg, rgba(23, 105, 255, 0.12), rgba(123, 44, 255, 0.08)), url('${escapeHtml(url)}')`
    : "";
}

function activateView(view) {
  let target = view || "overview";
  if (target === "admin" && state.bootstrapped && !state.isAdmin) target = "overview";
  els.navLinks.forEach(link => link.classList.toggle("active", link.dataset.view === target));
  els.views.forEach(panel => panel.classList.toggle("active", panel.dataset.viewPanel === target));
  if ((location.hash || "#overview").slice(1) !== target) {
    history.replaceState(null, "", `#${target}`);
  }
}

function syncHash() {
  activateView((location.hash || "#overview").slice(1));
}

function applyBootstrap(data) {
  state.profile = data.profile;
  state.providers = data.providers;
  state.posts = data.posts;
  state.automations = data.automations;
  state.events = data.events;
  state.analytics = data.analytics;
  state.user = data.user || null;
  state.isAdmin = Boolean(data.isAdmin);
  state.bootstrapped = true;

  for (const provider of state.providers) {
    if (provider.connected) state.selectedPlatforms.add(provider.id);
  }

  renderAll();
}

async function loadApp(message = "Ready") {
  const data = await api("/api/bootstrap");
  applyBootstrap(data);
  setStatus(message);
}

function renderAll() {
  renderProfile();
  renderMetrics();
  renderProviderStrip();
  renderOverviewBoard();
  renderEvents();
  renderAccounts();
  renderPlatformPicker();
  renderActivity();
  renderAutomations();
  renderDeveloperPanel();
  renderAuthState();
  renderAdminAccess();
  renderAdminPanel();
}

function renderAdminAccess() {
  const adminLink = document.querySelector('[data-view="admin"]');
  if (adminLink) adminLink.classList.toggle("hidden", !state.isAdmin);
  if (!state.isAdmin && (location.hash || "").slice(1) === "admin") activateView("overview");
}

function renderProfile() {
  els.workspaceName.textContent = state.profile.name;
  els.workspacePlan.textContent = `${state.profile.plan} plan`;
}

function renderMetrics() {
  const metrics = [
    ["Total posts", state.analytics.totalPosts || 0, "All campaigns created"],
    ["Scheduled", state.analytics.scheduled || 0, "Queued for publishing"],
    ["Synced reach", compactNumber(state.analytics.impressions || 0), "Real platform insights only"],
    ["Engagement", state.analytics.engagementRate || "0.0%", `${compactNumber(state.analytics.engagements || 0)} synced actions`]
  ];

  els.metricsGrid.innerHTML = metrics.map(([label, value, helper]) => `
    <article class="metric-card">
      <span>${label}</span>
      <strong>${value}</strong>
      <small>${helper}</small>
    </article>
  `).join("");
}

function compactNumber(value) {
  return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(Number(value || 0));
}

function renderProviderStrip() {
  els.providerStrip.innerHTML = state.providers.map(provider => `
    <article class="channel-card ${provider.connected ? "on" : ""}" title="${escapeHtml(provider.name)}">
      ${providerIcon(provider, "channel-icon")}
      <span>
        <strong>${escapeHtml(provider.name)}</strong>
        <small>${provider.connected ? "Connected" : provider.configured ? "Ready" : "Coming soon"}</small>
      </span>
    </article>
  `).join("");
}

function renderOverviewBoard() {
  renderNextPostPreview();
  renderAccountOverview();
  renderRecentPosts();
  renderMobileAccountDots();
}

function renderNextPostPreview() {
  const post = state.posts[0];
  const text = post ? post.text : "Digital innovation drives business growth with smarter social automation.";
  const when = post ? formatDate(post.scheduleDate || post.createdAt) : "Ready to publish";
  const mediaUrl = post && post.mediaUrl ? post.mediaUrl : "";
  els.nextPostPreview.innerHTML = `
    <div>
      <h3>${escapeHtml(text.slice(0, 92))}${text.length > 92 ? "..." : ""}</h3>
      <p>${escapeHtml(when)}</p>
      ${renderInsights(post)}
      <a class="secondary-button" href="#queue" data-jump="queue">View schedule</a>
    </div>
    <div class="preview-art"${mediaStyle(mediaUrl)}>
      <span>AI</span>
    </div>
  `;
}

function renderAccountOverview() {
  const connected = state.providers.filter(provider => provider.connected);
  const total = state.providers.length;
  const percent = total ? Math.round((connected.length / total) * 100) : 0;
  const rows = state.providers.slice(0, 5).map(provider => `
    <li>
      <span style="background:${provider.color}"></span>
      <strong>${escapeHtml(provider.name)}</strong>
      <small>${provider.connected ? "Live" : "Pending"}</small>
    </li>
  `).join("");
  els.accountOverview.innerHTML = `
    <div class="donut" style="--value:${percent}">
      <strong>${connected.length}</strong>
      <span>Connected</span>
    </div>
    <ul>${rows}</ul>
  `;
}

function renderRecentPosts() {
  const posts = state.posts.slice(0, 3);
  if (!posts.length) {
    els.recentPosts.innerHTML = `
      <article class="recent-post-item">
        <div class="recent-thumb"></div>
        <div>
          <strong>Boost your productivity with smart automation.</strong>
          <span>Facebook Page</span>
        </div>
        <em>Draft</em>
      </article>
      <article class="recent-post-item">
        <div class="recent-thumb alt"></div>
        <div>
          <strong>Stay ahead with data-driven insights.</strong>
          <span>LinkedIn Profile</span>
        </div>
        <em>Ready</em>
      </article>
    `;
    return;
  }

  els.recentPosts.innerHTML = posts.map(post => `
    <article class="recent-post-item">
      <div class="recent-thumb"${mediaStyle(post.mediaUrl)}></div>
      <div>
        <strong>${escapeHtml(post.text.slice(0, 86))}${post.text.length > 86 ? "..." : ""}</strong>
        <span>${escapeHtml(post.platforms.join(" + "))}</span>
        ${renderInsights(post)}
      </div>
      <em>${escapeHtml(post.status)}</em>
    </article>
  `).join("");
}

function renderInsights(post) {
  if (!post || !post.insights) {
    return `<div class="insight-row muted-insights"><span>Insights not synced</span></div>`;
  }
  return `
    <div class="insight-row">
      <span>${compactNumber(post.insights.reach)} reach</span>
      <span>${compactNumber(post.insights.engagement)} engagement</span>
      <span>${post.insights.engagementRate}</span>
    </div>
  `;
}

function renderMobileAccountDots() {
  const post = state.posts.find(item => item.mediaUrl);
  const phoneImage = document.querySelector(".phone-image");
  if (phoneImage) phoneImage.setAttribute("style", post && post.mediaUrl ? mediaBackground(post.mediaUrl) : "");
  if (!els.mobileAccountDots) return;

  els.mobileAccountDots.innerHTML = state.providers.slice(0, 4).map(provider => `
    <span class="${provider.connected ? "on" : ""}" style="background:${provider.color}" data-fallback="${escapeHtml(provider.icon || provider.name[0])}">
      <img src="${provider.logoUrl}" alt="${escapeHtml(provider.name)}" loading="lazy" onerror="this.remove()">
    </span>
  `).join("");
}

function renderEvents() {
  if (!state.events.length) {
    els.eventList.innerHTML = `<div class="empty">No system events yet.</div>`;
    return;
  }

  els.eventList.innerHTML = state.events.slice(0, 8).map(event => `
    <article class="event-item">
      <span>${escapeHtml(event.type)}</span>
      <strong>${escapeHtml(event.message)}</strong>
      <small>${formatDate(event.createdAt)}</small>
    </article>
  `).join("");
}

function renderAccounts() {
  els.providers.innerHTML = state.providers.map(provider => {
    const support = provider.supports.map(item => `<span>${escapeHtml(item)}</span>`).join("");
    const pages = provider.id === "facebook" && provider.connected
      ? renderFacebookPages(provider)
      : "";
    const instagramAccounts = provider.id === "instagram" && provider.connected
      ? renderInstagramAccounts(provider)
      : "";
    const linkedInProfile = provider.id === "linkedin" && provider.connected
      ? renderLinkedInProfile(provider)
      : "";
    return `
      <article class="account-card">
        <div class="account-head">
          ${providerIcon(provider)}
          <div>
            <h3>${escapeHtml(provider.name)}</h3>
            <p>${escapeHtml(provider.handle)}</p>
          </div>
          <button class="switch ${provider.connected ? "on" : ""}" data-provider-action="${provider.connected ? "disconnect" : "connect"}" data-provider="${provider.id}" type="button" aria-label="${provider.connected ? "Disconnect" : "Connect"} ${escapeHtml(provider.name)}">
            <span></span>
          </button>
        </div>
        <div class="support-list">${support}</div>
        ${pages}
        ${instagramAccounts}
        ${linkedInProfile}
        <div class="account-footer">
          <span>${provider.connected ? "OAuth linked" : provider.configured ? "Ready for login" : "Add API credentials"}</span>
          <button class="text-button" data-provider-action="${provider.connected ? "disconnect" : "connect"}" data-provider="${provider.id}" type="button">
            ${provider.connected ? "Unlink" : "Connect"}
          </button>
        </div>
      </article>
    `;
  }).join("");
}

function renderLinkedInProfile(provider) {
  const targets = provider.linkedInTargets && provider.linkedInTargets.length
    ? provider.linkedInTargets.map(target => `
      <label class="target-option">
        <input type="checkbox" value="${escapeHtml(target.id)}" data-linkedin-target ${target.selected ? "checked" : ""}>
        <span>${escapeHtml(target.type === "profile" ? "Profile" : target.type === "test" ? "Test Page" : "Page")}</span>
        <strong>${escapeHtml(target.name)}</strong>
      </label>
    `).join("")
    : `<span class="empty">Sync profile to load LinkedIn targets.</span>`;

  return `
    <div class="page-selector">
      <span>LinkedIn publishing targets</span>
      <strong>${escapeHtml(provider.accountName || "LinkedIn Member")}</strong>
      <div class="target-list">${targets}</div>
      <button class="text-button" data-sync-linkedin-profile type="button">Sync Profile</button>
    </div>
  `;
}

function renderInstagramAccounts(provider) {
  if (!provider.instagramAccounts.length) {
    return `
      <div class="page-selector empty-selector">
        <strong>No Instagram account loaded</strong>
        <span>Connect with the Facebook profile that owns the linked Page, then sync.</span>
        <button class="text-button" data-sync-instagram-accounts type="button">Sync Instagram</button>
      </div>
    `;
  }

  const options = provider.instagramAccounts.map(account => `
    <option value="${escapeHtml(account.id)}" ${account.selected ? "selected" : ""}>
      @${escapeHtml(account.username)} via ${escapeHtml(account.pageName || "Facebook Page")}
    </option>
  `).join("");

  return `
    <label class="page-selector">
      <span>Instagram Creator/Business Account</span>
      <select data-instagram-account>
        ${options}
      </select>
    </label>
  `;
}

function renderFacebookPages(provider) {
  if (!provider.pages.length) {
    return `
      <div class="page-selector empty-selector">
        <strong>No Pages loaded</strong>
        <span>Unlink and reconnect Facebook after granting Page permissions.</span>
        <button class="text-button" data-sync-facebook-pages type="button">Sync Pages</button>
      </div>
    `;
  }

  const options = provider.pages.map(page => `
    <option value="${escapeHtml(page.id)}" ${page.selected ? "selected" : ""}>
      ${escapeHtml(page.name)} (${escapeHtml(page.category)})
    </option>
  `).join("");

  return `
    <label class="page-selector">
      <span>Publishing Page</span>
      <select data-facebook-page>
        ${options}
      </select>
    </label>
  `;
}

function renderPlatformPicker() {
  els.platformPicker.innerHTML = state.providers.map(provider => `
    <label class="platform-option ${provider.connected ? "" : "disabled"}">
      <input type="checkbox" value="${provider.id}" ${state.selectedPlatforms.has(provider.id) ? "checked" : ""} ${provider.connected ? "" : "disabled"}>
      ${providerIcon(provider, "small")}
      <span>
        <strong>${escapeHtml(provider.name)}</strong>
        <small>${provider.connected ? "Available" : provider.configured ? "Connect with login" : "Credentials needed"}</small>
      </span>
    </label>
  `).join("");
}

function renderActivity() {
  const posts = state.posts.filter(post => queueFilter === "all" ? true : post.status === queueFilter);
  if (!posts.length) {
    const emptyCopy = queueFilter === "all"
      ? "No campaigns yet. Compose your first post to populate the queue."
      : `No ${queueFilter} posts in this view.`;
    els.activityList.innerHTML = `<div class="empty large">${escapeHtml(emptyCopy)}</div>`;
    return;
  }

  els.activityList.innerHTML = posts.map(post => {
    const okCount = post.results.filter(result => result.ok).length;
    const platforms = post.results.map(result => `<span class="${result.ok ? "ok" : "blocked"}">${escapeHtml(result.platform || result.providerId)}</span>`).join("");
    const canPublishNow = ["scheduled", "blocked", "ready"].includes(post.status);
    const scheduleActions = `
      <div class="queue-actions">
        <button class="secondary-button" type="button" data-edit-post="${escapeHtml(post.id)}">Edit</button>
        ${canPublishNow ? `<button class="primary-button" type="button" data-publish-post="${escapeHtml(post.id)}">Publish now</button>` : ""}
      </div>
    `;
    return `
      <article class="activity-item">
        <div class="activity-media"${mediaStyle(post.mediaUrl)}>
          <span>${post.mediaUrl ? "Media" : "Text"}</span>
        </div>
        <div class="activity-content">
          <div class="activity-meta">
            <span class="status ${post.status}">${escapeHtml(post.status)}</span>
            <span>${formatDate(post.scheduleDate || post.createdAt)}</span>
            <span>${okCount}/${post.platforms.length} jobs</span>
          </div>
          <p>${escapeHtml(post.text.slice(0, 260))}${post.text.length > 260 ? "..." : ""}</p>
          ${renderInsights(post)}
          <div class="platform-tags">${platforms}</div>
          ${scheduleActions}
        </div>
      </article>
    `;
  }).join("");
}

function renderAutomations() {
  els.automationList.innerHTML = state.automations.map(rule => `
    <article class="automation-card">
      <div>
        <h3>${escapeHtml(rule.name)}</h3>
        <p>${escapeHtml(rule.trigger)}</p>
        <small>${escapeHtml(rule.action)}</small>
      </div>
      <button class="switch ${rule.enabled ? "on" : ""}" data-automation="${rule.id}" data-enabled="${rule.enabled ? "0" : "1"}" type="button" aria-label="Toggle ${escapeHtml(rule.name)}">
        <span></span>
      </button>
    </article>
  `).join("");
}

function renderDeveloperPanel() {
  els.apiKey.textContent = state.profile.apiKey;
}

async function renderAdminPanel() {
  if (!els.adminPanel) return;
  if (!state.isAdmin) {
    els.adminPanel.innerHTML = `<div class="empty large">Admin backend is restricted to the owner account.</div>`;
    return;
  }

  try {
    const data = await api("/api/admin/summary");
    const cards = [
      ["Users", data.users.total, `${data.users.google} Google accounts`],
      ["Published", data.usage.published, "Real saved post records"],
      ["Scheduled", data.usage.scheduled, "Queued posts"],
      ["Total jobs", data.platforms.jobs, "Platform attempts"],
      ["Success rate", data.platforms.successRate, `${data.platforms.failed} failed jobs`],
      ["Billing", data.billing.source || "Not connected", "Stripe/paid plans pending"]
    ];
    els.adminPanel.innerHTML = `
      <div class="admin-grid">
        ${cards.map(([label, value, helper]) => `
          <article class="metric-card admin-card">
            <span>${escapeHtml(label)}</span>
            <strong>${escapeHtml(value)}</strong>
            <small>${escapeHtml(helper)}</small>
          </article>
        `).join("")}
      </div>
      <div class="two-column admin-two-column">
        <section class="panel">
          <div class="section-title"><span>Recent users</span><span class="muted">Admin only</span></div>
          <div class="admin-list">
            ${data.recentUsers.map(user => `
              <article>
                <strong>${escapeHtml(user.name)}</strong>
                <span>${escapeHtml(user.email)} · ${escapeHtml(user.provider)}</span>
              </article>
            `).join("") || `<div class="empty">No users yet.</div>`}
          </div>
        </section>
        <section class="panel">
          <div class="section-title"><span>Audit log</span><span class="muted">Latest</span></div>
          <div class="admin-list">
            ${data.audit.map(event => `
              <article>
                <strong>${escapeHtml(event.message)}</strong>
                <span>${escapeHtml(event.type)} · ${formatDate(event.createdAt)}</span>
              </article>
            `).join("")}
          </div>
        </section>
      </div>
    `;
  } catch (error) {
    els.adminPanel.innerHTML = `<div class="empty large">${escapeHtml(error.message)}</div>`;
  }
}

function renderAuthState() {
  const signin = document.querySelector(".signin-card");
  const authUser = document.querySelector("#authUser");
  const googleButton = document.querySelector(".google-button");
  if (!authUser) return;

  if (signin) signin.classList.toggle("hidden", Boolean(state.user));
  if (googleButton) googleButton.classList.toggle("hidden", Boolean(state.user));
  authUser.classList.toggle("hidden", !state.user);
  authUser.innerHTML = state.user ? `
    ${state.user.picture ? `<img src="${escapeHtml(state.user.picture)}" alt="">` : `<span>${escapeHtml(state.user.name.slice(0, 1))}</span>`}
    <strong>${escapeHtml(state.user.name)}</strong>
    <button type="button" data-logout>Logout</button>
  ` : "";
}

function openEditPost(post) {
  editingPostId = post.id;
  els.editPostText.value = post.text || "";
  els.editPostMedia.value = post.mediaUrl || "";
  els.editPostSchedule.value = toDatetimeLocal(post.scheduleDate || "");
  if (els.editPostHint) {
    els.editPostHint.textContent = post.status === "published"
      ? "This updates the saved Postvora record. Already-published platform posts are not edited retroactively."
      : "Update the caption, media URL, or schedule before publishing.";
  }
  els.editPostModal.classList.remove("hidden");
  els.editPostText.focus();
}

function closeEditPost() {
  editingPostId = null;
  els.editPostModal.classList.add("hidden");
  els.editPostForm.reset();
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Could not read image"));
    reader.readAsDataURL(file);
  });
}

function renderMediaPreview() {
  if (!uploadedMedia) {
    els.mediaPreview.classList.add("hidden");
    els.mediaPreview.innerHTML = "";
    return;
  }

  els.mediaPreview.classList.remove("hidden");
  els.mediaPreview.innerHTML = `
    <img src="${uploadedMedia.url}" alt="Uploaded media preview">
    <div>
      <strong>${escapeHtml(uploadedMedia.fileName)}</strong>
      <span>${Math.round(uploadedMedia.size / 1024)} KB uploaded</span>
    </div>
    <button class="text-button" id="removeMediaBtn" type="button">Remove</button>
  `;
}

async function connectProvider(providerId) {
  setStatus("Opening official login");
  const data = await api(`/api/connect/${providerId}`, { method: "POST" });
  if (data.authUrl) {
    window.location.href = data.authUrl;
    return;
  }
  setStatus(data.message || "Account linked");
  await loadApp("Account linked");
}

async function disconnectProvider(providerId) {
  setStatus("Unlinking account");
  await api(`/api/disconnect/${providerId}`, { method: "POST" });
  state.selectedPlatforms.delete(providerId);
  await loadApp("Account unlinked");
}

els.providers.addEventListener("click", async event => {
  const syncButton = event.target.closest("[data-sync-facebook-pages]");
  if (syncButton) {
    syncButton.disabled = true;
    try {
      setStatus("Syncing Facebook Pages");
      await api("/api/connections/facebook/sync-pages", { method: "POST" });
      await loadApp("Facebook Pages synced");
    } catch (error) {
      setStatus(error.message);
    } finally {
      syncButton.disabled = false;
    }
    return;
  }

  const syncInstagramButton = event.target.closest("[data-sync-instagram-accounts]");
  if (syncInstagramButton) {
    syncInstagramButton.disabled = true;
    try {
      setStatus("Syncing Instagram");
      await api("/api/connections/instagram/sync-accounts", { method: "POST" });
      await loadApp("Instagram account synced");
    } catch (error) {
      setStatus(error.message);
    } finally {
      syncInstagramButton.disabled = false;
    }
    return;
  }

  const syncLinkedInButton = event.target.closest("[data-sync-linkedin-profile]");
  if (syncLinkedInButton) {
    syncLinkedInButton.disabled = true;
    try {
      setStatus("Syncing LinkedIn");
      await api("/api/connections/linkedin/sync-profile", { method: "POST" });
      await loadApp("LinkedIn profile synced");
    } catch (error) {
      setStatus(error.message);
    } finally {
      syncLinkedInButton.disabled = false;
    }
    return;
  }

  const button = event.target.closest("[data-provider]");
  if (!button) return;

  button.disabled = true;
  try {
    if (button.dataset.providerAction === "disconnect") await disconnectProvider(button.dataset.provider);
    else await connectProvider(button.dataset.provider);
  } catch (error) {
    setStatus(error.message);
  } finally {
    button.disabled = false;
  }
});

els.providers.addEventListener("change", async event => {
  if (event.target.matches("[data-linkedin-target]")) {
    const selected = [...els.providers.querySelectorAll("[data-linkedin-target]:checked")].map(input => input.value);
    try {
      setStatus("Updating LinkedIn targets");
      await api("/api/connections/linkedin/targets", {
        method: "POST",
        body: JSON.stringify({ targets: selected })
      });
      await loadApp("LinkedIn targets updated");
    } catch (error) {
      setStatus(error.message);
      await loadApp("Ready");
    }
    return;
  }

  const instagramSelect = event.target.closest("[data-instagram-account]");
  if (instagramSelect) {
    try {
      setStatus("Selecting Instagram account");
      await api("/api/connections/instagram/account", {
        method: "POST",
        body: JSON.stringify({ accountId: instagramSelect.value })
      });
      await loadApp("Instagram account selected");
    } catch (error) {
      setStatus(error.message);
    }
    return;
  }

  const select = event.target.closest("[data-facebook-page]");
  if (!select) return;

  try {
    setStatus("Selecting Facebook Page");
    await api("/api/connections/facebook/page", {
      method: "POST",
      body: JSON.stringify({ pageId: select.value })
    });
    await loadApp("Facebook Page selected");
  } catch (error) {
    setStatus(error.message);
  }
});

els.platformPicker.addEventListener("change", event => {
  if (event.target.matches("input[type='checkbox']")) {
    if (event.target.checked) state.selectedPlatforms.add(event.target.value);
    else state.selectedPlatforms.delete(event.target.value);
  }
});

els.postText.addEventListener("input", () => {
  els.charCount.textContent = els.postText.value.length;
});

els.mediaFile.addEventListener("change", async () => {
  const file = els.mediaFile.files[0];
  if (!file) return;
  if (!file.type.startsWith("image/")) {
    setStatus("Choose an image file");
    return;
  }
  if (file.size > 8_000_000) {
    setStatus("Image must be 8 MB or smaller");
    return;
  }

  try {
    setStatus("Uploading image");
    const dataUrl = await fileToDataUrl(file);
    uploadedMedia = await api("/api/media", {
      method: "POST",
      body: JSON.stringify({
        name: file.name,
        type: file.type,
        dataUrl
      })
    });
    els.mediaUrl.value = uploadedMedia.absoluteUrl || uploadedMedia.url;
    renderMediaPreview();
    setStatus("Image uploaded");
  } catch (error) {
    uploadedMedia = null;
    renderMediaPreview();
    setStatus(error.message);
  }
});

els.mediaPreview.addEventListener("click", event => {
  if (!event.target.closest("#removeMediaBtn")) return;
  uploadedMedia = null;
  els.mediaUrl.value = "";
  els.mediaFile.value = "";
  renderMediaPreview();
  setStatus("Image removed");
});

els.selectAllBtn.addEventListener("click", () => {
  for (const provider of state.providers) {
    if (provider.connected) state.selectedPlatforms.add(provider.id);
  }
  renderPlatformPicker();
});

els.draftBtn.addEventListener("click", () => {
  setStatus("Draft saved locally");
});

els.postForm.addEventListener("submit", async event => {
  event.preventDefault();
  setStatus("Creating jobs");

  try {
    const data = await api("/api/post", {
      method: "POST",
      body: JSON.stringify({
        text: els.postText.value,
        mediaUrl: els.mediaUrl.value,
        campaign: els.campaignName.value,
        scheduleDate: els.scheduleDate.value,
        platforms: [...state.selectedPlatforms]
      })
    });

    state.posts.unshift(data.post);
    state.analytics = data.analytics;
    els.postForm.reset();
    uploadedMedia = null;
    renderMediaPreview();
    els.charCount.textContent = "0";
    await loadApp(data.post.status === "scheduled" ? "Scheduled" : "Jobs created");
    location.hash = "#queue";
  } catch (error) {
    setStatus(error.message);
  }
});

els.automationList.addEventListener("click", async event => {
  const button = event.target.closest("[data-automation]");
  if (!button) return;

  try {
    setStatus("Updating automation");
    await api(`/api/automations/${button.dataset.automation}`, {
      method: "POST",
      body: JSON.stringify({ enabled: button.dataset.enabled === "1" })
    });
    await loadApp("Automation updated");
  } catch (error) {
    setStatus(error.message);
  }
});

document.querySelector("#queueTabs")?.addEventListener("click", event => {
  const button = event.target.closest("[data-queue-filter]");
  if (!button) return;
  queueFilter = button.dataset.queueFilter;
  document.querySelectorAll("[data-queue-filter]").forEach(item => {
    item.classList.toggle("active", item === button);
  });
  renderActivity();
});

els.activityList.addEventListener("click", async event => {
  const editButton = event.target.closest("[data-edit-post]");
  const publishButton = event.target.closest("[data-publish-post]");
  if (!editButton && !publishButton) return;

  const postId = (editButton || publishButton).dataset.editPost || (editButton || publishButton).dataset.publishPost;
  const post = state.posts.find(item => item.id === postId);
  if (!post) return;

  try {
    if (editButton) {
      openEditPost(post);
      return;
    }

    if (!window.confirm("Publish this scheduled post now?")) return;
    setStatus("Publishing scheduled post");
    await api(`/api/posts/${postId}/publish`, { method: "POST" });
    await loadApp("Scheduled post published");
  } catch (error) {
    setStatus(error.message);
  }
});

els.editPostModal?.addEventListener("click", event => {
  if (event.target === els.editPostModal || event.target.closest("[data-close-edit]")) {
    closeEditPost();
  }
});

els.editPostForm?.addEventListener("submit", async event => {
  event.preventDefault();
  const post = state.posts.find(item => item.id === editingPostId);
  if (!post) return;

  try {
    setStatus("Saving post");
    await api(`/api/posts/${post.id}`, {
      method: "POST",
      body: JSON.stringify({
        text: els.editPostText.value,
        mediaUrl: els.editPostMedia.value,
        scheduleDate: els.editPostSchedule.value,
        campaign: post.campaign,
        platforms: post.platforms
      })
    });
    closeEditPost();
    await loadApp(post.status === "published" ? "Local record updated" : "Post updated");
  } catch (error) {
    setStatus(error.message);
  }
});

els.regenKeyBtn.addEventListener("click", async () => {
  try {
    setStatus("Regenerating key");
    const data = await api("/api/profile/regenerate-key", { method: "POST" });
    state.profile = data.profile;
    renderDeveloperPanel();
    setStatus("API key regenerated");
  } catch (error) {
    setStatus(error.message);
  }
});

els.refreshBtn.addEventListener("click", () => {
  setStatus("Refreshing");
  loadApp("Ready").catch(error => setStatus(error.message));
});

els.themeToggle.addEventListener("click", () => {
  applyTheme(currentTheme === "light" ? "dark" : "light");
});

document.querySelector(".google-button")?.addEventListener("click", async () => {
  try {
    setStatus("Opening Google login");
    const data = await api("/api/auth/google/start", { method: "POST" });
    window.location.href = data.authUrl;
  } catch (error) {
    setStatus(error.message);
  }
});

document.querySelector("#authUser")?.addEventListener("click", async event => {
  if (!event.target.closest("[data-logout]")) return;
  try {
    setStatus("Signing out");
    await api("/api/auth/logout", { method: "POST" });
    state.user = null;
    await loadApp("Signed out");
  } catch (error) {
    setStatus(error.message);
  }
});

window.addEventListener("hashchange", syncHash);
els.jumpLinks.forEach(link => link.addEventListener("click", () => activateView(link.dataset.jump)));

const query = new URLSearchParams(window.location.search);
applyTheme(currentTheme);
syncHash();
loadApp(query.has("oauth_error") ? `OAuth error: ${query.get("oauth_error")}` : query.has("login") ? "Signed in" : query.has("connected") ? "Account connected" : "Ready")
  .catch(error => setStatus(error.message));
