import { test } from 'node:test';
import assert from 'node:assert/strict';
import { biggestDrop } from '../../src/domain/admin/journey';

test('biggestDrop: overgangen der flest ikke kommer videre (antall), økninger teller ikke', () => {
  assert.equal(biggestDrop([10, 8, 8, 3, 3, 1, 0]), 3);
  assert.equal(biggestDrop([5, 6, 2]), 2);
  assert.equal(biggestDrop([4, 4, 4]), null);
  assert.equal(biggestDrop([0, 0, 0]), null);
  assert.equal(biggestDrop([]), null);
});
