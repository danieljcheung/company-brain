export function buildGmailSettingsRedirectUrl(requestUrl: string) {
  const url = new URL("/settings", getGmailSettingsRedirectBase(requestUrl));
  return url;
}

function getGmailSettingsRedirectBase(requestUrl: string) {
  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI;
  if (redirectUri) {
    try {
      return new URL(redirectUri).origin;
    } catch {
      // Fall through to the request URL if the optional override is invalid.
    }
  }

  return requestUrl;
}
