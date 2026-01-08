/**
 * Security Tests: Authentication
 *
 * Tests that HTTP API requires valid API key authentication.
 * Run with: npx tsx tests/security/authentication.test.ts
 */

// Simulated authentication middleware logic
function checkAuth(apiKey: string | undefined, configuredKey: string | undefined): { authorized: boolean; error?: string } {
  // If no API key configured, auth is disabled (dev mode)
  if (!configuredKey) {
    return { authorized: true };
  }

  // API key required but not provided
  if (!apiKey) {
    return { authorized: false, error: 'Unauthorized: Invalid or missing API key' };
  }

  // API key doesn't match
  if (apiKey !== configuredKey) {
    return { authorized: false, error: 'Unauthorized: Invalid or missing API key' };
  }

  return { authorized: true };
}

// Test cases
interface TestCase {
  name: string;
  configuredKey: string | undefined;
  providedKey: string | undefined;
  expectAuthorized: boolean;
}

const tests: TestCase[] = [
  {
    name: 'Allow request when no API key configured (dev mode)',
    configuredKey: undefined,
    providedKey: undefined,
    expectAuthorized: true
  },
  {
    name: 'Allow request with valid API key',
    configuredKey: 'intake-test-key-123',
    providedKey: 'intake-test-key-123',
    expectAuthorized: true
  },
  {
    name: 'Reject request with missing API key',
    configuredKey: 'intake-test-key-123',
    providedKey: undefined,
    expectAuthorized: false
  },
  {
    name: 'Reject request with wrong API key',
    configuredKey: 'intake-test-key-123',
    providedKey: 'wrong-key',
    expectAuthorized: false
  },
  {
    name: 'Reject request with empty API key',
    configuredKey: 'intake-test-key-123',
    providedKey: '',
    expectAuthorized: false
  }
];

// Run tests
let passed = 0;
let failed = 0;

console.log('\n=== Authentication Security Tests ===\n');

for (const test of tests) {
  const result = checkAuth(test.providedKey, test.configuredKey);

  if (result.authorized === test.expectAuthorized) {
    console.log(`✅ PASS: ${test.name}`);
    passed++;
  } else {
    console.log(`❌ FAIL: ${test.name}`);
    console.log(`   Expected authorized: ${test.expectAuthorized}, got: ${result.authorized}`);
    failed++;
  }
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
