module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Content-Type', 'application/json');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const supabaseUrl = process.env.SUPABASE_URL || '';
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || '';

  if (!supabaseUrl || !supabaseAnonKey) {
    return res.status(500).json({ error: 'Server configuration is incomplete' });
  }

  const authHeader = req.headers.authorization || '';
  const accessToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';

  if (!accessToken) {
    return res.status(401).json({ error: 'Missing access token' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch (_) {
      return res.status(400).json({ error: 'Invalid JSON body' });
    }
  }

  const adId = body?.adId;
  if (!adId || typeof adId !== 'string') {
    return res.status(400).json({ error: 'Missing ad id' });
  }

  const headers = {
    apikey: supabaseAnonKey,
    Authorization: `Bearer ${accessToken}`,
  };

  try {
    const adLookupUrl = new URL('/rest/v1/ads', supabaseUrl);
    adLookupUrl.searchParams.set('select', 'id,media_url');
    adLookupUrl.searchParams.set('id', `eq.${adId}`);
    adLookupUrl.searchParams.set('limit', '1');

    const lookupResponse = await fetch(adLookupUrl, {
      method: 'GET',
      headers,
    });

    const lookupText = await lookupResponse.text();
    const lookupPayload = lookupText ? JSON.parse(lookupText) : [];

    if (!lookupResponse.ok) {
      return res.status(lookupResponse.status).json({
        error: lookupPayload?.message || lookupPayload?.error || 'Failed to load ad',
      });
    }

    const ad = Array.isArray(lookupPayload) ? lookupPayload[0] : null;
    if (!ad) {
      return res.status(404).json({ error: 'Ad not found' });
    }

    const deleteUrl = new URL('/rest/v1/ads', supabaseUrl);
    deleteUrl.searchParams.set('id', `eq.${adId}`);

    const deleteResponse = await fetch(deleteUrl, {
      method: 'DELETE',
      headers: {
        ...headers,
        Prefer: 'return=representation',
      },
    });

    const deleteText = await deleteResponse.text();
    const deletePayload = deleteText ? JSON.parse(deleteText) : [];

    if (!deleteResponse.ok) {
      return res.status(deleteResponse.status).json({
        error: deletePayload?.message || deletePayload?.error || 'Failed to delete ad',
      });
    }

    const deletedAd = Array.isArray(deletePayload) ? deletePayload[0] : null;
    if (!deletedAd) {
      return res.status(404).json({ error: 'Ad not found or delete not allowed' });
    }

    return res.status(200).json({
      id: deletedAd.id,
      media_url: deletedAd.media_url || ad.media_url || '',
    });
  } catch (error) {
    console.error('remove-campaign error:', error);
    return res.status(500).json({ error: 'Failed to reach Supabase' });
  }
};
