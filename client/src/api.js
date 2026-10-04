export const apiFetch = async (url, token, impersonatingId, options = {}) => {
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    if (impersonatingId) headers['X-Impersonate'] = impersonatingId.toString();
    return fetch(url, { ...options, headers: { ...headers, ...(options.headers || {}) } });
};
