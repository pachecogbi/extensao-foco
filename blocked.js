document.getElementById("openOpts").addEventListener("click", () => {
  if (chrome.runtime && chrome.runtime.openOptionsPage) {
    chrome.runtime.openOptionsPage();
  }
});
document.getElementById("back").addEventListener("click", () => {
  window.history.length > 1 && window.history.back();
});
