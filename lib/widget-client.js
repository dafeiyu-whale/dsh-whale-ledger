// dsh-whale-ledger · 角落挂件客户端（P2 · 白鲸主题）
// 由 /dsh-ledger/widget.js 原样下发到页面执行：角落徽章 + 点击展开面板。
// 2026-10-29：改为「方案 B · 白鲸」——白磨砂面板、天蓝强调、圆环进度、信息减到三行。
(function () {
  try {
    if (window.__whaleLedgerLoaded) return
    window.__whaleLedgerLoaded = true

    function addCss(css) {
      var s = document.createElement('style')
      s.textContent = css
      document.head.appendChild(s)
    }
    addCss([
      '#wl-badge{position:fixed;right:16px;bottom:16px;z-index:2147483000;',
      'background:rgba(255,255,255,.92);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);',
      'color:#0f172a;font:12px/1.6 ui-sans-serif,system-ui,"Segoe UI",sans-serif;',
      'padding:6px 12px;border-radius:999px;cursor:grab;touch-action:none;user-select:none;',
      'border:1px solid rgba(15,23,42,.08);box-shadow:0 4px 14px rgba(15,23,42,.10);opacity:.94;}',
      '#wl-badge:hover{opacity:1;}',
      '#wl-badge.wl-dragging{cursor:grabbing;}',
      '#wl-panel{position:fixed;right:16px;bottom:56px;z-index:2147482999;',
      'background:rgba(255,255,255,.96);-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px);',
      'color:#0f172a;font:12px/1.7 ui-sans-serif,system-ui,"Segoe UI",sans-serif;',
      'padding:14px 16px;border-radius:16px;border:1px solid rgba(15,23,42,.08);',
      'box-shadow:0 10px 32px rgba(15,23,42,.16);min-width:232px;display:none;}',
      '#wl-panel .wl-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px;}',
      '#wl-panel .wl-title{font-weight:600;letter-spacing:.02em;}',
      '#wl-panel .wl-peak{font-size:11px;color:#64748b;}',
      '#wl-panel .wl-ring-wrap{display:flex;align-items:center;gap:12px;margin:2px 0 6px;}',
      '#wl-panel .wl-ring{width:58px;height:58px;border-radius:50%;flex:0 0 auto;',
      'background:conic-gradient(#0ea5e9 var(--p,0%),#e2e8f0 0);position:relative;}',
      '#wl-panel .wl-ring::after{content:"";position:absolute;inset:6px;border-radius:50%;background:rgba(255,255,255,.98);}',
      '#wl-panel .wl-ring-num{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;',
      'font-size:12px;font-weight:600;color:#0f172a;}',
      '#wl-panel .wl-left{font-size:22px;font-weight:600;letter-spacing:-.01em;line-height:1.2;}',
      '#wl-panel .wl-left small{display:block;font-size:11px;font-weight:400;color:#64748b;letter-spacing:0;margin-top:2px;}',
      '#wl-panel .wl-divider{height:1px;background:rgba(15,23,42,.08);margin:10px 0;}',
      '#wl-panel .wl-row{display:flex;justify-content:space-between;gap:12px;font-size:11.5px;color:#334155;}',
      '#wl-panel .wl-row .dim{color:#94a3b8;}',
      '#wl-panel .wl-sub{font-size:10.5px;color:#94a3b8;margin-top:2px;}',
      '#wl-panel .wl-section{margin-top:10px;font-size:11px;color:#64748b;}',
      '#wl-panel input#wl-pct{width:42px;background:#f8fafc;color:#0ea5e9;border:1px solid rgba(15,23,42,.12);',
      'border-radius:6px;padding:1px 5px;font:11px ui-monospace,monospace;text-align:right;}',
      '#wl-panel .wl-actions{margin-top:12px;display:flex;gap:8px;}',
      '#wl-panel button{background:#f1f5f9;color:#0f172a;border:1px solid rgba(15,23,42,.08);border-radius:8px;',
      'padding:4px 10px;cursor:pointer;font:11px ui-sans-serif,system-ui,sans-serif;}',
      '#wl-panel button:hover{background:#e2e8f0;}',
      '#wl-pct::-webkit-outer-spin-button,#wl-pct::-webkit-inner-spin-button{-webkit-appearance:none;margin:0;}',
      '#wl-pct{-moz-appearance:textfield;appearance:textfield;}',
    ].join(''))

    var badge = document.createElement('div')
    badge.id = 'wl-badge'
    badge.textContent = '🐳 鲸鱼账本 …'
    document.body.appendChild(badge)
    var panel = document.createElement('div')
    panel.id = 'wl-panel'
    document.body.appendChild(panel)

    var balance = null
    var pricing = null
    var lastTurn = null
    var panelVisible = false

    function p2(x) { return x < 10 ? '0' + x : '' + x }
    function countdown(ms) {
      if (!(ms > 0)) return '00:00:00'
      var s = Math.floor(ms / 1000)
      return p2(Math.floor(s / 3600)) + ':' + p2(Math.floor(s % 3600 / 60)) + ':' + p2(s % 60)
    }
    function nowTime() {
      var d = new Date()
      return p2(d.getHours()) + ':' + p2(d.getMinutes()) + ':' + p2(d.getSeconds())
    }
    function money(x) { return '¥' + Number(x || 0).toFixed(2) }

    function renderBadge() {
      var t = '🐳 鲸鱼账本 …'
      if (balance && balance.ok && balance.balance) {
        t = '🐳 ' + money(balance.balance.total) + ' · 剩 ' + money(balance.quota && balance.quota.remaining)
        if (pricing && pricing.ok) t += ' · ' + (pricing.isPeak ? '🔴峰' : '🟢谷')
      }
      badge.textContent = t
    }

    function renderPanel() {
      if (!panelVisible) return
      var rows = []
      var q = (balance && balance.ok) ? balance.quota : null
      var b = (balance && balance.ok) ? balance.balance : null

      rows.push('<div class="wl-head"><span class="wl-title">🐳 鲸鱼账本</span>')
      if (pricing && pricing.ok) {
        rows.push('<span class="wl-peak">' + (pricing.isPeak ? '🔴 高峰价' : '🟢 谷价') + '</span>')
      }
      rows.push('</div>')

      if (q) {
        var pct = q.allowance > 0 ? Math.max(0, Math.min(100, (q.remaining / q.allowance) * 100)) : 0
        rows.push('<div class="wl-ring-wrap">')
        rows.push('<div class="wl-ring" style="--p:' + pct.toFixed(1) + '%"><div class="wl-ring-num">' + Math.round(pct) + '%</div></div>')
        rows.push('<div class="wl-left"><span class="wl-whale">🐳</span>' + money(q.remaining) + '<small>本鲸私房钱剩余</small></div>')
        rows.push('</div>')
        rows.push('<div class="wl-divider"></div>')
        rows.push('<div class="wl-row"><span class="dim">额度 ' + money(q.allowance) + '</span>' +
          '<span class="dim">已用 ' + money(q.used) + '</span></div>')
        rows.push('<div class="wl-sub">份额 ' + money(q.share) + ' ｜ 调整 ' + money(q.credits) + '</div>')
      } else {
        rows.push('<div class="wl-row"><span>' + (balance && balance.error ? balance.error : '读取中…') + '</span></div>')
      }

      if (b) {
        rows.push('<div class="wl-divider"></div>')
        rows.push('<div class="wl-row"><span class="dim">充值 ' + money(b.recharge) + '</span>' +
          '<span class="dim">赠金 ' + money(b.bonus) + '</span></div>')
      }

      if (pricing && pricing.ok && pricing.nextChangeAt) {
        rows.push('<div class="wl-row"><span class="dim">' + (pricing.nextLabel || '切换') + '</span>' +
          '<span id="wl-countdown">' + countdown(pricing.nextChangeAt - Date.now()) + '</span></div>')
      }

      if (lastTurn && lastTurn.ok && lastTurn.lastTurn) {
        var lt = lastTurn.lastTurn
        rows.push('<div class="wl-row"><span class="dim">最近一轮 ¥' + Number(lt.amount || 0).toFixed(4) + '</span>' +
          '<span class="dim">' + lt.tokens + ' tk' + (lt.isSubagent ? ' · 子代理' : '') + '</span></div>')
      }

      rows.push('<div class="wl-section">私房钱比例 <input id="wl-pct" type="number" min="0" max="100" step="1"> %</div>')
      rows.push('<div class="wl-sub">更新 ' + nowTime() + '</div>')
      rows.push('<div class="wl-actions"><button id="wl-refresh">刷新</button><button id="wl-export">导出账本</button></div>')

      panel.innerHTML = rows.join('')

      var btn = document.getElementById('wl-refresh')
      if (btn) btn.onclick = function () { refreshData(true) }
      var pct2 = document.getElementById('wl-pct')
      if (pct2) {
        if (document.activeElement !== pct2) pct2.value = (balance && balance.quota) ? balance.quota.percent : 0
        pct2.addEventListener('input', function () {
          pct2.value = String(pct2.value).replace(/\D/g, '')
        })
        pct2.addEventListener('keydown', function (e) {
          if (e.key === 'Enter') pct2.blur()
        })
        pct2.addEventListener('change', function () {
          var v = parseFloat(pct2.value)
          if (!isFinite(v)) v = 0
          v = Math.min(100, Math.max(0, v))
          fetch('/dsh-ledger/percent', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ percent: v }),
          }).then(function (r) { return r.json() })
            .then(function (d) { if (d && d.ok) refreshData(false) })
            .catch(function () {})
        })
      }
      var ex = document.getElementById('wl-export')
      if (ex) ex.onclick = function () { window.open('/dsh-ledger/export?format=md', '_blank') }
    }

    function safeRender() {
      var act = document.activeElement
      if (act && act.id === 'wl-pct') return
      renderPanel()
    }

    function refreshData(force) {
      fetch('/dsh-ledger/balance.json' + (force ? '?refresh=1' : ''), { cache: 'no-store' })
        .then(function (r) { return r.json() })
        .then(function (d) { balance = d; renderBadge(); safeRender() })
        .catch(function () {})
      fetch('/dsh-ledger/pricing.json', { cache: 'no-store' })
        .then(function (r) { return r.json() })
        .then(function (d) { pricing = d; renderBadge(); safeRender() })
        .catch(function () {})
      fetch('/dsh-ledger/last-turn.json', { cache: 'no-store' })
        .then(function (r) { return r.json() })
        .then(function (d) { lastTurn = d; safeRender() })
        .catch(function () {})
    }

    // 位置记忆 + 拖动（插件多的时候用户自己挪）
    var POS_KEY = 'wl-pos-v1'
    var pos = { right: 16, bottom: 16 }
    try {
      var saved = JSON.parse(localStorage.getItem(POS_KEY) || 'null')
      if (saved && isFinite(saved.right) && isFinite(saved.bottom)) pos = saved
    } catch (err) {}
    function applyPos() {
      badge.style.right = pos.right + 'px'
      badge.style.bottom = pos.bottom + 'px'
      panel.style.right = pos.right + 'px'
      panel.style.bottom = (pos.bottom + badge.offsetHeight + 10) + 'px'
    }

    var drag = null
    badge.addEventListener('pointerdown', function (e) {
      drag = { x: e.clientX, y: e.clientY, right: pos.right, bottom: pos.bottom, moved: false }
      badge.classList.add('wl-dragging')
      try { badge.setPointerCapture(e.pointerId) } catch (err) {}
    })
    badge.addEventListener('pointermove', function (e) {
      if (!drag) return
      var dx = e.clientX - drag.x
      var dy = e.clientY - drag.y
      if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true
      if (!drag.moved) return
      pos.right = Math.max(4, drag.right - dx)
      pos.bottom = Math.max(4, drag.bottom - dy)
      applyPos()
    })
    function endDrag() {
      if (!drag) return
      var moved = drag.moved
      drag = null
      badge.classList.remove('wl-dragging')
      if (moved) {
        try {
          localStorage.setItem(POS_KEY, JSON.stringify({ right: Math.round(pos.right), bottom: Math.round(pos.bottom) }))
        } catch (err) {}
        return
      }
      panelVisible = !panelVisible
      panel.style.display = panelVisible ? 'block' : 'none'
      renderPanel()
    }
    badge.addEventListener('pointerup', endDrag)
    badge.addEventListener('pointercancel', endDrag)
    applyPos()

    refreshData(false)
    setInterval(function () { refreshData(false) }, 60000)
    setInterval(function () {
      if (!panelVisible) return
      var cd = document.getElementById('wl-countdown')
      if (cd && pricing && pricing.ok && pricing.nextChangeAt) {
        cd.textContent = countdown(pricing.nextChangeAt - Date.now())
      }
    }, 1000)
  } catch (e) {
    console.error('[whale-ledger]', e)
  }
})()
