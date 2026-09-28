import { expect, test } from 'vitest';
import { decodeSegment } from './route-param';

test.each([
  ['Hip-Hop%2FRap', 'Hip-Hop/Rap'],
  ['audius%3AnD96J', 'audius:nD96J'],
  ['audius:nD96J', 'audius:nD96J'],
  ['100%', '100%'],
  ['%E0%A4%A', '%E0%A4%A'],
])('decodeSegment(%j) is %j', (segment, expected) => {
  expect(decodeSegment(segment)).toBe(expected);
});
