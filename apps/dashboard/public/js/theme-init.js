(() => {
  let theme = "dark";
  try {
    const saved = localStorage.getItem("siela.theme");
    if (saved === "light" || saved === "dark") theme = saved;
    else if (window.matchMedia?.("(prefers-color-scheme: light)").matches) theme = "light";
  } catch {
    theme = "dark";
  }
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "light" ? "#f6f6f4" : "#0a0a0a");
})();
