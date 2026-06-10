import type { getZohoIntegrationConfig } from "./config";
import { refreshZohoAccessToken, type ZohoTokenState } from "./oauth";
import {
  decryptStoredZohoToken,
  readZohoConnection,
  writeZohoConnection,
  type ZohoStoredConnection,
} from "./tokenStore";

export async function validZohoTokenState(input: {
  config: ReturnType<typeof getZohoIntegrationConfig>;
  storedConnection: ZohoStoredConnection;
}) {
  const tokenState = decryptStoredZohoToken(input.storedConnection);
  if (!isExpiredOrExpiring(tokenState)) return tokenState;
  if (!tokenState.refreshToken) {
    throw new Error("Zoho access token expired and no refresh token is stored.");
  }

  const refreshed = await refreshZohoAccessToken(input.config, tokenState.refreshToken);
  await writeZohoConnection(refreshed, { existing: input.storedConnection });
  return refreshed;
}

export async function getConnectedZohoSession(
  config: ReturnType<typeof getZohoIntegrationConfig>,
) {
  const storedConnection = await readZohoConnection();
  if (!storedConnection) {
    throw new Error("Zoho is not connected.");
  }

  const organizationId = config.organizationId || storedConnection.organizationId;
  if (!organizationId) {
    throw new Error("Zoho organization id is missing.");
  }

  const tokenState = await validZohoTokenState({ config, storedConnection });
  return { storedConnection, organizationId, tokenState };
}

function isExpiredOrExpiring(tokenState: ZohoTokenState) {
  if (!tokenState.expiresAt) return false;
  return new Date(tokenState.expiresAt).getTime() - Date.now() < 60_000;
}
