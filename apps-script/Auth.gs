/**
 * Auth.gs
 * -------
 * Verifies the Google ID token sent by the frontend and resolves it to a
 * provisioned user (email → role + customer).
 *
 * The React PWA runs on a different origin (GitHub Pages), so it cannot use
 * Apps Script's native `Session.getActiveUser()`. Instead, Google Identity
 * Services on the frontend mints an ID token (a JWT); we verify it here.
 *
 * Verification uses Google's tokeninfo endpoint — simplest robust approach,
 * one UrlFetch per call (well within free quota at this volume). We still
 * check `aud` (our OAuth client id) and `exp` ourselves.
 */

var SCRIPT_PROP_OAUTH_CLIENT_ID = 'OAUTH_CLIENT_ID';

/**
 * @param {string} idToken  Google ID token (JWT) from the frontend.
 * @return {Object} {ok:true, email, claims} | {ok:false, error}
 */
function verifyIdToken_(idToken) {
  if (!idToken) return { ok: false, error: 'NO_TOKEN' };

  var expectedAud = PropertiesService.getScriptProperties()
    .getProperty(SCRIPT_PROP_OAUTH_CLIENT_ID);
  if (!expectedAud) {
    throw new Error('Script property "' + SCRIPT_PROP_OAUTH_CLIENT_ID + '" is not set.');
  }

  var url = 'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken);
  var resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (resp.getResponseCode() !== 200) return { ok: false, error: 'INVALID_TOKEN' };

  var claims;
  try { claims = JSON.parse(resp.getContentText()); }
  catch (e) { return { ok: false, error: 'INVALID_TOKEN' }; }

  // Audience must be our OAuth client id — rejects tokens minted for other apps.
  if (String(claims.aud) !== String(expectedAud)) return { ok: false, error: 'BAD_AUDIENCE' };

  // Expiry (tokeninfo already rejects expired tokens, but double-check).
  var now = Math.floor(Date.now() / 1000);
  if (claims.exp && Number(claims.exp) < now) return { ok: false, error: 'EXPIRED' };

  // Require a verified email.
  if (claims.email_verified !== 'true' && claims.email_verified !== true) {
    return { ok: false, error: 'EMAIL_UNVERIFIED' };
  }

  return { ok: true, email: String(claims.email).toLowerCase(), claims: claims };
}

/** Look up a provisioned user in the directory by email (case-insensitive). */
function getUserByEmail_(email) {
  var dir = getDirectorySpreadsheet_();
  var res = readObjects_(getSheetOrThrow_(dir, SHEETS.USERS));
  var lower = String(email).toLowerCase();
  return res.rows.find(function (r) {
    return String(r.email).toLowerCase() === lower;
  }) || null;
}
