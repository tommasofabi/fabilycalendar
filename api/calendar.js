export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }

  const feedUrl = process.env.ICS_FEED_URL;
  if (!feedUrl) {
    res.status(500).json({ error: 'not_configured' });
    return;
  }

  try {
    const upstream = await fetch(feedUrl, { signal: AbortSignal.timeout(10000) });

    if (!upstream.ok) {
      res.status(502).json({ error: 'feed_unreachable' });
      return;
    }

    const text = await upstream.text();
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
    res.status(200).send(text);
  } catch (err) {
    res.status(502).json({ error: 'feed_unreachable' });
  }
}
