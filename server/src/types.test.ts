import { describe, test, expect } from 'bun:test';
import { Ok, Err } from './types';
import type { Result, FeedId, EntryId, TagId } from './types';

// ============================================================================
// GATE 1: Result type — the error handling contract
// If this fails, nothing downstream is trustworthy.
// ============================================================================

describe('Result type', () => {
  test('Ok wraps a value and marks ok: true', () => {
    const result = Ok(42);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(42);
    }
  });

  test('Err wraps an error and marks ok: false', () => {
    const result = Err('something broke');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('something broke');
    }
  });

  test('Ok(undefined) is still ok: true', () => {
    const result = Ok(undefined);
    expect(result.ok).toBe(true);
  });

  test('Ok(null) is still ok: true', () => {
    const result = Ok(null);
    expect(result.ok).toBe(true);
  });

  test('Result discriminant narrows correctly in control flow', () => {
    const fn = (succeed: boolean): Result<number, string> =>
      succeed ? Ok(1) : Err('no');

    const good = fn(true);
    const bad = fn(false);

    // TypeScript narrows — this is a compile-time check as much as runtime
    if (good.ok) {
      const _v: number = good.value;
      expect(_v).toBe(1);
    } else {
      throw new Error('Should be Ok');
    }

    if (!bad.ok) {
      const _e: string = bad.error;
      expect(_e).toBe('no');
    } else {
      throw new Error('Should be Err');
    }
  });

  test('Err with structured error objects', () => {
    const result = Err({ code: 404, message: 'not found' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(404);
      expect(result.error.message).toBe('not found');
    }
  });
});

// ============================================================================
// GATE 2: Branded types — compile-time safety
// These tests exist primarily to document the contract. The real safety is
// at the type level, but we verify the runtime shape here.
// ============================================================================

describe('Branded ID types', () => {
  test('branded IDs are just numbers at runtime', () => {
    const feedId = 1 as FeedId;
    const entryId = 1 as EntryId;
    const tagId = 1 as TagId;

    expect(typeof feedId).toBe('number');
    expect(typeof entryId).toBe('number');
    expect(typeof tagId).toBe('number');

    // They ARE numbers — arithmetic works
    expect(feedId + 1).toBe(2);
  });

  test('branded IDs with the same number are !== at type level but === at runtime', () => {
    const feedId = 42 as FeedId;
    const entryId = 42 as EntryId;

    // Runtime: same value
    expect(feedId as number).toBe(entryId as number);

    // The type system prevents this in real code:
    // const _bad: FeedId = entryId; // TS error
    // But at runtime they're identical — the brand is erased
  });
});
