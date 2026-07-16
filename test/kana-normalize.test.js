import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalVowel } from '../kana-normalize.js';

const cases = [
  ['あ', ['あ', 'ア', 'a', 'A', 'あー', 'ああ。']],
  ['い', ['い', 'イ', 'i', 'I', 'イー', 'ii!']],
  ['う', ['う', 'ウ', 'u', 'U', 'うー', 'UU']],
  ['え', ['え', 'エ', 'e', 'E', 'えー', 'ee']],
  ['お', ['お', 'オ', 'o', 'O', 'オー', 'oo']],
];

for (const [expected, inputs] of cases) {
  test(`normalizes hiragana, katakana, and romaji to ${expected}`, () => {
    for (const input of inputs) assert.equal(canonicalVowel(input), expected, input);
  });
}

test('does not accept words or mixed vowels', () => {
  for (const input of ['', 'ai', 'あい', '愛', 'hello']) {
    assert.equal(canonicalVowel(input), null, input);
  }
});
