const VOWEL_MAP = {
  あ: 'あ', ア: 'あ', ぁ: 'あ', ァ: 'あ', a: 'あ',
  い: 'い', イ: 'い', ぃ: 'い', ィ: 'い', i: 'い',
  う: 'う', ウ: 'う', ぅ: 'う', ゥ: 'う', u: 'う',
  え: 'え', エ: 'え', ぇ: 'え', ェ: 'え', e: 'え',
  お: 'お', オ: 'お', ぉ: 'お', ォ: 'お', を: 'お', ヲ: 'お', o: 'お',
};

const RECOGNITION_ALIASES = {
  亜: 'あ', 阿: 'あ',
  胃: 'い', 井: 'い', 伊: 'い', 意: 'い',
  鵜: 'う', 宇: 'う', うん: 'う',
  絵: 'え', 江: 'え',
  尾: 'お', 緒: 'お',
};

const DECORATION_PATTERN = /[\s。、,.!?！？…〜～ー・「」『』“”‘’'"（）()【】\[\]]/g;

function clean(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(DECORATION_PATTERN, '');
}

export function canonicalVowel(value) {
  const characters = clean(value).split('');
  const vowels = characters.map((character) => VOWEL_MAP[character]).filter(Boolean);
  if (!vowels.length || vowels.length !== characters.length) return null;
  return vowels.every((vowel) => vowel === vowels[0]) ? vowels[0] : null;
}

export function recognitionVowel(value) {
  const text = clean(value);
  const withoutTrailingStop = text.replace(/[っッ]+$/g, '');
  return canonicalVowel(withoutTrailingStop) || RECOGNITION_ALIASES[text] || null;
}

export function matchVowelCandidates(expected, candidates, limit = 3) {
  const target = canonicalVowel(expected);
  const considered = Array.from(candidates || []).slice(0, limit);

  if (!target) {
    return { matched: false, candidate: null, rank: null, mode: 'none' };
  }

  for (let rank = 0; rank < considered.length; rank += 1) {
    const candidate = considered[rank];
    const transcript = typeof candidate === 'string' ? candidate : candidate?.transcript;
    const strict = canonicalVowel(transcript);
    if (strict === target) {
      return { matched: true, candidate, rank, mode: 'strict' };
    }

    if (recognitionVowel(transcript) === target) {
      return { matched: true, candidate, rank, mode: 'relaxed' };
    }
  }

  return { matched: false, candidate: null, rank: null, mode: 'none' };
}
