// Students API tests using node:test and fetch against an ephemeral-port server.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

// Set env before the app (and therefore db.js) is loaded.
process.env.FEESAATHI_DB = ':memory:';
process.env.JWT_SECRET ??= 'test-secret';

const { createApp } = await import('../src/app.js');

let server;
let base;
let cookie;
let studentId;

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

test('create student succeeds and stores the cleaned mobile', async () => {
  const res = await send('POST', '/api/students', validStudent());
  assert.equal(res.status, 201);
  const { student } = await res.json();
  assert.equal(student.student_name, 'Riya Sharma');
  assert.equal(student.parent_mobile, '9876543210');
  assert.equal(student.status, 'active');
  studentId = student.id;
});

test('create with an invalid mobile returns 400 with errors.parent_mobile', async () => {
  const res = await send('POST', '/api/students', validStudent({ parent_mobile: '12345' }));
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.ok(body.errors.parent_mobile);
});

test('create without fee_frequency returns 400', async () => {
  const res = await send('POST', '/api/students', {
    student_name: 'No Freq',
    parent_name: 'Parent',
    parent_mobile: '9876543210',
    fee_amount: 500,
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.ok(body.errors.fee_frequency);
});

test('default list returns the active student', async () => {
  const res = await send('GET', '/api/students');
  assert.equal(res.status, 200);
  const { students } = await res.json();
  assert.equal(students.length, 1);
  assert.equal(students[0].id, studentId);
});

test('archive hides the student from the active list and shows it under archived', async () => {
  const archived = await send('POST', `/api/students/${studentId}/archive`);
  assert.equal(archived.status, 200);
  assert.equal((await archived.json()).student.status, 'archived');

  const active = await (await send('GET', '/api/students?status=active')).json();
  assert.equal(active.students.length, 0);

  const archivedList = await (await send('GET', '/api/students?status=archived')).json();
  assert.equal(archivedList.students.length, 1);
  assert.equal(archivedList.students[0].id, studentId);
});

test('restore brings the student back to the active list', async () => {
  const restored = await send('POST', `/api/students/${studentId}/restore`);
  assert.equal(restored.status, 200);
  assert.equal((await restored.json()).student.status, 'active');

  const active = await (await send('GET', '/api/students')).json();
  assert.equal(active.students.length, 1);
});

test('GET of an unknown id returns 404', async () => {
  const res = await send('GET', '/api/students/999999');
  assert.equal(res.status, 404);
  assert.equal((await res.json()).message, 'Student not found');
});

test('search q matches parent_name', async () => {
  const res = await send('GET', '/api/students?q=anita');
  assert.equal(res.status, 200);
  const { students } = await res.json();
  assert.equal(students.length, 1);
  assert.equal(students[0].parent_name, 'Anita Sharma');
});
