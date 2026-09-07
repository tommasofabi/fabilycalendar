import ICAL from './vendor/ical.min.js';

const API_URL = '/api/calendar';
const CUSTOM_EVENTS_API = '/api/events';
const TZ = 'Europe/Rome';
const DAY_MS = 24 * 60 * 60 * 1000;
const REFRESH_INTERVAL_MS = 10 * 60 * 1000;
const VISIBILITY_MIN_GAP_MS = 2 * 60 * 1000;
const AGENDA_FORWARD_DAYS = 90;

const STORAGE_ICS = 'familyCalendar.icsText';
const STORAGE_UPDATED = 'familyCalendar.lastUpdated';
const STORAGE_VIEW = 'familyCalendar.view';

const WEEKDAY_CODES = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];

const romeDateKeyFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const romeTimeFormatter = new Intl.DateTimeFormat('it-IT', {
  timeZone: TZ,
  hour: '2-digit',
  minute: '2-digit',
});
const romeWeekdayLongFormatter = new Intl.DateTimeFormat('it-IT', {
  timeZone: TZ,
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});
const romeWallClockFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ,
  hour12: false,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});
const utcMonthYearFormatter = new Intl.DateTimeFormat('it-IT', {
  timeZone: 'UTC',
  month: 'long',
  year: 'numeric',
});
const utcWeekdayLongFormatter = new Intl.DateTimeFormat('it-IT', {
  timeZone: 'UTC',
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});
const utcDayMonthFormatter = new Intl.DateTimeFormat('it-IT', {
  timeZone: 'UTC',
  day: 'numeric',
  month: 'long',
});

const LESSON_DESCRIPTION_PATTERN =
  /Lezione:\s*\([^)]*\)\s*(.+?)\s*(?:\(Classe[^)]*\)\s*)?Docenti:\s*(.*?)\s*Aule:\s*(.*?)\s*Note:/;

let events = [];
let feedEventsByDay = new Map();
let customEvents = [];
let currentView = 'month';
let lastFetchAttempt = 0;
let editingSeriesId = null;

const now = new Date();
const [todayYear, todayMonth] = romeDateKey(now).split('-').map(Number);
const monthState = { year: todayYear, month: todayMonth - 1 };
const weekState = { mondayMillis: mondayOfWeekContainingToday() };

function romeDateKey(date) {
  return romeDateKeyFormatter.format(date);
}

function romeTime(date) {
  return romeTimeFormatter.format(date);
}

function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function toTitleCase(str) {
  return str.toLowerCase().replace(/(^|[\s-])([a-zà-ÿ])/g, (m, sep, ch) => sep + ch.toUpperCase());
}

function utcDateKey(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function mondayOfWeekContainingToday() {
  const key = romeDateKey(new Date());
  const [y, m, d] = key.split('-').map(Number);
  const asUTC = Date.UTC(y, m - 1, d);
  const weekday = new Date(asUTC).getUTCDay();
  const mondayOffset = (weekday + 6) % 7;
  return asUTC - mondayOffset * DAY_MS;
}

function buildMonthGrid(year, month) {
  const firstOfMonth = Date.UTC(year, month, 1);
  const firstWeekday = new Date(firstOfMonth).getUTCDay();
  const mondayOffset = (firstWeekday + 6) % 7;
  const gridStart = firstOfMonth - mondayOffset * DAY_MS;
  const days = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart + i * DAY_MS);
    days.push({
      date: d.getUTCDate(),
      key: utcDateKey(d),
      inCurrentMonth: d.getUTCMonth() === month,
    });
  }
  return days;
}

function romeWallTimeToUtcDate(dateKey, timeStr) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const [hh, mm] = (timeStr || '00:00').split(':').map(Number);
  const targetUTCMs = Date.UTC(y, m - 1, d, hh, mm);
  let offset = 0;
  for (let i = 0; i < 2; i++) {
    const guess = targetUTCMs - offset;
    const parts = romeWallClockFormatter.formatToParts(new Date(guess));
    const map = {};
    parts.forEach((p) => {
      map[p.type] = p.value;
    });
    const hour = Number(map.hour) % 24;
    const shownUTCMs = Date.UTC(Number(map.year), Number(map.month) - 1, Number(map.day), hour, Number(map.minute));
    const newOffset = shownUTCMs - guess;
    if (newOffset === offset) break;
    offset = newOffset;
  }
  return new Date(targetUTCMs - offset);
}

function parseLessonInfo(rawEv) {
  const match = (rawEv.description || '').match(LESSON_DESCRIPTION_PATTERN);
  if (match) {
    return {
      title: toTitleCase(match[1].trim()),
      room: match[3].trim() || rawEv.location || '',
    };
  }
  return { title: rawEv.summary || 'Evento', room: rawEv.location || '' };
}

function normalizeEvents(icsText) {
  const jcal = ICAL.parse(icsText);
  const comp = new ICAL.Component(jcal);

  comp.getAllSubcomponents('vtimezone').forEach((vt) => {
    ICAL.TimezoneService.register(vt);
  });

  return comp
    .getAllSubcomponents('vevent')
    .map((ve) => {
      const rawEv = new ICAL.Event(ve);
      const start = rawEv.startDate.toJSDate();
      const end = (rawEv.endDate || rawEv.startDate).toJSDate();
      const parsed = parseLessonInfo(rawEv);
      return {
        uid: rawEv.uid,
        summary: parsed.title,
        location: parsed.room,
        start,
        end,
        allDay: false,
        source: 'feed',
      };
    })
    .sort((a, b) => a.start - b.start);
}

function groupByDay(evts) {
  const map = new Map();
  evts.forEach((ev) => {
    const key = romeDateKey(ev.start);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(ev);
  });
  return map;
}

function occurrenceFromCustomEvent(ce, occurrenceDateKey) {
  const startTime = ce.allDay ? '00:00' : ce.startTime;
  const endTime = ce.allDay ? '23:59' : ce.endTime;
  return {
    uid: `${ce.id}::${occurrenceDateKey}`,
    summary: ce.title,
    location: ce.location || '',
    start: romeWallTimeToUtcDate(occurrenceDateKey, startTime),
    end: romeWallTimeToUtcDate(occurrenceDateKey, endTime),
    allDay: !!ce.allDay,
    source: 'custom',
    seriesId: ce.id,
    occurrenceDate: occurrenceDateKey,
  };
}

function getOccurrenceDates(ce, startKey, endKey) {
  const exceptions = new Set(ce.exceptions || []);

  if (!ce.recurrence) {
    if (ce.date >= startKey && ce.date <= endKey && !exceptions.has(ce.date)) {
      return [ce.date];
    }
    return [];
  }

  const [ay, am, ad] = ce.date.split('-').map(Number);
  const dtstart = new ICAL.Time({ year: ay, month: am, day: ad, isDate: true });

  const rruleParts = [`FREQ=${ce.recurrence.freq.toUpperCase()}`, `INTERVAL=${ce.recurrence.interval || 1}`];
  if (ce.recurrence.freq === 'weekly' && ce.recurrence.byweekday && ce.recurrence.byweekday.length) {
    rruleParts.push(`BYDAY=${ce.recurrence.byweekday.map((i) => WEEKDAY_CODES[i]).join(',')}`);
  }
  const end = ce.recurrence.end || { type: 'never' };
  if (end.type === 'count') rruleParts.push(`COUNT=${end.count}`);
  if (end.type === 'onDate') {
    const [uy, um, ud] = end.date.split('-').map(Number);
    rruleParts.push(`UNTIL=${String(uy).padStart(4, '0')}${String(um).padStart(2, '0')}${String(ud).padStart(2, '0')}`);
  }

  let recur;
  try {
    recur = ICAL.Recur.fromString(rruleParts.join(';'));
  } catch (err) {
    return [];
  }

  const iterator = recur.iterator(dtstart);
  const rangeStartFlat = startKey.replaceAll('-', '');
  const rangeEndFlat = endKey.replaceAll('-', '');
  const dates = [];
  let next;
  let guard = 0;
  while ((next = iterator.next()) && guard < 3000) {
    guard++;
    const key = `${next.year}-${String(next.month).padStart(2, '0')}-${String(next.day).padStart(2, '0')}`;
    const flat = key.replaceAll('-', '');
    if (flat > rangeEndFlat) break;
    if (flat >= rangeStartFlat && !exceptions.has(key)) dates.push(key);
  }
  return dates;
}

function getCombinedDayMap(startKey, endKey) {
  const map = new Map();

  feedEventsByDay.forEach((evts, key) => {
    if (key >= startKey && key <= endKey) {
      map.set(key, [...evts]);
    }
  });

  customEvents.forEach((ce) => {
    getOccurrenceDates(ce, startKey, endKey).forEach((dateKey) => {
      const occ = occurrenceFromCustomEvent(ce, dateKey);
      if (!map.has(dateKey)) map.set(dateKey, []);
      map.get(dateKey).push(occ);
    });
  });

  map.forEach((list) => list.sort((a, b) => a.start - b.start));
  return map;
}

function applyIcsText(text) {
  events = normalizeEvents(text);
  feedEventsByDay = groupByDay(events);
}

function render() {
  if (currentView === 'month') renderMonth();
  else if (currentView === 'week') renderWeek();
  else renderAgenda();
}

function renderMonth() {
  const label = utcMonthYearFormatter.format(new Date(Date.UTC(monthState.year, monthState.month, 1)));
  document.getElementById('month-label').textContent = capitalize(label);

  const grid = document.getElementById('month-grid');
  grid.innerHTML = '';
  const todayKey = romeDateKey(new Date());
  const days = buildMonthGrid(monthState.year, monthState.month);
  const dayMap = getCombinedDayMap(days[0].key, days[days.length - 1].key);

  days.forEach((day) => {
    const cell = document.createElement('button');
    cell.type = 'button';
    let cls = 'day-cell';
    if (!day.inCurrentMonth) cls += ' day-cell--muted';
    if (day.key === todayKey) cls += ' day-cell--today';
    cell.className = cls;

    const num = document.createElement('span');
    num.className = 'day-number';
    num.textContent = day.date;
    cell.appendChild(num);

    const dayEvents = dayMap.get(day.key) || [];
    const maxShown = 3;
    dayEvents.slice(0, maxShown).forEach((ev) => {
      cell.appendChild(renderEventPill(ev));
    });
    if (dayEvents.length > maxShown) {
      const more = document.createElement('span');
      more.className = 'event-pill event-pill--more';
      more.textContent = `+${dayEvents.length - maxShown} altri`;
      cell.appendChild(more);
    }

    cell.addEventListener('click', () => openDayDialog(day.key, dayEvents));
    grid.appendChild(cell);
  });
}

function renderEventPill(ev) {
  const pill = document.createElement('span');
  pill.className = 'event-pill' + (ev.source === 'custom' ? ' event-pill--custom' : '');

  const time = document.createElement('span');
  time.className = 'event-pill__time';
  time.textContent = ev.allDay ? '●' : romeTime(ev.start);
  pill.appendChild(time);

  const title = document.createElement('span');
  title.className = 'event-pill__title';
  title.textContent = ev.summary;
  pill.appendChild(title);

  return pill;
}

function renderWeek() {
  const start = new Date(weekState.mondayMillis);
  const end = new Date(weekState.mondayMillis + 6 * DAY_MS);
  document.getElementById('week-label').textContent =
    `${utcDayMonthFormatter.format(start)} – ${utcDayMonthFormatter.format(end)}`;

  const list = document.getElementById('week-list');
  list.innerHTML = '';
  const todayKey = romeDateKey(new Date());
  const startKey = utcDateKey(start);
  const endKey = utcDateKey(end);
  const dayMap = getCombinedDayMap(startKey, endKey);

  for (let i = 0; i < 7; i++) {
    const d = new Date(weekState.mondayMillis + i * DAY_MS);
    const key = utcDateKey(d);
    const section = document.createElement('section');
    section.className = 'week-day' + (key === todayKey ? ' week-day--today' : '');

    const header = document.createElement('h3');
    header.textContent = capitalize(utcWeekdayLongFormatter.format(d));
    section.appendChild(header);

    const dayEvents = dayMap.get(key) || [];
    if (dayEvents.length === 0) {
      const p = document.createElement('p');
      p.className = 'week-day__empty';
      p.textContent = 'Nessun evento.';
      section.appendChild(p);
    } else {
      dayEvents.forEach((ev) => section.appendChild(renderEventDetail(ev)));
    }
    list.appendChild(section);
  }
}

function renderAgenda() {
  const list = document.getElementById('agenda-list');
  list.innerHTML = '';

  const cutoffKey = romeDateKey(new Date(Date.now() - 7 * DAY_MS));
  const endKey = romeDateKey(new Date(Date.now() + AGENDA_FORWARD_DAYS * DAY_MS));
  const todayKey = romeDateKey(new Date());
  const dayMap = getCombinedDayMap(cutoffKey, endKey);
  const sortedKeys = [...dayMap.keys()].sort();

  const hasAny = sortedKeys.some((key) => (dayMap.get(key) || []).length > 0);
  if (!hasAny) {
    const p = document.createElement('p');
    p.className = 'week-day__empty';
    p.textContent = 'Nessun evento in programma.';
    list.appendChild(p);
    return;
  }

  sortedKeys.forEach((key) => {
    const dayEvents = dayMap.get(key) || [];
    if (dayEvents.length === 0) return;
    const header = document.createElement('h3');
    header.className = 'agenda-date' + (key === todayKey ? ' agenda-date--today' : '');
    const [y, m, d] = key.split('-').map(Number);
    header.textContent = capitalize(utcWeekdayLongFormatter.format(new Date(Date.UTC(y, m - 1, d))));
    list.appendChild(header);
    dayEvents.forEach((ev) => list.appendChild(renderEventDetail(ev)));
  });
}

function renderEventDetail(ev) {
  const wrap = document.createElement('div');
  wrap.className = 'event-detail' + (ev.source === 'custom' ? ' event-detail--custom' : '');

  const row = document.createElement('div');
  row.className = 'event-detail__row';

  const time = document.createElement('div');
  time.className = 'event-detail__time';
  time.textContent = ev.allDay ? 'Tutto il giorno' : `${romeTime(ev.start)} – ${romeTime(ev.end)}`;
  row.appendChild(time);

  if (ev.source === 'custom') {
    const actions = document.createElement('div');
    actions.className = 'event-detail__actions';

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'icon-btn';
    editBtn.setAttribute('aria-label', 'Modifica evento');
    editBtn.textContent = '✏️';
    editBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openEventForm({ mode: 'edit', seriesId: ev.seriesId });
    });
    actions.appendChild(editBtn);

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'icon-btn';
    delBtn.setAttribute('aria-label', 'Elimina evento');
    delBtn.textContent = '🗑️';
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openDeleteDialog(ev.seriesId, ev.occurrenceDate);
    });
    actions.appendChild(delBtn);

    row.appendChild(actions);
  }

  wrap.appendChild(row);

  const title = document.createElement('div');
  title.className = 'event-detail__title';
  title.textContent = ev.summary;
  wrap.appendChild(title);

  if (ev.location) {
    const meta = document.createElement('div');
    meta.className = 'event-detail__meta';
    meta.textContent = ev.location;
    wrap.appendChild(meta);
  }

  return wrap;
}

function openDayDialog(dayKey, dayEvents) {
  const dialog = document.getElementById('day-dialog');
  const title = document.getElementById('day-dialog-title');
  const list = document.getElementById('day-dialog-events');

  const [y, m, d] = dayKey.split('-').map(Number);
  const labelDate = new Date(Date.UTC(y, m - 1, d));
  title.textContent = capitalize(utcWeekdayLongFormatter.format(labelDate));

  list.innerHTML = '';
  if (dayEvents.length === 0) {
    const p = document.createElement('p');
    p.textContent = 'Nessun evento in programma.';
    list.appendChild(p);
  } else {
    dayEvents.forEach((ev) => list.appendChild(renderEventDetail(ev)));
  }

  dialog.showModal();
}

function setView(view) {
  currentView = view;
  localStorage.setItem(STORAGE_VIEW, view);

  document.querySelectorAll('.view-btn').forEach((btn) => {
    const active = btn.dataset.view === view;
    btn.setAttribute('aria-pressed', String(active));
    btn.classList.toggle('view-btn--active', active);
  });

  document.getElementById('month-view').hidden = view !== 'month';
  document.getElementById('week-view').hidden = view !== 'week';
  document.getElementById('agenda-view').hidden = view !== 'agenda';

  render();
}

function showContent() {
  document.getElementById('loading').hidden = true;
  document.getElementById('error-full').hidden = true;
  document.getElementById('calendar-content').hidden = false;
}

function showFullError() {
  document.getElementById('loading').hidden = true;
  document.getElementById('calendar-content').hidden = true;
  document.getElementById('error-full').hidden = false;
}

function showStaleBanner(updatedIso) {
  const banner = document.getElementById('stale-banner');
  const time = updatedIso ? romeTime(new Date(updatedIso)) : '';
  banner.textContent =
    `Non riesco ad aggiornare il calendario al momento. Mostro l'ultima versione salvata${
      time ? ' (aggiornata alle ' + time + ')' : ''
    }.`;
  banner.hidden = false;
}

function hideStaleBanner() {
  document.getElementById('stale-banner').hidden = true;
}

function updateFooter(date) {
  document.getElementById('updated-label').textContent = `Aggiornato alle ${romeTime(date)}`;
}

async function fetchFeedText() {
  const res = await fetch(API_URL, { cache: 'no-store' });
  if (!res.ok) throw new Error('bad_status');
  return res.text();
}

async function fetchCustomEvents() {
  const res = await fetch(CUSTOM_EVENTS_API, { cache: 'no-store' });
  if (!res.ok) throw new Error('bad_status');
  return res.json();
}

async function fetchAndRender({ isInitial = false } = {}) {
  lastFetchAttempt = Date.now();
  const [feedResult, customResult] = await Promise.allSettled([fetchFeedText(), fetchCustomEvents()]);

  if (customResult.status === 'fulfilled') {
    customEvents = customResult.value;
  }

  if (feedResult.status === 'fulfilled') {
    applyIcsText(feedResult.value);
    localStorage.setItem(STORAGE_ICS, feedResult.value);
    localStorage.setItem(STORAGE_UPDATED, new Date().toISOString());
    showContent();
    hideStaleBanner();
    updateFooter(new Date());
    render();
  } else {
    handleFetchError(isInitial);
  }
}

function handleFetchError(isInitial) {
  const cachedText = localStorage.getItem(STORAGE_ICS);
  if (cachedText) {
    try {
      applyIcsText(cachedText);
      showContent();
      showStaleBanner(localStorage.getItem(STORAGE_UPDATED));
      render();
      return;
    } catch (err) {
      // fall through to full error state below
    }
  }
  if (isInitial) {
    showFullError();
  }
}

function restoreViewPreference() {
  const saved = localStorage.getItem(STORAGE_VIEW);
  setView(['month', 'week', 'agenda'].includes(saved) ? saved : 'month');
}

function updateFormVisibility() {
  const allDay = document.getElementById('ef-allday').checked;
  document.getElementById('ef-time-row').hidden = allDay;

  const repeat = document.getElementById('ef-repeat').value;
  const isRecurring = repeat !== 'none';
  document.getElementById('ef-weekday-row').hidden = repeat !== 'weekly';
  document.getElementById('ef-end-row').hidden = !isRecurring;

  const endType = document.getElementById('ef-end-type').value;
  document.getElementById('ef-end-date').hidden = !isRecurring || endType !== 'onDate';
  document.getElementById('ef-end-count').hidden = !isRecurring || endType !== 'count';
}

function openEventForm({ mode = 'create', seriesId = null, defaultDate = null } = {}) {
  editingSeriesId = mode === 'edit' ? seriesId : null;

  let ce = null;
  if (mode === 'edit') {
    ce = customEvents.find((e) => e.id === seriesId);
    if (!ce) return;
  }

  document.getElementById('event-form-heading').textContent = mode === 'edit' ? 'Modifica evento' : 'Nuovo evento';
  document.getElementById('event-form-series-note').hidden = !(ce && ce.recurrence);
  document.getElementById('ef-time-error').hidden = true;

  document.getElementById('ef-title').value = ce ? ce.title : '';
  document.getElementById('ef-location').value = ce ? ce.location : '';
  document.getElementById('ef-notes').value = ce ? ce.notes : '';
  document.getElementById('ef-allday').checked = ce ? !!ce.allDay : false;
  document.getElementById('ef-date').value = ce ? ce.date : defaultDate || romeDateKey(new Date());
  document.getElementById('ef-start-time').value = ce ? ce.startTime : '09:00';
  document.getElementById('ef-end-time').value = ce ? ce.endTime : '10:00';
  document.getElementById('ef-repeat').value = ce && ce.recurrence ? ce.recurrence.freq : 'none';

  document.querySelectorAll('#ef-weekday-row input').forEach((cb) => {
    cb.checked = !!(
      ce &&
      ce.recurrence &&
      ce.recurrence.byweekday &&
      ce.recurrence.byweekday.includes(Number(cb.value))
    );
  });

  const endType = ce && ce.recurrence && ce.recurrence.end ? ce.recurrence.end.type : 'never';
  document.getElementById('ef-end-type').value = endType;
  document.getElementById('ef-end-date').value = endType === 'onDate' ? ce.recurrence.end.date : '';
  document.getElementById('ef-end-count').value = endType === 'count' ? ce.recurrence.end.count : '';

  updateFormVisibility();
  document.getElementById('event-form-dialog').showModal();
}

async function submitEventForm(e) {
  e.preventDefault();

  const allDay = document.getElementById('ef-allday').checked;
  const startTime = document.getElementById('ef-start-time').value || '09:00';
  const endTime = document.getElementById('ef-end-time').value || '10:00';
  const errorEl = document.getElementById('ef-time-error');

  if (!allDay && endTime <= startTime) {
    errorEl.textContent = "L'orario di fine deve essere dopo quello di inizio.";
    errorEl.hidden = false;
    return;
  }
  errorEl.hidden = true;

  const repeat = document.getElementById('ef-repeat').value;
  let recurrence = null;
  if (repeat !== 'none') {
    const byweekday =
      repeat === 'weekly'
        ? [...document.querySelectorAll('#ef-weekday-row input:checked')].map((cb) => Number(cb.value))
        : undefined;
    const endType = document.getElementById('ef-end-type').value;
    let end = { type: 'never' };
    if (endType === 'onDate') end = { type: 'onDate', date: document.getElementById('ef-end-date').value };
    if (endType === 'count') end = { type: 'count', count: Number(document.getElementById('ef-end-count').value) || 1 };
    recurrence = { freq: repeat, interval: 1, byweekday, end };
  }

  const payloadEvent = {
    title: document.getElementById('ef-title').value.trim(),
    location: document.getElementById('ef-location').value.trim(),
    notes: document.getElementById('ef-notes').value.trim(),
    allDay,
    date: document.getElementById('ef-date').value,
    startTime,
    endTime,
    recurrence,
  };

  const body = editingSeriesId
    ? { action: 'update', id: editingSeriesId, event: payloadEvent }
    : { action: 'create', event: payloadEvent };

  try {
    const res = await fetch(CUSTOM_EVENTS_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error('save_failed');
    customEvents = await res.json();
    document.getElementById('event-form-dialog').close();
    render();
  } catch (err) {
    errorEl.textContent = "Impossibile salvare l'evento. Controlla la connessione e riprova.";
    errorEl.hidden = false;
  }
}

function openDeleteDialog(seriesId, occurrenceDate) {
  const ce = customEvents.find((e) => e.id === seriesId);
  if (!ce) return;

  const dialog = document.getElementById('delete-dialog');
  const optionsWrap = document.getElementById('delete-dialog-options');
  optionsWrap.innerHTML = '';

  function addOption(label, mode) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = label;
    btn.addEventListener('click', () => performDelete(seriesId, mode, occurrenceDate));
    optionsWrap.appendChild(btn);
  }

  if (ce.recurrence) {
    addOption('Solo questo evento', 'occurrence');
    addOption('Questo e i successivi', 'following');
    addOption('Tutti gli eventi', 'all');
  } else {
    addOption('Elimina', 'all');
  }

  dialog.showModal();
}

async function performDelete(id, mode, date) {
  try {
    const res = await fetch(CUSTOM_EVENTS_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete', id, mode, date }),
    });
    if (res.ok) {
      customEvents = await res.json();
    }
  } catch (err) {
    // ignore; next refresh will resync
  }
  document.getElementById('delete-dialog').close();
  document.getElementById('day-dialog').close();
  render();
}

function attachEventListeners() {
  document.querySelectorAll('.view-btn').forEach((btn) => {
    btn.addEventListener('click', () => setView(btn.dataset.view));
  });

  document.getElementById('month-prev').addEventListener('click', () => {
    monthState.month -= 1;
    if (monthState.month < 0) {
      monthState.month = 11;
      monthState.year -= 1;
    }
    renderMonth();
  });
  document.getElementById('month-next').addEventListener('click', () => {
    monthState.month += 1;
    if (monthState.month > 11) {
      monthState.month = 0;
      monthState.year += 1;
    }
    renderMonth();
  });

  document.getElementById('week-prev').addEventListener('click', () => {
    weekState.mondayMillis -= 7 * DAY_MS;
    renderWeek();
  });
  document.getElementById('week-next').addEventListener('click', () => {
    weekState.mondayMillis += 7 * DAY_MS;
    renderWeek();
  });

  const dayDialog = document.getElementById('day-dialog');
  document.getElementById('day-dialog-close').addEventListener('click', () => dayDialog.close());
  dayDialog.addEventListener('click', (e) => {
    if (e.target === dayDialog) dayDialog.close();
  });

  document.getElementById('retry-btn').addEventListener('click', () => {
    document.getElementById('error-full').hidden = true;
    document.getElementById('loading').hidden = false;
    fetchAndRender({ isInitial: true });
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - lastFetchAttempt > VISIBILITY_MIN_GAP_MS) {
      fetchAndRender();
    }
  });

  window.addEventListener('pageshow', (e) => {
    if (e.persisted) fetchAndRender();
  });

  document.getElementById('fab-add-event').addEventListener('click', () => {
    openEventForm({ mode: 'create' });
  });

  document.getElementById('ef-allday').addEventListener('change', updateFormVisibility);
  document.getElementById('ef-repeat').addEventListener('change', updateFormVisibility);
  document.getElementById('ef-end-type').addEventListener('change', updateFormVisibility);
  document.getElementById('event-form').addEventListener('submit', submitEventForm);

  const eventFormDialog = document.getElementById('event-form-dialog');
  document.getElementById('ef-cancel').addEventListener('click', () => eventFormDialog.close());
  eventFormDialog.addEventListener('click', (e) => {
    if (e.target === eventFormDialog) eventFormDialog.close();
  });

  const deleteDialog = document.getElementById('delete-dialog');
  document.getElementById('delete-dialog-cancel').addEventListener('click', () => deleteDialog.close());
  deleteDialog.addEventListener('click', (e) => {
    if (e.target === deleteDialog) deleteDialog.close();
  });
}

async function init() {
  restoreViewPreference();
  attachEventListeners();
  await fetchAndRender({ isInitial: true });
  setInterval(() => fetchAndRender(), REFRESH_INTERVAL_MS);
}

init();
