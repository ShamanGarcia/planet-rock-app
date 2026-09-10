let timer = null;

export function showToast(message, { small = false } = {}) {
  let el = document.getElementById("pr-toast");
  if (el) el.remove();
  el = document.createElement("div");
  el.id = "pr-toast";
  el.className = small ? "toast toast-small" : "toast";
  el.textContent = message;
  document.body.appendChild(el);
  clearTimeout(timer);
  timer = setTimeout(() => el.remove(), 2200);
}
