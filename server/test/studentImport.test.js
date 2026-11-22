// Student import API tests using node:test and fetch against an ephemeral-port server.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

// Set env before the app (and therefore db.js) is loaded.
process.env.FEESAATHI_DB = ':memory:';
process.env.JWT_SECRET ??= 'test-secret';

const { createApp } = await import('../src/app.js');

let server;
let base;
let cookie;
let otherCookie;

before(async () => {
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;

  // Register and log in to get a session cookie.
  const reg = await fetch(base + '/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Tutor Test', email: 'tutor@example.com', password: 'password123' }),
  });
  assert.equal(reg.status, 201);
  cookie = (reg.headers.get('set-cookie') || '').split(';')[0];
});

after(() => new Promise((resolve) => server.close(resolve)));

const send = (method, path, body, headers = {}) =>
  fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', cookie, ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const validStudent = (overrides = {}) => ({
  student_name: 'Riya Sharma',
  parent_name: 'Anita Sharma',
  parent_mobile: '+91 98765-43210',
  fee_amount: 2000,
  fee_frequency: 'monthly',
  ...overrides,
});

test('valid rows are imported and appear in the student list', async () => {
  const res = await send('POST', '/api/students/import', {
    rows: [
      validStudent({ student_name: 'Aarav Mehta', parent_mobile: '9123456780' }),
      validStudent({ student_name: 'Diya Rao', parent_mobile: '9123456781' }),
    ],
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.imported, 2);
  assert.deepEqual(body.failed, []);

  const { students } = await (await send('GET', '/api/students')).json();
  const names = students.map((s) => s.student_name).sort();
  assert.deepEqual(names, ['Aarav Mehta', 'Diya Rao']);
});

test('a row with a bad mobile fails while other valid rows still import', async () => {
  const res = await send('POST', '/api/students/import', {
    rows: [
      validStudent({ student_name: 'Good One', parent_mobile: '9000000001' }),
      validStudent({ student_name: 'Bad Mobile', parent_mobile: '12345' }),
      validStudent({ student_name: 'Good Two', parent_mobile: '9000000002' }),
    ],
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.imported, 2);
  assert.equal(body.failed.length, 1);
  assert.equal(body.failed[0].row, 2);
  assert.ok(body.failed[0].errors.parent_mobile);

  const { students } = await (await send('GET', '/api/students')).json();
  assert.ok(students.some((s) => s.student_name === 'Good One'));
  assert.ok(students.some((s) => s.student_name === 'Good Two'));
  assert.ok(!students.some((s) => s.student_name === 'Bad Mobile'));
});

test('a row duplicating an existing student (same name and mobile) is reported and not inserted', async () => {
  // 'Aarav Mehta' with mobile 9123456780 was imported above.
  const res = await send('POST', '/api/students/import', {
    rows: [validStudent({ student_name: 'aarav mehta', parent_mobile: '91234 56780' })],
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.imported, 0);
  assert.equal(body.failed.length, 1);
  assert.equal(body.failed[0].row, 1);
  assert.equal(body.failed[0].errors.student_name, 'Already exists');

  const { students } = await (await send('GET', '/api/students')).json();
  assert.equal(students.filter((s) => s.parent_mobile === '9123456780').length, 1);
});

test('more than 500 rows returns 400', async () => {
  const rows = Array.from({ length: 501 }, (_, i) =>
    validStudent({ student_name: `Bulk ${i}`, parent_mobile: '9555000000' }),
  );
  const res = await send('POST', '/api/students/import', { rows });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.ok(body.message);
});

test("another user's import does not appear for the first user", async () => {
  const reg = await fetch(base + '/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Other Tutor', email: 'other@example.com', password: 'password123' }),
  });
  assert.equal(reg.status, 201);
  otherCookie = (reg.headers.get('set-cookie') || '').split(';')[0];

  const res = await send(
    'POST',
    '/api/students/import',
    { rows: [validStudent({ student_name: 'Other Users Child', parent_mobile: '9888877766' })] },
    { cookie: otherCookie },
  );
  assert.equal(res.status, 200);
  assert.equal((await res.json()).imported, 1);

  const mine = await (await send('GET', '/api/students?status=all')).json();
  assert.ok(!mine.students.some((s) => s.student_name === 'Other Users Child'));

  const theirs = await (await send('GET', '/api/students', undefined, { cookie: otherCookie })).json();
  assert.equal(theirs.students.length, 1);
  assert.equal(theirs.students[0].student_name, 'Other Users Child');
});
