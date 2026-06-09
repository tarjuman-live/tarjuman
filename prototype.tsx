// @ts-nocheck
// Visual prototype / source of truth — see CLAUDE.md. Not part of the build.
import { useState, useEffect, useRef } from "react";

// ── Sample Data ──
const SAMPLE_SEGMENTS = [
  { id: "1", sourceText: "بسم الله الرحمن الرحيم", translatedText: "In the name of Allah, the Most Gracious, the Most Merciful", timestamp: 0 },
  { id: "2", sourceText: "الحمد لله رب العالمين والصلاة والسلام على أشرف الأنبياء والمرسلين", translatedText: "All praise is due to Allah, Lord of the worlds, and peace and blessings be upon the noblest of prophets and messengers", timestamp: 4 },
  { id: "3", sourceText: "نبينا محمد وعلى آله وصحبه أجمعين", translatedText: "Our Prophet Muhammad, and upon his family and all of his companions", timestamp: 10 },
  { id: "4", sourceText: "أما بعد، فإن أصدق الحديث كتاب الله", translatedText: "To proceed, indeed the most truthful speech is the Book of Allah", timestamp: 14 },
  { id: "5", sourceText: "وخير الهدي هدي محمد صلى الله عليه وسلم", translatedText: "And the best guidance is the guidance of Muhammad, peace and blessings be upon him", timestamp: 19 },
  { id: "6", sourceText: "أيها المسلمون، إن التقوى هي وصية الله للأولين والآخرين", translatedText: "O Muslims, indeed taqwa (God-consciousness) is the advice of Allah to the first and the last of people", timestamp: 24 },
  { id: "7", sourceText: "قال الله تعالى: ولقد وصينا الذين أوتوا الكتاب من قبلكم وإياكم أن اتقوا الله", translatedText: "Allah the Most High said: And We have instructed those who were given the Scripture before you and yourselves to fear Allah", timestamp: 30 },
  { id: "8", sourceText: "فاتقوا الله عباد الله حق تقاته ولا تموتن إلا وأنتم مسلمون", translatedText: "So fear Allah, O servants of Allah, as He should truly be feared, and do not die except as Muslims", timestamp: 37 },
  { id: "9", sourceText: "إن الله يأمر بالعدل والإحسان وإيتاء ذي القربى", translatedText: "Indeed, Allah orders justice and good conduct and giving to relatives", timestamp: 44 },
  { id: "10", sourceText: "وينهى عن الفحشاء والمنكر والبغي يعظكم لعلكم تذكرون", translatedText: "And He forbids immorality and bad conduct and oppression. He admonishes you that perhaps you will be reminded", timestamp: 50 },
];

const SAMPLE_SUMMARY = `**Main Topic**
A Friday khutbah emphasizing the importance of taqwa (God-consciousness) as the central advice of Allah to all of humanity, from the earliest nations to the present.

**Key Points**
• Taqwa is described as the advice of Allah to all people throughout history — not a new concept but an eternal command
• The khateeb references Surah An-Nisa (4:131) to establish that this advice was given to previous nations as well as the current Ummah
• Allah commands justice (al-'adl), excellence (al-ihsan), and generosity toward relatives
• Allah forbids immorality (al-fahsha'), evil conduct (al-munkar), and transgression (al-baghy)

**Takeaways**
• Taqwa is not merely ritual worship — it encompasses justice, good conduct, and social responsibility
• The believer should strive to not die except in a state of Islam (submission to Allah)

**Notable Quotes**
• "Indeed the most truthful speech is the Book of Allah, and the best guidance is the guidance of Muhammad ﷺ"`;

const PAST_SESSIONS = [
  { id: "s1", title: "Jumu'ah Khutbah — Masjid An-Nabawi", source: "ar", target: "en", duration: 1832, date: "2026-04-18", hasSummary: true, segments: 47 },
  { id: "s2", title: "Tafseer Class — Surah Al-Kahf", source: "ar", target: "en", duration: 2540, date: "2026-04-16", hasSummary: true, segments: 83 },
  { id: "s3", title: "Fiqh of Salah — Part 3", source: "ar", target: "ur", duration: 1920, date: "2026-04-14", hasSummary: false, segments: 62 },
  { id: "s4", title: "Conference Talk — AI & Ethics", source: "en", target: "ar", duration: 960, date: "2026-04-10", hasSummary: true, segments: 38 },
];

const LANGUAGES = [
  { code: "ar", name: "Arabic", native: "العربية", rtl: true },
  { code: "en", name: "English", native: "English", rtl: false },
  { code: "fr", name: "French", native: "Français", rtl: false },
  { code: "ur", name: "Urdu", native: "اردو", rtl: true },
  { code: "tr", name: "Turkish", native: "Türkçe", rtl: false },
  { code: "ms", name: "Malay", native: "Bahasa Melayu", rtl: false },
  { code: "id", name: "Indonesian", native: "Indonesia", rtl: false },
  { code: "es", name: "Spanish", native: "Español", rtl: false },
  { code: "bn", name: "Bengali", native: "বাংলা", rtl: false },
  { code: "hi", name: "Hindi", native: "हिन्दी", rtl: false },
  { code: "so", name: "Somali", native: "Soomaali", rtl: false },
  { code: "sw", name: "Swahili", native: "Kiswahili", rtl: false },
];

function formatDuration(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function formatDate(d) {
  return new Date(d + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function getLangName(code) {
  return LANGUAGES.find(l => l.code === code)?.name || code;
}

function isRtl(code) {
  return LANGUAGES.find(l => l.code === code)?.rtl || false;
}

// ── Colors ──
const c = {
  bg: "#060B18", surface: "#0E1525", surfaceLight: "#151D30",
  border: "rgba(255,255,255,0.06)", borderLight: "rgba(255,255,255,0.1)",
  accent: "#2ECC71", accentDk: "#22A85A", accentSoft: "rgba(46,204,113,0.1)",
  red: "#EF4444", redSoft: "rgba(239,68,68,0.1)",
  amber: "#F59E0B", amberSoft: "rgba(245,158,11,0.1)",
  blue: "#3B82F6", blueSoft: "rgba(59,130,246,0.1)",
  w: "#F0F4F8", t2: "#B0BEC5", t3: "#6B7D8D", t4: "#455A64",
};

export default function TarjumanPrototype() {
  const [view, setView] = useState("record"); // record | history | session
  const [recState, setRecState] = useState("idle"); // idle | recording | paused | completed
  const [sourceLang, setSourceLang] = useState("ar");
  const [targetLang, setTargetLang] = useState("en");
  const [segments, setSegments] = useState([]);
  const [interimText, setInterimText] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [showSummary, setShowSummary] = useState(false);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summary, setSummary] = useState("");
  const [selectedSession, setSelectedSession] = useState(null);
  const [showLangPicker, setShowLangPicker] = useState(null); // "source" | "target" | null
  const [pulsePhase, setPulsePhase] = useState(0);
  const transcriptRef = useRef(null);
  const simIndex = useRef(0);
  const elapsedRef = useRef(0);

  // Simulate recording
  useEffect(() => {
    if (recState !== "recording") return;
    const timer = setInterval(() => setElapsed(e => {
      const next = e + 1;
      elapsedRef.current = next;
      return next;
    }), 1000);
    return () => clearInterval(timer);
  }, [recState]);

  // Simulate transcript segments appearing
  useEffect(() => {
    if (recState !== "recording") return;
    const interval = setInterval(() => {
      if (simIndex.current < SAMPLE_SEGMENTS.length) {
        const seg = SAMPLE_SEGMENTS[simIndex.current];
        // Show interim first
        setInterimText(seg.sourceText.substring(0, Math.floor(seg.sourceText.length * 0.6)) + "...");
        setTimeout(() => {
          setInterimText("");
          setSegments(prev => [...prev, { ...seg, timestamp: elapsedRef.current }]);
          simIndex.current += 1;
        }, 1200);
      }
    }, 4500);
    return () => clearInterval(interval);
  }, [recState]);

  // Pulse animation
  useEffect(() => {
    if (recState !== "recording") return;
    const t = setInterval(() => setPulsePhase(p => (p + 1) % 3), 600);
    return () => clearInterval(t);
  }, [recState]);

  // Auto-scroll transcript
  useEffect(() => {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [segments, interimText]);

  const startRecording = () => {
    setRecState("recording");
    setSegments([]);
    setElapsed(0);
    setSummary("");
    setShowSummary(false);
    simIndex.current = 0;
  };

  const pauseRecording = () => setRecState("paused");
  const resumeRecording = () => setRecState("recording");

  const stopRecording = () => {
    setRecState("completed");
    setInterimText("");
  };

  const generateSummary = () => {
    setSummaryLoading(true);
    setTimeout(() => {
      setSummary(SAMPLE_SUMMARY);
      setSummaryLoading(false);
      setShowSummary(true);
    }, 2500);
  };

  const newSession = () => {
    setRecState("idle");
    setSegments([]);
    setElapsed(0);
    setSummary("");
    setShowSummary(false);
    simIndex.current = 0;
  };

  const viewSession = (session) => {
    setSelectedSession(session);
    setView("session");
  };

  // ── Shared Components ──
  const Icon = ({ name, size = 20, color = c.t2 }) => {
    const icons = {
      mic: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0014 0"/><line x1="12" y1="20" x2="12" y2="24"/></svg>,
      pause: <svg width={size} height={size} viewBox="0 0 24 24" fill={color}><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>,
      play: <svg width={size} height={size} viewBox="0 0 24 24" fill={color}><path d="M6 4l14 8-14 8V4z"/></svg>,
      stop: <svg width={size} height={size} viewBox="0 0 24 24" fill={color}><rect x="5" y="5" width="14" height="14" rx="2"/></svg>,
      history: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>,
      back: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5"><path d="M15 4l-8 8 8 8"/></svg>,
      sparkle: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2"><path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z"/></svg>,
      copy: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h2"/></svg>,
      doc: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2"><path d="M6 2h8l6 6v12a2 2 0 01-2 2H6a2 2 0 01-2-2V4a2 2 0 012-2z"/><path d="M14 2v6h6"/></svg>,
      chevron: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2"><path d="M9 6l6 6-6 6"/></svg>,
      globe: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/></svg>,
      swap: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2"><path d="M7 16l-4-4 4-4M17 8l4 4-4 4M3 12h18"/></svg>,
    };
    return icons[name] || null;
  };

  // ── Language Picker Modal ──
  const LangPicker = ({ type, onSelect, onClose }) => (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 200 }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: c.surface, borderRadius: "20px 20px 0 0", width: "100%", maxWidth: 480, maxHeight: "70vh", overflow: "auto", padding: "24px 0 0", border: `1px solid ${c.border}` }}>
        <div style={{ padding: "0 24px 16px", borderBottom: `1px solid ${c.border}` }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: c.w }}>{type === "source" ? "Source Language" : "Target Language"}</div>
          <div style={{ fontSize: 13, color: c.t3, marginTop: 2 }}>{type === "source" ? "Language being spoken" : "Language you want to read"}</div>
        </div>
        <div style={{ padding: "8px 12px" }}>
          {LANGUAGES.map(lang => {
            const isSelected = type === "source" ? sourceLang === lang.code : targetLang === lang.code;
            return (
              <button key={lang.code} onClick={() => { onSelect(lang.code); onClose(); }}
                style={{
                  width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
                  padding: "14px 16px", borderRadius: 10, border: "none",
                  background: isSelected ? c.accentSoft : "transparent", cursor: "pointer",
                  transition: "background 0.15s",
                }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: isSelected ? c.accent : c.w }}>{lang.name}</span>
                  <span style={{ fontSize: 13, color: c.t3 }}>{lang.native}</span>
                </div>
                {isSelected && <div style={{ width: 20, height: 20, borderRadius: "50%", background: c.accent, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="#fff" strokeWidth="2.5"><path d="M2.5 6.5l2.5 2.5 4.5-4.5"/></svg>
                </div>}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );

  // ── Bottom Nav ──
  const BottomNav = () => (
    <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: c.surface, borderTop: `1px solid ${c.border}`, display: "flex", justifyContent: "center", gap: 0, padding: "8px 0 12px", zIndex: 50 }}>
      {[
        { id: "record", icon: "mic", label: "Record" },
        { id: "history", icon: "history", label: "History" },
      ].map(tab => (
        <button key={tab.id} onClick={() => { setView(tab.id); if (tab.id === "record") newSession(); }}
          style={{
            display: "flex", flexDirection: "column", alignItems: "center", gap: 3,
            padding: "6px 32px", border: "none", background: "none", cursor: "pointer",
          }}>
          <Icon name={tab.icon} size={22} color={view === tab.id || (view === "session" && tab.id === "history") ? c.accent : c.t4} />
          <span style={{ fontSize: 11, fontWeight: 600, color: view === tab.id || (view === "session" && tab.id === "history") ? c.accent : c.t4 }}>{tab.label}</span>
        </button>
      ))}
    </div>
  );

  // ═══════════════════════════════════════
  // RECORD VIEW
  // ═══════════════════════════════════════
  const RecordView = () => (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", paddingBottom: 60 }}>
      {/* Header */}
      <div style={{ padding: "16px 20px", borderBottom: `1px solid ${c.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {recState !== "idle" && (
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{
                width: 10, height: 10, borderRadius: "50%",
                background: recState === "recording" ? c.red : c.amber,
                boxShadow: recState === "recording" ? `0 0 8px ${c.red}60` : "none",
                animation: recState === "recording" ? undefined : undefined,
              }} />
              <span style={{ fontSize: 13, fontWeight: 700, color: recState === "recording" ? c.red : c.amber }}>
                {recState === "recording" ? "Recording" : recState === "paused" ? "Paused" : "Complete"}
              </span>
            </div>
          )}
          {recState === "idle" && (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Icon name="globe" size={18} color={c.accent} />
              <span style={{ fontSize: 16, fontWeight: 700, color: c.w }}>Tarjuman</span>
            </div>
          )}
        </div>
        {recState !== "idle" && (
          <div style={{ fontSize: 20, fontWeight: 700, color: c.w, fontVariantNumeric: "tabular-nums", fontFamily: "'JetBrains Mono', monospace" }}>
            {formatDuration(elapsed)}
          </div>
        )}
      </div>

      {/* ── IDLE STATE ── */}
      {recState === "idle" && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: 20, gap: 16 }}>
          {/* Language Selection */}
          <div style={{ background: c.surface, borderRadius: 16, border: `1px solid ${c.border}`, padding: "20px", display: "flex", alignItems: "center", gap: 12 }}>
            {/* Source */}
            <button onClick={() => setShowLangPicker("source")} style={{
              flex: 1, padding: "12px 14px", borderRadius: 10, background: c.surfaceLight,
              border: `1px solid ${c.borderLight}`, cursor: "pointer", textAlign: "left",
            }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: c.t4, letterSpacing: 1, textTransform: "uppercase", marginBottom: 4 }}>Listening to</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: c.w }}>{getLangName(sourceLang)}</div>
            </button>

            {/* Swap */}
            <button onClick={() => { const tmp = sourceLang; setSourceLang(targetLang); setTargetLang(tmp); }}
              style={{ width: 36, height: 36, borderRadius: 10, background: c.accentSoft, border: `1px solid ${c.accent}30`, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}>
              <Icon name="swap" size={16} color={c.accent} />
            </button>

            {/* Target */}
            <button onClick={() => setShowLangPicker("target")} style={{
              flex: 1, padding: "12px 14px", borderRadius: 10, background: c.surfaceLight,
              border: `1px solid ${c.borderLight}`, cursor: "pointer", textAlign: "left",
            }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: c.t4, letterSpacing: 1, textTransform: "uppercase", marginBottom: 4 }}>Translate to</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: c.w }}>{getLangName(targetLang)}</div>
            </button>
          </div>

          {/* Record Button */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16 }}>
            <button onClick={startRecording} style={{
              width: 120, height: 120, borderRadius: "50%", border: "none", cursor: "pointer",
              background: `linear-gradient(135deg, ${c.accent}, ${c.accentDk})`,
              boxShadow: `0 0 40px ${c.accent}30, 0 0 0 8px ${c.accentSoft}`,
              display: "flex", alignItems: "center", justifyContent: "center",
              transition: "transform 0.2s, box-shadow 0.2s",
            }}
              onMouseDown={e => e.currentTarget.style.transform = "scale(0.95)"}
              onMouseUp={e => e.currentTarget.style.transform = "scale(1)"}
            >
              <Icon name="mic" size={40} color="#fff" />
            </button>
            <span style={{ fontSize: 14, color: c.t3 }}>Tap to start transcribing</span>
          </div>

          {/* Recent Sessions Preview */}
          {PAST_SESSIONS.length > 0 && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: c.t4, letterSpacing: 1, textTransform: "uppercase", marginBottom: 10 }}>Recent</div>
              {PAST_SESSIONS.slice(0, 3).map(s => (
                <button key={s.id} onClick={() => viewSession(s)} style={{
                  width: "100%", display: "flex", alignItems: "center", gap: 12,
                  padding: "12px 14px", borderRadius: 10, border: "none",
                  background: c.surface, cursor: "pointer", marginBottom: 6,
                  textAlign: "left",
                }}>
                  <Icon name="doc" size={18} color={c.t4} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: c.t2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.title}</div>
                    <div style={{ fontSize: 11, color: c.t4 }}>{getLangName(s.source)} \u2192 {getLangName(s.target)} \u00b7 {formatDate(s.date)}</div>
                  </div>
                  <span style={{ fontSize: 12, color: c.t4, fontVariantNumeric: "tabular-nums" }}>{formatDuration(s.duration)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── RECORDING / PAUSED STATE ── */}
      {(recState === "recording" || recState === "paused") && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
          {/* Language bar */}
          <div style={{ padding: "8px 20px", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, borderBottom: `1px solid ${c.border}` }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: c.t3 }}>{getLangName(sourceLang)}</span>
            <span style={{ fontSize: 12, color: c.t4 }}>\u2192</span>
            <span style={{ fontSize: 12, fontWeight: 600, color: c.accent }}>{getLangName(targetLang)}</span>
            {recState === "recording" && (
              <div style={{ display: "flex", gap: 3, marginLeft: 8 }}>
                {[0, 1, 2].map(i => (
                  <div key={i} style={{
                    width: 4, height: 4, borderRadius: "50%",
                    background: pulsePhase === i ? c.accent : `${c.accent}30`,
                    transition: "background 0.3s",
                  }} />
                ))}
              </div>
            )}
          </div>

          {/* Transcript Area */}
          <div ref={transcriptRef} style={{ flex: 1, overflow: "auto", padding: "16px 20px" }}>
            {segments.length === 0 && !interimText && (
              <div style={{ textAlign: "center", padding: "40px 0", color: c.t4 }}>
                <div style={{ fontSize: 14 }}>Listening...</div>
                <div style={{ fontSize: 12, marginTop: 4 }}>Speak clearly into your device</div>
              </div>
            )}

            {segments.map((seg, i) => (
              <div key={seg.id} style={{ marginBottom: 20 }}>
                {/* Source */}
                <div style={{
                  padding: "10px 14px", borderRadius: 10,
                  background: `${c.blue}08`, borderLeft: `3px solid ${c.blue}40`,
                  direction: isRtl(sourceLang) ? "rtl" : "ltr",
                  textAlign: isRtl(sourceLang) ? "right" : "left",
                  marginBottom: 6,
                }}>
                  <div style={{ fontSize: 15, color: c.t2, lineHeight: 1.7 }}>{seg.sourceText}</div>
                </div>
                {/* Translation */}
                <div style={{
                  padding: "10px 14px", borderRadius: 10,
                  background: `${c.accent}06`, borderLeft: `3px solid ${c.accent}40`,
                  direction: isRtl(targetLang) ? "rtl" : "ltr",
                  textAlign: isRtl(targetLang) ? "right" : "left",
                }}>
                  <div style={{ fontSize: 15, color: c.w, lineHeight: 1.7, fontWeight: 500 }}>{seg.translatedText}</div>
                </div>
              </div>
            ))}

            {/* Interim text */}
            {interimText && (
              <div style={{
                padding: "10px 14px", borderRadius: 10,
                background: `${c.blue}05`, borderLeft: `3px solid ${c.blue}20`,
                direction: isRtl(sourceLang) ? "rtl" : "ltr",
                textAlign: isRtl(sourceLang) ? "right" : "left",
                opacity: 0.5,
              }}>
                <div style={{ fontSize: 15, color: c.t3, lineHeight: 1.7 }}>{interimText}</div>
              </div>
            )}
          </div>

          {/* Controls */}
          <div style={{ padding: "16px 20px", borderTop: `1px solid ${c.border}`, display: "flex", justifyContent: "center", gap: 16 }}>
            {recState === "recording" ? (
              <>
                <button onClick={pauseRecording} style={{
                  width: 56, height: 56, borderRadius: 16, border: `1px solid ${c.amber}30`,
                  background: c.amberSoft, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  <Icon name="pause" size={22} color={c.amber} />
                </button>
                <button onClick={stopRecording} style={{
                  width: 56, height: 56, borderRadius: 16, border: `1px solid ${c.red}30`,
                  background: c.redSoft, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  <Icon name="stop" size={22} color={c.red} />
                </button>
              </>
            ) : (
              <>
                <button onClick={resumeRecording} style={{
                  width: 56, height: 56, borderRadius: 16, border: `1px solid ${c.accent}30`,
                  background: c.accentSoft, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  <Icon name="play" size={22} color={c.accent} />
                </button>
                <button onClick={stopRecording} style={{
                  width: 56, height: 56, borderRadius: 16, border: `1px solid ${c.red}30`,
                  background: c.redSoft, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  <Icon name="stop" size={22} color={c.red} />
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── COMPLETED STATE ── */}
      {recState === "completed" && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
          {/* Complete badge */}
          <div style={{ padding: "12px 20px", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, borderBottom: `1px solid ${c.border}` }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: c.accent }} />
            <span style={{ fontSize: 13, fontWeight: 600, color: c.accent }}>Session Complete</span>
            <span style={{ fontSize: 13, color: c.t3 }}>\u00b7 {segments.length} segments \u00b7 {getLangName(sourceLang)} \u2192 {getLangName(targetLang)}</span>
          </div>

          {/* Transcript + Summary */}
          <div style={{ flex: 1, overflow: "auto", padding: "16px 20px" }}>
            {/* Summary Section */}
            {!showSummary && !summaryLoading && (
              <button onClick={generateSummary} style={{
                width: "100%", padding: "16px 20px", borderRadius: 14,
                background: `linear-gradient(135deg, ${c.accent}10, ${c.blue}10)`,
                border: `1px solid ${c.accent}25`, cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
                marginBottom: 20,
              }}>
                <Icon name="sparkle" size={20} color={c.accent} />
                <span style={{ fontSize: 15, fontWeight: 700, color: c.accent }}>Generate Summary</span>
              </button>
            )}

            {summaryLoading && (
              <div style={{
                padding: "24px 20px", borderRadius: 14, background: c.surface,
                border: `1px solid ${c.border}`, marginBottom: 20, textAlign: "center",
              }}>
                <div style={{ display: "flex", justifyContent: "center", gap: 4, marginBottom: 10 }}>
                  {[0, 1, 2].map(i => (
                    <div key={i} style={{
                      width: 6, height: 6, borderRadius: "50%", background: c.accent,
                      opacity: (Date.now() / 400 + i) % 3 < 1 ? 1 : 0.3,
                      animation: `pulse 1.2s ease-in-out ${i * 0.2}s infinite`,
                    }} />
                  ))}
                </div>
                <span style={{ fontSize: 13, color: c.t3 }}>Generating summary with AI...</span>
              </div>
            )}

            {showSummary && summary && (
              <div style={{
                padding: "20px", borderRadius: 14, background: `${c.accent}06`,
                border: `1px solid ${c.accent}15`, marginBottom: 20,
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
                  <Icon name="sparkle" size={16} color={c.accent} />
                  <span style={{ fontSize: 14, fontWeight: 700, color: c.accent }}>AI Summary</span>
                </div>
                <div style={{ fontSize: 14, color: c.t2, lineHeight: 1.8, whiteSpace: "pre-line" }}>
                  {summary.replace(/\*\*(.*?)\*\*/g, "$1").replace(/• /g, "\u2022 ")}
                </div>
              </div>
            )}

            {/* Full Transcript */}
            <div style={{ fontSize: 12, fontWeight: 600, color: c.t4, letterSpacing: 1, textTransform: "uppercase", marginBottom: 12 }}>Full Transcript</div>
            {segments.map(seg => (
              <div key={seg.id} style={{ marginBottom: 16 }}>
                <div style={{
                  padding: "10px 14px", borderRadius: 10,
                  background: `${c.blue}08`, borderLeft: `3px solid ${c.blue}40`,
                  direction: isRtl(sourceLang) ? "rtl" : "ltr",
                  textAlign: isRtl(sourceLang) ? "right" : "left",
                  marginBottom: 4,
                }}>
                  <div style={{ fontSize: 14, color: c.t2, lineHeight: 1.7 }}>{seg.sourceText}</div>
                </div>
                <div style={{
                  padding: "10px 14px", borderRadius: 10,
                  background: `${c.accent}06`, borderLeft: `3px solid ${c.accent}40`,
                }}>
                  <div style={{ fontSize: 14, color: c.w, lineHeight: 1.7 }}>{seg.translatedText}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Bottom actions */}
          <div style={{ padding: "12px 20px", borderTop: `1px solid ${c.border}`, display: "flex", gap: 10 }}>
            <button onClick={newSession} style={{
              flex: 1, padding: "14px 0", borderRadius: 12,
              background: `linear-gradient(135deg, ${c.accent}, ${c.accentDk})`,
              border: "none", color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            }}>
              <Icon name="mic" size={16} color="#fff" />
              New Recording
            </button>
            <button style={{
              width: 48, height: 48, borderRadius: 12, background: c.surface,
              border: `1px solid ${c.border}`, cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <Icon name="copy" size={18} color={c.t3} />
            </button>
          </div>
        </div>
      )}
    </div>
  );

  // ═══════════════════════════════════════
  // HISTORY VIEW
  // ═══════════════════════════════════════
  const HistoryView = () => (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", paddingBottom: 60 }}>
      <div style={{ padding: "16px 20px", borderBottom: `1px solid ${c.border}` }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: c.w }}>History</div>
        <div style={{ fontSize: 13, color: c.t3, marginTop: 2 }}>{PAST_SESSIONS.length} sessions</div>
      </div>
      <div style={{ flex: 1, overflow: "auto", padding: "12px 20px" }}>
        {PAST_SESSIONS.map(s => (
          <button key={s.id} onClick={() => viewSession(s)} style={{
            width: "100%", textAlign: "left", padding: "16px", borderRadius: 14,
            background: c.surface, border: `1px solid ${c.border}`, cursor: "pointer",
            marginBottom: 8, display: "flex", alignItems: "center", gap: 14,
          }}>
            <div style={{
              width: 44, height: 44, borderRadius: 12, background: c.surfaceLight,
              display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
            }}>
              <Icon name="doc" size={20} color={c.t3} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: c.w, marginBottom: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.title}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontSize: 12, color: c.t3 }}>{getLangName(s.source)} \u2192 {getLangName(s.target)}</span>
                <span style={{ fontSize: 12, color: c.t4 }}>\u00b7</span>
                <span style={{ fontSize: 12, color: c.t4 }}>{formatDate(s.date)}</span>
                <span style={{ fontSize: 12, color: c.t4 }}>\u00b7</span>
                <span style={{ fontSize: 12, color: c.t4 }}>{formatDuration(s.duration)}</span>
                {s.hasSummary && (
                  <span style={{ fontSize: 10, fontWeight: 600, color: c.accent, background: c.accentSoft, padding: "2px 8px", borderRadius: 100 }}>Summary</span>
                )}
              </div>
            </div>
            <Icon name="chevron" size={18} color={c.t4} />
          </button>
        ))}
      </div>
    </div>
  );

  // ═══════════════════════════════════════
  // SESSION DETAIL VIEW
  // ═══════════════════════════════════════
  const SessionView = () => {
    if (!selectedSession) return null;
    const s = selectedSession;
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100%", paddingBottom: 60 }}>
        <div style={{ padding: "12px 20px", borderBottom: `1px solid ${c.border}`, display: "flex", alignItems: "center", gap: 12 }}>
          <button onClick={() => setView("history")} style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}>
            <Icon name="back" size={20} color={c.t2} />
          </button>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: c.w }}>{s.title}</div>
            <div style={{ fontSize: 12, color: c.t3 }}>{getLangName(s.source)} \u2192 {getLangName(s.target)} \u00b7 {formatDuration(s.duration)} \u00b7 {formatDate(s.date)}</div>
          </div>
        </div>
        <div style={{ flex: 1, overflow: "auto", padding: "16px 20px" }}>
          {/* Summary */}
          {s.hasSummary ? (
            <div style={{
              padding: "20px", borderRadius: 14, background: `${c.accent}06`,
              border: `1px solid ${c.accent}15`, marginBottom: 20,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
                <Icon name="sparkle" size={16} color={c.accent} />
                <span style={{ fontSize: 14, fontWeight: 700, color: c.accent }}>AI Summary</span>
              </div>
              <div style={{ fontSize: 14, color: c.t2, lineHeight: 1.8, whiteSpace: "pre-line" }}>
                {SAMPLE_SUMMARY.replace(/\*\*(.*?)\*\*/g, "$1").replace(/• /g, "\u2022 ")}
              </div>
            </div>
          ) : (
            <button style={{
              width: "100%", padding: "16px 20px", borderRadius: 14,
              background: `linear-gradient(135deg, ${c.accent}10, ${c.blue}10)`,
              border: `1px solid ${c.accent}25`, cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
              marginBottom: 20,
            }}>
              <Icon name="sparkle" size={20} color={c.accent} />
              <span style={{ fontSize: 15, fontWeight: 700, color: c.accent }}>Generate Summary</span>
            </button>
          )}

          {/* Transcript */}
          <div style={{ fontSize: 12, fontWeight: 600, color: c.t4, letterSpacing: 1, textTransform: "uppercase", marginBottom: 12 }}>Transcript ({s.segments} segments)</div>
          {SAMPLE_SEGMENTS.map(seg => (
            <div key={seg.id} style={{ marginBottom: 16 }}>
              <div style={{
                padding: "10px 14px", borderRadius: 10,
                background: `${c.blue}08`, borderLeft: `3px solid ${c.blue}40`,
                direction: isRtl(s.source) ? "rtl" : "ltr",
                textAlign: isRtl(s.source) ? "right" : "left",
                marginBottom: 4,
              }}>
                <div style={{ fontSize: 14, color: c.t2, lineHeight: 1.7 }}>{seg.sourceText}</div>
              </div>
              <div style={{
                padding: "10px 14px", borderRadius: 10,
                background: `${c.accent}06`, borderLeft: `3px solid ${c.accent}40`,
              }}>
                <div style={{ fontSize: 14, color: c.w, lineHeight: 1.7 }}>{seg.translatedText}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  // ═══════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════
  return (
    <div style={{
      width: "100%", maxWidth: 420, height: "100vh", margin: "0 auto",
      background: c.bg, fontFamily: "'DM Sans', -apple-system, system-ui, sans-serif",
      color: c.w, display: "flex", flexDirection: "column", position: "relative",
      overflow: "hidden", WebkitFontSmoothing: "antialiased",
    }}>
      {view === "record" && <RecordView />}
      {view === "history" && <HistoryView />}
      {view === "session" && <SessionView />}
      <BottomNav />

      {/* Language Picker */}
      {showLangPicker && (
        <LangPicker
          type={showLangPicker}
          onSelect={(code) => showLangPicker === "source" ? setSourceLang(code) : setTargetLang(code)}
          onClose={() => setShowLangPicker(null)}
        />
      )}
    </div>
  );
}
