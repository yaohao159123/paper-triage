import test from 'node:test';
import assert from 'node:assert/strict';
import { profileHash, ensureProfiles, activeProfile, DEFAULT_PROFILE, linesToList } from '../src/shared/profile.js';

test('profileHash is stable, 8 hex chars, and changes with any judgment field but not with name/id', () => {
  const a = profileHash({ ...DEFAULT_PROFILE, id: 'x', name: 'A' });
  const b = profileHash({ ...DEFAULT_PROFILE, id: 'y', name: 'B' });
  assert.match(a, /^[0-9a-f]{8}$/);
  assert.equal(a, b);
  assert.notEqual(a, profileHash({ ...DEFAULT_PROFILE, materials: [...DEFAULT_PROFILE.materials, 'slag foam'] }));
  assert.notEqual(a, profileHash({ ...DEFAULT_PROFILE, summary: 'other' }));
});

test('ensureProfiles migrates a legacy single profile and picks a valid active id', () => {
  const legacy = { profile: { ...DEFAULT_PROFILE, summary: 'legacy' } };
  const { profiles, activeProfileId } = ensureProfiles(legacy);
  assert.equal(profiles.length, 1);
  assert.equal(profiles[0].id, 'default');
  assert.equal(profiles[0].summary, 'legacy');
  assert.equal(activeProfileId, 'default');
  const multi = { profiles: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], activeProfileId: 'zzz' };
  assert.equal(ensureProfiles(multi).activeProfileId, 'a');
  assert.equal(activeProfile({ ...multi, activeProfileId: 'b' }).name, 'B');
  assert.equal(ensureProfiles({}).profiles[0].core_topics.length, DEFAULT_PROFILE.core_topics.length);
});

test('linesToList splits on newlines and semicolons', () => {
  assert.deepEqual(linesToList(' a \nb;c\n\n'), ['a', 'b', 'c']);
});
