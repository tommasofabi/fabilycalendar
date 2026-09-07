const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const EVENTS_KEY = 'customEvents';

async function kvCommand(cmd) {
  const res = await fetch(KV_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${KV_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(cmd),
  });
  if (!res.ok) throw new Error('kv_request_failed');
  const data = await res.json();
  return data.result;
}

async function loadEvents() {
  const raw = await kvCommand(['GET', EVENTS_KEY]);
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch (err) {
    return [];
  }
}

async function saveEvents(events) {
  await kvCommand(['SET', EVENTS_KEY, JSON.stringify(events)]);
}

function makeId() {
  return 'evt_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function dayBefore(dateKey) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d) - 86400000);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(
    dt.getUTCDate()
  ).padStart(2, '0')}`;
}

function sanitizeIncomingEvent(input) {
  return {
    title: String(input.title || '').slice(0, 200) || 'Evento',
    location: String(input.location || '').slice(0, 200),
    notes: String(input.notes || '').slice(0, 1000),
    allDay: !!input.allDay,
    date: String(input.date || ''),
    startTime: input.allDay ? '00:00' : String(input.startTime || '00:00'),
    endTime: input.allDay ? '23:59' : String(input.endTime || '00:00'),
    recurrence: input.recurrence || null,
  };
}

export default async function handler(req, res) {
  if (!KV_URL || !KV_TOKEN) {
    res.status(500).json({ error: 'not_configured' });
    return;
  }

  try {
    if (req.method === 'GET') {
      const events = await loadEvents();
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json(events);
      return;
    }

    if (req.method !== 'POST') {
      res.status(405).json({ error: 'method_not_allowed' });
      return;
    }

    const body = typeof req.body === 'object' && req.body ? req.body : JSON.parse(req.body || '{}');
    const events = await loadEvents();

    if (body.action === 'create') {
      const event = {
        id: makeId(),
        ...sanitizeIncomingEvent(body.event || {}),
        exceptions: [],
        createdAt: new Date().toISOString(),
      };
      events.push(event);
      await saveEvents(events);
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json(events);
      return;
    }

    if (body.action === 'update') {
      const idx = events.findIndex((e) => e.id === body.id);
      if (idx === -1) {
        res.status(404).json({ error: 'not_found' });
        return;
      }
      events[idx] = {
        ...events[idx],
        ...sanitizeIncomingEvent(body.event || {}),
      };
      await saveEvents(events);
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json(events);
      return;
    }

    if (body.action === 'delete') {
      const idx = events.findIndex((e) => e.id === body.id);
      if (idx === -1) {
        res.status(404).json({ error: 'not_found' });
        return;
      }
      if (body.mode === 'all' || !events[idx].recurrence) {
        events.splice(idx, 1);
      } else if (body.mode === 'occurrence') {
        events[idx].exceptions = [...(events[idx].exceptions || []), body.date];
      } else if (body.mode === 'following') {
        events[idx].recurrence = {
          ...events[idx].recurrence,
          end: { type: 'onDate', date: dayBefore(body.date) },
        };
      }
      await saveEvents(events);
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json(events);
      return;
    }

    res.status(400).json({ error: 'unknown_action' });
  } catch (err) {
    res.status(502).json({ error: 'storage_unreachable' });
  }
}
