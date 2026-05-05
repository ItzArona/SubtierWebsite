const { generatePkceVerifier, pkceChallenge, generateToken } = require('../utils/tokens');
const { getSettings } = require('./dataStore');

const GRAPH_ME = 'https://graph.microsoft.com/v1.0/me';

function authority(tenant) {
  return `https://login.microsoftonline.com/${tenant || 'common'}`;
}

async function isMicrosoftEnabled() {
  const settings = await getSettings();
  if (!settings.oauthEnabled) return false;
  const clientId = (settings.oauthMicrosoft && settings.oauthMicrosoft.clientId) || process.env.MS_OAUTH_CLIENT_ID;
  const clientSecret = process.env.MS_OAUTH_CLIENT_SECRET;
  return Boolean(clientId && clientSecret);
}

async function buildAuthUrl({ baseUrl, mode = 'login' }) {
  const settings = await getSettings();
  const clientId = (settings.oauthMicrosoft && settings.oauthMicrosoft.clientId) || process.env.MS_OAUTH_CLIENT_ID;
  const tenant = (settings.oauthMicrosoft && settings.oauthMicrosoft.tenant) || process.env.MS_OAUTH_TENANT || 'common';
  if (!clientId) throw new Error('Microsoft OAuth client_id 未配置');

  const verifier = generatePkceVerifier();
  const challenge = pkceChallenge(verifier);
  const state = generateToken(16);
  const callbackPath = mode === 'link' ? '/account/link/microsoft/callback' : '/auth/microsoft/callback';
  const redirectUri = `${baseUrl.replace(/\/$/, '')}${callbackPath}`;

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    response_mode: 'query',
    scope: 'openid profile email User.Read',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256'
  });

  return {
    url: `${authority(tenant)}/oauth2/v2.0/authorize?${params.toString()}`,
    state,
    verifier,
    redirectUri,
    mode
  };
}

async function exchangeCode({ code, verifier, redirectUri }) {
  const settings = await getSettings();
  const clientId = (settings.oauthMicrosoft && settings.oauthMicrosoft.clientId) || process.env.MS_OAUTH_CLIENT_ID;
  const clientSecret = process.env.MS_OAUTH_CLIENT_SECRET;
  const tenant = (settings.oauthMicrosoft && settings.oauthMicrosoft.tenant) || process.env.MS_OAUTH_TENANT || 'common';
  if (!clientId || !clientSecret) throw new Error('Microsoft OAuth 凭据未配置');

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    code_verifier: verifier,
    scope: 'openid profile email User.Read'
  });

  const response = await fetch(`${authority(tenant)}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`OAuth token 接口 ${response.status}: ${text.slice(0, 300)}`);
  }
  return response.json();
}

async function fetchProfile(accessToken) {
  const response = await fetch(GRAPH_ME, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Graph /me ${response.status}: ${text.slice(0, 200)}`);
  }
  const profile = await response.json();
  const email = profile.mail || profile.userPrincipalName || null;
  return {
    subject: profile.id,
    email,
    displayName: profile.displayName || (email ? email.split('@')[0] : 'microsoft-user')
  };
}

module.exports = { isMicrosoftEnabled, buildAuthUrl, exchangeCode, fetchProfile };
