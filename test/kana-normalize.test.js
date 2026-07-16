import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalVowel,
  matchVowelCandidates,
  recognitionVowel,
} from '../kana-normalize.js';

const cases = [
  ['あ', ['あ', 'ア', 'a', 'A', 'あー', 'ああ。']],
  ['い', ['い', 'イ', 'i', 'I', 'イー', 'ii!']],
  ['う', ['う', 'ウ', 'u', 'U', 'うー', 'UU']],
  ['え', ['え', 'エ', 'e', 'E', 'えー', 'ee']],
  ['お', ['お', 'オ', 'を', 'ヲ', 'o', 'O', 'オー', 'oo']],
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

test('normalizes safe Web Speech variations', () => {
  const cases = [
    ['あ', ['亜', '阿', 'あぁ', 'あっ']],
    ['い', ['胃', '井', '意', 'いっ']],
    ['う', ['鵜', '宇', 'うん', 'うっ']],
    ['え', ['絵', '江', 'えぇ', 'えっ']],
    ['お', ['尾', '緒', 'おぉ', 'おっ']],
  ];

  for (const [expected, inputs] of cases) {
    for (const input of inputs) assert.equal(recognitionVowel(input), expected, input);
  }
});

test('accepts the expected vowel within the first three recognition candidates', () => {
  const candidates = [
    { transcript: 'あい' },
    { transcript: '絵' },
    { transcript: 'い' },
  ];
  assert.deepEqual(matchVowelCandidates('え', candidates), {
    matched: true,
    candidate: candidates[1],
    rank: 1,
    mode: 'relaxed',
  });
  assert.equal(matchVowelCandidates('い', candidates).matched, true);
});

test('does not accept an expected vowel below rank three or inside unrelated text', () => {
  const candidates = ['hello', '愛', 'ええと', 'お'];
  assert.deepEqual(matchVowelCandidates('お', candidates), {
    matched: false,
    candidate: null,
    rank: null,
    mode: 'none',
  });
  assert.equal(recognitionVowel('ええと'), null);
  assert.equal(recognitionVowel('愛'), null);
});
