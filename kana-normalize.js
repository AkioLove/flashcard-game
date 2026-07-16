const VOWEL_MAP = {
  あ: 'あ', ア: 'あ', a: 'あ',
  い: 'い', イ: 'い', i: 'い',
  う: 'う', ウ: 'う', u: 'う',
  え: 'え', エ: 'え', e: 'え',
  お: 'お', オ: 'お', o: 'お',
};

export function canonicalVowel(value) {
  const characters = String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s。、,.!?！？…〜～ー]/g, '')
    .split('');
  const vowels = characters.map((character) => VOWEL_MAP[character]).filter(Boolean);
  if (!vowels.length || vowels.length !== characters.length) return null;
  return vowels.every((vowel) => vowel === vowels[0]) ? vowels[0] : null;
}
