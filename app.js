import ICAL from './vendor/ical.min.js';

const API_URL = '/api/calendar';
const TZ = 'Europe/Rome';
const DAY_MS = 24 * 60 * 60 * 1000;
const REFRESH_INTERVAL_MS = 10 * 60 * 1000;
const VISIBILITY_MIN_GAP_MS = 2 * 60 * 1000;

const STORAGE_ICS = 'familyCalendar.icsText';
const STORAGE_UPDATED = 'familyCalendar.lastUpdated';
const STORAGE_VIEW = 'familyCalendar.view';

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

let events = [];
let eventsByDay = new Map();
let currentView = 'month';
let lastFetchAttempt = 0;

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

function normalizeEvents(icsText) {
  const jcal = ICAL.parse(icsText);
  const comp = new ICAL.Component(jcal);

  comp.getAllSubcomponents('vtimezone').forEach((vt) => {
    ICAL.TimezoneService.register(vt);
  });

  return comp
    .getAllSubcomponents('vevent')
    .map((ve) => {
      const ev = new ICAL.Event(ve);
      const start = ev.startDate.toJSDate();
      const end = (ev.endDate || ev.startDate).toJSDate();
      return {
        uid: ev.uid,
        summary: ev.summary || 'Evento',
        location: ev.location || '',
        description: ev.description || '',
        start,
        end,
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

function applyIcsText(text) {
  events = normalizeEvents(text);
  eventsByDay = groupByDay(events);
  render();
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

    const dayEvents = eventsByDay.get(day.key) || [];
    const maxShown = 3;
    dayEvents.slice(0, maxShown).forEach((ev) => {
      const pill = document.createElement('span');
      pill.className = 'event-pill';
      pill.textContent = `${romeTime(ev.start)} ${ev.summary}`;
      cell.appendChild(pill);
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

function renderWeek() {
  const start = new Date(weekState.mondayMillis);
  const end = new Date(weekState.mondayMillis + 6 * DAY_MS);
  document.getElementById('week-label').textContent =
    `${utcDayMonthFormatter.format(start)} – ${utcDayMonthFormatter.format(end)}`;

  const list = document.getElementById('week-list');
  list.innerHTML = '';
  const todayKey = romeDateKey(new Date());

  for (let i = 0; i < 7; i++) {
    const d = new Date(weekState.mondayMillis + i * DAY_MS);
    const key = utcDateKey(d);
    const section = document.createElement('section');
    section.className = 'week-day' + (key === todayKey ? ' week-day--today' : '');

    const header = document.createElement('h3');
    header.textContent = capitalize(utcWeekdayLongFormatter.format(d));
    section.appendChild(header);

    const dayEvents = eventsByDay.get(key) || [];
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

  const cutoff = romeDateKey(new Date(Date.now() - 7 * DAY_MS));
  const todayKey = romeDateKey(new Date());
  const upcoming = events.filter((ev) => romeDateKey(ev.start) >= cutoff);

  if (upcoming.length === 0) {
    const p = document.createElement('p');
    p.className = 'week-day__empty';
    p.textContent = 'Nessun evento in programma.';
    list.appendChild(p);
    return;
  }

  let lastKey = null;
  upcoming.forEach((ev) => {
    const key = romeDateKey(ev.start);
    if (key !== lastKey) {
      const header = document.createElement('h3');
      header.className = 'agenda-date' + (key === todayKey ? ' agenda-date--today' : '');
      header.textContent = capitalize(romeWeekdayLongFormatter.format(ev.start));
      list.appendChild(header);
      lastKey = key;
    }
    list.appendChild(renderEventDetail(ev));
  });
}

function renderEventDetail(ev) {
  const wrap = document.createElement('div');
  wrap.className = 'event-detail';

  const time = document.createElement('div');
  time.className = 'event-detail__time';
  time.textContent = `${romeTime(ev.start)} – ${romeTime(ev.end)}`;
  wrap.appendChild(time);

  const title = document.createElement('div');
  title.className = 'event-detail__title';
  title.textContent = ev.summary;
  wrap.appendChild(title);

  if (ev.location) {
    const loc = document.createElement('div');
    loc.className = 'event-detail__location';
    loc.textContent = ev.location;
    wrap.appendChild(loc);
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

async function fetchAndRender({ isInitial = false } = {}) {
  lastFetchAttempt = Date.now();
  try {
    const res = await fetch(API_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error('bad_status');
    const text = await res.text();

    applyIcsText(text);
    localStorage.setItem(STORAGE_ICS, text);
    localStorage.setItem(STORAGE_UPDATED, new Date().toISOString());

    showContent();
    hideStaleBanner();
    updateFooter(new Date());
  } catch (err) {
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

  const dialog = document.getElementById('day-dialog');
  document.getElementById('day-dialog-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });

  document.getElementById('retry-btn').addEventListener('click', () => {
    document.getElementById('error-full').hidden = true;
    document.getElementById('loading').hidden = false;
    fetchAndRender({ isInitial: true });
  });

  document.addEventListener('visibilitychange', () => {
    if (
      document.visibilityState === 'visible' &&
      Date.now() - lastFetchAttempt > VISIBILITY_MIN_GAP_MS
    ) {
      fetchAndRender();
    }
  });

  window.addEventListener('pageshow', (e) => {
    if (e.persisted) fetchAndRender();
  });
}

async function init() {
  restoreViewPreference();
  attachEventListeners();
  await fetchAndRender({ isInitial: true });
  setInterval(() => fetchAndRender(), REFRESH_INTERVAL_MS);
}

init();
