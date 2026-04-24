(() => {
  const DEFAULT_SETTINGS = {
    enabled: true,
    mode: "smart",
    inputSupport: true,
    siteOverrides: {}
  };

  const MESSAGE_GET_STATUS = "RTL_SMART_GET_STATUS";
  const MESSAGE_APPLY_SETTINGS = "RTL_SMART_APPLY_SETTINGS";
  const APPLIED_ATTR = "data-rtl-smart-applied";
  const PREV_DIR_ATTR = "data-rtl-smart-prev-dir";
  const FIXED_CLASS = "rtl-smart-fixed";

  const RTL_RE = /[\u0590-\u05FF\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/u;
  const RTL_GLOBAL_RE = /[\u0590-\u05FF\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/gu;
  const LATIN_GLOBAL_RE = /[A-Za-z]/g;
  const LETTER_GLOBAL_RE = /\p{L}/gu;
  const FIRST_STRONG_RE = /[A-Za-z\u0590-\u05FF\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/u;
  const URL_RE = /\b(?:https?:\/\/|www\.)\S+/gi;
  const EMAIL_RE = /\b\S+@\S+\.\S+\b/g;

  const TEXT_SELECTOR = [
    "a",
    "blockquote",
    "button",
    "caption",
    "dd",
    "div",
    "dt",
    "figcaption",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "input",
    "label",
    "legend",
    "li",
    "option",
    "p",
    "span",
    "summary",
    "td",
    "textarea",
    "th",
    "[contenteditable]",
    "[role='textbox']"
  ].join(",");

  const SKIP_TAGS = new Set([
    "AUDIO",
    "BR",
    "CANVAS",
    "CODE",
    "EMBED",
    "HR",
    "IFRAME",
    "IMG",
    "KBD",
    "MATH",
    "NOSCRIPT",
    "OBJECT",
    "PRE",
    "SAMP",
    "SCRIPT",
    "STYLE",
    "SVG",
    "VIDEO"
  ]);

  const BROAD_CONTAINER_TAGS = new Set([
    "ARTICLE",
    "ASIDE",
    "DIV",
    "FIELDSET",
    "FOOTER",
    "FORM",
    "HEADER",
    "MAIN",
    "NAV",
    "OL",
    "SECTION",
    "UL"
  ]);

  const RTL_INPUT_TYPES = new Set([
    "",
    "search",
    "text"
  ]);

  const state = {
    settings: { ...DEFAULT_SETTINGS },
    effective: { enabled: true, mode: "smart", inputSupport: true },
    observer: null,
    scheduled: false,
    fixedCount: 0,
    lastRunAt: null
  };

  function getHostname() {
    return window.location.hostname || "__local_file__";
  }

  function mergeSettings(settings) {
    return {
      ...DEFAULT_SETTINGS,
      ...settings,
      siteOverrides: {
        ...DEFAULT_SETTINGS.siteOverrides,
        ...(settings && settings.siteOverrides ? settings.siteOverrides : {})
      }
    };
  }

  function computeEffectiveSettings(settings) {
    const site = settings.siteOverrides[getHostname()] || {};

    return {
      enabled: site.enabled ?? settings.enabled,
      mode: site.mode || settings.mode,
      inputSupport: settings.inputSupport
    };
  }

  function loadSettings() {
    return new Promise((resolve) => {
      if (!chrome.storage || !chrome.storage.sync) {
        resolve({ ...DEFAULT_SETTINGS });
        return;
      }

      chrome.storage.sync.get(DEFAULT_SETTINGS, (stored) => {
        resolve(mergeSettings(stored));
      });
    });
  }

  function startObserver() {
    stopObserver();

    state.observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "childList" || mutation.type === "characterData") {
          scheduleScan();
          return;
        }

        if (mutation.type === "attributes" && isCandidateElement(mutation.target)) {
          processElement(mutation.target);
        }
      }
    });

    state.observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["placeholder", "value"],
      childList: true,
      characterData: true,
      subtree: true
    });
  }

  function stopObserver() {
    if (state.observer) {
      state.observer.disconnect();
      state.observer = null;
    }
  }

  function scheduleScan() {
    if (state.scheduled || !state.effective.enabled) return;

    state.scheduled = true;
    window.setTimeout(() => {
      state.scheduled = false;
      scanDocument();
    }, 120);
  }

  function countMatches(text, pattern) {
    return (text.match(pattern) || []).length;
  }

  function normalizeText(text) {
    return text
      .replace(URL_RE, " ")
      .replace(EMAIL_RE, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function classifyText(text) {
    const normalized = normalizeText(text);
    if (!normalized || !RTL_RE.test(normalized)) return null;

    const rtlCount = countMatches(normalized, RTL_GLOBAL_RE);
    const latinCount = countMatches(normalized, LATIN_GLOBAL_RE);
    const letterCount = countMatches(normalized, LETTER_GLOBAL_RE);
    const firstStrong = normalized.match(FIRST_STRONG_RE);
    const rtlRatio = letterCount > 0 ? rtlCount / letterCount : 0;
    const threshold = state.effective.mode === "aggressive" ? 0.12 : 0.28;

    if (firstStrong && RTL_RE.test(firstStrong[0])) return "rtl";
    if (rtlCount >= 2 && rtlRatio >= threshold) return "rtl";
    if (rtlCount >= 4 && rtlCount >= latinCount * 0.5) return "rtl";

    return null;
  }

  function isSupportedInput(element) {
    if (element.tagName !== "INPUT") return true;
    return RTL_INPUT_TYPES.has((element.getAttribute("type") || "text").toLowerCase());
  }

  function isVisible(element) {
    if (element === document.body || element === document.documentElement) return true;
    if (element.hidden || element.getAttribute("aria-hidden") === "true") return false;
    return element.getClientRects().length > 0;
  }

  function hasOwnText(element) {
    return Array.from(element.childNodes).some((node) => {
      return node.nodeType === Node.TEXT_NODE && normalizeText(node.textContent || "").length > 0;
    });
  }

  function isCandidateElement(element) {
    if (!(element instanceof HTMLElement)) return false;
    if (SKIP_TAGS.has(element.tagName)) return false;
    if (element.closest("[data-rtl-smart-ignore], pre, code, kbd, samp, svg, canvas")) return false;
    if (!isVisible(element)) return false;
    if (!state.effective.inputSupport && (element.tagName === "INPUT" || element.tagName === "TEXTAREA")) return false;
    if (!isSupportedInput(element)) return false;
    return true;
  }

  function getElementText(element) {
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      return `${element.value || ""} ${element.getAttribute("placeholder") || ""}`;
    }

    return element.textContent || "";
  }

  function shouldAvoidBroadContainer(element, text) {
    if (state.effective.mode === "aggressive") return false;
    if (!BROAD_CONTAINER_TAGS.has(element.tagName)) return false;
    if (element.isContentEditable || element.getAttribute("role") === "textbox") return false;
    if (hasOwnText(element)) return false;

    const childTextElements = Array.from(element.children).filter((child) => {
      return child instanceof HTMLElement && normalizeText(child.textContent || "").length > 0;
    });

    return text.length > 120 || childTextElements.length > 1;
  }

  function applyDirection(element, direction) {
    if (!element.hasAttribute(APPLIED_ATTR)) {
      element.setAttribute(PREV_DIR_ATTR, element.getAttribute("dir") || "");
    }

    element.setAttribute(APPLIED_ATTR, "true");
    if (element.getAttribute("dir") !== direction) {
      element.setAttribute("dir", direction);
    }
    element.classList.add(FIXED_CLASS);
  }

  function resetElement(element) {
    if (!element.hasAttribute(APPLIED_ATTR)) return;

    const previousDirection = element.getAttribute(PREV_DIR_ATTR);
    if (previousDirection) {
      element.setAttribute("dir", previousDirection);
    } else {
      element.removeAttribute("dir");
    }

    element.removeAttribute(APPLIED_ATTR);
    element.removeAttribute(PREV_DIR_ATTR);
    element.classList.remove(FIXED_CLASS);
  }

  function processElement(element) {
    if (!isCandidateElement(element)) {
      resetElement(element);
      return;
    }

    const text = getElementText(element);
    const normalized = normalizeText(text);
    if (!normalized || shouldAvoidBroadContainer(element, normalized)) {
      resetElement(element);
      return;
    }

    const direction = classifyText(normalized);
    if (direction) {
      applyDirection(element, direction);
    } else {
      resetElement(element);
    }
  }

  function scanDocument() {
    if (!document.body || !state.effective.enabled) return;

    const elements = document.body.querySelectorAll(TEXT_SELECTOR);
    for (const element of elements) {
      processElement(element);
    }

    state.fixedCount = document.body.querySelectorAll(`[${APPLIED_ATTR}]`).length;
    state.lastRunAt = new Date().toISOString();
  }

  function cleanupDocument() {
    stopObserver();
    document.querySelectorAll(`[${APPLIED_ATTR}]`).forEach(resetElement);
    state.fixedCount = 0;
    state.lastRunAt = new Date().toISOString();
  }

  function applySettings(settings) {
    state.settings = mergeSettings(settings);
    state.effective = computeEffectiveSettings(state.settings);

    if (!state.effective.enabled) {
      cleanupDocument();
      return;
    }

    scanDocument();
    startObserver();
  }

  function respondWithStatus(sendResponse) {
    sendResponse({
      settings: state.settings,
      effective: state.effective,
      hostname: getHostname(),
      fixedCount: state.fixedCount,
      lastRunAt: state.lastRunAt
    });
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || !message.type) return false;

    if (message.type === MESSAGE_GET_STATUS) {
      respondWithStatus(sendResponse);
      return true;
    }

    if (message.type === MESSAGE_APPLY_SETTINGS) {
      applySettings(message.settings || DEFAULT_SETTINGS);
      respondWithStatus(sendResponse);
      return true;
    }

    return false;
  });

  if (chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== "sync") return;
      if (!changes.enabled && !changes.mode && !changes.inputSupport && !changes.siteOverrides) return;

      loadSettings().then(applySettings);
    });
  }

  document.addEventListener(
    "input",
    (event) => {
      if (event.target instanceof HTMLElement) {
        processElement(event.target);
      }
    },
    true
  );

  loadSettings().then(applySettings);
})();
