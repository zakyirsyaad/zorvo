import { describe, expect, test } from 'vitest';
import { createStartPlaces } from '../lib/start-places';

describe('createStartPlaces', () => {
  test('a place is counted until it is freed, once', () => {
    const places = createStartPlaces();
    const free = places.take('a');
    places.take('a');
    expect(places.underWay('a')).toBe(2);
    expect(places.underWay('b')).toBe(0);
    free();
    free();
    expect(places.underWay('a')).toBe(1);
  });
});
