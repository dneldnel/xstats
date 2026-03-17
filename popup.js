const SETTINGS_STORAGE_KEY = "xstats.settings";
const LATEST_DATA_STORAGE_KEY = "xstats.latestData";
const RECENT_COUNTS_URL = "https://api.x.com/2/tweets/counts/recent";
const ARCHIVE_COUNTS_URL = "https://api.x.com/2/tweets/counts/all";
const MAX_PAGES = 100;

const elements = {
  bearerToken: document.querySelector("#bearerToken"),
  username: document.querySelector("#username"),
  quickRange: document.querySelector("#quickRange"),
  timezoneMode: document.querySelector("#timezoneMode"),
  startTime: document.querySelector("#startTime"),
  endTime: document.querySelector("#endTime"),
  excludeReplies: document.querySelector("#excludeReplies"),
  excludeRetweets: document.querySelector("#excludeRetweets"),
  saveButton: document.querySelector("#saveButton"),
  fetchButton: document.querySelector("#fetchButton"),
  status: document.querySelector("#status"),
  summary: document.querySelector("#summary"),
  visuals: document.querySelector("#visuals"),
  heatmapChart: document.querySelector("#heatmapChart"),
  dailyBarChart: document.querySelector("#dailyBarChart")
};

const state = {
  latestData: null
};

document.addEventListener("DOMContentLoaded", async () => {
  await loadSettings();
  await loadLatestDataset();
  bindEvents();
});

function bindEvents() {
  elements.quickRange.addEventListener("change", () => {
    if (elements.quickRange.value !== "custom") {
      applyDefaultRange(elements.quickRange.value);
    }
  });

  elements.timezoneMode.addEventListener("change", async () => {
    await saveSettings();
    rerenderLatestDataset();
  });

  elements.saveButton.addEventListener("click", async () => {
    await saveSettings();
    setStatus("设置已保存。");
  });

  elements.fetchButton.addEventListener("click", async () => {
    try {
      await saveSettings();
      await fetchAndRender();
    } catch (error) {
      setStatus(error.message || "查询失败。", true);
    }
  });
}

function applyDefaultRange(preset = "7d") {
  const end = new Date();
  const start = new Date(end);

  if (preset === "24h") {
    start.setHours(start.getHours() - 24);
  } else {
    start.setDate(start.getDate() - 7);
  }

  elements.startTime.value = formatDateTimeLocal(start);
  elements.endTime.value = formatDateTimeLocal(end);
}

async function loadSettings() {
  const stored = await chrome.storage.local.get(SETTINGS_STORAGE_KEY);
  const settings = stored[SETTINGS_STORAGE_KEY];
  if (!settings) {
    applyDefaultRange();
    return;
  }

  elements.bearerToken.value = settings.bearerToken || "";
  elements.username.value = settings.username || "";
  elements.quickRange.value = settings.quickRange || "7d";
  elements.timezoneMode.value = settings.timezoneMode || "local";
  elements.excludeReplies.checked = settings.excludeReplies ?? true;
  elements.excludeRetweets.checked = settings.excludeRetweets ?? true;
  elements.startTime.value = settings.startTime || "";
  elements.endTime.value = settings.endTime || "";

  if (!elements.startTime.value || !elements.endTime.value) {
    applyDefaultRange(elements.quickRange.value);
  }
}

async function loadLatestDataset() {
  const stored = await chrome.storage.local.get(LATEST_DATA_STORAGE_KEY);
  const latestData = stored[LATEST_DATA_STORAGE_KEY];
  if (!latestData?.buckets?.length) {
    return;
  }

  state.latestData = latestData;
  rerenderLatestDataset();
  setStatus("已恢复上次查询结果。");
}

async function saveSettings() {
  const settings = readForm();
  await chrome.storage.local.set({ [SETTINGS_STORAGE_KEY]: settings });
}

function readForm() {
  return {
    bearerToken: elements.bearerToken.value.trim(),
    username: elements.username.value.trim().replace(/^@/, ""),
    quickRange: elements.quickRange.value,
    timezoneMode: elements.timezoneMode.value,
    startTime: elements.startTime.value,
    endTime: elements.endTime.value,
    excludeReplies: elements.excludeReplies.checked,
    excludeRetweets: elements.excludeRetweets.checked
  };
}

async function fetchAndRender() {
  const settings = readForm();
  validateSettings(settings);

  setLoading(true);
  setStatus("正在获取小时统计...");
  elements.summary.hidden = true;
  elements.visuals.hidden = true;

  try {
    const counts = await fetchCounts(settings);
    const buckets = normalizeBuckets(counts, settings.startTime, settings.endTime);
    await persistLatestDataset(settings, counts, buckets);
    state.latestData = {
      username: settings.username,
      query: buildQuery(settings),
      startTime: settings.startTime,
      endTime: settings.endTime,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      capturedAt: new Date().toISOString(),
      totalCount: counts.reduce((sum, item) => sum + Number(item.tweet_count || 0), 0),
      buckets
    };
    renderSummary(settings.username, counts, buckets);
    renderCharts(buckets);
    setStatus("查询完成。");
  } finally {
    setLoading(false);
  }
}

async function persistLatestDataset(settings, counts, buckets) {
  const totalCount = counts.reduce((sum, item) => sum + Number(item.tweet_count || 0), 0);
  await chrome.storage.local.set({
    [LATEST_DATA_STORAGE_KEY]: {
      username: settings.username,
      query: buildQuery(settings),
      startTime: settings.startTime,
      endTime: settings.endTime,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      capturedAt: new Date().toISOString(),
      totalCount,
      buckets
    }
  });
}

function validateSettings(settings) {
  if (!settings.bearerToken) {
    throw new Error("请先填写 X API Bearer Token。");
  }
  if (!settings.username) {
    throw new Error("请填写账号用户名。");
  }
  if (!settings.startTime || !settings.endTime) {
    throw new Error("请填写开始和结束时间。");
  }

  const start = new Date(settings.startTime);
  const end = new Date(settings.endTime);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error("时间格式无效。");
  }
  if (start >= end) {
    throw new Error("开始时间必须早于结束时间。");
  }
}

async function fetchCounts(settings) {
  const buckets = [];
  let nextToken = "";
  let page = 0;
  const endpoint = pickCountsEndpoint(settings.startTime, settings.endTime);

  while (page < MAX_PAGES) {
    page += 1;
    setStatus(`正在拉取第 ${page} 页统计桶...`);

    const params = new URLSearchParams({
      query: buildQuery(settings),
      start_time: new Date(settings.startTime).toISOString(),
      end_time: new Date(settings.endTime).toISOString(),
      granularity: "hour"
    });

    if (nextToken) {
      params.set("next_token", nextToken);
    }

    const response = await fetch(`${endpoint}?${params.toString()}`, {
      headers: {
        Authorization: `Bearer ${settings.bearerToken}`
      }
    });

    const payload = await parseJson(response);
    if (!response.ok) {
      throw new Error(extractApiError(payload, "统计拉取失败。"));
    }

    buckets.push(...(payload.data || []));
    nextToken = payload.meta?.next_token || "";

    if (!nextToken) {
      break;
    }
  }

  if (page === MAX_PAGES) {
    setStatus("已达到分页上限，结果可能不完整。", true);
  }

  return buckets;
}

function normalizeBuckets(apiBuckets, startTime, endTime) {
  const start = roundToHour(new Date(startTime));
  const end = roundToHour(new Date(endTime));
  const bucketMap = new Map();

  for (let cursor = new Date(start); cursor <= end; cursor.setHours(cursor.getHours() + 1)) {
    bucketMap.set(cursor.toISOString(), 0);
  }

  for (const bucket of apiBuckets) {
    if (!bucket.start) {
      continue;
    }
    const hour = roundToHour(new Date(bucket.start)).toISOString();
    if (bucketMap.has(hour)) {
      bucketMap.set(hour, Number(bucket.tweet_count || 0));
    }
  }

  return Array.from(bucketMap.entries()).map(([iso, count]) => ({
    iso,
    count
  }));
}

function renderSummary(username, apiBuckets, buckets) {
  const timezoneMode = getTimezoneMode();
  const activeHours = buckets.filter((bucket) => bucket.count > 0).length;
  const totalCount = apiBuckets.reduce((sum, item) => sum + Number(item.tweet_count || 0), 0);
  const maxBucket = buckets.reduce((current, item) => {
    if (!current || item.count > current.count) {
      return item;
    }
    return current;
  }, null);

  elements.summary.textContent =
    `@${username} 共统计 ${totalCount} 条帖子，覆盖 ${buckets.length} 个小时桶，` +
    `其中 ${activeHours} 个小时有发帖。峰值为 ${maxBucket ? formatHourBucketLabel(maxBucket.iso, timezoneMode) : "-"}，` +
    `${maxBucket?.count || 0} 条。当前按${timezoneMode === "utc" ? " UTC" : "本地时间"}显示。`;
  elements.summary.hidden = false;
}

function renderStoredSummary(latestData, buckets) {
  const timezoneMode = getTimezoneMode();
  const activeHours = buckets.filter((bucket) => bucket.count > 0).length;
  const maxBucket = buckets.reduce((current, item) => {
    if (!current || item.count > current.count) {
      return item;
    }
    return current;
  }, null);

  elements.summary.textContent =
    `@${latestData.username} 共统计 ${latestData.totalCount || 0} 条帖子，覆盖 ${buckets.length} 个小时桶，` +
    `其中 ${activeHours} 个小时有发帖。峰值为 ${maxBucket ? formatHourBucketLabel(maxBucket.iso, timezoneMode) : "-"}，` +
    `${maxBucket?.count || 0} 条。当前按${timezoneMode === "utc" ? " UTC" : "本地时间"}显示。`;
  elements.summary.hidden = false;
}

function renderCharts(buckets) {
  renderHeatmap(buckets);
  renderDailyBars(buckets);
  elements.visuals.hidden = false;
}

function renderHeatmap(buckets) {
  const timezoneMode = getTimezoneMode();
  const maxCount = Math.max(...buckets.map((bucket) => bucket.count), 1);
  const dayMap = new Map();

  for (const bucket of buckets) {
    const dateKey = formatDateKey(bucket.iso, timezoneMode);
    if (!dayMap.has(dateKey)) {
      dayMap.set(dateKey, {
        label: formatDayLabel(bucket.iso, timezoneMode),
        hours: Array.from({ length: 24 }, () => 0)
      });
    }
    dayMap.get(dateKey).hours[getHourValue(bucket.iso, timezoneMode)] += bucket.count;
  }

  const header = `
    <div class="heatmap-header">
      <div class="day-label">日期</div>
      ${Array.from({ length: 24 }, (_, hour) => `<div class="hour-label">${String(hour).padStart(2, "0")}</div>`).join("")}
    </div>
  `;

  const rows = Array.from(dayMap.values())
    .map((day) => {
      const cells = day.hours
        .map((count) => {
          const alpha = count > 0 ? 0.12 + (count / maxCount) * 0.88 : 0.06;
          return `<div class="heat-cell" data-count="${count}" style="background: rgba(10, 127, 120, ${alpha.toFixed(2)});"></div>`;
        })
        .join("");
      return `<div class="heatmap-row"><div class="day-label">${day.label}</div>${cells}</div>`;
    })
    .join("");

  elements.heatmapChart.innerHTML = header + rows;
}

function renderDailyBars(buckets) {
  const totals = aggregateDailyTotals(buckets, getTimezoneMode());
  const maxCount = Math.max(...totals.map((item) => item.count), 1);

  elements.dailyBarChart.innerHTML = totals
    .map((item) => {
      const width = `${(item.count / maxCount) * 100}%`;
      return `
        <div class="bar-row">
          <div class="axis-label">${item.label}</div>
          <div class="bar-track"><div class="bar-fill" style="width:${width}"></div></div>
          <div class="bar-value">${item.count}</div>
        </div>
      `;
    })
    .join("");
}

function setStatus(message, isError = false) {
  elements.status.textContent = message;
  elements.status.classList.toggle("error", isError);
}

function rerenderLatestDataset() {
  if (!state.latestData?.buckets?.length) {
    return;
  }

  const buckets = state.latestData.buckets.map((bucket) => ({
    iso: bucket.iso,
    count: Number(bucket.count || 0)
  }));

  renderStoredSummary(state.latestData, buckets);
  renderCharts(buckets);
}

function setLoading(isLoading) {
  elements.fetchButton.disabled = isLoading;
  elements.saveButton.disabled = isLoading;
}

function roundToHour(date) {
  const rounded = new Date(date);
  rounded.setMinutes(0, 0, 0);
  return rounded;
}

function pickCountsEndpoint(startTime, endTime) {
  const now = Date.now();
  const start = new Date(startTime).getTime();
  const end = new Date(endTime).getTime();
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;

  if (start >= sevenDaysAgo && end <= now) {
    return RECENT_COUNTS_URL;
  }

  return ARCHIVE_COUNTS_URL;
}

function buildQuery(settings) {
  const parts = [`from:${settings.username}`];
  if (settings.excludeReplies) {
    parts.push("-is:reply");
  }
  if (settings.excludeRetweets) {
    parts.push("-is:retweet");
  }
  return parts.join(" ");
}

function formatDateTimeLocal(date) {
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60 * 1000);
  return local.toISOString().slice(0, 16);
}

function formatHourLabel(date) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false
  }).format(date);
}

function formatDayLabel(iso, timezoneMode) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    timeZone: timezoneMode === "utc" ? "UTC" : undefined
  }).format(new Date(iso));
}

function formatDateKey(iso, timezoneMode) {
  const date = new Date(iso);
  const year = timezoneMode === "utc" ? date.getUTCFullYear() : date.getFullYear();
  const month = String((timezoneMode === "utc" ? date.getUTCMonth() : date.getMonth()) + 1).padStart(2, "0");
  const day = String(timezoneMode === "utc" ? date.getUTCDate() : date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function aggregateDailyTotals(buckets, timezoneMode) {
  const totals = new Map();
  for (const bucket of buckets) {
    const dateKey = formatDateKey(bucket.iso, timezoneMode);
    totals.set(dateKey, (totals.get(dateKey) || 0) + bucket.count);
  }

  return Array.from(totals.entries()).map(([dateKey, count]) => ({
    label: dateKey.slice(5).replace("-", "/"),
    count
  }));
}

function getHourValue(iso, timezoneMode) {
  const date = new Date(iso);
  return timezoneMode === "utc" ? date.getUTCHours() : date.getHours();
}

function formatHourBucketLabel(iso, timezoneMode) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    timeZone: timezoneMode === "utc" ? "UTC" : undefined
  }).format(new Date(iso));
}

function getTimezoneMode() {
  return elements.timezoneMode.value || "local";
}

async function parseJson(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

function extractApiError(payload, fallback) {
  const title = payload.errors?.[0]?.title || payload.title;
  const detail = payload.errors?.[0]?.detail || payload.detail;
  return [fallback, title, detail].filter(Boolean).join(" ");
}
