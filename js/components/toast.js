let timer = null;

export function showToast(message, icon = "✅") {
  let el = document.getElementById("pr-toast");
  if (el) el.remove();
  el = document.createElement("div");
  el.id = "pr-toast";
  el.className = "toast";
  el.innerHTML = `<span>${icon}</span><span>${message}</span>`;
  document.body.appendChild(el);
  clearTimeout(timer);
  timer = setTimeout(() => el.remove(), 2200);
}
