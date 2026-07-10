import assert from 'node:assert/strict';
import test from 'node:test';
import { generateAppleScript } from './removeItem.js';

test('removeItem requires an identifier', () => {
  const script = generateAppleScript({ itemType: 'task' });
  assert.match(script, /Either id or name must be provided/);
});

test('removeItem rejects ambiguous name matches instead of deleting the first one', () => {
  const script = generateAppleScript({ name: 'Review', itemType: 'task' });

  // Counts matches rather than grabbing `first ... where name`
  assert.match(script, /set nameMatches to \(flattened tasks where name = "Review"\)/);
  assert.match(script, /set nameMatchCount to count of nameMatches/);
  assert.match(script, /if nameMatchCount = 1 then/);
  assert.match(script, /else if nameMatchCount > 1 then/);
  assert.match(script, /Ambiguous task name: Review\. Multiple matches found; please use id\./);

  // Must NOT silently delete an arbitrary first name match
  assert.doesNotMatch(script, /set foundItem to first flattened task where name =/);
});

test('removeItem duplicate guard applies to projects too', () => {
  const script = generateAppleScript({ name: 'Website', itemType: 'project' });
  assert.match(script, /set nameMatches to \(flattened projects where name = "Website"\)/);
  assert.match(script, /Ambiguous project name: Website/);
  assert.doesNotMatch(script, /set foundItem to first flattened project where name =/);
});

test('removeItem by id resolves by id only (no silent name fallback)', () => {
  const script = generateAppleScript({ id: 'abc123', name: 'Review', itemType: 'task' });

  // id lookup present
  assert.match(script, /set foundItem to first flattened task where id = "abc123"/);
  // when id is supplied, name must NOT be used to resolve — a stale id must surface
  // as "not found", never delete a same-named item
  assert.doesNotMatch(script, /where name = "Review"/);
  assert.doesNotMatch(script, /nameMatches/);
});

test('removeItem escapes quotes in identifiers', () => {
  const script = generateAppleScript({ name: 'a "b" c', itemType: 'task' });
  assert.match(script, /where name = "a \\"b\\" c"/);
});
