const DEFAULT_SETTINGS = {
  mode: "smart",
  inputSupport: true,
  siteOverrides: {}
};

const MESSAGE_GET_STATUS = "RTL_SMART_GET_STATUS";
const MESSAGE_APPLY_SETTINGS = "RTL_SMART_APPLY_SETTINGS";

const elements = {
  inputSupport: document.getElementById("input-support"),
  mode: document.getElementById("mode"),
  rescan: document.getElementById("rescan"),
  siteLabel: document.getElementById("site-label"),
  siteEnabled: document.getElementById("site-enabled"),
  status: document.getElementById("status")
};

let activeTab = null;
let hostname = "";
let settings = { ...DEFAULT_SETTINGS };

function mergeSettings(stored) {
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    siteOverrides: {
      ...DEFAULT_SETTINGS.siteOverrides,
      ...(stored && stored.siteOverrides ? stored.siteOverrides : {})
    }
  };
}

function loadSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(DEFAULT_SETTINGS, (stored) => {
      resolve(mergeSettings(stored));
    });
  });
}

function saveSettings(nextSettings) {
  return new Promise((resolve) => {
    chrome.storage.sync.set(nextSettings, resolve);
  });
}

function getActiveTab() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      resolve(tabs[0] || null);
    });
  });
}

function getHostname(tab) {
  if (!tab || !tab.url) return "";

  try {
    const url = new URL(tab.url);
    if (url.protocol === "file:") return "__local_file__";
    return url.hostname;
  } catch (_error) {
    return "";
  }
}

function isSiteEnabled() {
  const override = settings.siteOverrides[hostname];
  return override && override.enabled === true;
}

function isUnsupportedPage() {
  return !activeTab || !hostname || /^chrome:|^edge:|^about:/.test(activeTab.url || "");
}

function render() {
  if (elements.inputSupport) {
    elements.inputSupport.checked = settings.inputSupport;
  }

  elements.mode.value = settings.mode;
  elements.siteEnabled.checked = isSiteEnabled();
  elements.siteLabel.textContent = hostname ? hostname : "לא זמין בעמוד הזה";

  const unsupported = isUnsupportedPage();
  for (const control of [elements.siteEnabled, elements.inputSupport, elements.mode, elements.rescan].filter(Boolean)) {
    control.disabled = unsupported;
  }

  if (unsupported) {
    elements.status.textContent = "Chrome לא מאפשר לתוסף לרוץ בעמוד הזה.";
  }
}

function sendSettingsToTab() {
  if (!activeTab || !activeTab.id) return Promise.resolve(null);

  return chrome.tabs
    .sendMessage(activeTab.id, {
      type: MESSAGE_APPLY_SETTINGS,
      settings
    })
    .catch(() => null);
}

function updateStatus(status, prefix) {
  if (status && status.effective && !status.effective.enabled) {
    elements.status.textContent = "כבוי באתר הזה. כדי להפעיל, הדליקו את \"פעיל באתר הזה\".";
    return;
  }

  if (status && typeof status.fixedCount === "number") {
    elements.status.textContent = `${prefix} ${status.fixedCount} אלמנטים בעמוד.`;
  }
}

async function persistAndApply() {
  await saveSettings(settings);
  const status = await sendSettingsToTab();

  if (status) {
    updateStatus(status, "תוקנו");
  } else {
    elements.status.textContent = "ההגדרות נשמרו. אם זה קובץ מקומי, צריך לאפשר לתוסף גישה ל־file URLs.";
  }
}

function updateSiteOverride(enabled) {
  if (!hostname) return false;

  const nextOverrides = { ...settings.siteOverrides };

  if (enabled) {
    nextOverrides[hostname] = {
      ...(nextOverrides[hostname] || {}),
      enabled: true
    };
  } else {
    delete nextOverrides[hostname];
  }

  settings = {
    ...settings,
    siteOverrides: nextOverrides
  };

  return true;
}

async function requestStatus() {
  if (!activeTab || !activeTab.id) return;

  try {
    const status = await chrome.tabs.sendMessage(activeTab.id, { type: MESSAGE_GET_STATUS });
    if (status && status.effective && !status.effective.enabled) {
      elements.status.textContent = "כבוי באתר הזה. כדי להפעיל, הדליקו את \"פעיל באתר הזה\".";
    } else if (status && typeof status.fixedCount === "number") {
      elements.status.textContent = `פעיל עכשיו: ${status.effective.enabled ? "כן" : "לא"} · ${status.fixedCount} אלמנטים תוקנו.`;
    }
  } catch (_error) {
    elements.status.textContent = "התוסף יופעל אחרי רענון העמוד, או אחרי מתן הרשאה לקבצים מקומיים.";
  }
}

if (elements.inputSupport) {
  elements.inputSupport.addEventListener("change", () => {
    settings = { ...settings, inputSupport: elements.inputSupport.checked };
    persistAndApply();
  });
}

elements.mode.addEventListener("change", () => {
  settings = { ...settings, mode: elements.mode.value };
  persistAndApply();
});

elements.siteEnabled.addEventListener("change", () => {
  if (!updateSiteOverride(elements.siteEnabled.checked)) {
    elements.siteEnabled.checked = false;
    elements.status.textContent = "לא ניתן להפעיל את התוסף בעמוד הזה.";
    return;
  }

  persistAndApply();
});

elements.rescan.addEventListener("click", persistAndApply);

async function init() {
  activeTab = await getActiveTab();
  hostname = getHostname(activeTab);
  settings = await loadSettings();
  render();
  requestStatus();
}

init();
