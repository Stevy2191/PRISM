import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agentNeedsHttps, isTestCertificate } from './agentAddress.js';

test('https is fine anywhere', () => {
  assert.equal(agentNeedsHttps('https:', '192.168.1.50'), false);
  assert.equal(agentNeedsHttps('https:', 'helpdesk.example.com'), false);
});

test('plain http works only on this machine', () => {
  assert.equal(agentNeedsHttps('http:', 'localhost'), false);
  assert.equal(agentNeedsHttps('http:', '127.0.0.1'), false);
  assert.equal(agentNeedsHttps('http:', '[::1]'), false);
  assert.equal(agentNeedsHttps('http:', '192.168.1.50'), true);
  assert.equal(agentNeedsHttps('http:', 'prism.lan'), true);
});

test('only a certificate counts as the test authority', () => {
  assert.equal(isTestCertificate(200, 'application/x-x509-ca-cert'), true);
  assert.equal(isTestCertificate(200, 'application/pkix-cert'), true);
  assert.equal(isTestCertificate(404, 'application/x-x509-ca-cert'), false);
  assert.equal(isTestCertificate(200, 'text/html; charset=utf-8'), false);
  assert.equal(isTestCertificate(200, null), false);
});
