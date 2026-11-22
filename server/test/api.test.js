// API tests using node:test and fetch against an ephemeral-port server.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

// Set env before the app (and therefore db.js) is loaded.
process.env.FEESAATHI_DB = ':memory:';
process.env.JWT_SECRET ??= 'test-secret';

const { createApp } = await import('../src/app.js');

let server;
let base;
let cookie;

before(async () => {
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

const post = (path, body, headers = {}) =>
  fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

const get = (path, headers = {}) => fetch(base + path, { headers });

const cookieFrom = (res) => (res.headers.get('set-cookie') || '').split(';')[0];

const EMAIL = 'asha@example.com';
const PASSWORD = 'password123';

test('register creates a user and sets the session cookie', async () => {
  const res = await post('/api/auth/register', {
    name: 'Asha Verma',
    email: 'Asha@Example.com',
    password: PASSWORD,
  });
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.user.email, EMAIL);
  assert.match(res.headers.get('set-cookie'), /fs_token=/);
});

test('duplicate register returns 409', async () => {
  const res = await post('/api/auth/register', {
    name: 'Someone Else',
    email: EMAIL,
    password: PASSWORD,
  });
  assert.equal(res.status, 409);
});

test('register validation returns field errors', async () => {
  const res = await post('/api/auth/register', { name: '', email: 'not-an-email', password: 'short' });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.ok(body.errors.name);
  assert.ok(body.errors.email);
  assert.ok(body.errors.password);
});

test('login succeeds with correct credentials', async () => {
  const res = await post('/api/auth/login', { email: EMAIL, password: PASSWORD });
  assert.equal(res.status, 200);
  cookie = cookieFrom(res);
  assert.match(cookie, /^fs_token=/);
});

test('login with wrong password returns 401', async () => {
  const res = await post('/api/auth/login', { email: EMAIL, password: 'wrong-password' });
  assert.equal(res.status, 401);
  assert.equal((await res.json()).error, 'Invalid email or password');
});

test('onboarding rejects an invalid mobile number', async () => {
  const res = await post(
    '/api/onboarding',
    { name: 'Asha', email: EMAIL, mobile: '12345', feeCycle: 'monthly' },
    { cookie },
  );
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.ok(body.errors.mobile);
});

test('onboarding rejects an invalid fee cycle', async () => {
  const res = await post(
    '/api/onboarding',
    { name: 'Asha', email: EMAIL, mobile: '9876543210', feeCycle: 'yearly' },
    { cookie },
  );
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.ok(body.errors.feeCycle);
});

test('onboarding succeeds and marks the profile onboarded', async () => {
  const res = await post(
    '/api/onboarding',
    {
      name: 'Asha Verma',
      businessName: 'Asha Tuition Centre',
      mobile: '+91 98765 43210',
      email: EMAIL,
      cityOrArea: 'Pune',
      currency: 'INR',
      openingCashBalance: 2500,
      feeCycle: 'monthly',
    },
    { cookie },
  );
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.profile.onboarded, true);
  assert.equal(body.profile.mobile, '9876543210');
  assert.equal(body.profile.openingCashBalance, 2500);
});

test('GET /api/auth/me returns the user and profile', async () => {
  const res = await get('/api/auth/me', { cookie });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.user.email, EMAIL);
  assert.equal(body.profile.businessName, 'Asha Tuition Centre');
  assert.equal(body.profile.onboarded, true);
});
