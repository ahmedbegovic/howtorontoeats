// How Toronto Eats: headline counts and the map, from data/*.json (written by export_site.py).
const $ = (s) => document.querySelector(s);
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const fmt = (n) => n.toLocaleString('en-CA');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const plural = (n, w) => `${fmt(n)} ${w}${n === 1 ? '' : 's'}`;
const load = (f) => fetch('data/' + f + '.json').then((r) => r.json());

Promise.all(['overview', 'areas', 'cuisines', 'sentiment', 'neighbourhoods', 'turns', 'extras', 'hype', 'network', 'stability', 'closures'].map(load))
  .then(([ov, areas, cu, se, nb, tu, ex, hy, nw, st, cl]) => {
    initAttention(nb);
    initLists(tu, ex, hy, nw);
    $('#hero-n').textContent = fmt(ov.restaurants);
    $('#s-items').textContent = fmt(ov.posts + ov.comments);
    $('#s-mentions').textContent = fmt(ov.mentions);
    initMap(areas);
    initCuisines(cu);
    initVerdicts(se, st);
    initClosures(cl);
  })
  .catch((e) => { document.querySelector('main').insertAdjacentHTML('afterbegin', `<p class="note">Could not load data (${esc(e.message)}). Serve this folder over HTTP.</p>`); });

function initMap(areas) {
  // empty municipalities (Georgina, Clarington, ...) are dropped; empty Toronto neighbourhoods stay so the city has no holes
  areas.features = areas.features.filter((f) => f.properties.restaurants || f.properties.kind !== 'municipality');
  $('#s-areas').textContent = fmt(areas.features.length);
  const map = L.map('leaf', { zoomControl: false, zoomSnap: 0.25, wheelPxPerZoomLevel: 120 });
  L.control.zoom({ position: 'topright' }).addTo(map);
  map.attributionControl.setPrefix(false).addAttribution('Boundaries: City of Toronto Open Data');

  // shade by restaurant count: 7 quantile classes over areas that have any
  const ramp = [1, 2, 3, 4, 5, 6, 7].map((k) => css('--seq-' + k));
  const v = areas.features.map((f) => f.properties.restaurants).filter(Boolean).sort((a, b) => a - b);
  const breaks = [1, 2, 3, 4, 5, 6].map((k) => v[Math.floor((v.length * k) / 7)]);
  const color = (m) => { if (!m) return css('--neutral'); let k = 0; while (k < 6 && m >= breaks[k]) k++; return ramp[k]; };
  $('#scale').innerHTML = ramp.map((c) => `<span style="background:${c}"></span>`).join('');
  $('#scale-lo').textContent = `under ${fmt(breaks[0])} restaurants`;
  $('#scale-hi').textContent = `over ${fmt(breaks[5])}`;

  // the table beside the map: every area, most restaurants first; hovering a row outlines its area (not the other way round)
  const ranked = [...areas.features].sort((a, b) => b.properties.restaurants - a.properties.restaurants);
  const body = $('#areas tbody');
  body.innerHTML = ranked.map(({ properties: p }) => `<tr><td class="nm">${esc(p.name)}</td><td class="r">${fmt(p.restaurants)}</td><td class="r">${fmt(p.mentions)}</td></tr>`).join('');
  let hot = null;
  // un-highlights the previous area first: bringToFront re-inserts the path, which can swallow the old area's mouseout
  const light = (l) => {
    if (hot) layer.resetStyle(hot);
    hot = l;
    if (l) { l.setStyle({ weight: 2.5, color: css('--ink') }); l.bringToFront(); }
  };

  const style = (f) => ({ fillColor: color(f.properties.restaurants), fillOpacity: 1, color: css('--surface'), weight: 1 });
  const layer = L.geoJSON(areas, {
    style,
    onEachFeature: (f, l) => {
      const row = body.children[ranked.indexOf(f)];
      l.on('mouseover', () => light(l));
      l.on('mouseout', () => light());
      row.onmouseenter = () => light(l);
      row.onmouseleave = () => light();
    },
  // one tooltip shared by every area, so two can never be open at once
  }).bindTooltip((l) => `<b>${esc(l.feature.properties.name)}</b>: ${plural(l.feature.properties.restaurants, 'restaurant')}`, { sticky: true }).addTo(map);
  map.on('mouseout', () => layer.closeTooltip());
  map.fitBounds(layer.getBounds(), { padding: [10, 10] });
}

// sidebar: mark the section being read
const links = [...document.querySelectorAll('.side li a')];
const spy = new IntersectionObserver((es) => es.forEach((e) => {
  if (e.isIntersecting) links.forEach((a) => a.classList.toggle('on', a.hash === '#' + e.target.id));
}), { rootMargin: '-25% 0px -70% 0px' });
document.querySelectorAll('section').forEach((s) => spy.observe(s));

// restaurant lookup: data/restaurants.json (800 KB) is fetched the first time the box is used; rows are sorted by mentions, so index = rank
const fold = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
let lookup;
function find() {
  lookup ??= load('restaurants').then((d) => d.rows.map((r, i) => ({ r, rank: i + 1, key: fold(r[0]) })));
  lookup.then((all) => {
    const q = fold($('#q').value);
    // names starting with the query first, then names containing it; each group stays in mention order
    const hits = q ? [...all.filter((x) => x.key.startsWith(q)), ...all.filter((x) => !x.key.startsWith(q) && x.key.includes(q))] : [];
    $('#q-note').textContent = !q ? "Type a restaurant's name to see how often it was mentioned and get a link to it on Google Maps."
      : !hits.length ? 'Nothing on the map by that name. I left out places mentioned only once or twice and places outside the GTA.'
      : hits.length > 6 ? `Showing the 6 most mentioned of ${fmt(hits.length)} matches.` : plural(hits.length, 'match') + '.';
    const month = (m) => new Date(m + '-15').toLocaleDateString('en-CA', { month: 'short', year: 'numeric' });
    $('#q-out').hidden = !hits.length;
    $('#q-out tbody').innerHTML = hits.slice(0, 6).map(({ r: [name, area, address, cuisine, closed, pid, n, pos, neg, first, last], rank }) => {
      const url = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(name + ', ' + address) + (pid ? '&query_place_id=' + pid : '');
      const stats = n ? [fmt(n), `${fmt(rank)} of ${fmt(all.length)}`, fmt(pos), fmt(neg), fmt(Math.max(0, n - pos - neg)), month(first), month(last)].map((c) => `<td class="r">${c}</td>`).join('')
        : '<td class="r" colspan="7">no mentions tied to this branch</td>';
      return `<tr><td class="nm">${esc(name)}${closed ? ' (closed)' : ''}<small>${esc([cuisine, area, address].filter(Boolean).join(' · '))}
        · <a href="${esc(url)}" target="_blank" rel="noopener">Google Maps</a></small></td>${stats}</tr>`; }).join('');
  }).catch(() => { lookup = null; $('#q-note').textContent = 'Could not load the restaurant list.'; });
}
$('#q').addEventListener('input', find);

// mentions per DineSafe restaurant, by Toronto neighbourhood (data from neighbourhoods.py)
function initAttention({ neighbourhoods: all, half_of_talk }) {
  const MIN = 40;  // restaurants needed for the ratio to mean something
  const sum = (rs, k) => rs.reduce((t, o) => t + o[k], 0), pct = (x) => Math.round(100 * x) + '%';
  const top = [...all].sort((a, b) => b.mentions - a.mentions).slice(0, 10);
  const ok = all.filter((o) => o.dinesafe >= MIN).sort((a, b) => b.per_place - a.per_place), max = ok[0].per_place;
  // the same three numbers back the sample-bias paragraph at the top
  $('#at-half').textContent = $('#b-half').textContent = half_of_talk;
  $('#at-talk').textContent = $('#b-talk').textContent = pct(sum(top, 'mentions') / sum(all, 'mentions'));
  $('#at-places').textContent = $('#b-places').textContent = pct(sum(top, 'dinesafe') / sum(all, 'dinesafe'));
  $('#at-n').textContent = ok.length;
  $('#at-min').textContent = MIN;
  $('#at-city').textContent = (sum(all, 'mentions') / sum(all, 'dinesafe')).toFixed(1);
  const rows = (rs) => rs.map((o) => `<tr><td class="nm">${esc(o.name)}<small>${plural(o.mentions, 'mention')} · ${plural(o.dinesafe, 'restaurant')}</small></td>
    <td class="barcell"><div class="bar" style="width:${(100 * o.per_place) / max}%"></div></td><td class="r">${o.per_place.toFixed(1)}</td></tr>`).join('');
  $('#at-most tbody').innerHTML = rows(ok.slice(0, 10));
  $('#at-least tbody').innerHTML = rows(ok.slice(-10).reverse());
}

// plain ranked lists from turns.py, extras.py, hype.py and network.py
function initLists(tu, ex, hy, nw) {
  const pct = (x) => Math.round(100 * x) + '%', pts = (x) => Math.round(100 * Math.abs(x));
  const net = (x) => `<span style="color:var(--${x < 0 ? 'red' : 'blue'})">${x < 0 ? '−' : '+'}${pts(x)}%</span>`;
  const row = (name, small, ...cells) => `<tr><td class="nm">${esc(name)}${small ? `<small>${esc(small)}</small>` : ''}</td>${cells.map((c) => `<td class="r">${c}</td>`).join('')}</tr>`;
  const fill = (id, rs, f) => { $(id + ' tbody').innerHTML = rs.map(f).join(''); };

  $('#t-n').textContent = fmt(tu.places); $('#t-sig').textContent = tu.significant;
  $('#t-med').textContent = pts(tu.median_change); $('#t-drift').textContent = (tu.drift < 0 ? '−' : '+') + pts(tu.drift);
  for (const k of ['soured', 'warmed'])
    fill('#t-' + k, tu[k].slice(0, 10), (o) => row(o.name, `${fmt(o.n25)} then ${plural(o.n26, 'mention')}`, net(o.net25), net(o.net26)));

  fill('#x-gems', ex.gems.slice(0, 10), (o) => row(o.name, plural(o.mentions, 'mention'), pct(o.positive), pts(o.praise_pct)));
  fill('#x-over', ex.overrated.slice(0, 10), (o) => row(o.name, `${fmt(o.praise)} praising, ${fmt(o.criticism)} critical`, pts(o.praise_pct), pts(o.criticism_pct)));

  $('#h-n').textContent = hy.arrivals; $('#h-m0').textContent = pct(hy.curve[0]); $('#h-top').textContent = pct(hy.top_thread_median);
  const month = (m) => new Date(m + '-15').toLocaleDateString('en-CA', { month: 'short', year: 'numeric' });
  fill('#h-big', hy.biggest.slice(0, 12), (o) => `<tr><td class="nm">${esc(o.name)}</td><td>${month(o.first)}</td>
    <td>${esc(o.shape)}</td><td class="r">${pct(o.top_thread)}</td><td class="r">${fmt(o.mentions)}</td></tr>`);

  $('#n-places').textContent = fmt(nw.nodes.length); $('#n-groups').textContent = nw.groups.length;
  const half = Math.ceil(nw.groups.length / 2), group = (g) => row(g.name, g.top.join(' · '), plural(g.size, 'place').replace(' ', '&nbsp;'));
  fill('#n-a', nw.groups.slice(0, half), group); fill('#n-b', nw.groups.slice(half), group);
}

function initCuisines({ none, cuisines }) {
  const total = cuisines.reduce((t, [, n]) => t + n, 0), top = cuisines.slice(0, 20), rest = cuisines.slice(20), max = top[0][1];
  $('#cu-n').textContent = fmt(total);
  $('#cu-none').textContent = fmt(none);
  $('#cu tbody').innerHTML = top.map(([c, n], i) => `<tr><td class="rk">${i + 1}</td><td class="nm">${esc(c)}</td>
    <td class="barcell"><div class="bar" style="width:${(100 * n) / max}%"></div></td><td class="r">${fmt(n)}</td><td class="r">${((100 * n) / total).toFixed(1)}%</td></tr>`).join('');
  $('#cu-more').textContent = `${rest.length} more cuisines, ${plural(rest.reduce((t, [, n]) => t + n, 0), 'restaurant')}`;
  $('#cu-rest').textContent = rest.map(([c, n]) => `${c} ${fmt(n)}`).join(' · ');
}

// st (stability.py): how often each place stays in its top ten when its threads are resampled and its labels redrawn
function initVerdicts(se, st) {
  $('#v-n').textContent = fmt(se.ranked);
  $('#v-min').textContent = fmt(se.min); $('#v-mt').textContent = se.min_threads;
  $('#v-reruns').textContent = fmt(st.reruns); $('#v-pool').textContent = st.positive.pool;
  for (const [id, k] of [['kp', 'positive'], ['kn', 'negative'], ['kc', 'controversial']]) $('#v-' + id).textContent = st[k].kept.toFixed(1);
  for (const k of ['positive', 'negative', 'controversial']) {
    $(`#v-${k} tbody`).innerHTML = se[k].map(([name, p, n]) => { const pp = (100 * p) / (p + n), hold = st[k].holds[name];
      return `<tr title="${esc(name)}: ${plural(p, 'positive mention')}, ${plural(n, 'negative mention')}"><td class="nm">${esc(name)}
        <div class="split"><span style="width:${pp}%;background:var(--blue)"></span><span style="width:${100 - pp}%;background:var(--red)"></span></div></td>
        <td class="r">${fmt(p)} <span class="note">/</span> ${fmt(n)}</td>
        <td class="r">${hold == null ? '' : Math.round(100 * hold) + '%'}</td></tr>`; }).join('');
  }
}

// closure model (closures.py): cross-validated AUC per set of inputs, odds ratios, and the stricter recheck
function initClosures(cl) {
  const f = (x) => x.toFixed(2), sg = (x) => (x < 0 ? '−' : '+') + f(Math.abs(x)), cap = (s) => s[0].toUpperCase() + s.slice(1);
  const [base, , sent] = cl.models, strict = cl.recheck.models[2];
  $('#c-n').textContent = `${fmt(cl.closed)} of ${fmt(cl.cohort)}`;
  $('#c-base').textContent = f(base.auc); $('#c-sent').textContent = f(sent.auc);
  $('#c-gain').textContent = sg(sent.auc - base.auc); $('#c-gain-ci').textContent = `${sg(sent.gain_lo)} to ${sg(sent.gain_hi)}`;
  $('#c-gone').textContent = cl.gone; $('#c-rn').textContent = fmt(cl.recheck.cohort); $('#c-rc').textContent = cl.recheck.closed;
  $('#c-rci').textContent = `${sg(strict.gain_lo)} to ${sg(strict.gain_hi)}`;
  const rows = (id, rs, f1) => { $(id + ' tbody').innerHTML = rs.map((o) => `<tr><td class="nm">${esc(cap(o.model || o.feature))}</td><td class="r">${f1(o)}</td><td class="r">${f(o.lo)} to ${f(o.hi)}</td></tr>`).join(''); };
  rows('#c-models', cl.models, (m) => f(m.auc));
  rows('#c-odds', cl.odds, (o) => '×' + f(o.or));
}
