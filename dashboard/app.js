// Token Radar dashboard (radar-2). Renders window.RADAR with no network:
// a ranked board, a detail view for every protocol, filters, and the live
// token set kept apart with market caps. The page recomputes each row's
// implied value from the snapshot figures and says so when it disagrees
// with the number board.json carries.
(function () {
  'use strict';
  var DATA = window.RADAR;
  var app = document.getElementById('board');
  if (!DATA || !app) return;

  var state = { q: '', category: 'all', chain: 'all', watchOnly: false, minTvl: 0, tab: 'pre', sort: 'implied', dir: -1, selected: null };

  function money(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function pct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function ageLabel(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.round(days) + 'd';
  }
  function esc(s) { return String(s == null ? '' : s); }
  // The model's arithmetic, recomputed in the page from the same figures
  // board.json was scored with: comp multiple, growth, maturity, chain spread.
  function impliedOf(row) {
    var m = DATA.model;
    var growth = Math.min(m.growth_cap, Math.max(m.growth_floor, row.change_7d === null ? 0 : row.change_7d));
    var g = 1 + (growth / 100) * m.growth_weight;
    var age = row.age_days === null ? m.unknown_age_days : row.age_days;
    var mat = m.maturity_floor + (Math.min(Math.max(age, 0), m.maturity_days) / m.maturity_days) * m.maturity_range;
    var ch = 1 + m.chain_step * Math.min(Math.max((row.chains || []).length - 1, 0), m.chain_max_extra);
    return Math.max(1, Math.round(row.tvl_usd * row.comp_multiple * g * mat * ch));
  }

  // Farm plan, derived in the page the same way main.ts derives it: the
  // protocol's category, chain, TVL tier and age decide every step.
  function farmSteps(row) {
    var chain = (row.chains && row.chains.length) ? row.chains[0] : 'its main chain';
    var cap = row.tvl_usd >= 5e9 ? 250 : row.tvl_usd >= 1e9 ? 150 : row.tvl_usd >= 1e8 ? 100 : 50;
    var hold = row.age_days === null ? 30 : row.age_days < 180 ? 60 : row.age_days < 365 ? 45 : 30;
    var c = (row.category || '').toLowerCase();
    var act;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) act = 'Lend $' + cap + ' of USDC on ' + row.name + ' on ' + chain + ' and leave the deposit working.';
    else if (c.indexOf('dex') >= 0 || c.indexOf('leveraged farm') >= 0) act = 'Add $' + cap + ' of liquidity to ' + row.name + "'s main pool on " + chain + ' and leave the position open.';
    else if (c.indexOf('yield') >= 0 || c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) act = 'Put $' + cap + ' into a ' + row.name + ' vault on ' + chain + ' and hold the shares.';
    else if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) act = 'Stake $' + cap + " of the chain's staking asset through " + row.name + ' and keep the receipt token.';
    else if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0 || c.indexOf('basis') >= 0) act = 'Deposit $' + cap + ' of USDC as margin on ' + row.name + ' and open one small hedged position.';
    else if (c.indexOf('prediction') >= 0) act = 'Fund $' + cap + ' and take one position in a market on ' + row.name + '.';
    else if (c.indexOf('stable') >= 0) act = 'Mint or deposit $' + cap + ' of the stable asset through ' + row.name + ' on ' + chain + '.';
    else if (c.indexOf('rwa') >= 0) act = 'Mint $' + cap + " of the yield-bearing asset " + row.name + ' issues on ' + chain + ' and hold it.';
    else if (c.indexOf('insurance') >= 0) act = 'Buy $' + cap + ' of cover from ' + row.name + ' on ' + chain + ' and keep the policy active.';
    else if (c.indexOf('payment') >= 0) act = 'Route $' + cap + ' of payments through ' + row.name + ' on ' + chain + ' and keep the channel open.';
    else act = 'Deposit $' + cap + ' of USDC into ' + row.name + ' on ' + chain + ' and leave the position open.';
    var steps = [
      ['Open a fresh wallet for this farm only, fund it with exactly $' + cap + ' plus gas, and store its seed phrase offline.', 'under $3 of gas for the first transaction', '5 minutes'],
      [act, '$' + cap + ' of capital and about $' + (cap >= 150 ? 8 : 4) + ' of gas', '15 minutes to set up'],
      ['Do one qualifying action each week — a deposit, a borrow, a swap or a vote — so the wallet stays active.', 'about $2 of gas a week', '10 minutes a week'],
      ['Hold the position for at least ' + hold + ' days so the activity lands in more than one snapshot.', 'the $' + cap + ' stays in the position', hold + ' days'],
      ["Check the protocol's own points or rewards page before you withdraw, and claim only from a link that page itself publishes.", 'no fee to check; never pay anyone to claim', '10 minutes'],
      ['Log the wallet, the dates and every transaction, then decide in advance at what point you unwind.', 'nothing but the log', '5 minutes']
    ];
    return steps.map(function (s) { return s[0] + ' Cost: ' + s[1] + '. Time: ' + s[2] + '.'; });
  }

  function h(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.watchOnly && !r.watchlist) return false;
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (state.chain !== 'all' && !(r.chains || []).includes(state.chain)) return false;
      if (r.tvl_usd < state.minTvl) return false;
      if (!q) return true;
      return [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase().indexOf(q) >= 0;
    });
  }
  function sorted(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : 1;
    });
  }

  function readHash() {
    var p = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    if (p.get('q')) state.q = p.get('q');
    if (p.get('category')) state.category = p.get('category');
    if (p.get('chain')) state.chain = p.get('chain');
    if (p.get('watch') === '1') state.watchOnly = true;
    if (p.get('tab')) state.tab = p.get('tab');
    if (p.get('p')) state.selected = p.get('p');
  }
  function writeHash() {
    var p = new URLSearchParams();
    if (state.q) p.set('q', state.q);
    if (state.category !== 'all') p.set('category', state.category);
    if (state.chain !== 'all') p.set('chain', state.chain);
    if (state.watchOnly) p.set('watch', '1');
    if (state.tab !== 'pre') p.set('tab', state.tab);
    if (state.selected) p.set('p', state.selected);
    var s = p.toString();
    window.history.replaceState(null, '', s ? '#' + s : window.location.pathname);
  }

  function topBar() {
    var wrap = h('div', 'top');
    var shell = h('div', 'shell');
    var brand = h('div', 'brand');
    brand.appendChild(h('span', 'mark'));
    brand.appendChild(document.createTextNode('TOKEN RADAR'));
    var meta = h('div', 'top-meta');
    meta.appendChild(h('span', null, 'Snapshot ' + DATA.as_of));
    meta.appendChild(h('span', null, 'DefiLlama protocol index'));
    meta.appendChild(h('span', null, DATA.model_version + ' model'));
    shell.appendChild(brand); shell.appendChild(meta);
    wrap.appendChild(shell);
    return wrap;
  }

  function hero() {
    var sec = h('section', 'hero');
    sec.appendChild(h('h1', null, DATA.board_size + ' pre-token protocols, ranked by implied value'));
    var p = h('p', null, 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. The early radar adds ' + DATA.early_size + ' more below that floor — every rankable pre-token protocol the snapshot holds, with wrapped, staked and bridged products left out. Implied value is a model estimate, never a price and never a promise that a token launches.');
    sec.appendChild(p);
    var stats = h('div', 'stats');
    var items = [
      ['Watchlist covered', DATA.watchlist_size + ' / ' + DATA.watchlist_size],
      ['Pre-token rows', String(DATA.board_size)],
      ['Early rows below the floor', String(DATA.early_size)],
      ['Top implied value', money(DATA.rows[0] ? DATA.rows[0].implied_value_usd : 0)]
    ];
    items.forEach(function (it) {
      var d = h('div', 'stat');
      d.appendChild(h('span', null, it[0]));
      d.appendChild(h('b', null, it[1]));
      stats.appendChild(d);
    });
    sec.appendChild(stats);
    var spot = h('div', 'spot');
    DATA.rows.slice(0, 5).forEach(function (r) {
      var card = h('div', 'spot-card');
      card.tabIndex = 0;
      card.appendChild(h('div', 'rank', 'RANK ' + r.rank));
      card.appendChild(h('b', null, r.name));
      card.appendChild(h('span', null, money(r.implied_value_usd) + ' implied · ' + money(r.tvl_usd) + ' TVL'));
      card.addEventListener('click', function () { openDetail(r.slug); });
      card.addEventListener('keydown', function (e) { if (e.key === 'Enter') openDetail(r.slug); });
      spot.appendChild(card);
    });
    sec.appendChild(spot);
    return sec;
  }

  function controls() {
    var wrap = h('div', 'controls');
    var cats = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (a, r) { return a.concat(r.chains || []); }, []))).sort();
    var qf = h('div', 'field');
    qf.appendChild(h('label', null, 'Search'));
    var q = document.createElement('input');
    q.type = 'search'; q.value = state.q; q.placeholder = 'Name, category or chain'; q.setAttribute('aria-label', 'Search the board');
    q.addEventListener('input', function () { state.q = q.value; writeHash(); render(); });
    qf.appendChild(q); wrap.appendChild(qf);
    function select(label, options, value, onChange) {
      var f = h('div', 'field');
      f.appendChild(h('label', null, label));
      var s = document.createElement('select');
      s.setAttribute('aria-label', label);
      options.forEach(function (o) {
        var op = document.createElement('option');
        op.value = o[0]; op.textContent = o[1];
        if (o[0] === value) op.selected = true;
        s.appendChild(op);
      });
      s.addEventListener('change', function () { onChange(s.value); writeHash(); render(); });
      f.appendChild(s); wrap.appendChild(f);
    }
    select('Category', [['all', 'All categories']].concat(cats.map(function (c) { return [c, c]; })), state.category, function (v) { state.category = v; });
    select('Chain', [['all', 'All chains']].concat(chains.map(function (c) { return [c, c]; })), state.chain, function (v) { state.chain = v; });
    select('Minimum TVL', [['0', 'Any TVL'], ['50000000', '$50M+'], ['100000000', '$100M+'], ['500000000', '$500M+'], ['1000000000', '$1B+']], String(state.minTvl), function (v) { state.minTvl = Number(v); });
    var chk = h('label', 'check');
    var cb = document.createElement('input');
    cb.type = 'checkbox'; cb.checked = state.watchOnly;
    cb.addEventListener('change', function () { state.watchOnly = cb.checked; writeHash(); render(); });
    chk.appendChild(cb); chk.appendChild(document.createTextNode('Watchlist only'));
    wrap.appendChild(chk);
    var tabs = h('div', 'tabs');
    [['pre', 'Pre-token'], ['live', 'Live token']].forEach(function (t) {
      var b = document.createElement('button');
      b.type = 'button'; b.textContent = t[1];
      b.setAttribute('aria-pressed', state.tab === t[0] ? 'true' : 'false');
      b.addEventListener('click', function () { state.tab = t[0]; writeHash(); render(); });
      tabs.appendChild(b);
    });
    wrap.appendChild(tabs);
    var count = h('span', 'count', state.tab === 'pre' ? filteredRows().length + ' rows shown' : DATA.live.length + ' live-token protocols');
    wrap.appendChild(count);
    return wrap;
  }

  function sortBtn(key, label) {
    var th = document.createElement('th');
    th.scope = 'col';
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = label + (state.sort === key ? (state.dir < 0 ? ' v' : ' ^') : '');
    b.addEventListener('click', function () {
      if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; }
      render();
    });
    th.appendChild(b);
    return th;
  }

  function boardTable() {
    var list = sorted(filteredRows());
    var panel = h('div', 'panel');
    if (!list.length) {
      var empty = h('div', 'empty');
      empty.appendChild(h('h2', null, 'No protocol matches that filter'));
      empty.appendChild(h('p', null, 'Clear the search or pick another category to see the board again.'));
      var b = h('button', 'button', 'Clear filters');
      b.type = 'button';
      b.addEventListener('click', function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.watchOnly = false; state.minTvl = 0; writeHash(); render(); });
      empty.appendChild(b);
      panel.appendChild(empty);
      return panel;
    }
    var max = list[0].implied_value_usd || 1;
    var wrap = h('div', 'table-wrap');
    var table = document.createElement('table');
    var cap = h('caption', 'sub', 'Pre-token protocols, strongest implied value first. Select a row for its model breakdown and farm plan.');
    table.appendChild(cap);
    var thead = document.createElement('thead');
    var hr = document.createElement('tr');
    hr.appendChild(sortBtn('implied', 'Rank'));
    hr.appendChild(sortBtn('name', 'Protocol'));
    hr.appendChild(sortBtn('tvl', 'TVL'));
    hr.appendChild(sortBtn('growth', '7d'));
    hr.appendChild(sortBtn('age', 'Age'));
    hr.appendChild(sortBtn('implied', 'Implied value'));
    var thS = document.createElement('th'); thS.scope = 'col'; thS.textContent = 'Status'; hr.appendChild(thS);
    thead.appendChild(hr); table.appendChild(thead);
    var tbody = document.createElement('tbody');
    list.forEach(function (r) {
      var tr = document.createElement('tr');
      tr.setAttribute('data-sel', state.selected === r.slug ? 'true' : 'false');
      tr.tabIndex = 0;
      tr.addEventListener('click', function () { openDetail(r.slug); });
      tr.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } });
      var td;
      td = h('td', 'num', String(r.rank)); tr.appendChild(td);
      td = document.createElement('td');
      var nm = h('div', 'name');
      nm.appendChild(h('b', null, r.name));
      nm.appendChild(h('span', 'sub', (r.category || 'Other') + ' on ' + ((r.chains || []).slice(0, 2).join(', ') || 'an unnamed chain')));
      td.appendChild(nm); tr.appendChild(td);
      tr.appendChild(h('td', 'num', money(r.tvl_usd)));
      var g = h('td', 'num', pct(r.change_7d));
      if (r.change_7d !== null) g.className = 'num ' + (r.change_7d >= 0 ? 'pos' : 'neg');
      tr.appendChild(g);
      tr.appendChild(h('td', 'num', ageLabel(r.age_days)));
      td = document.createElement('td');
      var imp = h('div', 'implied');
      var bar = h('div', 'bar'); bar.setAttribute('aria-hidden', 'true');
      var fill = h('i', null); fill.style.width = Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%';
      bar.appendChild(fill); imp.appendChild(bar);
      imp.appendChild(h('span', 'num', money(r.implied_value_usd)));
      td.appendChild(imp); tr.appendChild(td);
      td = document.createElement('td');
      var badge = h('span', 'badge' + (r.watchlist ? ' watch' : ''), r.watchlist ? 'watchlist' : 'early');
      td.appendChild(badge); tr.appendChild(td);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    panel.appendChild(wrap);
    return panel;
  }

  function liveTable() {
    var panel = h('div', 'panel');
    var wrap = h('div', 'table-wrap');
    var table = document.createElement('table');
    table.appendChild(h('caption', 'sub', 'Tokens live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking — and their median market-cap / TVL per category is where the model takes its multiples.'));
    var thead = document.createElement('thead');
    var hr = document.createElement('tr');
    ['Status', 'Protocol', 'TVL', '7d', 'Market cap', 'Token'].forEach(function (t) { var th = document.createElement('th'); th.scope = 'col'; th.textContent = t; hr.appendChild(th); });
    thead.appendChild(hr); table.appendChild(thead);
    var tbody = document.createElement('tbody');
    DATA.live.forEach(function (r) {
      var tr = document.createElement('tr');
      tr.appendChild(h('td', 'num', 'live'));
      var td = document.createElement('td');
      var nm = h('div', 'name');
      nm.appendChild(h('b', null, r.name));
      nm.appendChild(h('span', 'sub', (r.category || 'Other') + ' on ' + ((r.chains || []).slice(0, 2).join(', ') || 'an unnamed chain')));
      td.appendChild(nm); tr.appendChild(td);
      tr.appendChild(h('td', 'num', money(r.tvl_usd)));
      var g = h('td', 'num', pct(r.change_7d));
      if (r.change_7d !== null) g.className = 'num ' + (r.change_7d >= 0 ? 'pos' : 'neg');
      tr.appendChild(g);
      tr.appendChild(h('td', 'num', money(r.mcap_usd)));
      tr.appendChild(h('td', null, 'already trades'));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody); wrap.appendChild(table); panel.appendChild(wrap);
    return panel;
  }

  function methodSection() {
    var m = DATA.model;
    var sec = h('section', 'panel method');
    var inner = h('div', null);
    inner.style.padding = '18px 20px';
    inner.appendChild(h('h2', null, 'How implied value is computed'));
    inner.appendChild(h('p', 'sub', 'One function scores every row. The category multiple is not a guess: it is the median market-cap / TVL of the snapshot\u2019s own live-token protocols in that category (at least two of them), or the overall live median where a category has fewer. No protocol name is special-cased and no row is hand-picked.'));
    var formula = h('div', 'formula', 'implied = round( tvl_usd x comp(category) x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ') x (' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' x ' + m.maturity_range + ') x (1 + ' + m.chain_step + ' x min(chains - 1, ' + m.chain_max_extra + ')) )');
    inner.appendChild(formula);
    inner.appendChild(h('p', 'sub', 'Age is the time since the protocol was first listed — the best record of how long it has run with no token; an unlisted age uses ' + m.unknown_age_days + ' days. "Records no token" is the snapshot\u2019s claim, not proof a token does not exist: a protocol on the list may still hold one its record does not carry. This is an estimate, not a price, and not a prediction that any token launches.'));
    var table = document.createElement('table');
    table.className = 'comp-table';
    var thead = document.createElement('thead');
    var hr = document.createElement('tr');
    ['Category', 'Multiple', 'Live protocols behind it'].forEach(function (t) { var th = document.createElement('th'); th.scope = 'col'; th.textContent = t; hr.appendChild(th); });
    thead.appendChild(hr); table.appendChild(thead);
    var tbody = document.createElement('tbody');
    DATA.comps.filter(function (c) { return DATA.rows.some(function (r) { return (r.category || 'Other') === c.category; }); }).forEach(function (c) {
      var tr = document.createElement('tr');
      tr.appendChild(h('td', null, c.category));
      tr.appendChild(h('td', 'num', c.multiple.toFixed(3) + (c.fallback ? ' (overall median)' : '')));
      tr.appendChild(h('td', 'num', String(c.live_count)));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    inner.appendChild(table);
    sec.appendChild(inner);
    return sec;
  }

  var dialog = document.createElement('dialog');
  dialog.className = 'detail';
  dialog.setAttribute('aria-labelledby', 'detail-title');
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function openDetail(slug) {
    var row = null;
    DATA.rows.forEach(function (r) { if (r.slug === slug) row = r; });
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var head = h('div', 'detail-head');
    var left = h('div', null);
    left.appendChild(h('span', 'brand-name', 'Rank ' + row.rank + ' of ' + DATA.board_size + (row.watchlist ? ' · watchlist' : ' · early radar')));
    var title = h('h2', null, row.name);
    title.id = 'detail-title';
    left.appendChild(title);
    left.appendChild(h('p', 'sub', (row.category || 'Other') + ' on ' + ((row.chains || []).join(', ') || 'an unnamed chain') + ' · listed ' + (row.listed_at || 'date unknown')));
    head.appendChild(left);
    var close = h('button', 'close', 'Close');
    close.type = 'button'; close.setAttribute('aria-label', 'Close details');
    close.addEventListener('click', function () { dialog.close(); });
    head.appendChild(close);
    dialog.appendChild(head);
    var body = h('div', 'detail-body');
    body.appendChild(h('h3', null, 'Implied value — every input shown'));
    var comp = null;
    DATA.comps.forEach(function (c) { if (c.category === (row.category || 'Other')) comp = c; });
    var compText = row.comp_multiple.toFixed(3) + (comp && comp.fallback
      ? ' (overall median — only ' + row.comp_live_count + ' live protocol' + (row.comp_live_count === 1 ? '' : 's') + ' in this category)'
      : ' (' + row.comp_live_count + ' live protocols in this category)');
    var recomputed = impliedOf(row);
    var kv = h('div', 'kv');
    [
      ['TVL', money(row.tvl_usd)],
      ['Seven-day growth', pct(row.change_7d)],
      ['Age with no token', ageLabel(row.age_days)],
      ['Category multiple', compText],
      ['Growth multiplier', String(row.growth_multiplier)],
      ['Maturity multiplier', String(row.maturity_multiplier)],
      ['Chain multiplier', String(row.chain_multiplier)],
      ['Implied value', money(row.implied_value_usd)]
    ].forEach(function (kvPair) {
      var d = h('div', null);
      d.appendChild(h('span', null, kvPair[0]));
      d.appendChild(h('b', null, kvPair[1]));
      kv.appendChild(d);
    });
    body.appendChild(kv);
    body.appendChild(h('p', 'sub', 'Model ' + DATA.model_version + ': the page recomputes this row as ' + money(recomputed) + (recomputed === row.implied_value_usd ? ', the same number board.json carries.' : ' — that differs from the board, so the data would be stale.') + ' An estimate, not a price.'));
    body.appendChild(h('h3', null, 'Farm plan'));
    var ol = document.createElement('ol');
    ol.className = 'steps';
    farmSteps(row).forEach(function (s) {
      var at = s.indexOf(' Cost: ');
      var li = document.createElement('li');
      li.appendChild(h('b', null, at >= 0 ? s.slice(0, at) : s));
      li.appendChild(h('span', 'cost', at >= 0 ? s.slice(at + 1) : ''));
      ol.appendChild(li);
    });
    body.appendChild(ol);
    var note = h('div', 'note', 'Before you farm: a token may never launch, and a farm plan is not a guarantee of an airdrop. Never pay anyone to claim, never paste a seed phrase anywhere, and check the protocol\u2019s own page for its points or rewards rules.');
    body.appendChild(note);
    dialog.appendChild(body);
    if (typeof dialog.showModal === 'function') { if (!dialog.open) dialog.showModal(); }
    else dialog.setAttribute('open', '');
  }

  function render() {
    app.textContent = '';
    var shell = h('div', 'shell');
    shell.appendChild(topBar());
    shell.appendChild(hero());
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'pre' ? boardTable() : liveTable());
    if (state.tab === 'pre') shell.appendChild(methodSection());
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('hashchange', function () { readHash(); render(); });
  window.addEventListener('keydown', function (e) { if (e.key === 'Escape' && dialog.open) dialog.close(); });
})();
