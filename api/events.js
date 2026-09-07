const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TABLE = 'custom_events';

function restUrl(query) {
  return `${SUPABASE_URL}/rest/v1/${TABLE}${query}`;
}

function restHeaders(extra = {}) {
  return {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    ...extra,
  };
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

function toInsertRow(event) {
  return {
    id: event.id,
    title: event.title,
    location: event.location,
    notes: event.notes,
    all_day: event.allDay,
    date: event.date,
    start_time: event.startTime,
    end_time: event.endTime,
    recurrence: event.recurrence,
    exceptions: [],
  };
}

function toUpdateRow(sanitized) {
  return {
    title: sanitized.title,
    location: sanitized.location,
    notes: sanitized.notes,
    all_day: sanitized.allDay,
    date: sanitized.date,
    start_time: sanitized.startTime,
    end_time: sanitized.endTime,
    recurrence: sanitized.recurrence,
  };
}

function fromRow(row) {
  return {
    id: row.id,
    title: row.title,
    location: row.location || '',
    notes: row.notes || '',
    allDay: !!row.all_day,
    date: row.date,
    startTime: row.start_time,
    endTime: row.end_time,
    recurrence: row.recurrence,
    exceptions: row.exceptions || [],
    createdAt: row.created_at,
  };
}

async function fetchAllEvents() {
  const res = await fetch(restUrl('?select=*&order=created_at.asc'), { headers: restHeaders() });
  if (!res.ok) throw new Error('supabase_error');
  const rows = await res.json();
  return rows.map(fromRow);
}

async function fetchOneRow(id) {
  const res = await fetch(restUrl(`?id=eq.${encodeURIComponent(id)}&select=*`), { headers: restHeaders() });
  if (!res.ok) throw new Error('supabase_error');
  const rows = await res.json();
  return rows[0] || null;
}

export default async function handler(req, res) {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    res.status(500).json({ error: 'not_configured' });
    return;
  }

  try {
    if (req.method === 'GET') {
      const events = await fetchAllEvents();
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json(events);
      return;
    }

    if (req.method !== 'POST') {
      res.status(405).json({ error: 'method_not_allowed' });
      return;
    }

    const body = typeof req.body === 'object' && req.body ? req.body : JSON.parse(req.body || '{}');

    if (body.action === 'create') {
      const sanitized = sanitizeIncomingEvent(body.event || {});
      const event = { id: makeId(), ...sanitized };
      const insertRes = await fetch(restUrl(''), {
        method: 'POST',
        headers: restHeaders({ Prefer: 'return=minimal' }),
        body: JSON.stringify(toInsertRow(event)),
      });
      if (!insertRes.ok) throw new Error('supabase_error');
      const events = await fetchAllEvents();
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json(events);
      return;
    }

    if (body.action === 'update') {
      const existing = await fetchOneRow(body.id);
      if (!existing) {
        res.status(404).json({ error: 'not_found' });
        return;
      }
      const sanitized = sanitizeIncomingEvent(body.event || {});
      const updateRes = await fetch(restUrl(`?id=eq.${encodeURIComponent(body.id)}`), {
        method: 'PATCH',
        headers: restHeaders({ Prefer: 'return=minimal' }),
        body: JSON.stringify(toUpdateRow(sanitized)),
      });
      if (!updateRes.ok) throw new Error('supabase_error');
      const events = await fetchAllEvents();
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json(events);
      return;
    }

    if (body.action === 'delete') {
      const existing = await fetchOneRow(body.id);
      if (!existing) {
        res.status(404).json({ error: 'not_found' });
        return;
      }

      if (body.mode === 'all' || !existing.recurrence) {
        const delRes = await fetch(restUrl(`?id=eq.${encodeURIComponent(body.id)}`), {
          method: 'DELETE',
          headers: restHeaders({ Prefer: 'return=minimal' }),
        });
        if (!delRes.ok) throw new Error('supabase_error');
      } else if (body.mode === 'occurrence') {
        const exceptions = [...(existing.exceptions || []), body.date];
        const patchRes = await fetch(restUrl(`?id=eq.${encodeURIComponent(body.id)}`), {
          method: 'PATCH',
          headers: restHeaders({ Prefer: 'return=minimal' }),
          body: JSON.stringify({ exceptions }),
        });
        if (!patchRes.ok) throw new Error('supabase_error');
      } else if (body.mode === 'following') {
        const recurrence = { ...existing.recurrence, end: { type: 'onDate', date: dayBefore(body.date) } };
        const patchRes = await fetch(restUrl(`?id=eq.${encodeURIComponent(body.id)}`), {
          method: 'PATCH',
          headers: restHeaders({ Prefer: 'return=minimal' }),
          body: JSON.stringify({ recurrence }),
        });
        if (!patchRes.ok) throw new Error('supabase_error');
      }

      const events = await fetchAllEvents();
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json(events);
      return;
    }

    res.status(400).json({ error: 'unknown_action' });
  } catch (err) {
    res.status(502).json({ error: 'storage_unreachable' });
  }
}
