const csrfMeta = document.querySelector('meta[name="csrf-token"]');

export function getCsrfToken() {
    return csrfMeta ? csrfMeta.content : '';
}

export function postData(url, data) {
    const fd = new FormData();
    for (const key in data) {
        fd.append(key, data[key]);
    }

    const token = getCsrfToken();
    if (token) fd.append('csrf_token', token);

    return fetch(url, { method: 'POST', body: fd });
}

export async function fetchGraphData({ etag = null, lastUpdate = null } = {}) {
    const headers = {};
    if (etag) headers['If-None-Match'] = etag;

    const params = new URLSearchParams();
    if (lastUpdate) params.set('last_update', lastUpdate);
    const query = params.toString();
    const url = query ? `api/data.php?${query}` : 'api/data.php';

    const res = await fetch(url, { headers });
    if (res.status === 304) return { status: 304 };
    if (!res.ok) {
        return { status: res.status };
    }

    const newEtag = res.headers.get('ETag');
    const payload = await res.json();

    return { status: res.status, etag: newEtag, data: payload };
}

export async function syncReadReceipts() {
    try {
        const res = await fetch('api/messages.php?action=sync_read_receipts');
        const data = await res.json();
        return data;
    } catch (e) {
        console.error('Hydration failed:', e);
        return { success: false };
    }
}
