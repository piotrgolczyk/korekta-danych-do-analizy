const $ = (sel, root = document) => root.querySelector(sel);
const safeStr = (v) => (v === null || v === undefined ? '' : String(v));
const deepClone = (o) => JSON.parse(JSON.stringify(o));

const SESSION_TIMEOUT_MS = 5 * 60 * 1000;

const ui = {
  loginView: $('#loginView'),
  loadingView: $('#loadingView'),
  appView: $('#appView'),
  loginForm: $('#loginForm'),
  passwordInput: $('#passwordInput'),
  loginError: $('#loginError'),
  companyName: $('#companyName'),
  orgBlock: $('#orgBlock'),
  emptyState: $('#emptyState'),
  metricsGrid: $('#metricsGrid'),
  errorsGrid: $('#errorsGrid'),
  changesCount: $('#changesCount'),
  btnSave: $('#btnSave'),
  btnLogout: $('#btnLogout'),
  sessionCountdown: $('#sessionCountdown'),
  historyList: $('#historyList'),
  historyEmpty: $('#historyEmpty'),
  historyToggle: $('#historyToggle'),
  historyToggleBtn: $('#historyToggleBtn'),
  filterDept: $('#filterDept'),
  filterManager: $('#filterManager'),
  filterSearch: $('#filterSearch'),
  filterMissingOnly: $('#filterMissingOnly'),
  changesWrap: $('#changesWrap'),
};

let originalReport = null;
let report = null;
let departments = [];
let usersById = new Map();
let changes = new Map();
let dirtyUsers = new Set();
let sortState = { key: 'missing', dir: 'desc' };
let historyEntries = [];
let historyExpanded = false;
let lastActivityAt = Date.now();
let sessionTimer = null;
let autoLogoutInProgress = false;

const api = {
  async post(path, body) {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({ message: 'Błąd serwera.' }));
      throw new Error(data.message || 'Błąd serwera.');
    }
    return res.json().catch(() => ({}));
  },
  async get(path) {
    const res = await fetch(path);
    if (!res.ok) {
      const data = await res.json().catch(() => ({ message: 'Błąd serwera.' }));
      throw new Error(data.message || 'Błąd serwera.');
    }
    return res.json().catch(() => ({}));
  },
};

const format = {
  pad2(n) {
    return String(n).padStart(2, '0');
  },
  dateToDateOnly(d) {
    const y = d.getFullYear();
    const m = format.pad2(d.getMonth() + 1);
    const dd = format.pad2(d.getDate());
    return `${y}-${m}-${dd}`;
  },
  dateOnlyToDate(dateOnly) {
    if (!dateOnly) return null;
    const d = new Date(`${dateOnly}T00:00:00`);
    if (Number.isNaN(d.getTime())) return null;
    d.setHours(0, 0, 0, 0);
    return d;
  },
  escapeHtml(value) {
    return safeStr(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  },
};

function showView(view) {
  ui.loginView.classList.toggle('hidden', view !== 'login');
  ui.loadingView.classList.toggle('hidden', view !== 'loading');
  ui.appView.classList.toggle('hidden', view !== 'app');
}

function resetState() {
  originalReport = null;
  report = null;
  departments = [];
  usersById = new Map();
  changes = new Map();
  dirtyUsers = new Set();
  sortState = { key: 'missing', dir: 'desc' };
  historyEntries = [];
  historyExpanded = false;
  ui.companyName.textContent = '—';
  ui.changesCount.textContent = '0';
  ui.btnSave.disabled = true;
  ui.orgBlock.style.display = 'none';
  ui.emptyState.classList.remove('hidden');
  ui.changesWrap.style.display = 'none';
}

function normalizeDepartments(depts) {
  const map = new Map();
  for (const d of depts || []) {
    const id = safeStr(d.department_id).trim();
    const name = safeStr(d.name).trim();
    if (!id && !name) continue;
    const key = id || name;
    if (!map.has(key)) map.set(key, { department_id: id, name });
  }
  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name, 'pl'));
}

function firstName(u) {
  return safeStr(u.first_name).trim();
}

function lastName(u) {
  return safeStr(u.last_name).trim();
}

function fullName(u) {
  const fn = firstName(u);
  const ln = lastName(u);
  const f = `${fn} ${ln}`.trim();
  return f || 'Brak imienia i nazwiska';
}

function deptName(u) {
  return safeStr(u.reported_department_name).trim();
}

function deptId(u) {
  return safeStr(u.reported_department_id).trim();
}

function personWithDept(u) {
  const d = deptName(u);
  return d ? `${fullName(u)} (${d})` : `${fullName(u)} (brak działu)`;
}

function tenureYearsValue(u) {
  const v = Number(u.tenure_years);
  return Number.isFinite(v) ? v : 0;
}

function formatTenureYearsToShort(yearsFloat) {
  const v = Number(yearsFloat);
  if (!Number.isFinite(v) || v <= 0) return '—';
  let totalMonths = Math.round(v * 12);
  let years = Math.floor(totalMonths / 12);
  let months = totalMonths % 12;
  if (years < 0) years = 0;
  if (months < 0) months = 0;
  return `${years}r ${months}m`;
}

function joinDateOnlyFromTenureYears(u) {
  const v = tenureYearsValue(u);
  if (v <= 0) return '';
  const totalMonths = Math.round(v * 12);
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setMonth(d.getMonth() - totalMonths);
  return format.dateToDateOnly(d);
}

function setTenureYearsFromJoinDateOnly(u, dateOnly) {
  const d = format.dateOnlyToDate(dateOnly);
  if (!d) {
    u.tenure_years = 0.0;
    return;
  }
  const now = new Date();
  now.setHours(0, 0, 0, 0);

  let months = (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth());
  if (now.getDate() < d.getDate()) months -= 1;
  if (months < 0) months = 0;

  const years = months / 12;
  u.tenure_years = Number(years.toFixed(2));
}

function tenureBadge(u) {
  return formatTenureYearsToShort(tenureYearsValue(u));
}

function managerState(u) {
  const mgrId = safeStr(u.reports_to_user_id).trim();
  if (!mgrId) return 'MISSING';
  if (mgrId === u.id) return 'SELF';
  if (!usersById.has(mgrId)) return 'UNKNOWN';
  return 'OK';
}

function hasDept(u) {
  return Boolean(deptId(u) || deptName(u));
}

function hasJoinDate(u) {
  return tenureYearsValue(u) > 0;
}

function missingScore(u) {
  let s = 0;
  if (!firstName(u)) s += 1;
  if (!lastName(u)) s += 1;
  if (!hasDept(u)) s += 1;
  const ms = managerState(u);
  if (ms !== 'OK') s += 1;
  if (!hasJoinDate(u)) s += 1;
  return s;
}

function missingBadge(u) {
  const m = missingScore(u);
  if (m === 0) return '✅ 0';
  if (m === 1) return '🟡 1';
  if (m === 2) return '🟠 2';
  return `🔴 ${m}`;
}

function getAllPeople() {
  return report?.people || [];
}

function uniqueDepartmentNames() {
  const set = new Set();
  for (const d of departments || []) {
    if (d?.name) set.add(d.name);
  }
  for (const u of getAllPeople()) {
    const dn = deptName(u);
    if (dn) set.add(dn);
  }
  return Array.from(set.values()).sort((a, b) => a.localeCompare(b, 'pl'));
}

function countLeadersAndTeams() {
  const people = getAllPeople();
  const directReportsByMgr = new Map();

  for (const u of people) {
    const mgrId = safeStr(u.reports_to_user_id).trim();
    if (!mgrId) continue;
    if (mgrId === u.id) continue;
    directReportsByMgr.set(mgrId, (directReportsByMgr.get(mgrId) || 0) + 1);
  }

  let leaders = 0;
  for (const mgrId of directReportsByMgr.keys()) {
    if (usersById.has(mgrId)) leaders += 1;
  }

  return { leaders, teams: leaders };
}

function computeErrors() {
  const people = getAllPeople();

  let missingFirst = 0;
  let missingLast = 0;
  let missingBoth = 0;
  let missingDept = 0;
  let mgrMissing = 0;
  let mgrSelf = 0;
  let mgrUnknown = 0;
  let missingJoin = 0;

  for (const u of people) {
    const fn = firstName(u);
    const ln = lastName(u);
    if (!fn) missingFirst += 1;
    if (!ln) missingLast += 1;
    if (!fn && !ln) missingBoth += 1;

    if (!hasDept(u)) missingDept += 1;

    const ms = managerState(u);
    if (ms === 'MISSING') mgrMissing += 1;
    if (ms === 'SELF') mgrSelf += 1;
    if (ms === 'UNKNOWN') mgrUnknown += 1;

    if (!hasJoinDate(u)) missingJoin += 1;
  }

  return {
    missingFirst,
    missingLast,
    missingBoth,
    missingDept,
    mgrMissing,
    mgrSelf,
    mgrUnknown,
    missingJoin,
  };
}

function renderMetricsAndErrors() {
  const org = report.organization || {};
  const people = getAllPeople();
  const uniqDepts = uniqueDepartmentNames();
  const { leaders, teams } = countLeadersAndTeams();
  const errs = computeErrors();

  const metrics = [
    { k: 'Liczba osób', v: people.length },
    { k: 'Osób zarejestrowanych', v: safeStr(org.registered_users) || people.length },
    { k: 'Liczba licencji', v: safeStr(org.licenses_assigned) || '—' },
    { k: 'Działy (unikalne)', v: uniqDepts.length },
    { k: 'Liderów', v: leaders },
    { k: 'Zespołów', v: teams },
  ];

  ui.metricsGrid.innerHTML = metrics
    .map(
      (m) => `
        <div class="metric">
          <div class="k">${format.escapeHtml(m.k)}</div>
          <div class="v">${format.escapeHtml(m.v)}</div>
        </div>
      `,
    )
    .join('');

  const rows = [
    { label: 'Brak imienia i nazwiska', value: errs.missingBoth },
    { label: 'Brak imienia', value: errs.missingFirst },
    { label: 'Brak nazwiska', value: errs.missingLast },
    { label: 'Brak działu', value: errs.missingDept },
    { label: 'Brak oznaczenia przełożonego', value: errs.mgrMissing },
    { label: 'Raportowanie do siebie samego', value: errs.mgrSelf },
    { label: 'Przełożony nie istnieje na liście', value: errs.mgrUnknown },
    { label: 'Brak daty dołączenia', value: errs.missingJoin },
  ];

  ui.errorsGrid.innerHTML = rows
    .map(
      (r) => `
        <div class="err-row">
          <div class="left">${format.escapeHtml(r.label)}</div>
          <div class="right">${format.escapeHtml(r.value)}</div>
        </div>
      `,
    )
    .join('');

  const name = safeStr(org.name).trim() || '—';
  ui.companyName.textContent = name;
}

function buildFilters() {
  ui.filterDept.innerHTML = '';
  ui.filterDept.append(new Option('Wszystkie działy', '__ALL__'));
  ui.filterDept.append(new Option('(brak działu)', '__EMPTY__'));

  for (const d of departments) {
    ui.filterDept.append(new Option(d.name, d.department_id || d.name));
  }

  ui.filterManager.innerHTML = '';
  ui.filterManager.append(new Option('Wszyscy przełożeni', '__ALL__'));
  ui.filterManager.append(new Option('(brak / błąd)', '__EMPTY__'));

  const opts = getAllPeople()
    .map((u) => ({ id: u.id, label: personWithDept(u) }))
    .sort((a, b) => a.label.localeCompare(b.label, 'pl'));

  for (const o of opts) {
    ui.filterManager.append(new Option(o.label, o.id));
  }
}

function applyFiltersAndSort(people) {
  const deptVal = ui.filterDept.value;
  const mgrVal = ui.filterManager.value;
  const q = ui.filterSearch.value.trim().toLowerCase();
  const missingOnly = ui.filterMissingOnly.checked;

  let list = [...people];

  if (deptVal && deptVal !== '__ALL__') {
    if (deptVal === '__EMPTY__') {
      list = list.filter((u) => !hasDept(u));
    } else {
      list = list.filter((u) => deptId(u) === deptVal || deptName(u) === deptVal);
    }
  }

  if (mgrVal && mgrVal !== '__ALL__') {
    if (mgrVal === '__EMPTY__') {
      list = list.filter((u) => managerState(u) !== 'OK');
    } else {
      list = list.filter((u) => safeStr(u.reports_to_user_id).trim() === mgrVal);
    }
  }

  if (q) {
    list = list.filter((u) => {
      const fn = firstName(u).toLowerCase();
      const ln = lastName(u).toLowerCase();
      const dep = deptName(u).toLowerCase();
      const mgr = usersById.get(safeStr(u.reports_to_user_id).trim());
      const mgrName = mgr ? fullName(mgr).toLowerCase() : '';
      return fn.includes(q) || ln.includes(q) || dep.includes(q) || mgrName.includes(q);
    });
  }

  if (missingOnly) {
    list = list.filter((u) => missingScore(u) > 0);
  }

  const dir = sortState.dir === 'asc' ? 1 : -1;
  const cmpText = (a, b) => safeStr(a).localeCompare(safeStr(b), 'pl');

  list.sort((a, b) => {
    switch (sortState.key) {
      case 'missing': {
        const sa = missingScore(a);
        const sb = missingScore(b);
        if (sa !== sb) return (sa - sb) * dir;
        const ln = cmpText(lastName(a), lastName(b));
        if (ln !== 0) return ln;
        return cmpText(firstName(a), firstName(b));
      }
      case 'first':
        return cmpText(firstName(a), firstName(b)) * dir;
      case 'last':
        return cmpText(lastName(a), lastName(b)) * dir;
      case 'dept':
        return cmpText(deptName(a), deptName(b)) * dir;
      case 'manager': {
        const ma = usersById.get(safeStr(a.reports_to_user_id).trim());
        const mb = usersById.get(safeStr(b.reports_to_user_id).trim());
        return cmpText(ma ? personWithDept(ma) : '', mb ? personWithDept(mb) : '') * dir;
      }
      case 'date': {
        const da = joinDateOnlyFromTenureYears(a);
        const db = joinDateOnlyFromTenureYears(b);
        return cmpText(da, db) * dir;
      }
      default:
        return 0;
    }
  });

  return list;
}

function setChangesCount() {
  const c = changes.size;
  ui.changesCount.textContent = String(c);
  const disabled = c === 0;
  ui.btnSave.disabled = disabled;
  ui.btnSave.title = disabled ? 'Najpierw wprowadź zmianę.' : 'Zapisze plik z wprowadzonymi zmianami.';
  ui.changesWrap.style.display = disabled ? 'none' : 'block';
}

function rebuildMaps() {
  usersById = new Map();
  for (const u of getAllPeople()) usersById.set(u.id, u);
  departments = normalizeDepartments(report.departments || []);
}

function renderPeople() {
  const tbody = $('#peopleTable tbody');
  tbody.innerHTML = '';

  const people = getAllPeople();
  const list = applyFiltersAndSort(people);

  for (const u of list) {
    const tr = document.createElement('tr');
    if (dirtyUsers.has(u.id)) tr.classList.add('changed');

    const tdMissing = document.createElement('td');
    tdMissing.className = 'nowrap';
    tdMissing.textContent = missingBadge(u);
    tr.appendChild(tdMissing);

    const tdFirst = document.createElement('td');
    const fn = firstName(u);
    tdFirst.innerHTML = fn
      ? `<strong>${format.escapeHtml(fn)}</strong>`
      : '<span style="color:#ef4444;font-weight:900;">(brak)</span>';
    tr.appendChild(tdFirst);

    const tdLast = document.createElement('td');
    const ln = lastName(u);
    tdLast.innerHTML = ln
      ? `<strong>${format.escapeHtml(ln)}</strong>`
      : '<span style="color:#ef4444;font-weight:900;">(brak)</span>';
    tr.appendChild(tdLast);

    const tdDept = document.createElement('td');
    const selDept = document.createElement('select');
    selDept.dataset.userId = u.id;
    selDept.dataset.field = 'department';
    selDept.append(new Option('(brak działu)', '__EMPTY__'));
    for (const d of departments) {
      selDept.append(new Option(d.name, d.department_id || d.name));
    }

    const curId = deptId(u);
    const curName = deptName(u);
    let val = '__EMPTY__';
    if (curId) {
      val = curId;
      if (!Array.from(selDept.options).some((o) => o.value === curId)) {
        selDept.append(new Option(curName ? `${curName}` : '(nieznany dział)', curId));
      }
    } else if (curName) {
      const match = departments.find((d) => d.name === curName);
      if (match) val = match.department_id || match.name;
      else {
        selDept.append(new Option(curName, curName));
        val = curName;
      }
    }
    selDept.value = val;
    selDept.addEventListener('change', onEditField);

    tdDept.appendChild(selDept);
    const deptMini = document.createElement('div');
    deptMini.className = 'mini';
    deptMini.textContent = curName ? `Obecnie: ${curName}` : 'Obecnie: brak';
    tdDept.appendChild(deptMini);
    tr.appendChild(tdDept);

    const tdMgr = document.createElement('td');
    const selMgr = document.createElement('select');
    selMgr.dataset.userId = u.id;
    selMgr.dataset.field = 'manager';
    selMgr.append(new Option('(brak / błąd)', '__EMPTY__'));

    const opts = getAllPeople()
      .filter((x) => x.id !== u.id)
      .map((x) => ({ id: x.id, label: personWithDept(x) }))
      .sort((a, b) => a.label.localeCompare(b.label, 'pl'));
    for (const o of opts) {
      selMgr.append(new Option(o.label, o.id));
    }

    const ms = managerState(u);
    selMgr.value = ms === 'OK' ? safeStr(u.reports_to_user_id).trim() : '__EMPTY__';
    selMgr.addEventListener('change', onEditField);

    tdMgr.appendChild(selMgr);

    const mgrId = safeStr(u.reports_to_user_id).trim();
    const mgr = usersById.get(mgrId);
    const mgrText =
      ms === 'OK'
        ? `Obecnie: ${personWithDept(mgr)}`
        : ms === 'SELF'
          ? 'Obecnie: błąd (raportuje do siebie)'
          : ms === 'UNKNOWN'
            ? 'Obecnie: błąd (przełożony nie istnieje)'
            : 'Obecnie: brak';

    const mgrMini = document.createElement('div');
    mgrMini.className = 'mini';
    mgrMini.textContent = mgrText;
    tdMgr.appendChild(mgrMini);
    tr.appendChild(tdMgr);

    const tdDate = document.createElement('td');
    const wrap = document.createElement('div');
    wrap.className = 'inline';

    const dateInput = document.createElement('input');
    dateInput.type = 'date';
    dateInput.value = joinDateOnlyFromTenureYears(u) || '';
    dateInput.dataset.userId = u.id;
    dateInput.dataset.field = 'join_date';
    dateInput.addEventListener('change', onEditField);

    const calBtn = document.createElement('button');
    calBtn.className = 'calendar-btn';
    calBtn.type = 'button';
    calBtn.textContent = '📅';
    calBtn.title = 'Wybierz datę';
    calBtn.addEventListener('click', () => {
      dateInput.focus();
      if (dateInput.showPicker) dateInput.showPicker();
    });

    const badge = document.createElement('span');
    badge.className = 'tenure-badge';
    badge.textContent = `(${tenureBadge(u)})`;

    wrap.appendChild(dateInput);
    wrap.appendChild(calBtn);
    wrap.appendChild(badge);

    tdDate.appendChild(wrap);
    tr.appendChild(tdDate);

    tbody.appendChild(tr);
  }
}

function renderChanges() {
  const tbody = $('#changesTable tbody');
  tbody.innerHTML = '';

  if (changes.size === 0) {
    ui.changesWrap.style.display = 'none';
    return;
  }
  ui.changesWrap.style.display = 'block';

  const rows = Array.from(changes.values())
    .map((r) => {
      const u = usersById.get(r.userId);
      const person = u ? personWithDept(u) : r.person;
      return { ...r, person };
    })
    .sort((a, b) => {
      const u = a.person.localeCompare(b.person, 'pl');
      if (u !== 0) return u;
      return a.what.localeCompare(b.what, 'pl');
    });

  for (const r of rows) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${format.escapeHtml(r.person)}</strong></td>
      <td class="nowrap">${format.escapeHtml(r.what)}</td>
      <td>${format.escapeHtml(r.from || '(brak)')}</td>
      <td>${format.escapeHtml(r.to || '(brak)')}</td>
    `;
    tbody.appendChild(tr);
  }
}

function renderHistory() {
  if (!historyEntries || historyEntries.length === 0) {
    ui.historyEmpty.classList.remove('hidden');
    ui.historyList.innerHTML = '';
    ui.historyToggle.classList.add('hidden');
    return;
  }

  ui.historyEmpty.classList.add('hidden');
  const visible = historyExpanded ? historyEntries : historyEntries.slice(0, 5);

  ui.historyList.innerHTML = visible
    .map((entry) => {
      const changesList = (entry.changes || [])
        .map(
          (change) =>
            `<li>${format.escapeHtml(change.person || 'Osoba')} – ${format.escapeHtml(
              change.what || 'Zmiana',
            )}: ${format.escapeHtml(change.from || '(brak)')} → ${format.escapeHtml(
              change.to || '(brak)',
            )}</li>`,
        )
        .join('');

      return `
        <li class="history-item">
          <h4>${format.escapeHtml(entry.timestamp || 'Zapis')}</h4>
          <ul>${changesList || '<li>Brak zmian do pokazania.</li>'}</ul>
        </li>
      `;
    })
    .join('');

  if (historyEntries.length > 5) {
    ui.historyToggle.classList.remove('hidden');
    ui.historyToggleBtn.textContent = historyExpanded ? 'Zwiń historię' : 'Pokaż całą historię';
  } else {
    ui.historyToggle.classList.add('hidden');
  }
}

function renderAll() {
  renderMetricsAndErrors();
  buildFilters();
  renderPeople();
  renderChanges();
  renderHistory();
  setChangesCount();
}

function getOriginalUserById(userId) {
  const people = originalReport?.people || [];
  return people.find((u) => u.id === userId) || null;
}

function humanDeptValue(u) {
  return deptName(u) || '(brak działu)';
}

function humanManagerValue(u) {
  const ms = managerState(u);
  if (ms === 'MISSING') return '(brak)';
  if (ms === 'SELF') return '(błąd: raportuje do siebie)';
  if (ms === 'UNKNOWN') return '(błąd: przełożony nie istnieje)';
  const mgr = usersById.get(safeStr(u.reports_to_user_id).trim());
  return mgr ? personWithDept(mgr) : '(błąd)';
}

function humanJoinValue(u) {
  const d = joinDateOnlyFromTenureYears(u);
  const t = tenureBadge(u);
  return d ? `${d} (${t})` : '(brak)';
}

function markChange(userId, fieldKey, what, fromVal, toVal) {
  const key = `${userId}:${fieldKey}`;
  const u = usersById.get(userId);
  const person = u ? personWithDept(u) : '—';

  const f = safeStr(fromVal).trim();
  const t = safeStr(toVal).trim();

  if (f === t) {
    changes.delete(key);
  } else {
    changes.set(key, { userId, person, what, from: f, to: t });
  }

  const hasAny = Array.from(changes.keys()).some((k) => k.startsWith(`${userId}:`));
  if (hasAny) dirtyUsers.add(userId);
  else dirtyUsers.delete(userId);

  setChangesCount();
  renderChanges();
}

function onEditField(e) {
  registerActivity();
  const el = e.target;
  const userId = el.dataset.userId;
  const field = el.dataset.field;
  const u = usersById.get(userId);
  if (!u) return;

  const orig = getOriginalUserById(userId);

  if (field === 'department') {
    const before = orig
      ? orig.reported_department_name
        ? orig.reported_department_name
        : '(brak działu)'
      : '(brak działu)';
    const selected = el.value;

    if (selected === '__EMPTY__') {
      u.reported_department_id = '';
      u.reported_department_name = '';
    } else {
      const d = departments.find((x) => (x.department_id || x.name) === selected) || null;
      u.reported_department_id = d ? d.department_id || '' : selected;
      u.reported_department_name = d ? d.name : selected;
    }

    const after = humanDeptValue(u);
    markChange(userId, 'department', 'Dział', before, after);

    renderAll();
    return;
  }

  if (field === 'manager') {
    const before = orig
      ? (() => {
          const tmp = deepClone(u);
          tmp.reports_to_user_id = orig.reports_to_user_id;
          return humanManagerValue(tmp);
        })()
      : '(brak)';

    const selected = el.value;
    u.reports_to_user_id = selected === '__EMPTY__' ? null : selected;

    const after = humanManagerValue(u);
    markChange(userId, 'manager', 'Raportuje do', before, after);

    renderAll();
    return;
  }

  if (field === 'join_date') {
    const before = orig
      ? (() => {
          const tmp = deepClone(orig);
          return humanJoinValue(tmp);
        })()
      : '(brak)';

    const dateOnly = el.value || '';
    setTenureYearsFromJoinDateOnly(u, dateOnly);

    const after = humanJoinValue(u);
    markChange(userId, 'join_date', 'Data dołączenia', before, after);

    renderAll();
  }
}

function setSort(key) {
  if (sortState.key === key) {
    sortState.dir = sortState.dir === 'asc' ? 'desc' : 'asc';
  } else {
    sortState.key = key;
    sortState.dir = key === 'missing' ? 'desc' : 'asc';
  }

  const keys = ['missing', 'first', 'last', 'dept', 'manager', 'date'];
  for (const k of keys) {
    const el = $(`#sortIcon-${k}`);
    if (!el) continue;
    if (sortState.key !== k) el.textContent = '↕';
    else el.textContent = sortState.dir === 'asc' ? '↑' : '↓';
  }

  renderPeople();
}

function wireSorting() {
  const ths = Array.from($('#peopleTable thead').querySelectorAll('th[data-sort]'));
  for (const th of ths) {
    th.addEventListener('click', () => setSort(th.dataset.sort));
  }
  sortState = { key: 'missing', dir: 'desc' };
  $('#sortIcon-missing').textContent = '↓';
}

function wireFilters() {
  ui.filterDept.addEventListener('change', renderPeople);
  ui.filterManager.addEventListener('change', renderPeople);
  ui.filterMissingOnly.addEventListener('change', renderPeople);
  ui.filterSearch.addEventListener('input', renderPeople);
}

async function loadReport() {
  showView('loading');
  const data = await api.get('api/load.php');
  if (!data.ok) throw new Error(data.message || 'Nie udało się wczytać danych.');

  originalReport = deepClone(data.data);
  report = deepClone(data.data);
  historyEntries = Array.isArray(data.history) ? data.history : [];

  changes = new Map();
  dirtyUsers = new Set();
  sortState = { key: 'missing', dir: 'desc' };

  rebuildMaps();

  ui.orgBlock.style.display = 'block';
  ui.emptyState.classList.add('hidden');

  renderAll();
  wireSorting();
  setChangesCount();

  showView('app');
  startSessionTimer();
}

async function handleLogin(event) {
  event.preventDefault();
  ui.loginError.classList.add('hidden');
  const password = ui.passwordInput.value.trim();

  try {
    await api.post('api/login.php', { password });
    ui.passwordInput.value = '';
    await loadReport();
  } catch (err) {
    ui.loginError.textContent = err.message || 'Nie udało się zalogować.';
    ui.loginError.classList.remove('hidden');
  }
}

function collectChanges() {
  return Array.from(changes.values()).map((item) => ({
    userId: item.userId,
    person: item.person,
    what: item.what,
    from: item.from,
    to: item.to,
  }));
}

async function saveChanges() {
  if (!report) return null;
  const payload = {
    data: report,
    changes: collectChanges(),
  };

  const response = await api.post('api/save.php', payload);
  if (!response.ok) throw new Error(response.message || 'Nie udało się zapisać zmian.');

  historyEntries = Array.isArray(response.history) ? response.history : historyEntries;
  originalReport = deepClone(report);
  changes = new Map();
  dirtyUsers = new Set();
  setChangesCount();
  renderChanges();
  renderHistory();
  return response;
}

async function handleSave() {
  registerActivity();
  try {
    await saveChanges();
    alert('Zmiany zostały zapisane.');
  } catch (err) {
    alert(err.message || 'Nie udało się zapisać zmian.');
  }
}

async function logout() {
  await fetch('api/logout.php', { method: 'POST' });
  stopSessionTimer();
  resetState();
  showView('login');
}

async function handleLogout() {
  registerActivity();
  const shouldSave = changes.size > 0;
  if (shouldSave) {
    try {
      await saveChanges();
    } catch (err) {
      alert(err.message || 'Nie udało się zapisać zmian przed wylogowaniem.');
      return;
    }
  }
  await logout();
}

function registerActivity() {
  lastActivityAt = Date.now();
}

function startSessionTimer() {
  stopSessionTimer();
  lastActivityAt = Date.now();
  sessionTimer = window.setInterval(() => {
    const remaining = SESSION_TIMEOUT_MS - (Date.now() - lastActivityAt);
    if (remaining <= 0) {
      triggerAutoLogout();
      return;
    }
    const minutes = Math.floor(remaining / 60000);
    const seconds = Math.floor((remaining % 60000) / 1000);
    ui.sessionCountdown.textContent = `${minutes}:${String(seconds).padStart(2, '0')}`;
  }, 1000);
}

function stopSessionTimer() {
  if (sessionTimer) {
    window.clearInterval(sessionTimer);
    sessionTimer = null;
  }
}

async function triggerAutoLogout() {
  if (autoLogoutInProgress) return;
  autoLogoutInProgress = true;

  try {
    if (changes.size > 0) {
      await saveChanges();
    }
    await logout();
  } catch (err) {
    alert(err.message || 'Nie udało się automatycznie zapisać zmian.');
    autoLogoutInProgress = false;
  }
}

function wireActivityListeners() {
  const events = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart'];
  events.forEach((eventName) => {
    document.addEventListener(
      eventName,
      () => {
        if (ui.appView.classList.contains('hidden')) return;
        registerActivity();
      },
      { passive: true },
    );
  });
}

ui.loginForm.addEventListener('submit', handleLogin);
ui.btnSave.addEventListener('click', handleSave);
ui.btnLogout.addEventListener('click', handleLogout);
ui.historyToggleBtn.addEventListener('click', () => {
  historyExpanded = !historyExpanded;
  renderHistory();
});

wireFilters();
wireSorting();
wireActivityListeners();
resetState();
showView('login');
