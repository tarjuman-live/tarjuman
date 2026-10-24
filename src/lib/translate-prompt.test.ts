import { describe, it, expect } from "vitest";
import {
  routeModel,
  MODEL_HAIKU,
  MODEL_SONNET,
  parseMergeDirective,
  shouldFilterAsNoise,
  MERGE_MARKER,
  type TranslateContextEntry,
} from "./translate-prompt";

// The routing tests below are a REGRESSION GATE, not a description of desired
// behavior in the abstract. The Sonnet escalation they lock out was removed on
// measured evidence (bench/translate-model-compare.ts, n=60/model): Sonnet
// scored ~5pp HIGHER overall, but its entire edge was merge behavior (cosmetic
// card-splitting), while it fabricated 6 citations and misattributed 4 where
// Haiku did neither — at 4x the latency.
//
// Misattribution is the error class the downstream verifier CANNOT catch — a
// citation whose number exists resolves `found` and gets canonical text
// attached, publishing the wrong verse with full authority. So "escalate to the
// bigger model for citation accuracy" is not a safe intuition to act on here,
// and a future edit that quietly restores it should fail these tests first.

describe("routeModel — never escalates (verifier-first)", () => {
  const citationContext: TranslateContextEntry[] = [
    {
      id: "s1",
      sourceText: "قال رسول الله صلى الله عليه وسلم إنما الأعمال بالنيات",
      translatedText:
        "The Messenger of Allah ﷺ said: Actions are but by intentions. (Sahih al-Bukhari 1)",
    },
  ];

  const cases: Array<[string, string, TranslateContextEntry[] | undefined]> = [
    ["plain Arabic prose", "فإن التقوى خير زاد ليوم المعاد", undefined],
    // Each of these tripped a marker in the old router.
    ["Arabic hadith opener", "قال النبي صلى الله عليه وسلم", undefined],
    ["Arabic isnad opener", "حدثنا أبو بكر عن أنس", undefined],
    ["Arabic Quran opener", "قال الله تعالى في كتابه الكريم", undefined],
    ["a passing surah reference", "هذا مذكور في سورة البقرة", undefined],
    [
      "English hadith marker",
      "The Prophet Muhammad said to his companions",
      undefined,
    ],
    ["English Quran marker", "Allah says in Surah Al-Baqarah", undefined],
    // THE LATCH: ordinary prose whose only sin is following a citation. This is
    // what put most of a khutbah session on the slow model.
    [
      "prose after a cited hadith (the latch)",
      "وهذا الحديث أصل عظيم",
      citationContext,
    ],
    [
      "prose after a cited verse (the latch)",
      "فينبغي للمسلم أن يصبر عند المصيبة",
      [
        {
          id: "s1",
          sourceText: "إنا لله وإنا إليه راجعون",
          translatedText:
            "Truly, to Allah we belong and to Him we return. (Quran Al-Baqarah:156)",
        },
      ],
    ],
  ];

  for (const [label, text, context] of cases) {
    it(`routes ${label} to Haiku`, () => {
      expect(routeModel(text, context)).toBe(MODEL_HAIKU);
    });
  }

  it("never returns Sonnet for any input", () => {
    for (const [, text, context] of cases) {
      expect(routeModel(text, context)).not.toBe(MODEL_SONNET);
    }
  });
});

describe("parseMergeDirective — hallucinated ids can never merge", () => {
  const valid = new Set(["seg-1", "seg-2"]);

  const directive = (fromIds: string[]) =>
    `The translation.\n${MERGE_MARKER}\n${JSON.stringify({
      fromIds,
      combinedSourceText: "النص العربي الكامل",
      combinedTranslatedText: "The full translation. (Quran Al-Baqarah:156)",
    })}`;

  it("keeps only ids the client actually sent as context", () => {
    const out = parseMergeDirective(directive(["seg-1", "seg-99"]), valid);
    expect(out.translation).toBe("The translation.");
    expect(out.merge?.fromIds).toEqual(["seg-1"]);
  });

  it("drops the merge entirely when every id is hallucinated", () => {
    const out = parseMergeDirective(directive(["seg-98", "seg-99"]), valid);
    expect(out.merge).toBeUndefined();
    // The plain translation must survive — a bad merge never costs the segment.
    expect(out.translation).toBe("The translation.");
  });

  it("falls back to the plain translation on malformed merge JSON", () => {
    const out = parseMergeDirective(
      `The translation.\n${MERGE_MARKER}\n{not valid json`,
      valid,
    );
    expect(out.merge).toBeUndefined();
    expect(out.translation).toBe("The translation.");
  });

  it("returns the whole output as translation when no marker is present", () => {
    const out = parseMergeDirective("Just a translation.", valid);
    expect(out.translation).toBe("Just a translation.");
    expect(out.merge).toBeUndefined();
  });
});

describe("shouldFilterAsNoise — two-word dhikr is never dropped", () => {
  // The primary use case. A stricter word-count threshold silently deleted
  // these from the transcript, which is the worst failure this app can have.
  for (const dhikr of ["الله أكبر", "سبحان الله", "الحمد لله"]) {
    it(`keeps "${dhikr}"`, () => {
      expect(shouldFilterAsNoise(dhikr, "ar").filter).toBe(false);
    });
  }

  it("drops a single isolated word", () => {
    expect(shouldFilterAsNoise("اجمعين", "ar").filter).toBe(true);
  });

  it("drops empty input", () => {
    expect(shouldFilterAsNoise("   ", "ar").filter).toBe(true);
  });
});

describe("shouldFilterAsNoise — repeated-token hallucination", () => {
  it("drops one token repeated three or more times", () => {
    expect(shouldFilterAsNoise("الله الله الله", "ar")).toEqual({
      filter: true,
      reason: "repeated-token",
    });
    expect(shouldFilterAsNoise("نعم، نعم، نعم، نعم.", "ar").filter).toBe(true);
  });
  it("keeps genuine repeated dhikr (two or more distinct tokens)", () => {
    expect(shouldFilterAsNoise("الله أكبر الله أكبر", "ar").filter).toBe(false);
    expect(shouldFilterAsNoise("سبحان الله سبحان الله", "ar").filter).toBe(false);
  });
  it("keeps a two-word repeat (not enough signal to call it noise)", () => {
    expect(shouldFilterAsNoise("الله الله", "ar").filter).toBe(false);
  });
});
