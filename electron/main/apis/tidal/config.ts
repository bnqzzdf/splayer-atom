export const TIDAL_API_BASE = "https://api.tidal.com/v1";
export const TIDAL_AUTH_BASE = "https://auth.tidal.com/v1/oauth2";
export const TIDAL_DEFAULT_COUNTRY = process.env.TIDAL_COUNTRY_CODE?.trim() || "US";
export const TIDAL_TOKEN_REFRESH_MARGIN_MS = 60_000;
export const TIDAL_USER_AGENT = "SPlayer-Atom/1.0";
