// Stage-name gate for a new boxer pick. A small backstop, not a census of every real person.
// Matching ignores case, punctuation and accents. Saved fight logs do not come through here.

/** A whole token is enough: "Tyson", "Ali", "Canelo", including inside a longer name. */
const BLOCKED_TOKENS = [
  "tyson", "ali", "canelo", "mayweather", "pacquiao", "holyfield", "marciano",
  "lomachenko", "golovkin", "klitschko", "usyk", "hagler", "duran", "liston",
  "dempsey", "eubank", "calzaghe", "hatton", "mcgregor",
  "beyonce", "madonna", "rihanna", "eminem", "elvis", "oprah", "pele",
  "lebron", "messi",
  "obama", "putin", "trump", "mandela", "churchill", "biden",
] as const;

/** Contiguous token runs. "young Mike Tyson" still matches "mike tyson". */
const BLOCKED_PHRASES = [
  "mike tyson", "iron mike", "muhammad ali", "mohammed ali", "mohammad ali", "cassius clay",
  "canelo alvarez", "saul alvarez", "floyd mayweather", "manny pacquiao", "emmanuel pacquiao",
  "evander holyfield", "george foreman", "rocky marciano", "jack dempsey", "sonny liston", "joe louis",
  "sugar ray", "sugar ray robinson", "sugar ray leonard", "roberto duran", "julio cesar chavez", "julio chavez",
  "marvin hagler", "thomas hearns", "tommy hearns", "oscar de la hoya", "felix trinidad", "tito trinidad",
  "miguel cotto", "arturo gatti", "jake la motta", "jake lamotta", "naseem hamed", "prince naseem",
  "joe frazier", "smokin joe", "lennox lewis", "anthony joshua", "deontay wilder", "oleksandr usyk",
  "wladimir klitschko", "vitali klitschko", "gennady golovkin", "vasyl lomachenko", "vasiliy lomachenko",
  "naoya inoue", "terence crawford", "errol spence", "andre ward", "roy jones", "bernard hopkins",
  "nigel benn", "chris eubank", "joe calzaghe", "ricky hatton", "tyson fury", "conor mcgregor",
  "michael jordan", "lebron james", "kobe bryant", "tom brady", "tiger woods", "serena williams", "venus williams",
  "usain bolt", "lionel messi", "cristiano ronaldo", "diego maradona", "babe ruth", "wayne gretzky",
  "michael phelps", "simone biles", "bruce lee",
  "taylor swift", "elvis presley", "michael jackson", "oprah winfrey", "kanye west", "kim kardashian",
  "donald trump", "barack obama", "joe biden", "kamala harris", "vladimir putin", "winston churchill",
  "abraham lincoln", "nelson mandela", "elon musk", "brad pitt", "tom cruise", "leonardo dicaprio",
  "ariana grande", "billie eilish", "dwayne johnson", "the rock", "john cena", "hulk hogan", "bob hope",
  "will smith", "chris rock",
] as const;

// Textbook personal names: a very common given name plus a very common surname.
// Exactly two tokens, and never when either word is a ring-name word ("The Ghost", "Iron Tide").
const GIVEN_NAMES = `
john james robert michael mike william will david richard joseph thomas tom charles
christopher chris daniel matthew anthony donald steven steve paul andrew joshua kevin
brian george edward jason ryan eric stephen justin scott benjamin samuel frank alexander
patrick jack aaron adam nathan henry peter kyle walter roger arthur jesse billy bruce
joe albert alan wayne randy philip harry bob tony jimmy johnny tommy danny eddie kenny
mary patricia jennifer linda elizabeth barbara susan jessica sarah karen nancy lisa
betty sandra ashley emily donna michelle carol amanda melissa deborah stephanie rebecca
laura amy angela anna brenda pamela emma nicole helen samantha rachel diane victoria
kelly lauren megan andrea hannah alice julia grace madison marilyn diana natalie
abigail jane olivia
`;

const SURNAMES = `
smith johnson williams brown jones garcia miller davis rodriguez martinez hernandez
lopez gonzalez wilson anderson thomas taylor moore jackson martin lee perez thompson
white harris sanchez clark ramirez lewis robinson walker young allen king wright scott
torres nguyen hill flores green adams nelson baker hall rivera campbell mitchell carter
roberts gomez phillips evans turner diaz parker cruz edwards collins reyes stewart morris
murphy cook rogers morgan cooper bailey reed kelly howard cox richardson watson brooks
wood james gray hughes price long ross foster sanders myers doe bloggs
`;

const STAGE_WORDS = `
the iron ghost tide hammer silk buzzsaw kid big mad steel storm shadow thunder
night wolf ring sugar rocky fury bolt swift
`;

const HONORIFICS = new Set(["mr", "mrs", "ms", "miss", "dr", "sir", "lord", "lady"]);
const SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv"]);

const blockedTokens = new Set<string>(BLOCKED_TOKENS);
const blockedPhrases = new Set<string>(BLOCKED_PHRASES);
const givenNames = wordSet(GIVEN_NAMES);
const surnames = wordSet(SURNAMES);
const stageWords = wordSet(STAGE_WORDS);

function wordSet(words: string): Set<string> {
  return new Set(words.trim().split(/\s+/).filter((word) => word.length > 0));
}

function coreTokens(name: string): string[] {
  const folded = name
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  if (!folded) return [];
  const tokens = folded.split(" ").filter((token) => token.length > 0 && !HONORIFICS.has(token));
  while (tokens.length > 1 && SUFFIXES.has(tokens[tokens.length - 1] ?? "")) tokens.pop();
  return tokens;
}

function containsPhrase(tokens: string[]): boolean {
  const joined = ` ${tokens.join(" ")} `;
  for (const phrase of blockedPhrases) {
    if (joined.includes(` ${phrase} `)) return true;
  }
  return false;
}

function looksLikeCommonPersonalName(tokens: string[]): boolean {
  if (tokens.length !== 2) return false;
  const first = tokens[0];
  const last = tokens[1];
  if (!first || !last || first.length < 2 || last.length < 2) return false;
  if (stageWords.has(first) || stageWords.has(last)) return false;
  return givenNames.has(first) && surnames.has(last);
}

/** True when this display name is a known real person or a textbook first-and-last name. */
export function usesRealPersonName(name: string): boolean {
  const tokens = coreTokens(name);
  if (tokens.length === 0) return false;
  if (tokens.some((token) => blockedTokens.has(token))) return true;
  if (containsPhrase(tokens)) return true;
  return looksLikeCommonPersonalName(tokens);
}
