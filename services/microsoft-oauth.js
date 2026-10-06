// MICROSOFT SIGN-IN SHAPES — the two requests whose scope list decides whether a mailbox keeps working.
// PURE: no network, no clock, so the rules below can be tested with fixed inputs.
//
// Why this exists (R-136, owner 6 Oct: "Outlook label colours need one extra permission that each person grants
// once by reconnecting … yes"). The colour of an Outlook category lives in the mailbox's master list, which needs
// `MailboxSettings.ReadWrite`. That permission is asked for when a mailbox is CONNECTED (authorize + code exchange).
//
// The trap: the token REFRESH used to send the same scope list. A mailbox connected BEFORE this permission existed
// never granted it, and Microsoft refuses a refresh that asks for a scope the token was not granted — so adding the
// permission to the shared list would have taken every already-connected Outlook mailbox offline at its next refresh,
// silently, within the hour. A refresh therefore sends NO scope: Microsoft then returns whatever the token was
// originally granted — the old base set for an old connection, base + colours for a new one.
'use strict';

/** The form body of a token refresh. Deliberately has no `scope`. */
function refreshParams({ clientId, clientSecret, refreshToken }) {
  return new URLSearchParams({
    client_id: clientId, client_secret: clientSecret,
    refresh_token: refreshToken, grant_type: 'refresh_token',
  });
}

module.exports = { refreshParams };
