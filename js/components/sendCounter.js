import { computeUserStats, getCurrentUser } from "../data/api.js";

// After a send is logged: a card with a rolling-digit counter appears mid-screen,
// ticks from the previous send total to the new one, holds a beat, then fades away.
// Fire-and-forget; if the stats call fails the counter just doesn't show.
const ROLL_MS = 700;
const HOLD_MS = 650; // how long the new total stays up before fading

function digitsHTML(from, to) {
  const a = String(from).padStart(String(to).length, "0");
  return [...String(to)].map((d, i) => `
    <span class="sc-digit"><span class="sc-roll" data-to="${d}" style="transform:translateY(${-a[i]}em)">${
      "0123456789".split("").map((n) => `<span>${n}</span>`).join("")
    }</span></span>`).join("");
}

export async function playSendCounter() {
  navigator.vibrate?.([40, 70, 40]); // two quick buzzes for a logged send
  let total;
  try {
    const user = getCurrentUser();
    const stats = await computeUserStats(user.id);
    total = stats.totalClimbs + (stats.rope?.totalClimbs || 0);
  } catch { return; }

  const el = document.createElement("div");
  el.className = "send-counter";
  el.setAttribute("role", "status");
  el.innerHTML = `<div class="sc-card"><div class="sc-number" aria-label="${total} sends">${digitsHTML(total - 1, total)}</div><div class="sc-label">Total Sends</div></div>`;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add("show"));

  setTimeout(() => el.querySelectorAll(".sc-roll").forEach((r) => {
    r.style.transition = `transform ${ROLL_MS}ms cubic-bezier(.2,.8,.2,1)`;
    r.style.transform = `translateY(${-r.dataset.to}em)`;
  }), 350);
  setTimeout(() => el.classList.remove("show"), 350 + ROLL_MS + HOLD_MS);
  setTimeout(() => el.remove(), 350 + ROLL_MS + HOLD_MS + 400);
}
