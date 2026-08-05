// Shared browser-test entry point.
//
// The 17 Playwright suites all need the same thing: the app shell rendered, as
// some role, with no backend behind it. Until now they got that by clicking
// "Continue as Guest" — which meant every browser test depended on a PRODUCTION
// AUTHENTICATION BYPASS existing. That bypass handed anyone read-only access to
// the default organisation's live data, so it is gone, and the tests must not
// be the reason it comes back.
//
// What the tests actually needed was never a login: it was a rendered app with
// a user in STATE. So that is what this does, from the test side, granting
// nothing in the product. `STATE.token` is set to a string that is not a real
// token on purpose — these suites route all network to abort, and a test that
// silently started talking to a backend should fail loudly, not authenticate.

export const TEST_USERS = {
  bd:       { id: 'test-bd',   name: 'Test BD',        email: 'bd@example.test',   role: 'bd',       roles: ['bd'],       av: 'TB', avc: 'av-bd',    desig: 'BD Manager' },
  admin:    { id: 'test-adm',  name: 'Test Admin',     email: 'adm@example.test',  role: 'admin',    roles: ['admin'],    av: 'TA', avc: 'av-admin', desig: 'Admin' },
  ra:       { id: 'test-ra',   name: 'Test Analyst',   email: 'ra@example.test',   role: 'ra',       roles: ['ra'],       av: 'TR', avc: 'av-ra',    desig: 'Research Analyst' },
  ra_lead:  { id: 'test-ral',  name: 'Test RA Lead',   email: 'ral@example.test',  role: 'ra_lead',  roles: ['ra_lead'],  av: 'TL', avc: 'av-admin', desig: 'RA Team Lead' },
  recruiter:{ id: 'test-rec',  name: 'Test Recruiter', email: 'rec@example.test',  role: 'recruiter',roles: ['recruiter'],av: 'TC', avc: 'av-ra',    desig: 'Recruiter' },
};

/**
 * Put the app into a signed-in state and wait for the shell.
 *
 * @param page          Playwright page, already at the app's root
 * @param roleOrUser    a key of TEST_USERS, or a full user object to merge over 'bd'
 */
export async function enterApp(page, roleOrUser = 'bd') {
  const user = typeof roleOrUser === 'string'
    ? (TEST_USERS[roleOrUser] || TEST_USERS.bd)
    : { ...TEST_USERS.bd, ...roleOrUser };

  await page.evaluate((u) => {
    window.STATE.user = u;
    window.STATE.token = 'test-session-not-a-real-token';
    window.STATE.page = 'dashboard';
    window.render();
  }, user);

  await page.waitForSelector('#sidebar', { timeout: 15000 });
  await page.waitForSelector('#content', { timeout: 15000 });
  return user;
}

/** Change the signed-in user's role mid-test and re-render. */
export async function switchRole(page, roleOrUser) {
  const user = typeof roleOrUser === 'string'
    ? (TEST_USERS[roleOrUser] || TEST_USERS.bd)
    : roleOrUser;
  await page.evaluate((u) => {
    window.STATE.user = Object.assign({}, window.STATE.user, u);
    window.STATE.page = 'dashboard';
    window.render();
  }, user);
  await page.waitForTimeout(250);
  return user;
}

/** The login screen is up and rendered — the pre-sign-in assertion. */
export async function waitForLogin(page) {
  await page.waitForSelector('.login-card', { timeout: 15000 });
}
