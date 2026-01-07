/**
 * Security Tests: Input Validation
 *
 * Tests that HTTP API properly validates input.
 * Run with: npx tsx tests/security/input-validation.test.ts
 */

import { z } from 'zod';

// Input validation schemas (copied from http/server.ts)
const CheckInputSchema = z.object({
  content: z.string().optional(),
  content_type: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
  file_path: z.string().optional()
}).refine(data => data.content || data.file_path, {
  message: 'Either content or file_path is required'
});

const AdmitInputSchema = z.object({
  content_hash: z.string().min(1),
  override: z.boolean().optional(),
  override_reason: z.string().optional(),
  destination: z.string().optional()
});

const ConfigInputSchema = z.object({
  auto_admit_max: z.number().min(0).max(100).optional(),
  review_recommended_max: z.number().min(0).max(100).optional(),
  review_required_max: z.number().min(0).max(100).optional()
});

// Test cases
interface TestCase {
  name: string;
  schema: z.ZodSchema;
  input: unknown;
  shouldFail: boolean;
}

const tests: TestCase[] = [
  // CheckInputSchema tests
  {
    name: 'Check: Valid content input',
    schema: CheckInputSchema,
    input: { content: 'test content' },
    shouldFail: false
  },
  {
    name: 'Check: Valid file_path input',
    schema: CheckInputSchema,
    input: { file_path: '/path/to/file' },
    shouldFail: false
  },
  {
    name: 'Check: Reject empty object',
    schema: CheckInputSchema,
    input: {},
    shouldFail: true
  },
  {
    name: 'Check: Reject non-string content',
    schema: CheckInputSchema,
    input: { content: 12345 },
    shouldFail: true
  },
  {
    name: 'Check: Reject array content',
    schema: CheckInputSchema,
    input: { content: ['test'] },
    shouldFail: true
  },

  // AdmitInputSchema tests
  {
    name: 'Admit: Valid input',
    schema: AdmitInputSchema,
    input: { content_hash: 'abc123' },
    shouldFail: false
  },
  {
    name: 'Admit: Reject empty content_hash',
    schema: AdmitInputSchema,
    input: { content_hash: '' },
    shouldFail: true
  },
  {
    name: 'Admit: Reject missing content_hash',
    schema: AdmitInputSchema,
    input: { override: true },
    shouldFail: true
  },
  {
    name: 'Admit: Reject non-boolean override',
    schema: AdmitInputSchema,
    input: { content_hash: 'abc123', override: 'true' },
    shouldFail: true
  },

  // ConfigInputSchema tests
  {
    name: 'Config: Valid thresholds',
    schema: ConfigInputSchema,
    input: { auto_admit_max: 30, review_recommended_max: 70 },
    shouldFail: false
  },
  {
    name: 'Config: Reject negative values',
    schema: ConfigInputSchema,
    input: { auto_admit_max: -1 },
    shouldFail: true
  },
  {
    name: 'Config: Reject values over 100',
    schema: ConfigInputSchema,
    input: { auto_admit_max: 150 },
    shouldFail: true
  },
  {
    name: 'Config: Reject string numbers',
    schema: ConfigInputSchema,
    input: { auto_admit_max: '30' },
    shouldFail: true
  }
];

// Run tests
let passed = 0;
let failed = 0;

console.log('\\n=== Input Validation Security Tests ===\\n');

for (const test of tests) {
  try {
    test.schema.parse(test.input);
    if (test.shouldFail) {
      console.log(`❌ FAIL: ${test.name}`);
      console.log(`   Expected validation error but input was accepted`);
      failed++;
    } else {
      console.log(`✅ PASS: ${test.name}`);
      passed++;
    }
  } catch (error) {
    if (test.shouldFail) {
      console.log(`✅ PASS: ${test.name}`);
      passed++;
    } else {
      console.log(`❌ FAIL: ${test.name}`);
      console.log(`   Unexpected error: ${(error as Error).message}`);
      failed++;
    }
  }
}

console.log(`\\n=== Results: ${passed} passed, ${failed} failed ===\\n`);
process.exit(failed > 0 ? 1 : 0);
