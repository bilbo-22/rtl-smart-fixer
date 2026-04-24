const DEFAULT_SETTINGS = {
  enabled: true,
  mode: "smart",
  inputSupport: true,
  siteOverrides: {}
};

const MESSAGE_GET_STATUS = "RTL_SMART_GET_STATUS";
const MESSAGE_APPLY_SETTINGS = "RTL_SMART_APPLY_SETTINGS";

const elements = {
  enabled: document.getElementById("enabled"),
  inputSupport: document.getElementById("input-support"),
  mode: document.getElementById("mode"),
  rescan: document.getElementById("rescan"),
  siteLabel: document.getElementById("site-label"),
  siteMode: document.getElementById("site-mode"),
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

function siteOverrideValue() {
  const override = settings.siteOverrides[hostname];
  if (!override || typeof override.enabled === "undefined") return "inherit";
  return override.enabled ? "on" : "off";
}

function render() {
  elements.enabled.checked = settings.enabled;
  elements.inputSupport.checked = settings.inputSupport;
  elements.mode.value = settings.mode;
  elements.siteMode.value = siteOverrideValue();
  elements.siteLabel.textContent = hostname ? hostname : "לא זמין בעמוד הזה";

  const unsupported = !activeTab || !hostname || /^chrome:|^edge:|^about:/.test(activeTab.url || "");
  for (const control of [elements.enabled, elements.inputSupport, elements.mode, elements.siteMode, elements.rescan]) {
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
  if (status && status.nativeRtlSkipped) {
    elements.status.textContent = "האתר כבר מוגדר RTL, אז התוסף לא מריץ תיקונים בעמוד הזה.";
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

function updateSiteOverride(value) {
  const nextOverrides = { ...settings.siteOverrides };

  if (value === "inherit") {
    delete nextOverrides[hostname];
  } else {
    nextOverrides[hostname] = {
      ...(nextOverrides[hostname] || {}),
      enabled: value === "on"
    };
  }

  settings = {
    ...settings,
    siteOverrides: nextOverrides
  };
}

async function requestStatus() {
  if (!activeTab || !activeTab.id) return;

  try {
    const status = await chrome.tabs.sendMessage(activeTab.id, { type: MESSAGE_GET_STATUS });
    if (status && status.nativeRtlSkipped) {
      elements.status.textContent = "האתר כבר מוגדר RTL, אז התוסף לא מריץ תיקונים בעמוד הזה.";
    } else if (status && typeof status.fixedCount === "number") {
      elements.status.textContent = `פעיל עכשיו: ${status.effective.enabled ? "כן" : "לא"} · ${status.fixedCount} אלמנטים תוקנו.`;
    }
  } catch (_error) {
    elements.status.textContent = "התוסף יופעל אחרי רענון העמוד, או אחרי מתן הרשאה לקבצים מקומיים.";
  }
}

elements.enabled.addEventListener("change", () => {
  settings = { ...settings, enabled: elements.enabled.checked };
  persistAndApply();
});

elements.inputSupport.addEventListener("change", () => {
  settings = { ...settings, inputSupport: elements.inputSupport.checked };
  persistAndApply();
});

elements.mode.addEventListener("change", () => {
  settings = { ...settings, mode: elements.mode.value };
  persistAndApply();
});

elements.siteMode.addEventListener("change", () => {
  updateSiteOverride(elements.siteMode.value);
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
