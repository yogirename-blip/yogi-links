const { AD_TOP, AD_MIDDLE, AD_BOTTOM } = require("../ads");

const slot = (code, label) =>
  code && code.trim() ? `<div class="ad">${code}</div>` : `<div class="ad ph">${label}</div>`;

// Renders one "wait + ads" page (step X of N).
function renderStep({ code, step, total, token, wait }) {
  const last = step >= total;
  const href = `/${encodeURIComponent(code)}/continue?t=${encodeURIComponent(token)}`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Please wait… (${step}/${total})</title>
<style>
*{box-sizing:border-box}body{margin:0;font-family:system-ui,Segoe UI,Arial,sans-serif;background:#0b1220;color:#e8eef9;display:flex;justify-content:center}
.wrap{width:100%;max-width:560px;padding:18px}
.card{background:#121c2e;border:1px solid #26354d;border-radius:16px;padding:18px;margin-bottom:14px;text-align:center}
h1{font-size:19px;margin:0 0 6px}.muted{color:#93a4bf;font-size:14px;margin:0}
.steps{display:flex;gap:6px;justify-content:center;margin:10px 0 0}.steps i{width:34px;height:6px;border-radius:9px;background:#26354d}.steps i.on{background:#2dd4bf}
.timer{font-size:44px;font-weight:700;margin:10px 0;color:#2dd4bf}
a.btn{display:block;padding:14px;border-radius:12px;background:#2dd4bf;color:#04211d;font-weight:700;text-decoration:none;font-size:16px}
a.btn.off{background:#26354d;color:#6d7f9b;pointer-events:none}
.ad{margin:0 auto 14px;text-align:center;overflow:hidden;max-width:100%}
.ad.ph{border:2px dashed #34475f;border-radius:12px;padding:36px 10px;color:#6d7f9b;font-size:13px}
</style></head><body><div class="wrap">
${slot(AD_TOP, "Ad space (top)")}
<div class="card">
  <h1>Step ${step} of ${total}</h1>
  <p class="muted">${last ? "Last step! Your link is almost ready." : "Wait for the timer, then continue."}</p>
  <div class="steps">${Array.from({ length: total }, (_, i) => `<i class="${i < step ? "on" : ""}"></i>`).join("")}</div>
  <div class="timer" id="t">${wait}</div>
  <a id="go" class="btn off" href="${href}">${last ? "Get link" : "Continue"}</a>
</div>
${slot(AD_MIDDLE, "Ad space (middle)")}
${slot(AD_BOTTOM, "Ad space (bottom)")}
</div>
<script>
var s=${Number(wait)},t=document.getElementById("t"),g=document.getElementById("go");
var iv=setInterval(function(){s--;if(s<=0){clearInterval(iv);t.textContent="Ready";g.classList.remove("off")}else t.textContent=s},1000);
</script></body></html>`;
}

module.exports = { renderStep };
