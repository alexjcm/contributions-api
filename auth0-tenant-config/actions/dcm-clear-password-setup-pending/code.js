const DCM_PASSWORD_SETUP_PENDING_APP_METADATA_KEY = 'dcm_password_setup_pending';

const getManagementAccessToken = async (event) => {
  const response = /** @type {any} */ (await fetch(`https://${event.secrets.AUTH0_DOMAIN}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: event.secrets.M2M_CLIENT_ID,
      client_secret: event.secrets.M2M_CLIENT_SECRET,
      audience: `https://${event.secrets.AUTH0_DOMAIN}/api/v2/`,
    }),
  }));

  if (!response.ok) {
    throw new Error(`No se pudo obtener token M2M: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  if (!data.access_token) {
    throw new Error('Auth0 no devolvió access_token.');
  }

  return data.access_token;
};

const managementFetchJson = async (event, token, path, init) => {
  const response = /** @type {any} */ (await fetch(`https://${event.secrets.AUTH0_DOMAIN}/api/v2${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  }));

  if (!response.ok) {
    let detail = response.statusText;
    try {
      const data = await response.json();
      detail = data.message || data.error || data.error_description || detail;
    } catch (e) {
      // ignore
    }

    throw new Error(`Auth0 respondió ${response.status}: ${detail}`);
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
};

exports.onExecutePostChangePassword = async (event) => {
  try {
    const appMetadata = event.user.app_metadata || {};
    if (appMetadata[DCM_PASSWORD_SETUP_PENDING_APP_METADATA_KEY] !== true) {
      return;
    }

    const updatedMetadata = { ...appMetadata };
    delete updatedMetadata[DCM_PASSWORD_SETUP_PENDING_APP_METADATA_KEY];

    const token = await getManagementAccessToken(event);
    await managementFetchJson(event, token, `/users/${encodeURIComponent(event.user.user_id)}`, {
      method: 'PATCH',
      body: JSON.stringify({
        app_metadata: updatedMetadata,
      }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log('[dcm-clear-password-setup-pending] failed', {
      message,
      user_id: event.user.user_id,
    });
  }
};
