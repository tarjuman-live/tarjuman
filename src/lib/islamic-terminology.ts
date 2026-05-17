/**
 * Shared Islamic-terminology rules + few-shot examples used by both the
 * /api/translate and /api/summarize prompts.
 *
 * Why a shared module:
 *   The whole reason this app uses an LLM (instead of Google Translate) is
 *   to preserve Islamic vocabulary correctly. The translate route runs per
 *   transcript segment; the summarize route runs once at the end. Both must
 *   apply the same vocabulary rules — keeping them in one place prevents
 *   drift.
 *
 * Why this is long:
 *   Anthropic's prompt-cache thresholds are 1024 tokens (Sonnet) and 2048
 *   tokens (Haiku). A short prompt would be re-billed at full price every
 *   call. By making the rules+examples block comfortably exceed both
 *   thresholds, every recording session after the first call pays roughly
 *   1/10th the input cost — and the prompt is *better* for it because the
 *   model has more in-context examples and structured guidance.
 */

export const ISLAMIC_TERMINOLOGY_RULES = `
## Methodology and creed framing

This app's audience is Sunni Muslims following the methodology (manhaj) of the Salaf as-Salih (the righteous predecessors — the first three generations of Muslims). All Islamic content must be interpreted within the framework of Ahl as-Sunnah wal-Jama'ah ('aqeedah and fiqh), avoiding sectarian, modernist, or innovative readings.

When a phrase has multiple sectarian readings (e.g., Sunni vs Shia, Salafi vs Sufi, Mu'tazili, etc.), render the authentic Sunni Salafi reading and use the corresponding terminology. Do not soften, secularize, or generalize theological concepts to fit a non-Muslim audience — the audience is Muslim and expects authentic Islamic English (or the equivalent in the target language).

## Source-language agnostic

These rules apply REGARDLESS of source language. They fire whenever Islamic content appears in the input, whether the speaker is using Arabic, English, Urdu, Turkish, Bahasa, French, or any other language. An English-language lecture about Islam being translated to Urdu still requires preserving "Allah", "Salah", "Sabr", honorifics, and authentic Quranic/hadith renderings in the target.

## Islamic terminology rules

The audience expects target-language text that uses the conventional Islamic vocabulary, NOT flattened generic translations.

### Rule 1 — Divine names and honorifics: NEVER translate these to generic equivalents.

- "Allah" — never "God." Always Allah.
- "Allahu Akbar" — preserve verbatim.
- "Subhan'Allah" / "Subhanahu wa Ta'ala" — preserve. If the speaker says "سبحانه وتعالى" inline, write "(Subhanahu wa Ta'ala)" or its abbreviation "(SWT)" after Allah.
- "Alhamdulillah" — preserve.
- "Bismillah" — preserve. If the full "بسم الله الرحمن الرحيم" is spoken, render as "Bismillahir Rahmanir Raheem" or "In the name of Allah, the Most Gracious, the Most Merciful."
- "Astaghfirullah" — preserve.
- "La ilaha illa Allah" — preserve, do not translate to "There is no god but God."
- "Mashaa'Allah", "Inshaa'Allah", "Barakallahu feek" — preserve verbatim.
- The honorific ﷺ (Sallallahu Alayhi Wa Sallam) follows the Prophet Muhammad's name. Always include either the symbol "ﷺ" or "(peace be upon him)" / "(PBUH)" after every mention of the Prophet.
- Other prophets get "(peace be upon him)" or "(a.s.)" / "(عليه السلام)": Ibrahim (a.s.), Musa (a.s.), Isa (a.s.), etc. Do NOT use Anglicized names (Abraham, Moses, Jesus) when the speaker used Arabic names.

### Rule 2 — Quranic verses and Hadith: cite authentically with sunnah.com numbering, but ONLY when 100% certain.

This is the most important rule for source-fidelity. Read carefully.

**Citation format — ALWAYS use parentheses, NEVER brackets:**
- Quran: \`(Quran SurahName:AyahNumber)\` — e.g., \`(Quran Al-Baqarah:255)\`
- Hadith: \`(CollectionName Number)\` using **sunnah.com numbering** — e.g., \`(Sahih al-Bukhari 3367)\`, \`(Sahih Muslim 2009)\`, \`(Sunan at-Tirmidhi 2344)\`

NO comma, NO "Hadith" word, NO brackets — match sunnah.com's URL convention exactly.

**For Quranic verses** that you recognize with **100% certainty** as the exact wording of a known ayah:
- For English target: render Muhsin Khan's translation (the Salafi-preferred English rendering).
- For other-language target: render the most widely-accepted Salafi-approved translation conventional for that language. Examples: Urdu → Fateh Muhammad Jalandhary or Mahmood al-Hasan; Indonesian → Tafsir Departemen Agama or Hilali-Khan equivalent.
- Add the inline reference \`(Quran SurahName:AyahNumber)\`. Use the standard English transliteration of the surah name (Al-Baqarah, Al-Imran, Al-Kahf, etc.).
- If the speaker themself stated the surah/ayah ("Surah Al-Baqarah, ayah 255"), preserve their reference instead of duplicating.

**For Hadith** that you recognize with **100% certainty** from one of the six canonical Sunni collections (or Muwatta Malik / Musnad Ahmad when the narration is well-known and unambiguously attributed):

| Collection | Citation prefix | sunnah.com URL slug |
|---|---|---|
| Sahih al-Bukhari | \`Sahih al-Bukhari\` | bukhari |
| Sahih Muslim | \`Sahih Muslim\` | muslim |
| Sunan Abu Dawud | \`Sunan Abi Dawud\` | abudawud |
| Jami' at-Tirmidhi | \`Sunan at-Tirmidhi\` | tirmidhi |
| Sunan an-Nasa'i | \`Sunan an-Nasa'i\` | nasai |
| Sunan Ibn Majah | \`Sunan Ibn Majah\` | ibnmajah |
| Muwatta Malik | \`Muwatta Malik\` | malik |
| Musnad Ahmad | \`Musnad Ahmad\` | ahmad |

**Citation priority** (when the same hadith is in multiple collections): Bukhari > Muslim > Sunan (any) > Muwatta / Ahmad. Cite the single highest-priority source.

- Translate using a well-accepted English rendering (or the equivalent authentic translation in the target language).
- Format: \`(Sahih al-Bukhari 3367)\` — no "Hadith" word, just collection + number, sunnah.com style.
- Do NOT cite from collections outside Ahl as-Sunnah (no Shia collections, no Sufi attributions).

**Hard rule — fabrication is forbidden:**
If you do NOT recognize the exact wording with full certainty, if you cannot pin a specific surah:ayah, if you cannot identify the specific hadith book AND number — DO NOT add a reference. Translate the phrase literally as the speaker said it without claiming a source. **Fabricated citations are strictly worse than missing ones.** A translation with no reference is honest; a translation with a wrong reference misleads the audience.

If you recognize the hadith narration but are uncertain of the exact number, cite the collection alone: \`(Sahih al-Bukhari)\`. Never invent a number.

**Server-side verification:** Your citations are verified after you respond:
- **Hadith** citations are checked against **sunnah.com**. Verified hadith → user sees sunnah.com's canonical English + a clickable link. Hallucinated hadith numbers → citation is STRIPPED before the user sees it.
- **Quran** citations are checked against **quran.com**. Verified verses with an English target → user sees Muhsin Khan's canonical translation + a clickable link to quran.com. Hallucinated surah:ayah numbers → citation is STRIPPED.

So: when in doubt about an exact hadith number or surah:ayah, omit the citation entirely. A correctly-cited verse becomes the canonical authoritative text in the user's transcript; a wrongly-cited one disappears.

**Famous formulaic phrases** that are well-known and unambiguous:
- إنا لله وإنا إليه راجعون → "Indeed, to Allah we belong and to Him we shall return" \`(Quran Al-Baqarah:156)\`
- بسم الله الرحمن الرحيم → "In the name of Allah, the Most Gracious, the Most Merciful" (Quranic header — citation optional)
- لا حول ولا قوة إلا بالله → "There is no power and no might except with Allah" (du'a, not a verse — no citation)
- الحمد لله رب العالمين → "All praise is due to Allah, Lord of the worlds" \`(Quran Al-Fatihah:2)\`

### Rule 3 — Worship, ritual, and fiqh terms: preserve transliterations.

Do NOT translate any of these to a generic English equivalent. Use the transliteration. The audience knows these words.

Worship & ritual:
- Salah / Salat (the five daily prayers) — not "prayer"
- Wudu (ablution before prayer)
- Ghusl (full ritual washing)
- Tayammum (dry ablution)
- Sajdah / Sujood (prostration)
- Ruku (bowing)
- Rakah (a unit of prayer)
- Adhan (call to prayer) — not "the call"
- Iqamah (second call before prayer starts)
- Imam (prayer leader)
- Mu'adhin (the one calling the adhan)
- Khutbah (sermon)
- Tarawih, Witr, Tahajjud (specific prayers)
- Niyyah (intention)

Fiqh categorizations:
- Halal (permissible) — preserve, gloss only on first use
- Haram (forbidden) — same
- Makruh (disliked)
- Mustahabb (recommended)
- Wajib (obligatory)
- Fard (obligatory — fard ayn vs fard kifayah are technical distinctions worth preserving when used)
- Sunnah Muakkadah (emphasized) / Ghair Muakkadah (non-emphasized)

### Rule 4 — Concepts, character, eschatology: preserve.

- Iman (faith)
- Taqwa (God-consciousness)
- Tawheed (oneness of Allah)
- Shirk (associating partners with Allah)
- Sabr (patience)
- Shukr (gratitude)
- Tawakkul (reliance on Allah)
- Tawbah (repentance)
- Ikhlas (sincerity)
- Riya (showing off in worship)
- Ihsan (excellence in worship)
- Jannah (paradise) — not "heaven"
- Jahannam (hell) — not "fire" generically
- Akhirah (the hereafter)
- Dunya (this worldly life)
- Qiyamah (the Day of Judgment)
- Mizan (the scale of deeds)

### Rule 5 — Beings.

- Mala'ika (angels) — preserve when speaker uses
- Jinn — preserve
- Iblis / Shaytan — preserve, do not translate to "Satan" or "Devil"
- Mu'min (believer)
- Munafiq (hypocrite)
- Kafir (disbeliever) — preserve, do not soften
- Mushrik (one who commits shirk)

### Rule 6 — People and history.

- Sahaba / Sahabiyat (the Companions of the Prophet, male / female)
- Tabiun (the generation after the Companions)
- Ahl al-Bayt (the Prophet's household)
- Khulafa Rashidun (the Rightly Guided Caliphs)
- Sirah / Seerah (the Prophet's biography)
- Hadith (preserved sayings of the Prophet)
- Sunnah (the Prophet's example) — distinct from "sunnah" as a fiqh ruling
- Hijra (the migration to Madinah)

### Rule 7 — Pillars and events.

- Hajj (the pilgrimage)
- Umrah (the lesser pilgrimage)
- Zakat (obligatory charity)
- Sadaqah (voluntary charity)
- Fitra (charity at the end of Ramadan)
- Sawm / Siyam (fasting)
- Ramadan, Eid, Eid al-Fitr, Eid al-Adha
- Iftar (breaking the fast), Suhoor (pre-dawn meal)

### Rule 8 — Place names: prefer Arabic forms when used.

- Makkah (Mecca is also acceptable but match the speaker)
- Madinah (Medina)
- Masjid (mosque) — preserve, especially "Masjid an-Nabawi," "Masjid al-Haram," "Masjid al-Aqsa"
- Kaaba (Ka'bah) — preserve

### Rule 9 — Spelling: use the most common transliteration.

When multiple spellings exist (Quran/Qur'an, Salah/Salat, Subhan'Allah/SubhanAllah), pick the most readable common form. Be consistent within a single output.

### Rule 10 — When in doubt, preserve.

If you're uncertain whether a term is religious vocabulary the audience would expect to see in transliteration, err on the side of preserving. The audience prefers seeing "Sabr" they need to recognize over a generic "patience" that strips meaning.
`.trim();

export const ISLAMIC_FEW_SHOT_EXAMPLES = `
## Worked translation examples

These show the expected style for Arabic → English translation. Match this register and term handling.

### Example 1 — khutbah opening
Input:  الحمد لله نحمده ونستعينه ونستغفره، ونعوذ بالله من شرور أنفسنا وسيئات أعمالنا
Output: All praise is due to Allah, we praise Him, seek His help, and seek His forgiveness. We seek refuge in Allah from the evils of our souls and the wickedness of our deeds.

### Example 2 — Quranic verse with reference
Input:  قال الله تعالى في سورة البقرة: إنا لله وإنا إليه راجعون
Output: Allah (Subhanahu wa Ta'ala) said in Surah Al-Baqarah: "Indeed, to Allah we belong and to Him we shall return."

### Example 3 — fiqh sentence with multiple terms
Input:  الصلاة فرض على كل مسلم، والصدقة سنة مؤكدة
Output: Salah is fard upon every Muslim, and Sadaqah is a Sunnah Muakkadah.

### Example 4 — mention of the Prophet ﷺ with hadith citation
Input:  قال النبي محمد: إنما الأعمال بالنيات
Output: The Prophet Muhammad ﷺ said: "Actions are but by intentions." (Sahih al-Bukhari 1)

### Example 5 — common formulaic phrase
Input:  لا حول ولا قوة إلا بالله
Output: La hawla wa la quwwata illa billah (there is no power and no might except with Allah).

### Example 6 — speaker references multiple prophets
Input:  أرسل الله إبراهيم وموسى وعيسى ومحمدا
Output: Allah sent Ibrahim (a.s.), Musa (a.s.), Isa (a.s.), and Muhammad ﷺ.

### Example 7 — partial / truncated segment (live transcription artifact)
The STT engine sometimes commits a segment that ends mid-word. Translate
what is there and end with "..." — never add a parenthetical note about
the cut, never ask the user to provide the rest.
Input:  ان الحمد لله نحو
Output: All praise is due to Allah...

### Example 8 — Quranic verse recognized with certainty (Ayat al-Kursi opening)
Input:  الله لا إله إلا هو الحي القيوم
Output: Allah! La ilaha illa Huwa (none has the right to be worshipped but He), Al-Hayyul-Qayyum (the Ever Living, the One Who sustains and protects all that exists). (Quran Al-Baqarah:255)

### Example 9 — religious-sounding phrase that is NOT a Quranic verse — no fake citation
The speaker is making a personal du'a / statement using common Islamic
vocabulary, but it is not from the Quran. Translate literally with
preserved terminology. Do NOT invent a surah:ayah reference.
Input:  اللهم اجعلنا من عبادك الصالحين
Output: O Allah, make us among Your righteous servants.

### Example 10 — well-known hadith about Mount Uhud (sunnah.com numbering)
The Prophet ﷺ said this about the mountain of Uhud. Recognized verbatim
across multiple narrations; use the highest-priority canonical source.
Input:  قال النبي صلى الله عليه وسلم: أحد جبل يحبنا ونحبه
Output: The Prophet ﷺ said: "Uhud is a mountain that loves us and we love it." (Sahih al-Bukhari 4422)

### Example 11 — hadith on Tawakkul (Tirmidhi-graded hasan, well-known)
Input:  لو أنكم تتوكلون على الله حق توكله لرزقكم كما يرزق الطير
Output: "If you were to rely upon Allah with the reliance He is due, He would provide for you just as He provides for the birds — they leave in the morning lean and return in the evening full." (Sunan at-Tirmidhi 2344)

### Example 12 — hadith narration with isnad (use the matn, cite the collection)
The speaker recites the chain of narrators and the text. Translate only the
narration itself with the sunnah.com citation; the isnad doesn't appear in
the user-facing translation unless the speaker specifically discusses it.
Input:  عن عائشة رضي الله عنها قالت: قال رسول الله صلى الله عليه وسلم: من أحدث في أمرنا هذا ما ليس منه فهو رد
Output: 'A'ishah (RA) narrated that the Messenger of Allah ﷺ said: "Whoever introduces into this matter of ours something that is not from it, it is rejected." (Sahih al-Bukhari 2697)
`.trim();
